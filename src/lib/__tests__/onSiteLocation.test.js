import { describe, it, expect } from 'vitest';
import { onSiteCheck } from '../onSiteLocation';

describe('onSiteCheck', () => {
  it('accepts a precise fix close to the site', () => {
    expect(onSiteCheck({ accuracy: 12, distanceM: 80 })).toMatchObject({ ok: true, problem: null });
  });

  it('rejects a fix that is too far from the site', () => {
    const r = onSiteCheck({ accuracy: 10, distanceM: 2400 }, { place: 'the reported site' });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('2.4 km from the reported site');
  });

  it('rejects an imprecise fix even when close', () => {
    const r = onSiteCheck({ accuracy: 350, distanceM: 50 });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('±350 m');
  });

  it('skips the distance check when the site has no location', () => {
    expect(onSiteCheck({ accuracy: 20, distanceM: null }).ok).toBe(true);
  });
});
