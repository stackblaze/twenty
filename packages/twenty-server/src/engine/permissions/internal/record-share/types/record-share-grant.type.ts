/* Licensed under AGPLv3 */

import { type RecordShare } from 'src/engine/permissions/record-share/types/record-share.type';

export type RecordShareGrant = Pick<
  RecordShare,
  'recordId' | 'principalId' | 'accessLevel'
>;
