/* Licensed under AGPLv3 */

export type WorkspaceCreditAllowanceWindow = {
  creditAllowanceMicro: number;
  startsAtMs: number;
  endsAtMs: number | null;
};
