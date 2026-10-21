import { describe, it, expect } from 'vitest';
import { distanceToLine, findRouteOverlaps, polylineLengthMeters } from '../routeOverlap';

// ~1.1 km of road heading east along lat 10.8 (0.001° lng ≈ 109 m here).
const east = (from, to) => [[10.8, 122.4 + from * 0.001], [10.8, 122.4 + to * 0.001]];

describe('distanceToLine', () => {
  it('measures the gap from a point to a road line', () => {
    expect(distanceToLine([10.8, 122.405], east(0, 10))).toBeLessThan(0.5);
    expect(distanceToLine([10.8009, 122.405], east(0, 10))).toBeCloseTo(100, -1);
  });
});

describe('findRouteOverlaps', () => {
  it('finds an existing project the new route runs along, with how much', () => {
    const route = east(0, 10);
    const { overlaps, segments } = findRouteOverlaps(route, [
      { id: 'A', name: 'Old road', line: east(5, 15) },
      { id: 'B', name: 'Far road', line: [[10.81, 122.4], [10.81, 122.41]] },
    ]);
    expect(overlaps.map((o) => o.id)).toEqual(['A']);
    expect(overlaps[0].overlapMeters).toBeGreaterThan(450);
    expect(overlaps[0].share).toBeCloseTo(0.5, 1);
    expect(segments.length).toBe(1);
  });

  it('ignores a road that only crosses or touches at a junction', () => {
    const route = east(0, 10);
    const crossing = [[10.79, 122.405], [10.81, 122.405]];
    const touchingEnd = east(10, 20);
    expect(findRouteOverlaps(route, [
      { id: 'X', name: 'Crossing', line: crossing },
      { id: 'T', name: 'Next road', line: touchingEnd },
    ]).overlaps).toEqual([]);
  });

  it('flags a route drawn on top of an existing one', () => {
    const route = east(0, 10);
    const { overlaps } = findRouteOverlaps(route, [{ id: 'D', name: 'Same road', line: east(0, 10) }]);
    expect(overlaps[0].share).toBeGreaterThan(0.95);
    expect(polylineLengthMeters(route)).toBeGreaterThan(1000);
  });
});
