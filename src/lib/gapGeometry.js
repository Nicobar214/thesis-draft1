/* Where a road gap really is, and how sure we are.
 *
 * A row of road_network_gaps is the UNPAVED (earth / gravel) part of one
 * surveyed barangay road (Leon_barangay_roads.csv). That road is also the FMR
 * project `from_project_id`, with its own mapped route. The survey says HOW
 * MUCH of the road is unpaved, never WHERE along it (there is no chainage).
 *
 * The stored gap_points were generated as "the next unpaved km beyond the
 * funded route" and, where the road ran out, walked on along the network, so
 * many of them lie on other roads. This draws a gap on its own road instead,
 * and says plainly what is known:
 *
 *   whole-road     the road is (almost) all unpaved and it is mapped
 *   share-of-road  part of the mapped road is unpaved; where is not surveyed
 *   partly-mapped  the surveyed road is longer than what is mapped; only the
 *                  mapped part is drawn, the rest is to be confirmed on site
 *   stored-line    no route for the parent road: the stored line, as it was
 *
 * Nothing stored is changed; this runs on the live rows every time. */
import { buildRoutePoints, calculatePolylineDistanceKm, parsePointList } from './mapRouteUtils';

const WHOLE_ROAD_SHARE = 0.9;  // this much unpaved counts as the whole road
const MAPPED_ENOUGH = 0.85;    // a mapped line this close to the survey is "the road"

const PAVED = new Set(['concrete', 'asphalt']);

/** "Concrete 6.76 km (72%, Fair); Gravel 2.6 km (28%, Poor)" -> lengths per surface. */
export function surveyFromSummary(summary) {
  const parts = [];
  String(summary || '').split(';').forEach((chunk) => {
    const m = chunk.trim().match(/^([A-Za-z]+)\s+([\d.]+)\s*km(?:\s*\((\d+)%(?:,\s*([A-Za-z]+))?\))?/);
    if (!m) return;
    const km = Number(m[2]);
    if (!Number.isFinite(km)) return;
    parts.push({ type: m[1], km, pct: m[3] != null ? Number(m[3]) : null, condition: m[4] || null });
  });
  const totalKm = parts.reduce((s, p) => s + p.km, 0);
  const pavedKm = parts.filter((p) => PAVED.has(p.type.toLowerCase())).reduce((s, p) => s + p.km, 0);
  return { parts, totalKm, pavedKm, unpavedKm: totalKm - pavedKm };
}

const round2 = (n) => Math.round(n * 100) / 100;
const km2 = (n) => `${round2(n).toFixed(2)} km`;

/** "Earth Surface Gap" -> "Earth road"; "Mixed Earth-Gravel Gap" -> "Earth/gravel road". */
export function gapSurfaceLabel(gapType) {
  const t = String(gapType || '').toLowerCase();
  if (t.includes('mixed') || (t.includes('earth') && t.includes('gravel'))) return 'Earth/gravel road';
  if (t.includes('earth')) return 'Earth road';
  if (t.includes('gravel')) return 'Gravel road';
  return 'Gravel/earth road';
}

function storedLine(gap) {
  let points = parsePointList(gap?.gap_points);
  if (points.length < 2) {
    points = [[gap?.start_latitude, gap?.start_longitude], [gap?.end_latitude, gap?.end_longitude]]
      .map(([a, b]) => [Number(a), Number(b)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  }
  return points;
}

/**
 * The line to draw and score for a gap, and what can honestly be said about it.
 * `parentProject` / `parentRoute` are the surveyed road's FMR project and its
 * project_routes row (either may be missing).
 */
export function resolveGapGeometry(gap, parentProject = null, parentRoute = null) {
  const survey = surveyFromSummary(gap?.source_surface_summary);
  const unpavedKm = Number(gap?.gap_km) > 0 ? Number(gap.gap_km) : survey.unpavedKm;
  const surveyKm = survey.totalKm > 0 ? survey.totalKm : unpavedKm;
  const unpavedShare = surveyKm > 0 ? Math.min(1, unpavedKm / surveyKm) : 1;

  const roadPoints = parentProject ? buildRoutePoints(parentProject, parentRoute).points : [];
  if (roadPoints.length < 2) {
    const points = storedLine(gap);
    return {
      points,
      placement: 'stored-line',
      mappedKm: calculatePolylineDistanceKm(points),
      surveyKm, unpavedKm, unpavedShare, unmappedKm: 0,
      note: 'Drawn from the stored line: the surveyed road has no mapped route yet. Confirm on site.',
    };
  }

  const mappedKm = calculatePolylineDistanceKm(roadPoints);
  const base = { points: roadPoints, mappedKm, surveyKm, unpavedKm, unpavedShare, unmappedKm: 0 };
  const pct = Math.round(unpavedShare * 100);

  if (mappedKm < surveyKm * MAPPED_ENOUGH) {
    const unmappedKm = surveyKm - mappedKm;
    const unpavedOffMap = Math.min(unpavedKm, unmappedKm);
    return {
      ...base,
      placement: 'partly-mapped',
      unmappedKm,
      note: `${km2(mappedKm)} of the surveyed ${km2(surveyKm)} road is mapped. Up to ${km2(unpavedOffMap)} still to concrete may be on the unmapped part. Confirm on site.`,
    };
  }
  if (unpavedShare >= WHOLE_ROAD_SHARE) {
    return {
      ...base,
      placement: 'whole-road',
      note: `The whole road still needs concreting: ${km2(unpavedKm)} of ${km2(surveyKm)}.`,
    };
  }
  return {
    ...base,
    placement: 'share-of-road',
    note: `${km2(unpavedKm)} of the ${km2(surveyKm)} road still needs concreting (${pct}%); the rest is already concrete. Which part is not recorded. Confirm on site.`,
  };
}

/** Short chip text for the placement. */
export const PLACEMENT_LABELS = {
  'whole-road': 'Mapped',
  'share-of-road': 'Mapped · part to concrete not located',
  'partly-mapped': 'Partly mapped',
  'stored-line': 'Approximate line',
};

/** Index the parent roads once: projectId -> project, and the route rows by project id. */
export function makeGapResolver(projects = [], routesByProjectId = {}) {
  const byId = new Map((projects || []).map((p) => [String(p.id), p]));
  const cache = new Map();
  return (gap) => {
    const key = `${gap?.id}`;
    if (!cache.has(key)) {
      const parent = byId.get(String(gap?.from_project_id)) || null;
      cache.set(key, resolveGapGeometry(gap, parent, parent ? routesByProjectId?.[parent.id] || null : null));
    }
    return cache.get(key);
  };
}
