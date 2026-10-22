import { describe, it, expect, vi } from 'vitest';
import {
  PRIORITY_WEIGHTS,
  computePriority,
  topCommoditiesByMunicipality,
} from '../priorityScoring';

// A straight east-west road ~1.1 km long at Leon's latitude.
const line = (lat, lng0, lng1) => [[lat, lng0], [lat, (lng0 + lng1) / 2], [lat, lng1]];
const gap = (id, lat, km, marketKm, extra = {}) => ({
  id,
  gap_code: `G-${id}`,
  municipality: 'Leon',
  gap_km: km,
  market_distance_km: marketKm,
  gap_points: line(lat, 122.40, 122.41).map(([a, b]) => ({ lat: a, lng: b })),
  ...extra,
});
const farmer = (lat, lng, crop, area = 1) => ({ municipality: 'Leon', crop, farm_latitude: lat, farm_longitude: lng, farm_area_ha: area });

describe('PRIORITY_WEIGHTS', () => {
  it('adds up to 100%', () => {
    const sum = Object.values(PRIORITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });
});

describe('topCommoditiesByMunicipality', () => {
  it('ranks the top crops by number of registered farmers, per municipality', () => {
    const top = topCommoditiesByMunicipality([
      farmer(0, 0, 'Rice'), farmer(0, 0, 'Rice'), farmer(0, 0, 'Corn'),
      { municipality: 'Cabatuan', crop: 'Banana' },
    ]);
    expect(top.leon.map((t) => t.crop)).toEqual(['Rice', 'Corn']);
    expect(top.leon[0].rank).toBe(1);
    expect(top.cabatuan[0].crop).toBe('Banana');
  });
});

describe('computePriority', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('ranks gaps and ongoing projects in separate groups, skipping completed ones', () => {
    const result = computePriority({
      gaps: [gap(1, 11.0, 1.0, 2), gap(2, 11.1, 0.5, 5)],
      projects: [
        { id: 10, project_name: 'Ongoing road', status: 'On-Going', municipality: 'Leon', project_length_km: 2, accomplishment: 25, start_latitude: 11.2, start_longitude: 122.40, end_latitude: 11.2, end_longitude: 122.41 },
        { id: 11, project_name: 'Done road', status: 'Completed', municipality: 'Leon', start_latitude: 11.3, start_longitude: 122.40, end_latitude: 11.3, end_longitude: 122.41 },
      ],
    });
    expect(result.newRoads.map((r) => r.id)).toEqual([1, 2]);
    expect(result.ongoing.map((r) => r.id)).toEqual([10]);
    expect(result.ongoing[0].rank).toBe(1);
    // remaining length to build: 2 km x 75%
    expect(result.ongoing[0].lengthKm).toBeCloseTo(1.5);
  });

  it('counts only farmers within 2 km and weights the top commodities by rank', () => {
    const { newRoads } = computePriority({
      gaps: [gap(1, 11.0, 1, 3), gap(2, 11.5, 1, 3)],
      farmers: [
        farmer(11.001, 122.405, 'Rice', 2),  // ~110 m from gap 1
        farmer(11.001, 122.405, 'Corn', 1),  // ~110 m from gap 1
        farmer(11.10, 122.405, 'Rice', 5),   // ~11 km away: not counted
        farmer(11.5, 122.405, 'Rice', 1),    // on gap 2
      ],
    });
    const g1 = newRoads.find((r) => r.id === 1);
    const g2 = newRoads.find((r) => r.id === 2);
    expect(g1.farmersNear).toBe(2);
    expect(g2.farmersNear).toBe(1);
    // Rice is rank 1 (5 points x 2 ha) + Corn rank 2 (4 points x 1 ha) = 14
    expect(g1.commodityWeight).toBe(14);
    expect(g1.C).toBe(100);
  });

  it('counts citizen reports within 500 m only, and ignores dismissed or mismatched ones', () => {
    const now = new Date().toISOString();
    const { newRoads } = computePriority({
      gaps: [gap(1, 11.0, 1, 3)],
      reports: [
        { latitude: 11.001, longitude: 122.405, severity_category: 'structural', created_at: now },
        { latitude: 11.05, longitude: 122.405, severity_category: 'structural', created_at: now },    // ~5.5 km
        { latitude: 11.0, longitude: 122.405, severity_category: 'road_damage', created_at: now, status: 'dismissed' },
        { latitude: 11.0, longitude: 122.405, severity_category: 'road_damage', created_at: now, verification: 'Location Mismatch' },
      ],
    });
    expect(newRoads[0].reportCount).toBe(1);
    expect(newRoads[0].bySeverity.structural).toBe(1);
  });

  it('puts a missing market distance mid-range instead of at zero', () => {
    const { newRoads } = computePriority({ gaps: [gap(1, 11.0, 1, null), gap(2, 11.1, 1, 4)] });
    expect(newRoads.find((r) => r.id === 1).M).toBe(50);
  });

  it('scores as the published weighted sum', () => {
    const { newRoads } = computePriority({ gaps: [gap(1, 11.0, 1, 2), gap(2, 11.1, 0.4, 6)] });
    newRoads.forEach((r) => {
      const expected = r.G * 0.25 + r.M * 0.2 + r.R * 0.2 + r.C * 0.2 + r.F * 0.15;
      expect(Math.abs(r.score - expected)).toBeLessThanOrEqual(2);
    });
  });

  it('scores commodities and farmer density neutral where the municipality has no farmer registry', () => {
    const { newRoads } = computePriority({
      gaps: [gap(1, 11.0, 1, 2), { ...gap(2, 11.1, 1, 2), municipality: 'Cabatuan' }],
      farmers: [farmer(11.0, 122.405, 'Rice', 2)],
    });
    const cabatuan = newRoads.find((r) => r.id === 2);
    expect(cabatuan.C).toBe(50);
    expect(cabatuan.F).toBe(50);
    expect(newRoads.find((r) => r.id === 1).C).toBe(100);
  });

  it('drops a gap that an existing project road already covers (60%+)', () => {
    const covering = { id: 50, project_name: 'Concreting of gap road', status: 'Proposed', start_latitude: 11.0, start_longitude: 122.40, end_latitude: 11.0, end_longitude: 122.41 };
    const partial = { id: 51, project_name: 'Joins at the end', status: 'Completed', start_latitude: 11.1, start_longitude: 122.409, end_latitude: 11.1, end_longitude: 122.42 };
    const result = computePriority({ gaps: [gap(1, 11.0, 1, 2), gap(2, 11.1, 1, 2)], projects: [covering, partial] });
    expect(result.newRoads.map((r) => r.id)).toEqual([2]);
    expect(result.covered).toHaveLength(1);
    expect(result.covered[0].coveredBy.name).toBe('Concreting of gap road');
  });

  it('drops gaps that were already converted into projects', () => {
    const { newRoads } = computePriority({ gaps: [gap(1, 11.0, 1, 2), gap(2, 11.1, 1, 2)], excludeGapIds: [2] });
    expect(newRoads.map((r) => r.id)).toEqual([1]);
  });
});
