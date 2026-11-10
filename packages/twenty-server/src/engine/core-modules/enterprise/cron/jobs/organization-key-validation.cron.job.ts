/* @license Enterprise */

import { Injectable, Logger } from '@nestjs/common';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ENTERPRISE_KEY_VALIDATION_CRON_PATTERN } from 'src/engine/core-modules/enterprise/constants/organization-key-validation-cron-pattern.constant';
import { type EnterpriseKeyValidationCronJobData } from 'src/engine/core-modules/enterprise/types/enterprise-key-validation-cron-job-data.type';
import { toMinuteLevelCronPattern } from 'src/engine/core-modules/enterprise/utils/to-minute-level-cron-pattern.util';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';

@Injectable()
@Processor(MessageQueue.cronQueue)
export class EnterpriseKeyValidationCronJob {
  private readonly logger = new Logger(EnterpriseKeyValidationCronJob.name);

  @Process(EnterpriseKeyValidationCronJob.name)
  // Sentry follows the pattern the queue registered, not one recomputed here.
  // Schedulers registered by older versions carry no data and run at 04:00.
  @SentryCronMonitor(
    EnterpriseKeyValidationCronJob.name,
    (data?: EnterpriseKeyValidationCronJobData) =>
      toMinuteLevelCronPattern(
        data?.cronPattern ?? ENTERPRISE_KEY_VALIDATION_CRON_PATTERN,
      ),
  )
  async handle(
    _data: EnterpriseKeyValidationCronJobData | undefined,
  ): Promise<void> {
    this.logger.log(
      'Skipping twenty.com license refresh; Organization features are ungated.',
    );
  }
}
