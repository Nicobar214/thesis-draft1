import { describe, it, expect, vi, afterEach } from 'vitest';
import { sampleAlongLine, pickShortestByRoad, findRoadAccess, MAX_CANDIDATES } from '../farmRoadAccess';

describe('sampleAlongLine', () => {
  it('spreads points evenly from end to end', () => {
    const pts = sampleAlongLine([[10, 122], [10, 122.01]], 3);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual([10, 122]);
    expect(pts[1][1]).toBeCloseTo(122.005, 5);
    expect(pts[2]).toEqual([10, 122.01]);
  });

  it('caps the number of spots', () => {
    const line = Array.from({ length: 200 }, (_, i) => [10, 122 + i * 0.0001]);
    expect(sampleAlongLine(line)).toHaveLength(MAX_CANDIDATES);
  });
});

describe('pickShortestByRoad', () => {
  it('chooses the spot with the shortest trip by road, not the closest one', () => {
    // Spot 0 is right across the river (huge detour by road); spot 1 is farther but on the same side.
    const table = {
      distances: [[0, 5200, 650]],
      sources: [{ distance: 40 }],
      destinations: [{}, { distance: 5 }, { distance: 5 }],
    };
    const best = pickShortestByRoad(table, [['across'], ['same side']]);
    expect(best.point).toEqual(['same side']);
    expect(best.meters).toBe(40 + 650 + 5);
    expect(best.offRoadMeters).toBe(40);
  });

  it('skips spots the network cannot reach', () => {
    expect(pickShortestByRoad({ distances: [[0, null, null]] }, [[1], [2]])).toBeNull();
  });
});

describe('findRoadAccess', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to a straight line when the road network cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const res = await findRoadAccess([10.001, 122.005], [[10, 122], [10, 122.01]]);
    expect(res.byRoad).toBe(false);
    expect(res.path).toHaveLength(2);
    expect(res.point[0]).toBeCloseTo(10, 6);
  });
});
