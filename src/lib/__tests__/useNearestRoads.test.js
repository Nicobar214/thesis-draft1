import { afterEach, describe, it, expect, vi } from 'vitest';
import { entryCandidates } from '../useNearestRoads';
import { fetchBestEntryIndex } from '../inMapNavigation';

// A straight road about 1.1 km long heading east, points every ~110 m.
const road = Array.from({ length: 11 }, (_, i) => [10.7, 122.5 + i * 0.001]);

describe('entryCandidates', () => {
  it('starts with the straight-line nearest point and spreads the rest along the road', () => {
    const me = [10.701, 122.5];
    const nearest = [10.7, 122.5];
    const out = entryCandidates(road, nearest, me, 4);
    expect(out[0]).toEqual(nearest);
    expect(out).toHaveLength(4);
    // no two candidates on top of each other
    for (let i = 1; i < out.length; i += 1) expect(out[i]).not.toEqual(out[0]);
  });
});

describe('fetchBestEntryIndex', () => {
  afterEach(() => vi.restoreAllMocks());

  it('picks the entry that is shortest by street, counting the walk from the street', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        // candidate 0 is near in a straight line but 5 km by street
        distances: [[0, 5000, 900, 800]],
        // candidate 2 is short by street but 200 m from it
        destinations: [{ distance: 0 }, { distance: 5 }, { distance: 10 }, { distance: 200 }],
      }),
    });
    const best = await fetchBestEntryIndex([10.7, 122.5], [[1, 1], [2, 2], [3, 3]]);
    expect(best).toBe(1);
  });

  it('skips the request when there is only one candidate', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchBestEntryIndex([10.7, 122.5], [[1, 1]])).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
