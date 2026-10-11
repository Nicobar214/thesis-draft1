import { describe, expect, it } from 'vitest';
import { nearestPointOnPolyline } from '../mapRouteUtils';

// About 0.009 degrees of latitude is 1 km.
const KM = 1 / 111.32;

describe('nearestPointOnPolyline', () => {
  it('finds the point beside the farm on the middle of a road, not the road start', () => {
    // Road runs east-west 1 km north of the farm, from 5 km west to 5 km east.
    const road = [[10 + KM, 122 - 5 * KM], [10 + KM, 122 + 5 * KM]];
    const result = nearestPointOnPolyline([10, 122], road);
    expect(result.distanceMeters).toBeGreaterThan(990);
    expect(result.distanceMeters).toBeLessThan(1010);
    expect(result.point[0]).toBeCloseTo(10 + KM, 6);
    expect(result.point[1]).toBeCloseTo(122, 4);
  });

  it('clamps to the nearer end when the farm is past the end of the road', () => {
    const road = [[10, 122.1], [10, 122.2]];
    const result = nearestPointOnPolyline([10, 122], road);
    expect(result.point[1]).toBeCloseTo(122.1, 6);
  });

  it('handles a single-point road and rejects bad input', () => {
    expect(nearestPointOnPolyline([10, 122], [[10, 122]]).distanceMeters).toBeCloseTo(0, 6);
    expect(nearestPointOnPolyline([10, 122], [])).toBeNull();
    expect(nearestPointOnPolyline([NaN, 122], [[10, 122]])).toBeNull();
  });

  it('picks the closest of several segments', () => {
    const road = [[10.05, 122], [10.05, 122.05], [10.001, 122.05]];
    const result = nearestPointOnPolyline([10, 122.05], road);
    expect(result.distanceMeters).toBeLessThan(150);
  });
});
