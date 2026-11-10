/* Licensed under AGPLv3 */

import { type RowLevelPermissionPredicate } from 'twenty-shared/types';

export const buildMemberFieldKey = ({
  workspaceMemberFieldMetadataId,
  workspaceMemberSubFieldName,
}: Pick<
  RowLevelPermissionPredicate,
  'workspaceMemberFieldMetadataId' | 'workspaceMemberSubFieldName'
>): string =>
  `${workspaceMemberFieldMetadataId}:${workspaceMemberSubFieldName ?? ''}`;
