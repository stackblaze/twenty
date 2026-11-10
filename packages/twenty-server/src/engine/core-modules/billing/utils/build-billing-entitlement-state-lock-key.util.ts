/* Licensed under AGPLv3 */

export const buildBillingEntitlementStateLockKey = (
  workspaceId: string,
): string => `billing-entitlement-state:${workspaceId}`;
