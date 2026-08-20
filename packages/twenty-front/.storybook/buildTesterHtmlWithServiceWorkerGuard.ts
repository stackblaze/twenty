import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const TESTER_SCRIPT_MARKER = '<script type="module" crossorigin';

// An iframe whose navigation starts just before the msw service worker finishes
// activating is never controlled by it: clients.claim() runs once, during
// activation, so no later event can claim it. msw recovers by reloading the
// page, and when that lands mid-test vitest aborts the whole shard. Doing the
// reload here instead, while the tester document is still loading, keeps it
// invisible to vitest's orchestrator.
const SERVICE_WORKER_GUARD = `<script type="module">
      const registration = await navigator.serviceWorker.getRegistration();

      if (
        navigator.serviceWorker.controller === null &&
        registration?.active != null
      ) {
        const alreadyReloadedKey =
          'msw-uncontrolled-reload:' +
          new URLSearchParams(location.search).get('iframeId');

        if (sessionStorage.getItem(alreadyReloadedKey) === null) {
          sessionStorage.setItem(alreadyReloadedKey, 'true');
          location.reload();
        }
      }
    </script>
    `;

export const buildTesterHtmlWithServiceWorkerGuard = () => {
  const require = createRequire(import.meta.url);
  const browserDistPath = path.dirname(
    require.resolve('@vitest/browser/package.json'),
  );
  const testerHtml = readFileSync(
    path.join(browserDistPath, 'dist/client/tester/tester.html'),
    'utf8',
  );

  if (!testerHtml.includes(TESTER_SCRIPT_MARKER)) {
    throw new Error(
      `Could not find "${TESTER_SCRIPT_MARKER}" in vitest's tester.html. The service worker guard in ${import.meta.url} needs updating for this vitest version.`,
    );
  }

  const guardedHtmlPath = path.join(
    os.tmpdir(),
    'twenty-front-vitest',
    'tester.html',
  );

  mkdirSync(path.dirname(guardedHtmlPath), { recursive: true });
  writeFileSync(
    guardedHtmlPath,
    testerHtml.replace(
      TESTER_SCRIPT_MARKER,
      `${SERVICE_WORKER_GUARD}${TESTER_SCRIPT_MARKER}`,
    ),
  );

  return guardedHtmlPath;
};
