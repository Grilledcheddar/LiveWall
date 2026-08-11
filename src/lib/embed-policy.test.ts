import { describe, expect, it } from 'vitest';
import { getEmbedPolicy } from './embed-policy';

describe('embed policy', () => {
  it('deterministically marks Weatherwise External Only without relying on iframe load or WebGL', () => {
    const policy = getEmbedPolicy({
      type: 'website',
      url: 'https://web.weatherwise.app/#map=8.03/35.519/-97.062&rt=KTLX&rp=REF0',
    });
    expect(policy).toMatchObject({ externalOnly: true, webglRequired: true });
    expect(policy?.message).toContain('does not allow embedding');
  });

  it('does not apply the Weatherwise policy to other generic providers', () => {
    expect(getEmbedPolicy({ type: 'website', url: 'https://example.com/' })).toBeUndefined();
  });
});
