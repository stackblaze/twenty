/* Licensed under AGPLv3 */

export type BillingSubscriptionItemMetadata =
  | {
      trialPeriodFreeWorkflowCredits: number;
    }
  | Record<string, never>;
