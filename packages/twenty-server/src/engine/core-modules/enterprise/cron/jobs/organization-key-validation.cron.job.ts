/* Licensed under AGPLv3 */

import { Injectable, Logger } from '@nestjs/common';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ENTERPRISE_KEY_VALIDATION_CRON_PATTERN } from 'src/engine/core-modules/enterprise/constants/organization-key-validation-cron-pattern.constant';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';

@Injectable()
@Processor(MessageQueue.cronQueue)
export class EnterpriseKeyValidationCronJob {
  private readonly logger = new Logger(EnterpriseKeyValidationCronJob.name);

  @Process(EnterpriseKeyValidationCronJob.name)
  @SentryCronMonitor(
    EnterpriseKeyValidationCronJob.name,
    ENTERPRISE_KEY_VALIDATION_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    this.logger.log('Skipping twenty.com license refresh; features are ungated.');
  }
}
