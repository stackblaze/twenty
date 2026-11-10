/* Licensed under AGPLv3 */

export const ACCESS_GROUP_SYNC_LOCK_OPTIONS = { ms: 500, maxRetries: 120 };

export const buildAccessGroupSyncLockKey = (workspaceId: string): string =>
  `access-group-sync:${workspaceId}`;
