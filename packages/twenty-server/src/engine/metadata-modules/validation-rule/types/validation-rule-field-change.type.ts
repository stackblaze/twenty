/* Licensed under AGPLv3 */

export type ValidationRuleFieldChange = {
  fieldUniversalIdentifier: string;
  newFieldName: string | null;
  shouldDisableRulesReadingField: boolean;
  isDeleted: boolean;
};
