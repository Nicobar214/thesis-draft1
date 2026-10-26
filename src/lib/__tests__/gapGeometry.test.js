import { describe, expect, it } from 'vitest';
import { gapSurfaceLabel, resolveGapGeometry, surveyFromSummary } from '../gapGeometry';

// An east-west road at lat 10.78: 0.01 deg of longitude is ~1.09 km here.
const road = (lng1) => ({ id: 7, start_latitude: 10.78, start_longitude: 122.40, end_latitude: 10.78, end_longitude: lng1 });
const route = (lng1) => ({ project_id: 7, route_points: [[10.78, 122.40], [10.78, (122.40 + lng1) / 2], [10.78, lng1]] });
const offRoadLine = [[10.80, 122.40], [10.80, 122.42]]; // the old generated line, ~2 km away
const gap = (km, summary) => ({ id: 1, from_project_id: 7, gap_km: km, source_surface_summary: summary, gap_points: offRoadLine });

describe('surveyFromSummary', () => {
  it('reads every surface and splits paved from unpaved', () => {
    const s = surveyFromSummary('Concrete 0.14 km (4%, Fair); Gravel 3.24 km (85%, Poor); Earth 0.44 km (11%, Poor)');
    expect(s.totalKm).toBeCloseTo(3.82);
    expect(s.pavedKm).toBeCloseTo(0.14);
    expect(s.unpavedKm).toBeCloseTo(3.68);
    expect(s.parts[1]).toEqual({ type: 'Gravel', km: 3.24, pct: 85, condition: 'Poor' });
    expect(surveyFromSummary(null).totalKm).toBe(0);
  });
});

describe('resolveGapGeometry', () => {
  it('draws a fully unpaved road on the road itself, not on the old generated line', () => {
    const g = resolveGapGeometry(gap(1.1, 'Earth 1.1 km (100%, Poor)'), road(122.41), route(122.41));
    expect(g.placement).toBe('whole-road');
    expect(g.points[0]).toEqual([10.78, 122.40]);
    expect(g.note).toMatch(/whole road still needs concreting/i);
  });

  it('says the unpaved part is a share of the road when part of it is paved', () => {
    const g = resolveGapGeometry(gap(0.6, 'Concrete 0.5 km (45%, Fair); Gravel 0.6 km (55%, Poor)'), road(122.41), route(122.41));
    expect(g.placement).toBe('share-of-road');
    expect(Math.round(g.unpavedShare * 100)).toBe(55);
    expect(g.note).toMatch(/already concrete/);
  });

  it('draws only the mapped part when the surveyed road is longer, and says how much is unmapped', () => {
    const g = resolveGapGeometry(gap(2.06, 'Concrete 1.5 km (42%, Fair); Gravel 2.06 km (58%, Fair)'), road(122.4025), route(122.4025));
    expect(g.placement).toBe('partly-mapped');
    expect(g.mappedKm).toBeLessThan(0.3);
    expect(g.unmappedKm).toBeGreaterThan(3);
    expect(g.note).toMatch(/Confirm on site/);
  });

  it('keeps the stored line when the road has no route at all', () => {
    const g = resolveGapGeometry(gap(1, 'Earth 1 km (100%, Poor)'), null, null);
    expect(g.placement).toBe('stored-line');
    expect(g.points).toEqual(offRoadLine);
  });

  it('names the surface plainly', () => {
    expect(gapSurfaceLabel('Earth Surface Gap')).toBe('Earth road');
    expect(gapSurfaceLabel('Mixed Earth-Gravel Gap')).toBe('Earth/gravel road');
    expect(gapSurfaceLabel('Gravel Surface Gap')).toBe('Gravel road');
  });
});
