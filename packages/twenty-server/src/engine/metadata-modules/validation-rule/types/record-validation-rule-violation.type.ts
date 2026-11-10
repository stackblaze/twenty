/* Licensed under AGPLv3 */

export type RecordValidationRuleViolation = {
  ruleId: string;
  message: string;
  fieldMetadataId: string | null;
  recordId: string;
  inputIndex: number | null;
};
