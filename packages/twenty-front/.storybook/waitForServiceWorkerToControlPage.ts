import { isDefined } from 'twenty-shared/utils';

// An iframe that navigates while the worker is still activating is claimed once
// activation finishes. This only backstops a worker that never activates.
const SERVICE_WORKER_CLAIM_BACKSTOP_MS = 60_000;

export const waitForServiceWorkerToControlPage = async () => {
  if (isDefined(navigator.serviceWorker.controller)) {
    return;
  }

  const registration = await navigator.serviceWorker.getRegistration();

  if (!isDefined(registration)) {
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => resolve(),
        { once: true },
      );
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, SERVICE_WORKER_CLAIM_BACKSTOP_MS);
    }),
  ]);
};
