import { describe, it, expect } from 'vitest';
import { buildRoutePoints } from '../mapRouteUtils';

// Two pins ~1.1 km apart on the same latitude near Leon.
const project = (extra = {}) => ({
  start_latitude: 10.78, start_longitude: 122.39, end_latitude: 10.78, end_longitude: 122.40, ...extra,
});

describe('buildRoutePoints without a mapped route', () => {
  it('draws a straight line between the pins when they fit the declared length', () => {
    const r = buildRoutePoints(project({ project_length_km: 1.2 }), null);
    expect(r.points).toHaveLength(2);
    expect(r.endpointsMismatch).toBe(false);
  });

  it('keeps only the start when the pins are far apart for the road length (one pin is wrong)', () => {
    // 0.2 km road, pins 1.1 km apart: more than 2 x 0.2 + 0.5 km.
    const r = buildRoutePoints(project({ project_length_km: 0.2 }), null);
    expect(r.points).toHaveLength(1);
    expect(r.hasPolyline).toBe(false);
    expect(r.endpointsMismatch).toBe(true);
  });

  it('trusts the pins when the length is unknown', () => {
    expect(buildRoutePoints(project(), null).points).toHaveLength(2);
  });
});
