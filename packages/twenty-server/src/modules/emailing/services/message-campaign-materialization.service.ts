import { Injectable } from '@nestjs/common';

import chunk from 'lodash.chunk';
import { type ObjectLiteral } from 'typeorm';
import { v4 } from 'uuid';

import {
  CAMPAIGN_MATERIALIZATION_CHUNK_SIZE,
  CAMPAIGN_MESSAGE_DELIVERY_STATUS,
  SEND_CAMPAIGN_EMAIL_JOB,
} from 'src/engine/core-modules/emailing-domain/constants/campaign.constant';
import { type MaterializeCampaignJobData } from 'src/engine/core-modules/emailing-domain/types/materialize-campaign-job-data.type';
import { type SendCampaignEmailJobData } from 'src/engine/core-modules/emailing-domain/types/send-campaign-email-job-data.type';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MessageCampaignLifecycleService } from 'src/modules/emailing/services/message-campaign-lifecycle.service';
import { MessageCampaignWorkspaceEntity } from 'src/modules/emailing/standard-objects/message-campaign.workspace-entity';
import { type CampaignMessageRecipient } from 'src/modules/emailing/types/campaign-message-recipient.type';
import { buildCampaignMessageId } from 'src/modules/emailing/utils/build-campaign-message-id.util';
import { compileCampaignEmailContent } from 'src/modules/emailing/utils/compile-campaign-email-content.util';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageThreadWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-thread.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import {
  MessageCampaignStatus,
  MessageParticipantRole,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

type CampaignMessageRow = {
  recipient: CampaignMessageRecipient;
  messageId: string;
  threadId: string;
  temporaryExternalId: string;
};

type MaterializeMessagesArgs = {
  campaignId: string;
  messageChannelId: string;
  fromAddress: string;
  subjectTemplate: string;
  bodyTemplate: string;
  recipients: CampaignMessageRecipient[];
};

@Injectable()
export class MessageCampaignMaterializationService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly messageCampaignLifecycleService: MessageCampaignLifecycleService,
    @InjectMessageQueue(MessageQueue.emailQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async processMaterializeJob({
    workspaceId,
    campaignId,
    messageChannelId,
    emailingDomainId,
    recipients,
  }: MaterializeCampaignJobData): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const campaignRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          MessageCampaignWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      const campaign = await campaignRepository.findOne({
        where: { id: campaignId },
      });

      if (
        !isDefined(campaign) ||
        campaign.status !== MessageCampaignStatus.SENDING
      ) {
        return;
      }

      const recipientsByMessageId = new Map<string, CampaignMessageRecipient>();

      for (const recipient of recipients) {
        const messageId = buildCampaignMessageId({
          campaignId,
          personId: recipient.personId,
        });

        if (!recipientsByMessageId.has(messageId)) {
          recipientsByMessageId.set(messageId, { ...recipient, messageId });
        }
      }

      const messageRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          MessageWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      const existingMessages = await messageRepository.find({
        where: { messageCampaignId: campaignId },
        select: { id: true },
      });
      const existingMessageIds = new Set(
        existingMessages.map((message) => message.id),
      );

      const recipientsToCreate = [...recipientsByMessageId.values()].filter(
        (recipient) => !existingMessageIds.has(recipient.messageId),
      );

      if (recipientsToCreate.length > 0) {
        await this.materializeMessages({
          campaignId,
          messageChannelId,
          fromAddress: campaign.fromAddress?.primaryEmail ?? '',
          subjectTemplate: campaign.subject ?? '',
          bodyTemplate: campaign.bodyTemplate ?? '',
          recipients: recipientsToCreate,
        });
      }

      // Only the recipients this run created. A replay skips the ones an earlier run already
      // materialized, whose send jobs it also already enqueued, so no recipient gets two jobs.
      // Messages stranded by a run that died between materializing and enqueueing are picked up
      // by the stuck-campaign sweeper instead.
      await this.messageQueueService.bulkAdd<SendCampaignEmailJobData>(
        SEND_CAMPAIGN_EMAIL_JOB,
        recipientsToCreate.map((recipient) => ({
          workspaceId,
          campaignId,
          messageId: recipient.messageId,
          personId: recipient.personId,
          recipientEmail: recipient.email,
          emailingDomainId,
        })),
        { retryLimit: 3 },
      );

      await this.messageCampaignLifecycleService.finalizeCampaignIfComplete({
        workspaceId,
        campaignId,
      });
    }, buildSystemAuthContext(workspaceId));
  }

  async materializeMessages({
    campaignId,
    messageChannelId,
    fromAddress,
    subjectTemplate,
    bodyTemplate,
    recipients,
  }: MaterializeMessagesArgs): Promise<void> {
    const now = new Date();
    // The stored message keeps the unresolved template, so placeholders stay
    // visible on the campaign's message records.
    const { plainText: text } = await compileCampaignEmailContent(
      bodyTemplate,
      null,
    );
    const rows = recipients.map((recipient) => ({
      recipient,
      messageId: recipient.messageId,
      threadId: v4(),
      temporaryExternalId: v4(),
    }));

    for (const rowsChunk of chunk(rows, CAMPAIGN_MATERIALIZATION_CHUNK_SIZE)) {
      await this.insertChunk({
        campaignId,
        messageChannelId,
        fromAddress,
        subjectTemplate,
        text,
        now,
        rows: rowsChunk,
      });
    }
  }

  private async insertChunk({
    campaignId,
    messageChannelId,
    fromAddress,
    subjectTemplate,
    text,
    now,
    rows,
  }: {
    campaignId: string;
    messageChannelId: string;
    fromAddress: string;
    subjectTemplate: string;
    text: string;
    now: Date;
    rows: CampaignMessageRow[];
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.runInWorkspaceTransaction(
      async (transactionScope) => {
        const repositoryOf = <T extends ObjectLiteral>(
          objectMetadataName: string,
        ) =>
          transactionScope.getRepository<T>(objectMetadataName, {
            shouldBypassPermissionChecks: true,
          });

        await repositoryOf<MessageThreadWorkspaceEntity>(
          'messageThread',
        ).insert(rows.map((row) => ({ id: row.threadId })));
        await repositoryOf<MessageWorkspaceEntity>('message').insert(
          rows.map((row) => ({
            id: row.messageId,
            headerMessageId: row.temporaryExternalId,
            subject: subjectTemplate,
            text,
            receivedAt: now,
            messageThreadId: row.threadId,
            messageCampaignId: campaignId,
            deliveryStatus: CAMPAIGN_MESSAGE_DELIVERY_STATUS.QUEUED,
          })),
        );
        await repositoryOf<MessageChannelMessageAssociationWorkspaceEntity>(
          'messageChannelMessageAssociation',
        ).insert(
          rows.map((row) => ({
            id: v4(),
            messageId: row.messageId,
            messageChannelId,
            messageExternalId: row.temporaryExternalId,
            messageThreadExternalId: row.temporaryExternalId,
            direction: MessageDirection.OUTGOING,
          })),
        );
        await repositoryOf<MessageParticipantWorkspaceEntity>(
          'messageParticipant',
        ).insert(
          rows.flatMap((row) => [
            {
              id: v4(),
              messageId: row.messageId,
              role: MessageParticipantRole.FROM,
              handle: fromAddress,
              displayName: fromAddress,
            },
            {
              id: v4(),
              messageId: row.messageId,
              role: MessageParticipantRole.TO,
              handle: row.recipient.email,
              displayName: row.recipient.email,
              personId: row.recipient.personId,
              messageCampaignId: campaignId,
            },
          ]),
        );
      },
    );
  }
}
