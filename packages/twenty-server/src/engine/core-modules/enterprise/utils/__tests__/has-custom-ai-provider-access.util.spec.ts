/* Licensed under AGPLv3 */

import { hasCustomAiProviderAccess } from 'src/engine/core-modules/enterprise/utils/has-custom-ai-provider-access.util';

describe('hasCustomAiProviderAccess', () => {
  it('is always on', () => {
    expect(hasCustomAiProviderAccess()).toBe(true);
  });
});
