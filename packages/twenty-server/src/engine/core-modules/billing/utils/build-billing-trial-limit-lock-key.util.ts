/* Licensed under AGPLv3 */

export const buildBillingTrialLimitLockKey = (userId: string): string =>
  `billing-trial-limit:${userId}`;
