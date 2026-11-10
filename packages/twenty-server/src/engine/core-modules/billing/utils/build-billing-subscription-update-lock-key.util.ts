/* Licensed under AGPLv3 */

export const buildBillingSubscriptionUpdateLockKey = (
  workspaceId: string,
): string => `billing-subscription-update:${workspaceId}`;
