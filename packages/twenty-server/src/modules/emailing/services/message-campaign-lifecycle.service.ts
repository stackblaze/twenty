import { Injectable, type Type } from '@nestjs/common';

import chunk from 'lodash.chunk';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import { In, type ObjectLiteral } from 'typeorm';

import {
  CAMPAIGN_MESSAGE_DELIVERY_STATUS,
  CAMPAIGN_STATS_REFRESH_DELAY_MS,
  REFRESH_CAMPAIGN_STATS_JOB,
  type CampaignMessageDeliveryStatus,
} from 'src/engine/core-modules/emailing-domain/constants/campaign.constant';
import {
  EmailingDomainException,
  EmailingDomainExceptionCode,
} from 'src/engine/core-modules/emailing-domain/exceptions/emailing-domain.exception';
import { type RefreshCampaignStatsJobData } from 'src/engine/core-modules/emailing-domain/types/refresh-campaign-stats-job-data.type';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MessageCampaignStatisticsService } from 'src/modules/emailing/services/message-campaign-statistics.service';
import { MessageCampaignWorkspaceEntity } from 'src/modules/emailing/standard-objects/message-campaign.workspace-entity';
import { computeCampaignTerminalStatus } from 'src/modules/emailing/utils/compute-campaign-terminal-status.util';
import { readCampaignMessageCounts } from 'src/modules/emailing/utils/read-campaign-message-counts.util';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { MessageCampaignStatus } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

type CampaignStatusTransition = {
  workspaceId: string;
  campaignId: string;
  from: MessageCampaignStatus;
  to: MessageCampaignStatus;
  roleId?: string;
};

@Injectable()
export class MessageCampaignLifecycleService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly userRoleService: UserRoleService,
    private readonly messageCampaignStatisticsService: MessageCampaignStatisticsService,
    @InjectMessageQueue(MessageQueue.emailQueue)
    private readonly messageQueueService: MessageQueueService,
    @InjectCacheStorage(CacheStorageNamespace.ModuleEmailing)
    private readonly cacheStorageService: CacheStorageService,
  ) {}

  private getRepository<T extends ObjectLiteral>(
    workspaceId: string,
    entity: Type<T>,
    roleId?: string,
  ) {
    return this.globalWorkspaceOrmManager.getRepository(
      workspaceId,
      entity,
      isDefined(roleId)
        ? { unionOf: [roleId] }
        : { shouldBypassPermissionChecks: true },
    );
  }

  async transitionCampaignStatus({
    workspaceId,
    campaignId,
    from,
    to,
    roleId,
  }: CampaignStatusTransition): Promise<boolean> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const campaignRepository = await this.getRepository(
          workspaceId,
          MessageCampaignWorkspaceEntity,
          roleId,
        );

        const { affected } = await campaignRepository.update(
          { id: campaignId, status: from },
          { status: to },
        );

        return affected === 1;
      },
      // A user-initiated transition keeps the caller's context so the record event is attributed
      // to them; the recovery cron has no caller and runs as the system instead.
      isDefined(roleId) ? undefined : buildSystemAuthContext(workspaceId),
    );
  }

  async cancelCampaignOrThrow({
    workspaceId,
    userWorkspaceId,
    campaignId,
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    campaignId: string;
  }): Promise<{ campaignId: string; canceledMessageCount: number }> {
    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      workspaceId,
      userWorkspaceId,
    });

    const canceled = await this.transitionCampaignStatus({
      workspaceId,
      campaignId,
      roleId,
      from: MessageCampaignStatus.SENDING,
      to: MessageCampaignStatus.CANCELED,
    });

    if (!canceled) {
      throw new EmailingDomainException(
        `Campaign ${campaignId} is not sending`,
        EmailingDomainExceptionCode.MESSAGE_CAMPAIGN_NOT_CANCELABLE,
      );
    }

    // The campaign is CANCELED before its messages are, so a send job that runs in between
    // refuses on the campaign rather than delivering.
    const canceledMessageCount = await this.settleQueuedMessages({
      workspaceId,
      campaignId,
      deliveryStatus: CAMPAIGN_MESSAGE_DELIVERY_STATUS.SKIPPED,
    });

    await this.scheduleStatsRefresh({ workspaceId, campaignId });

    return { campaignId, canceledMessageCount };
  }

  async failStalledQueuedMessages({
    workspaceId,
    campaignId,
  }: {
    workspaceId: string;
    campaignId: string;
  }): Promise<number> {
    // Reached only for a campaign that has made no progress for an hour, so these messages have no
    // live job behind them. They are failed rather than re-enqueued because a message that does
    // still have a job would then be sent twice, and a duplicate cannot be taken back.
    return this.settleQueuedMessages({
      workspaceId,
      campaignId,
      deliveryStatus: CAMPAIGN_MESSAGE_DELIVERY_STATUS.FAILED,
    });
  }

  async settleQueuedMessages({
    workspaceId,
    campaignId,
    deliveryStatus,
  }: {
    workspaceId: string;
    campaignId: string;
    deliveryStatus: CampaignMessageDeliveryStatus;
  }): Promise<number> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageRepository = await this.getRepository(
          workspaceId,
          MessageWorkspaceEntity,
        );

        const queuedMessages = await messageRepository.find({
          where: {
            messageCampaignId: campaignId,
            deliveryStatus: CAMPAIGN_MESSAGE_DELIVERY_STATUS.QUEUED,
          },
          select: { id: true },
        });

        let settledCount = 0;

        // A workspace update reads back every row it touches to emit events and refuses beyond
        // QUERY_MAX_RECORDS, so a campaign-sized set has to be walked in batches.
        for (const idsChunk of chunk(
          queuedMessages.map((message) => message.id),
          QUERY_MAX_RECORDS,
        )) {
          // Still filtered on QUEUED: a send job can land between the read above and this write,
          // and settling by id alone would report a delivered message as unsent.
          const { affected } = await messageRepository.update(
            {
              id: In(idsChunk),
              deliveryStatus: CAMPAIGN_MESSAGE_DELIVERY_STATUS.QUEUED,
            },
            { deliveryStatus },
          );

          settledCount += affected ?? 0;
        }

        return settledCount;
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  async finalizeCampaignIfComplete({
    workspaceId,
    campaignId,
  }: {
    workspaceId: string;
    campaignId: string;
  }): Promise<void> {
    const countByDeliveryStatus =
      await this.messageCampaignStatisticsService.countMessagesByDeliveryStatus(
        { workspaceId, campaignId },
      );

    const terminalStatus = computeCampaignTerminalStatus(
      readCampaignMessageCounts(countByDeliveryStatus),
    );

    if (!isDefined(terminalStatus)) {
      return;
    }

    const campaignRepository = await this.getRepository(
      workspaceId,
      MessageCampaignWorkspaceEntity,
    );

    // A campaign already reported as SENT_WITH_ERRORS can still be corrected up to SENT once a
    // retried message succeeds, but nothing ever moves back out of a terminal state on its own.
    const correctableStatuses =
      terminalStatus === MessageCampaignStatus.SENT
        ? [
            MessageCampaignStatus.SENDING,
            MessageCampaignStatus.SENT_WITH_ERRORS,
          ]
        : [MessageCampaignStatus.SENDING];

    await campaignRepository.update(
      { id: campaignId, status: In(correctableStatuses) },
      { status: terminalStatus, sentAt: new Date() },
    );

    await this.scheduleStatsRefresh({ workspaceId, campaignId });
  }

  async scheduleStatsRefresh({
    workspaceId,
    campaignId,
  }: {
    workspaceId: string;
    campaignId: string;
  }): Promise<void> {
    const acquired = await this.cacheStorageService.acquireLock(
      `campaign-stats-refresh:${workspaceId}:${campaignId}`,
      CAMPAIGN_STATS_REFRESH_DELAY_MS,
    );

    if (!acquired) {
      return;
    }

    await this.messageQueueService.add<RefreshCampaignStatsJobData>(
      REFRESH_CAMPAIGN_STATS_JOB,
      { workspaceId, campaignId },
      { delay: CAMPAIGN_STATS_REFRESH_DELAY_MS },
    );
  }
}
