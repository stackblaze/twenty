/* Licensed under AGPLv3 */

export const buildBillingSeatLockKey = (workspaceId: string): string =>
  `billing-seat:${workspaceId}`;
