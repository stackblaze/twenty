import { Globals } from '@react-spring/web';
import { setProjectAnnotations } from '@storybook/react-vite';
import { MotionGlobalConfig } from 'framer-motion';
import { waitForServiceWorkerToControlPage } from './waitForServiceWorkerToControlPage';

MotionGlobalConfig.skipAnimations = true;
Globals.assign({ skipAnimation: true });

const disableCssAnimationsStyle = document.createElement('style');
disableCssAnimationsStyle.innerHTML = `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}`;
document.head.appendChild(disableCssAnimationsStyle);

// msw reloads the page when its service worker is registered but not yet
// controlling it, which vitest reports as "the iframe was reloaded during a
// test" and which fails the whole shard. ./preview starts the worker while it
// evaluates, so it may only be imported once the page is controlled.
await waitForServiceWorkerToControlPage();
const projectAnnotations = await import('./preview');

// Pre-warm the dynamic imports used by lazy() story components so the
// modules are cached before any test runs (avoids flaky timeouts and Argos
// screenshots that capture a Suspense skeleton instead of the loaded content).
import('~/testing/utils/getTestEnrichedObjectMetadataItemsMock');
import('react-markdown');
import('remark-gfm');
import('@/activities/components/ActivityRichTextEditor');
import('@/object-record/record-field/ui/meta-types/input/components/RichTextFieldEditor');
import('@/navigation-menu-item/display/sections/favorites/components/FavoritesSectionDispatcher');
import('@/navigation-menu-item/display/sections/workspace/components/WorkspaceSectionDispatcher');

// This is an important step to apply the right configuration when testing your stories.
// More info at: https://storybook.js.org/docs/api/portable-stories/portable-stories-vitest#setprojectannotations
setProjectAnnotations([projectAnnotations]);
