/* Licensed under AGPLv3 */

export const buildBillingSubscriptionStateLockKey = (
  stripeCustomerId: string,
): string => `billing-subscription-state:${stripeCustomerId}`;
