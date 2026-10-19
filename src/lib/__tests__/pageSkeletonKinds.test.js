import { describe, it, expect } from 'vitest';
import { kindForPath, portalPageCount } from '../pageSkeletonKinds';

describe('page skeletons', () => {
  it('gives each farmer page its own shape', () => {
    const kinds = ['/farmer', '/farmer/harvest', '/farmer/reports', '/farmer/fmr-projects', '/farmer/markets', '/farmer/profile']
      .map((p) => kindForPath('farmer', p));
    expect(new Set(kinds).size).toBe(6);
  });

  it('ignores a trailing slash and falls back for unknown pages', () => {
    expect(kindForPath('farmer', '/farmer/harvest/')).toBe('kpiForm');
    expect(kindForPath('user', '/user/unknown')).toBe('dashboard');
  });

  it('draws one sidebar item per page', () => {
    expect(portalPageCount('farmer')).toBe(6);
    expect(portalPageCount('contractor')).toBe(4);
  });
});
