import { describe, expect, it } from 'vitest';
import { ACCESS_MIX, GAP_WEIGHTS, computeRoadGapPriorityScores, surfaceSeverity } from '../priorityScoring';

const gap = (overrides) => ({
  id: overrides.id,
  gap_code: overrides.id,
  from_project_id: null,
  to_project_id: null,
  barangay: 'A',
  barangay_end: null,
  gap_km: 1,
  market_distance_km: 2,
  gap_type: 'Gravel Surface Gap',
  surface_condition: 'Fair',
  ...overrides,
});

describe('gap scoring weights', () => {
  it('sum to 100%', () => {
    expect(GAP_WEIGHTS.G + GAP_WEIGHTS.A + GAP_WEIGHTS.C).toBeCloseTo(1);
  });

  it('keeps connectivity and market access in their old 35:25 balance inside Access', () => {
    expect(ACCESS_MIX.connectivity + ACCESS_MIX.market).toBeCloseTo(1);
    expect(ACCESS_MIX.connectivity / ACCESS_MIX.market).toBeCloseTo(35 / 25);
  });
});

describe('surfaceSeverity', () => {
  it('ranks Earth above Gravel and Poor above Fair', () => {
    expect(surfaceSeverity('Earth Surface Gap', 'Poor')).toBe(100);
    expect(surfaceSeverity('Earth Surface Gap', 'Fair')).toBe(80);
    expect(surfaceSeverity('Gravel Surface Gap', 'Poor')).toBe(70);
    expect(surfaceSeverity('Gravel Surface Gap', 'Fair')).toBe(50);
  });

  it('gives missing data a midpoint, never zero', () => {
    expect(surfaceSeverity(null, null)).toBe(65);
    expect(surfaceSeverity('Earth Surface Gap', '')).toBe(80);
  });
});

describe('computeRoadGapPriorityScores', () => {
  it('lets surface condition break a tie between otherwise identical gaps', () => {
    const rows = computeRoadGapPriorityScores([
      gap({ id: 'fair-gravel' }),
      gap({ id: 'poor-earth', gap_type: 'Earth Surface Gap', surface_condition: 'Poor' }),
    ]);
    expect(rows[0].gap.id).toBe('poor-earth');
    expect(rows[0].C).toBe(100);
    expect(rows[1].C).toBe(50);
    expect(rows[0].A).toBe(rows[1].A);
  });

  it('returns G, A and C between 0 and 100 with a score that matches the weights', () => {
    const rows = computeRoadGapPriorityScores([
      gap({ id: 'a', gap_km: 2, market_distance_km: 1, to_project_id: 7 }),
      gap({ id: 'b', gap_km: 0.5, market_distance_km: 4 }),
    ]);
    for (const r of rows) {
      for (const key of ['G', 'A', 'C']) {
        expect(r[key]).toBeGreaterThanOrEqual(0);
        expect(r[key]).toBeLessThanOrEqual(100);
      }
      const expected = r.G * GAP_WEIGHTS.G + r.A * GAP_WEIGHTS.A + r.C * GAP_WEIGHTS.C;
      expect(Math.abs(r.score - expected)).toBeLessThanOrEqual(1);
    }
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });
});
