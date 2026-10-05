// Independent verification of generated route and gap geometry.
//
//   node scripts/verify_route_geometry.mjs
//
// Reads leon_route_corridor_audit.json and re-derives every claim from the stored
// coordinates rather than trusting the numbers the generator reported. The point is
// to catch a generator bug, so it must not reuse the generator's arithmetic.
//
// Uses node's assertions directly instead of adding a test runner: this checks one
// generated artifact, and the repo has no test infrastructure to fit into.
// Exits non-zero on any failure, so it can gate the SQL.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT, LEON_BARANGAYS, loadBarangayCentroids, normalizeRoadName } from './lib/leonPlaceChain.mjs';
import { calculatePolylineDistanceKm, haversineKm, coordPair } from '../src/lib/mapRouteUtils.js';

const AUDIT_PATH = resolve(REPO_ROOT, 'leon_route_corridor_audit.json');
const INVENTORY_PATH = resolve(REPO_ROOT, 'src', 'data', 'leonRoadInventory.json');

// Tolerances. Deliberately a touch looser than the generator's own, so this fails
// on real defects rather than on floating-point noise.
const LENGTH_TOLERANCE_KM = 0.025;
const JOIN_TOLERANCE_M = 5;
const OVERLAP_MIN_SEPARATION_M = 10;
const OVERLAP_IGNORE_FIRST_M = 50;
const MAX_START_OFFSET_KM = 2.6;

// Generous box around Leon; anything outside is a coordinate-order or snapping bug.
const LEON_BBOX = { south: 10.69, west: 122.21, north: 10.95, east: 122.50 };

if (!existsSync(AUDIT_PATH)) {
  console.error(`Missing ${AUDIT_PATH}`);
  console.error('Run: node scripts/generate_leon_route_corridors.mjs');
  process.exit(1);
}

const audit = JSON.parse(readFileSync(AUDIT_PATH, 'utf8'));
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
const centroids = loadBarangayCentroids();
const canonical = new Set(LEON_BARANGAYS);

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);

/** Perpendicular distance from a point to a polyline, in metres. */
function distanceToPolylineMeters(point, polyline) {
  const [pLat, pLng] = coordPair(point);
  // Local equirectangular projection; over a few km the distortion is negligible
  // and it makes the point-to-segment projection simple arithmetic.
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((pLat * Math.PI) / 180);
  const px = pLng * lngScale;
  const py = pLat * latScale;

  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const [aLat, aLng] = coordPair(polyline[i]);
    const [bLat, bLng] = coordPair(polyline[i + 1]);
    const ax = aLng * lngScale, ay = aLat * latScale;
    const bx = bLng * lngScale, by = bLat * latScale;

    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

const inBbox = ([lat, lng]) =>
  lat >= LEON_BBOX.south && lat <= LEON_BBOX.north && lng >= LEON_BBOX.west && lng <= LEON_BBOX.east;

// --- inventory lookup, honouring the three duplicate road names --------------

const inventoryByName = new Map();
for (const road of inventory) {
  const key = normalizeRoadName(road.roadName);
  if (!inventoryByName.has(key)) inventoryByName.set(key, []);
  inventoryByName.get(key).push(road);
}

// ---------------------------------------------------------------------------

const records = audit.records || [];
if (records.length === 0) fail('audit contains no records');

const withRoute = records.filter((r) => r.route);
const withGap = records.filter((r) => r.gap);
const skipped = records.filter((r) => r.skipped);

// 1. Every project is accounted for: it has a route, or a recorded reason it does not.
for (const r of records) {
  if (!r.route && !r.skipped) fail(`#${r.projectId}: neither a route nor a skip reason`);
  if (r.route && r.skipped) fail(`#${r.projectId}: has both a route and a skip reason`);
}

// 2. Route length matches the declared length, recomputed from the coordinates.
for (const r of withRoute) {
  const measured = calculatePolylineDistanceKm(r.route.points);

  if (r.route.routeQuality === 'corridor-truncated') {
    const delta = Math.abs(measured - r.declaredKm);
    if (delta > LENGTH_TOLERANCE_KM) {
      fail(`#${r.projectId}: measured ${measured.toFixed(3)} km vs declared ${r.declaredKm} km (delta ${delta.toFixed(3)})`);
    }
  } else if (r.route.routeQuality === 'corridor-shorter-than-declared') {
    if (measured > r.declaredKm + LENGTH_TOLERANCE_KM) {
      fail(`#${r.projectId}: flagged short but measures ${measured.toFixed(3)} km against declared ${r.declaredKm} km`);
    }
  } else {
    fail(`#${r.projectId}: unrecognised route_quality "${r.route.routeQuality}"`);
  }

  // The generator's own reported figure must agree with the recomputation.
  if (Math.abs(measured - r.route.mappedKm) > 0.005) {
    fail(`#${r.projectId}: audit says mapped ${r.route.mappedKm} km, coordinates measure ${measured.toFixed(3)} km`);
  }

  if (r.route.points.length < 2) fail(`#${r.projectId}: route has fewer than 2 vertices`);
}

// 3. Routes start in the barangay the project names.
for (const r of withRoute) {
  if (!r.barangay) { fail(`#${r.projectId}: route with no barangay`); continue; }
  if (!canonical.has(r.barangay)) fail(`#${r.projectId}: barangay "${r.barangay}" is not canonical`);

  const centroid = centroids[r.barangay];
  if (!centroid) { fail(`#${r.projectId}: no centroid for ${r.barangay}`); continue; }

  const offset = haversineKm(r.route.points[0], [centroid.lat, centroid.lng]);
  if (offset > MAX_START_OFFSET_KM) {
    fail(`#${r.projectId}: starts ${offset.toFixed(2)} km from the ${r.barangay} centroid`);
  }
}

// 4. Every coordinate is inside Leon -- catches lat/lng transposition.
for (const r of records) {
  for (const point of r.route?.points || []) {
    if (!inBbox(point)) { fail(`#${r.projectId}: route vertex outside Leon: ${point}`); break; }
  }
  for (const point of r.gap?.points || []) {
    if (!inBbox(point)) { fail(`#${r.projectId}: gap vertex outside Leon: ${point}`); break; }
  }
}

// 5. Each gap begins where its route ends, and does not double back over it.
for (const r of withGap) {
  const routeEnd = r.route.points[r.route.points.length - 1];
  const joinM = haversineKm(routeEnd, r.gap.points[0]) * 1000;
  if (joinM > JOIN_TOLERANCE_M) {
    fail(`#${r.projectId}: gap starts ${joinM.toFixed(1)} m from the route end (limit ${JOIN_TOLERANCE_M} m)`);
  }

  // Past the shared join, the gap must stay clear of the funded route -- otherwise
  // the map would show a gap drawn on top of a road recorded as built.
  let along = 0;
  for (let i = 1; i < r.gap.points.length; i += 1) {
    along += haversineKm(r.gap.points[i - 1], r.gap.points[i]) * 1000;
    if (along < OVERLAP_IGNORE_FIRST_M) continue;
    const sep = distanceToPolylineMeters(r.gap.points[i], r.route.points);
    if (sep < OVERLAP_MIN_SEPARATION_M) {
      fail(`#${r.projectId}: gap doubles back over its route (${sep.toFixed(1)} m separation at ${(along / 1000).toFixed(2)} km along the gap)`);
      break;
    }
  }
}

// 6. gap_km traces to the survey, and the drawn gap never exceeds it.
for (const r of withGap) {
  const candidates = inventoryByName.get(normalizeRoadName(r.inventoryRoadName || '')) || [];
  // Match on surveyed length as well as name. Three road names appear twice in the
  // CSV as separate segments ("Isian Victoria Road" at 0.77 km and 2.89 km, plus
  // "Bucari Road" and "Jamog Gines Road"), so a name-only lookup picks whichever
  // comes first and then disagrees with the record the generator actually used.
  const road =
    candidates.find(
      (c) => c.roadName === r.inventoryRoadName && Number(c.lengthKm) === Number(r.inventoryLengthKm)
    ) || candidates.find((c) => c.roadName === r.inventoryRoadName);
  if (!road) {
    fail(`#${r.projectId}: gap cites road "${r.inventoryRoadName}" which is not in the inventory`);
    continue;
  }

  if (Math.abs(Number(road.unpavedKm) - Number(r.gap.surveyedKm)) > 0.001) {
    fail(`#${r.projectId}: gap surveyedKm ${r.gap.surveyedKm} != inventory unpavedKm ${road.unpavedKm} for ${road.roadName}`);
  }

  const measured = calculatePolylineDistanceKm(r.gap.points);
  if (measured > Number(r.gap.surveyedKm) + LENGTH_TOLERANCE_KM) {
    fail(`#${r.projectId}: drew ${measured.toFixed(3)} km of gap against a surveyed ${r.gap.surveyedKm} km`);
  }
  if (Math.abs(measured - r.gap.mappedKm) > 0.005) {
    fail(`#${r.projectId}: audit says gap ${r.gap.mappedKm} km, coordinates measure ${measured.toFixed(3)} km`);
  }

  if (!r.gap.gapType) fail(`#${r.projectId}: gap has no surface type`);
  if (!r.gap.surfaceSummary) fail(`#${r.projectId}: gap has no surveyed surface summary to cite`);
}

// 7. Identifiers are unique.
const seenGapCodes = new Set();
for (const r of withGap) {
  if (seenGapCodes.has(r.gap.gapCode)) fail(`duplicate gap_code ${r.gap.gapCode}`);
  seenGapCodes.add(r.gap.gapCode);
}
const seenProjectIds = new Set();
for (const r of records) {
  if (seenProjectIds.has(r.projectId)) fail(`duplicate project id ${r.projectId} in the audit`);
  seenProjectIds.add(r.projectId);
}

// 8. A gap that claims to join two projects must name a real one.
const byId = new Map(records.map((r) => [r.projectId, r]));
for (const r of withGap) {
  if (r.gap.toProjectId === null || r.gap.toProjectId === undefined) continue;
  const target = byId.get(r.gap.toProjectId);
  if (!target) fail(`#${r.projectId}: gap points to unknown project ${r.gap.toProjectId}`);
  else if (r.gap.toProjectId === r.projectId) fail(`#${r.projectId}: gap points at its own project`);
}

// 9. Skips carry reasons, and no skip is silent.
for (const r of skipped) {
  if (!r.skipped || String(r.skipped).trim() === '') fail(`#${r.projectId}: skipped with an empty reason`);
}

// --- factor-variance check for the prioritization module ---------------------
//
// The defect this guards against: the existing scorer's connectivity factor
// normalizes to 100 for every row, because its test is
// projName.includes('rd'), which matches every Leon road name. A factor with no
// variance contributes nothing, so the documented 40/35/25 weighting silently
// collapses to a sort on gap km. If the gap inputs have no spread either, the new
// scorer would have the same problem.
const gapKms = withGap.map((r) => r.gap.surveyedKm);
const marketKms = withGap.map((r) => r.gap.marketDistanceKm).filter((n) => Number.isFinite(n));
const distinct = (xs) => new Set(xs.map((x) => Number(x).toFixed(3))).size;

if (withGap.length > 1) {
  if (distinct(gapKms) < 2) fail('surveyed gap_km has no variance across gaps -- it cannot discriminate in ranking');
  if (marketKms.length > 1 && distinct(marketKms) < 2) {
    fail('market_distance_km has no variance across gaps -- the market factor would be inert');
  }
  const connected = withGap.filter((r) => r.gap.toProjectId).length;
  if (connected === 0 || connected === withGap.length) {
    notes.push(`connectivity is uniform: ${connected}/${withGap.length} gaps link two projects, so that sub-factor will not discriminate`);
  }
}

// --- report -----------------------------------------------------------------

const sorted = [...gapKms].sort((a, b) => a - b);
const drawn = withGap.map((r) => r.gap.mappedKm).sort((a, b) => a - b);
const shortDrawn = withGap.filter((r) => r.gap.mappedKm < r.gap.surveyedKm - LENGTH_TOLERANCE_KM);
console.log(`Audit:              ${AUDIT_PATH}`);
console.log(`Generated:          ${audit.generatedAt}`);
console.log('');
console.log(`Projects:           ${records.length}`);
console.log(`  routes:           ${withRoute.length}   ${JSON.stringify(audit.routeQualityCounts || {})}`);
console.log(`  gaps:             ${withGap.length}   ${JSON.stringify(audit.gapSourceCounts || {})}`);
console.log(`  skipped:          ${skipped.length}`);
console.log(`  length conflicts: ${records.filter((r) => r.lengthConflict).length}`);
console.log('');
console.log(`Surveyed gap km:    min ${sorted[0] ?? 'n/a'} / median ${sorted[Math.floor(sorted.length / 2)] ?? 'n/a'} / max ${sorted[sorted.length - 1] ?? 'n/a'}  (scored)`);
console.log(`Drawn gap km:       min ${drawn[0] ?? 'n/a'} / median ${drawn[Math.floor(drawn.length / 2)] ?? 'n/a'} / max ${drawn[drawn.length - 1] ?? 'n/a'}`);
console.log(`  drawn short of survey (corridor ran out): ${shortDrawn.length} of ${withGap.length}`);
console.log(`  distinct values:  ${distinct(gapKms)} of ${gapKms.length}`);
console.log(`Market distance:    ${marketKms.length} of ${withGap.length} gaps measured, ${distinct(marketKms)} distinct`);
console.log(`Gaps joining two projects: ${withGap.filter((r) => r.gap.toProjectId).length} / ${withGap.length}`);

if (notes.length > 0) {
  console.log('');
  console.log('Notes:');
  notes.forEach((n) => console.log(`  - ${n}`));
}

if (skipped.length > 0) {
  console.log('');
  console.log(`Projects without geometry (${skipped.length}):`);
  const grouped = skipped.reduce((acc, r) => {
    const key = String(r.skipped).replace(/[\d.]+/g, 'N').slice(0, 70);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => console.log(`  ${String(count).padStart(3)}x  ${reason}`));
}

console.log('');
if (failures.length > 0) {
  console.error(`FAILED ${failures.length} check(s):`);
  failures.slice(0, 40).forEach((f) => console.error(`  - ${f}`));
  if (failures.length > 40) console.error(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}

console.log('All geometry checks passed.');
