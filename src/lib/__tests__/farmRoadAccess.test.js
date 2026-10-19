import { describe, it, expect, vi, afterEach } from 'vitest';
import { sampleAlongLine, pickShortestByRoad, findRoadAccess, chooseHaulRoute, MAX_CANDIDATES } from '../farmRoadAccess';

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
    expect(res.mode).toBe('straight');
    expect(res.path).toHaveLength(2);
    expect(res.point[0]).toBeCloseTo(10, 6);
  });
});

describe('chooseHaulRoute', () => {
  const leg = (km, offRoadMeters = 50) => ({ point: [0, 0], path: [[0, 0], [1, 1]], km, offRoadMeters });

  it('uses the vehicle route, the one that can carry a load', () => {
    const res = chooseHaulRoute({ vehicle: leg(2), walking: leg(1.8) });
    expect(res.mode).toBe('vehicle');
    expect(res.km).toBe(2);
    expect(res.shortcut).toBeNull(); // walking is not much shorter
  });

  it('shows a footpath shortcut only when clearly shorter', () => {
    expect(chooseHaulRoute({ vehicle: leg(3), walking: leg(1) }).shortcut.km).toBe(1);
  });

  it('warns when crops must be carried far to a vehicle road', () => {
    const res = chooseHaulRoute({ vehicle: leg(4, 1500), walking: leg(2) });
    expect(res.farCarry).toBe(true);
    expect(res.carryMeters).toBe(1500);
  });

  it('falls back to walking, then to a straight line', () => {
    expect(chooseHaulRoute({ vehicle: null, walking: leg(1) }).mode).toBe('walking');
    expect(chooseHaulRoute({ vehicle: null, walking: null, straight: leg(0.5, null) }).mode).toBe('straight');
  });
});

describe('ranking roads by road distance', () => {
  it('picks, per road, its closest spot by road', async () => {
    const { bestPerRoad } = await import('../farmRoadAccess');
    // Road A's spots are 5 km away by road (across a river); road B's are 0.8 km.
    const table = { distances: [[0, 5000, 5200, 800, 900]], sources: [{ distance: 30 }], destinations: [{}, {}, {}, {}, {}] };
    const best = bestPerRoad(table, ['A', 'A', 'B', 'B'], [[1, 1], [1, 2], [2, 1], [2, 2]]);
    expect(best.get('A').meters).toBe(5030);
    expect(best.get('B').meters).toBe(830);
    expect(best.get('B').point).toEqual([2, 1]);
  });
});
