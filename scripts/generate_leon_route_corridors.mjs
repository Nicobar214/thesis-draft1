// Generate realistic Leon project route geometry and the road-network gaps that
// follow from it.
//
//   node scripts/generate_leon_route_corridors.mjs
//
// Emits (nothing is written if the assertions fail):
//   supabase_leon_realistic_routes.sql          project_routes + barangay backfill
//   supabase_leon_road_network_gaps_data.sql    road_network_gaps rows
//   leon_route_corridor_audit.json              per-project record of every decision
//
// ---------------------------------------------------------------------------
// THE MODEL
//
// A surveyed barangay road has a real alignment and a real surface breakdown. An
// FMR project concretes a PORTION of that road. So:
//
//   corridor  = a path through Leon's local OSM road graph along the barangays
//               named in the project, which physically cannot use the national
//               road because trunk classes are excluded from the graph
//   route     = the first `project_length_km` of that corridor  (what was funded)
//   gap       = the next `unpavedKm` of the same corridor       (what was not)
//
// `unpavedKm` is the sum of the Earth and Gravel sub-segments recorded for that
// road in Leon_barangay_roads.csv. It is read from the survey, never chosen here,
// which is the point: the prioritization module must not rank numbers this script
// invented. Gap lengths vary from 0.04 to 4.01 km across Leon because the survey
// varies, not because a spread was designed.
//
// By construction the gap starts exactly where the route ends, so it can never
// overlap the funded segment, and a Completed project keeps a whole, unbroken
// route line -- the gap sits beyond it. That matches the records: the road really
// was concreted for the funded length, and the rest really is earth.
//
// WHAT THIS REFUSES TO DO
//
// Where there is no usable corridor, no route is emitted and the project keeps its
// centroid pin. The previous generators instead projected a line on a bearing
// derived from a hash of the project's name (bearingFromName), which produces
// confident-looking geometry pointing in a meaningless direction. A missing route
// is honest; a fabricated one is not.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REPO_ROOT,
  parsePlaceChain,
  normalizeRoadName,
  loadBarangayCentroids,
  barangaysMissingCentroids,
} from './lib/leonPlaceChain.mjs';
import {
  loadLocalNetwork,
  buildGraph,
  labelComponents,
  nearestNode,
  shortestPath,
  walkOutward,
  farthestPathWithinKm,
} from './lib/leonRoadGraph.mjs';
import {
  cutPolylineAtKm,
  slicePolylineFromKm,
  calculatePolylineDistanceKm,
  haversineKm,
  bearingBetween,
} from '../src/lib/mapRouteUtils.js';

// --- tunables ---------------------------------------------------------------

/** Minimum surveyed unpaved length for a road to become a gap row.
 *  0.8 -> ~41 candidate roads, 1.2 -> ~30. Below ~0.8 km a "gap" is a patch. */
const MIN_GAP_KM = 1.2;

/** A route must start within this distance of its host barangay centroid, or the
 *  corridor is rejected -- it wandered somewhere that is not the named barangay. */
const MAX_START_OFFSET_KM = 2.5;

/** Snapping a centroid further than this to the road graph means the barangay has
 *  no mapped local road; fall back rather than anchor on a distant road. */
const MAX_SNAP_KM = 1.0;

/** Tolerance for mapped vs declared length on a truncated route. */
const LENGTH_TOLERANCE_KM = 0.02;

/** Declared project length vs surveyed road length disagreement worth flagging. */
const LENGTH_CONFLICT_KM = 0.25;

const LEON_MARKET = [10.7853, 122.3831];

/**
 * Hand-reviewed gap notes carried over from the previous generator's
 * ROAD_GAP_PROJECTS table. The km values are NOT taken from here -- they come from
 * the survey -- only the written reason, which is why these rows are marked
 * `reviewed` rather than `inventory-surface`.
 */
const REVIEWED_GAP_NOTES = {
  201: 'Agboy Norte-Siol Norte has 98% earth surface in poor condition, creating a priority market-access gap.',
  206: 'Avanzada-Baje has a long gravel/poor-condition portion that weakens all-weather connectivity.',
  219: 'Binolbog-Ambulong is recorded as fully earth surfaced and poor, a clear missing paved link.',
  226: 'Bucari-Cagay-Ingay has combined earth and gravel sections that constrain highland access.',
  228: 'Bucari-Cumpan-Sibucao is recorded as a critical earth road gap.',
  231: 'Buga-Sitio Dao-Baong has mostly earth and gravel surface, affecting rainy-season access.',
  232: 'Buga-Kananghan-Iguaras has a long unpaved section suitable for gap-based prioritization.',
  236: 'Buga-Sitio Tibod-Lanag is recorded as fully earth surfaced in poor condition.',
  257: 'Dorog-Cawilihan has a long gravel segment that can delay produce movement.',
  295: 'Malublub-Sitio Lintian is fully gravel surfaced and can justify improvement priority.',
  297: 'Malublub-Sitio Tumotob is recorded as fully earth surfaced and poor.',
  334: 'Tu-og-Siol Norte is recorded as a full earth surface gap.',
};

// --- paths ------------------------------------------------------------------

const PROJECTS_PATH = resolve(REPO_ROOT, 'scripts', 'leon_fmr_projects_live.json');
const INVENTORY_PATH = resolve(REPO_ROOT, 'src', 'data', 'leonRoadInventory.json');
const NETWORK_PATH = resolve(REPO_ROOT, 'scripts', 'leon_osm_local_roads.geojson');
const ROUTES_SQL = resolve(REPO_ROOT, 'supabase_leon_realistic_routes.sql');
const GAPS_SQL = resolve(REPO_ROOT, 'supabase_leon_road_network_gaps_data.sql');
const AUDIT_PATH = resolve(REPO_ROOT, 'leon_route_corridor_audit.json');

// --- helpers ----------------------------------------------------------------

const sqlStr = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sqlNum = (v) => (Number.isFinite(Number(v)) ? String(Number(Number(v).toFixed(6))) : 'NULL');
const sqlBool = (v) => (v ? 'TRUE' : 'FALSE');
const jsonbArr = (points) => `${sqlStr(JSON.stringify(points.map(([a, b]) => [round6(a), round6(b)])))}::jsonb`;
const round6 = (n) => Number(Number(n).toFixed(6));

/**
 * Match a project to its surveyed road. Strict normalized equality only -- loose
 * containment collapses "Awis Road" onto "Gumboc-Awis-Paoy-Camando Road" and
 * every "Buga-*" road onto one another.
 *
 * Three road names appear twice in the CSV as distinct segments, so when a name is
 * ambiguous the candidate whose surveyed length is closest to the declared project
 * length wins, and the choice is recorded in the audit.
 */
function matchInventory(project, inventoryByName) {
  const key = normalizeRoadName(project.project_name);
  const candidates = inventoryByName.get(key);
  if (!candidates || candidates.length === 0) return { road: null, ambiguous: false };
  if (candidates.length === 1) return { road: candidates[0], ambiguous: false };

  const declared = Number(project.project_length_km);
  const best = candidates.reduce((a, b) =>
    Math.abs((b.lengthKm ?? 0) - declared) < Math.abs((a.lengthKm ?? 0) - declared) ? b : a
  );
  return { road: best, ambiguous: true, candidateCount: candidates.length };
}

/** Snap a barangay centroid onto the road graph, refusing distant snaps. */
function snapBarangay(graph, centroids, barangay) {
  const c = centroids[barangay];
  if (!c) return { ok: false, reason: `no centroid for ${barangay}` };
  const hit = nearestNode(graph, c.lat, c.lng);
  if (!hit) return { ok: false, reason: 'empty road graph' };
  if (hit.distanceKm > MAX_SNAP_KM) {
    return { ok: false, reason: `${barangay} is ${hit.distanceKm.toFixed(2)} km from the nearest mapped local road`, distanceKm: hit.distanceKm };
  }
  return { ok: true, key: hit.key, distanceKm: hit.distanceKm, centroid: c };
}

/**
 * Build the longest sensible corridor for a project, long enough to host both the
 * funded route and the unpaved gap beyond it.
 */
function buildCorridor(project, chain, needKm, graph, components, centroids) {
  const withCentroids = chain.filter((b) => centroids[b]);

  // Two or more named barangays: route between them on the local network.
  if (withCentroids.length >= 2) {
    const from = snapBarangay(graph, centroids, withCentroids[0]);
    const to = snapBarangay(graph, centroids, withCentroids[withCentroids.length - 1]);

    if (from.ok && to.ok) {
      const sameComponent =
        components.componentOf.get(from.key) === components.componentOf.get(to.key);
      if (sameComponent) {
        const path = shortestPath(graph, from.key, to.key);
        if (path && path.points.length >= 2) {
          // Short corridor: continue past the far end so the gap has somewhere to
          // sit, rather than truncating the gap to whatever happened to be left.
          let points = path.points;
          let wayIds = path.wayIds;
          if (path.km < needKm) {
            // Seed the walk with the path's own nodes and point it onward along the
            // path's final heading, so the extension continues past the far barangay
            // instead of doubling back down the route it is extending.
            const tail = path.points.length >= 2
              ? bearingBetween(path.points[path.points.length - 2], path.points[path.points.length - 1])
              : null;
            const extra = farthestPathWithinKm(graph, to.key, needKm - path.km, new Set(path.nodeKeys))
              || walkOutward(graph, to.key, needKm - path.km, tail, path.nodeKeys);
            if (extra && extra.points.length >= 2) {
              points = [...points, ...extra.points.slice(1)];
              wayIds = [...new Set([...wayIds, ...extra.wayIds])];
            }
          }
          return {
            ok: true, points, wayIds,
            method: 'osm-local-graph barangay-to-barangay',
            routeSource: 'osm-local-graph',
            snapKm: Math.max(from.distanceKm, to.distanceKm),
            anchor: from.centroid,
          };
        }
      }
    }

    // Fall through to the single-barangay walk from whichever end did snap.
    const anchor = from.ok ? from : to.ok ? to : null;
    if (anchor) {
      const walk = farthestPathWithinKm(graph, anchor.key, needKm) || walkOutward(graph, anchor.key, needKm);
      if (walk && walk.points.length >= 2) {
        return {
          ok: true, points: walk.points, wayIds: walk.wayIds,
          method: 'osm-local-graph outward walk (named barangays not connected on the local network)',
          routeSource: 'osm-local-graph',
          snapKm: anchor.distanceKm,
          anchor: anchor.centroid,
        };
      }
    }
    return { ok: false, reason: from.ok || to.ok ? 'no walkable corridor from either named barangay' : `${from.reason}; ${to.reason}` };
  }

  // One named barangay: the road runs some distance along that barangay's own
  // network. Walk the real network outward instead of inventing a bearing.
  if (withCentroids.length === 1) {
    const anchor = snapBarangay(graph, centroids, withCentroids[0]);
    if (!anchor.ok) return { ok: false, reason: anchor.reason };
    const walk = farthestPathWithinKm(graph, anchor.key, needKm) || walkOutward(graph, anchor.key, needKm);
    if (!walk || walk.points.length < 2) return { ok: false, reason: 'no walkable corridor from the barangay centroid' };
    return {
      ok: true, points: walk.points, wayIds: walk.wayIds,
      method: 'osm-local-graph single-barangay outward walk',
      routeSource: 'osm-local-graph',
      snapKm: anchor.distanceKm,
      anchor: anchor.centroid,
    };
  }

  return { ok: false, reason: 'no barangay in the project name resolved to a centroid' };
}

/** Network distance from a point to Leon Public Market, on the same local graph. */
function marketDistanceKm(graph, components, lat, lng, marketNodeKey) {
  if (!marketNodeKey) return { km: null, method: 'market not on the local network' };
  const hit = nearestNode(graph, lat, lng);
  if (!hit) return { km: null, method: 'empty graph' };
  if (components.componentOf.get(hit.key) !== components.componentOf.get(marketNodeKey)) {
    return {
      km: round6(haversineKm([lat, lng], LEON_MARKET)),
      method: 'straight-line (not connected to the market on the local network)',
    };
  }
  const path = shortestPath(graph, hit.key, marketNodeKey);
  if (!path) return { km: round6(haversineKm([lat, lng], LEON_MARKET)), method: 'straight-line (no path found)' };
  return { km: round6(path.km), method: 'osm-local-graph network distance' };
}

// ---------------------------------------------------------------------------

if (!existsSync(NETWORK_PATH)) {
  console.error(`Missing ${NETWORK_PATH}`);
  console.error('Run: node scripts/fetch_leon_osm_roads.mjs');
  process.exit(1);
}

const projects = JSON.parse(readFileSync(PROJECTS_PATH, 'utf8'));
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
const centroids = loadBarangayCentroids();

const missingCentroids = barangaysMissingCentroids(centroids);
if (missingCentroids.length > 0) {
  console.error(`Barangays without a centroid: ${missingCentroids.join(', ')}`);
  process.exit(1);
}

const network = loadLocalNetwork(NETWORK_PATH);
const graph = buildGraph(network);
const components = labelComponents(graph);

console.log(`Road graph:   ${graph.nodes.size} nodes, ${graph.edgeCount} edges, from ${graph.wayCount} OSM ways`);
console.log(`Components:   ${components.sizes.length} (largest ${Math.max(...components.sizes)} nodes)`);
if (network.properties?.failedTiles?.length) {
  console.log(`  NOTE: ${network.properties.failedTiles.length} Overpass tile(s) failed during fetch; the network has holes.`);
}

const marketSnap = nearestNode(graph, LEON_MARKET[0], LEON_MARKET[1]);
const marketNodeKey = marketSnap && marketSnap.distanceKm <= MAX_SNAP_KM ? marketSnap.key : null;
console.log(`Leon market:  snapped ${marketSnap ? `${marketSnap.distanceKm.toFixed(3)} km` : 'n/a'}${marketNodeKey ? '' : ' (too far - market distances fall back to straight-line)'}`);

const inventoryByName = new Map();
for (const road of inventory) {
  const key = normalizeRoadName(road.roadName);
  if (!inventoryByName.has(key)) inventoryByName.set(key, []);
  inventoryByName.get(key).push(road);
}

// --- pass 1: build a route (and candidate gap) per project ------------------

const records = [];

for (const project of projects) {
  const declaredKm = Number(project.project_length_km);
  const parsed = parsePlaceChain(`${project.project_name || ''} ${project.location || ''}`);
  const { road, ambiguous, candidateCount } = matchInventory(project, inventoryByName);

  const base = {
    projectId: project.id,
    projectName: project.project_name,
    status: project.status,
    declaredKm: Number.isFinite(declaredKm) ? declaredKm : null,
    placeChain: parsed.chain,
    sitios: parsed.sitios,
    barangay: parsed.hostBarangay ?? road?.barangay ?? null,
    barangayEnd: parsed.terminalBarangay ?? road?.barangayEnd ?? null,
    inventoryRoadName: road?.roadName ?? null,
    inventoryLengthKm: road?.lengthKm ?? null,
    ambiguousInventoryMatch: Boolean(ambiguous),
    inventoryCandidateCount: candidateCount ?? (road ? 1 : 0),
    unpavedKm: road?.unpavedKm ?? null,
    unpavedType: road?.unpavedType ?? null,
    unpavedCondition: road?.unpavedCondition ?? null,
    surfaceSummary: road?.surfaceSummary ?? null,
    route: null,
    gap: null,
    skipped: null,
    warnings: [],
  };

  // Proposed projects with no declared length get no geometry -- there is nothing
  // to place. They keep the dashed centroid pin.
  if (!Number.isFinite(declaredKm) || declaredKm <= 0) {
    base.skipped = 'no declared length (project_length_km is 0 or null)';
    records.push(base);
    continue;
  }

  const gapKm = Number(road?.unpavedKm) >= MIN_GAP_KM ? Number(road.unpavedKm) : 0;
  const needKm = declaredKm + gapKm;

  const corridor = buildCorridor(project, parsed.chain, needKm, graph, components, centroids);
  if (!corridor.ok) {
    base.skipped = `no corridor: ${corridor.reason}`;
    records.push(base);
    continue;
  }

  const corridorKm = calculatePolylineDistanceKm(corridor.points);
  const cut = cutPolylineAtKm(corridor.points, declaredKm);
  const mappedKm = calculatePolylineDistanceKm(cut.points);

  // Guard: the route must begin in the barangay the project names.
  const startOffsetKm = corridor.anchor
    ? haversineKm(cut.points[0], [corridor.anchor.lat, corridor.anchor.lng])
    : null;
  if (startOffsetKm !== null && startOffsetKm > MAX_START_OFFSET_KM) {
    base.skipped = `route start is ${startOffsetKm.toFixed(2)} km from the ${base.barangay} centroid (limit ${MAX_START_OFFSET_KM} km)`;
    records.push(base);
    continue;
  }

  const truncated = cut.truncated;
  if (!truncated) {
    base.warnings.push(`corridor only ${corridorKm.toFixed(2)} km, shorter than the declared ${declaredKm} km`);
  }
  if (truncated && Math.abs(mappedKm - declaredKm) > LENGTH_TOLERANCE_KM) {
    base.warnings.push(`mapped ${mappedKm.toFixed(3)} km vs declared ${declaredKm} km`);
  }

  base.route = {
    points: cut.points.map(([a, b]) => [round6(a), round6(b)]),
    mappedKm: round6(mappedKm),
    corridorKm: round6(corridorKm),
    routeSource: corridor.routeSource,
    routeQuality: truncated ? 'corridor-truncated' : 'corridor-shorter-than-declared',
    method: corridor.method,
    osmWayIds: corridor.wayIds.slice(0, 40),
    snapKm: round6(corridor.snapKm ?? 0),
    startOffsetKm: startOffsetKm === null ? null : round6(startOffsetKm),
  };

  base.lengthConflict =
    Number.isFinite(road?.lengthKm) &&
    Math.abs(declaredKm - road.lengthKm) > LENGTH_CONFLICT_KM;

  // --- the gap: the unpaved remainder of the same road, beyond the route -----
  if (gapKm > 0) {
    const remainder = slicePolylineFromKm(corridor.points, declaredKm);
    if (remainder.points.length >= 2) {
      const gapCut = cutPolylineAtKm(remainder.points, gapKm);
      const gapMappedKm = calculatePolylineDistanceKm(gapCut.points);
      if (gapCut.points.length >= 2 && gapMappedKm > 0) {
        const far = gapCut.points[gapCut.points.length - 1];
        const market = marketDistanceKm(graph, components, far[0], far[1], marketNodeKey);
        base.gap = {
          gapCode: `LEON-GAP-${project.id}`,
          surveyedKm: gapKm,
          mappedKm: round6(gapMappedKm),
          truncated: gapCut.truncated,
          points: gapCut.points.map(([a, b]) => [round6(a), round6(b)]),
          gapType: road.unpavedType,
          surfaceCondition: road.unpavedCondition,
          surfaceSummary: road.surfaceSummary,
          marketDistanceKm: market.km,
          marketDistanceMethod: market.method,
          source: REVIEWED_GAP_NOTES[project.id] ? 'reviewed' : 'inventory-surface',
          reason:
            REVIEWED_GAP_NOTES[project.id] ||
            `${gapKm.toFixed(2)} km of the surveyed ${road.roadName} is unpaved (${road.surfaceSummary}).`,
        };
        if (!gapCut.truncated) {
          base.warnings.push(`gap corridor short: drew ${gapMappedKm.toFixed(2)} km of a surveyed ${gapKm} km`);
        }
      } else {
        base.warnings.push('no corridor left beyond the route for the gap');
      }
    } else {
      base.warnings.push('no corridor left beyond the route for the gap');
    }
  }

  records.push(base);
}

// --- pass 2: link each gap to the project it would connect to ---------------

const hostIndex = new Map();
for (const r of records) {
  if (!r.barangay) continue;
  if (!hostIndex.has(r.barangay)) hostIndex.set(r.barangay, []);
  hostIndex.get(r.barangay).push(r);
}

for (const r of records) {
  if (!r.gap) continue;
  const target = r.barangayEnd
    ? (hostIndex.get(r.barangayEnd) || []).find((o) => o.projectId !== r.projectId && o.route)
    : null;
  r.gap.toProjectId = target ? target.projectId : null;
  r.gap.connectsToMarket =
    Number.isFinite(r.gap.marketDistanceKm) && r.gap.marketDistanceKm <= 2.0;
}

// --- assertions -------------------------------------------------------------

const withRoute = records.filter((r) => r.route);
const withGap = records.filter((r) => r.gap);
const skipped = records.filter((r) => r.skipped);

const problems = [];
for (const r of withRoute) {
  if (r.route.routeQuality === 'corridor-truncated' &&
      Math.abs(r.route.mappedKm - r.declaredKm) > LENGTH_TOLERANCE_KM) {
    problems.push(`#${r.projectId}: mapped ${r.route.mappedKm} vs declared ${r.declaredKm}`);
  }
  if (!r.barangay) problems.push(`#${r.projectId}: route emitted with no barangay`);
  if (r.route.points.length < 2) problems.push(`#${r.projectId}: route has < 2 vertices`);
}
for (const r of withGap) {
  const routeEnd = r.route.points[r.route.points.length - 1];
  const sepM = haversineKm(routeEnd, r.gap.points[0]) * 1000;
  if (sepM > 5) problems.push(`#${r.projectId}: gap starts ${sepM.toFixed(1)} m from the route end`);
  if (!r.gap.gapType) problems.push(`#${r.projectId}: gap has no surface type`);
}
for (const r of skipped) {
  if (!r.skipped) problems.push(`#${r.projectId}: skipped with no recorded reason`);
}

// --- audit ------------------------------------------------------------------

const gapKms = withGap.map((r) => r.gap.surveyedKm).sort((a, b) => a - b);
const audit = {
  generatedAt: new Date().toISOString(),
  tunables: { MIN_GAP_KM, MAX_START_OFFSET_KM, MAX_SNAP_KM, LENGTH_TOLERANCE_KM, LENGTH_CONFLICT_KM },
  network: {
    source: network.properties?.source,
    license: network.properties?.license,
    fetchedAt: network.properties?.fetchedAt,
    excludedClasses: network.properties?.excludedClasses,
    ways: graph.wayCount,
    nodes: graph.nodes.size,
    edges: graph.edgeCount,
    components: components.sizes.length,
    failedTiles: network.properties?.failedTiles ?? [],
  },
  totals: {
    projects: records.length,
    routesEmitted: withRoute.length,
    gapsEmitted: withGap.length,
    skipped: skipped.length,
    withWarnings: records.filter((r) => r.warnings.length > 0).length,
    lengthConflicts: records.filter((r) => r.lengthConflict).length,
    ambiguousInventoryMatches: records.filter((r) => r.ambiguousInventoryMatch).length,
  },
  gapSpreadKm: {
    count: gapKms.length,
    min: gapKms[0] ?? null,
    median: gapKms[Math.floor(gapKms.length / 2)] ?? null,
    max: gapKms[gapKms.length - 1] ?? null,
  },
  routeQualityCounts: withRoute.reduce((acc, r) => {
    acc[r.route.routeQuality] = (acc[r.route.routeQuality] || 0) + 1;
    return acc;
  }, {}),
  gapSourceCounts: withGap.reduce((acc, r) => {
    acc[r.gap.source] = (acc[r.gap.source] || 0) + 1;
    return acc;
  }, {}),
  skippedReasons: skipped.map((r) => ({ projectId: r.projectId, projectName: r.projectName, reason: r.skipped })),
  problems,
  records,
};
writeFileSync(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`);

// --- report -----------------------------------------------------------------

console.log('');
console.log(`Projects:          ${records.length}`);
console.log(`  routes emitted:  ${withRoute.length}   ${JSON.stringify(audit.routeQualityCounts)}`);
console.log(`  gaps emitted:    ${withGap.length}   ${JSON.stringify(audit.gapSourceCounts)}`);
console.log(`  skipped:         ${skipped.length}`);
console.log(`  with warnings:   ${audit.totals.withWarnings}`);
console.log(`  length conflicts:${audit.totals.lengthConflicts}  (declared vs surveyed road length)`);
console.log(`Gap spread km:     min ${audit.gapSpreadKm.min} / median ${audit.gapSpreadKm.median} / max ${audit.gapSpreadKm.max}`);
console.log(`Audit:             ${AUDIT_PATH}`);

if (problems.length > 0) {
  console.error('');
  console.error(`FAILED ${problems.length} assertion(s) -- no SQL written:`);
  problems.slice(0, 20).forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

// --- SQL --------------------------------------------------------------------

const routeLines = [
  '-- ============================================================',
  '-- KalsaTrack - Realistic Leon project route geometry',
  `-- Generated ${audit.generatedAt} by scripts/generate_leon_route_corridors.mjs`,
  '--',
  '-- Each route is the first project_length_km of a path through Leon\'s LOCAL OSM',
  '-- road network (trunk classes excluded, so no national-road detours), truncated',
  '-- with vertex interpolation so mapped_length_km equals the declared length.',
  `-- Alignment source: ${network.properties?.source} (${network.properties?.license}).`,
  '--',
  '-- Supersedes supabase_define_missing_leon_project_routes.sql and',
  '-- supabase_correct_leon_completed_project_routes.sql.',
  '-- Run supabase_leon_road_network_gaps.sql first (adds the barangay columns).',
  '-- ============================================================',
  '',
  'INSERT INTO public.project_routes (',
  '  project_id, start_latitude, start_longitude, end_latitude, end_longitude,',
  '  route_points, route_source, route_quality, declared_length_km, mapped_length_km',
  ') VALUES',
];

// The row separator must come BEFORE the trailing comment, not after it: a comma
// placed after `-- ...` is inside the comment, so Postgres sees two VALUES rows
// with nothing between them and fails with a syntax error at the next "(".
const routeValues = withRoute.map((r, index) => {
  const pts = r.route.points;
  const start = pts[0];
  const end = pts[pts.length - 1];
  // Interior vertices only: buildRoutePoints reassembles start + route_points + end.
  const interior = pts.slice(1, -1);
  const comma = index === withRoute.length - 1 ? '' : ',';
  const note = `${r.projectName} | ${r.placeChain.join(' > ') || r.barangay} | ${r.route.method}`
    .replace(/[\r\n]+/g, ' ');
  return `  (${r.projectId}, ${sqlNum(start[0])}, ${sqlNum(start[1])}, ${sqlNum(end[0])}, ${sqlNum(end[1])}, ` +
    `${jsonbArr(interior)}, ${sqlStr(r.route.routeSource)}, ${sqlStr(r.route.routeQuality)}, ` +
    `${sqlNum(r.declaredKm)}, ${sqlNum(r.route.mappedKm)})${comma}` +
    `  -- ${note}`;
});

routeLines.push(routeValues.join('\n'));
routeLines.push('ON CONFLICT (project_id) DO UPDATE SET');
routeLines.push('  start_latitude = EXCLUDED.start_latitude,');
routeLines.push('  start_longitude = EXCLUDED.start_longitude,');
routeLines.push('  end_latitude = EXCLUDED.end_latitude,');
routeLines.push('  end_longitude = EXCLUDED.end_longitude,');
routeLines.push('  route_points = EXCLUDED.route_points,');
routeLines.push('  route_source = EXCLUDED.route_source,');
routeLines.push('  route_quality = EXCLUDED.route_quality,');
routeLines.push('  declared_length_km = EXCLUDED.declared_length_km,');
routeLines.push('  mapped_length_km = EXCLUDED.mapped_length_km,');
routeLines.push('  updated_at = now();');
routeLines.push('');
routeLines.push('-- Barangay attribution, from the surveyed road name rather than a regex over');
routeLines.push('-- free-text location. Also mirrors start/end onto fmr_projects for the older');
routeLines.push('-- views that read it directly.');
routeLines.push('UPDATE public.fmr_projects AS p SET');
routeLines.push('  barangay = v.barangay,');
routeLines.push('  barangay_end = v.barangay_end,');
routeLines.push('  inventory_road_name = v.inventory_road_name,');
routeLines.push('  length_conflict = v.length_conflict');
routeLines.push('FROM (VALUES');

const barangayRows = records
  .filter((r) => r.barangay)
  .map((r) =>
    `  (${r.projectId}::bigint, ${sqlStr(r.barangay)}::text, ${sqlStr(r.barangayEnd)}::text, ` +
    `${sqlStr(r.inventoryRoadName)}::text, ${sqlBool(r.lengthConflict)}::boolean)`
  );
routeLines.push(barangayRows.join(',\n'));
routeLines.push(') AS v(project_id, barangay, barangay_end, inventory_road_name, length_conflict)');
routeLines.push('WHERE p.id = v.project_id;');
routeLines.push('');
routeLines.push('UPDATE public.fmr_projects AS p SET');
routeLines.push('  start_latitude = r.start_latitude,');
routeLines.push('  start_longitude = r.start_longitude,');
routeLines.push('  end_latitude = r.end_latitude,');
routeLines.push('  end_longitude = r.end_longitude');
routeLines.push('FROM public.project_routes AS r');
routeLines.push(`WHERE p.id = r.project_id AND r.project_id IN (${withRoute.map((r) => r.projectId).join(', ')});`);
routeLines.push('');
routeLines.push(`-- ${withRoute.length} routes. ${skipped.length} project(s) intentionally left without geometry:`);
skipped.forEach((r) => routeLines.push(`--   ${r.projectId}: ${r.projectName} -- ${r.skipped}`));

writeFileSync(ROUTES_SQL, `${routeLines.join('\n')}\n`);

const gapLines = [
  '-- ============================================================',
  '-- KalsaTrack - Road network gap rows',
  `-- Generated ${audit.generatedAt} by scripts/generate_leon_route_corridors.mjs`,
  '--',
  '-- gap_km is the surveyed Earth + Gravel length of the road from',
  '-- Leon_barangay_roads.csv -- read from the survey, not chosen here. Each gap is',
  '-- drawn on its road\'s own alignment, starting where the funded route ends.',
  '--',
  `-- Threshold: roads with at least ${MIN_GAP_KM} km unpaved.`,
  '-- Requires supabase_leon_road_network_gaps.sql (schema) to have been run.',
  '-- ============================================================',
  '',
  'INSERT INTO public.road_network_gaps (',
  '  gap_code, from_project_id, to_project_id, municipality, barangay, barangay_end,',
  '  gap_km, mapped_gap_km, gap_type, surface_condition, gap_reason, gap_source, source_road_name,',
  '  source_surface_summary, route_source, route_quality,',
  '  start_latitude, start_longitude, end_latitude, end_longitude, gap_points,',
  '  market_distance_km, connects_to_market',
  ') VALUES',
];

const gapValues = withGap.map((r, index) => {
  const pts = r.gap.points;
  const start = pts[0];
  const end = pts[pts.length - 1];
  // Comma before the comment -- see the note on routeValues above.
  const comma = index === withGap.length - 1 ? '' : ',';
  return `  (${sqlStr(r.gap.gapCode)}, ${r.projectId}, ${r.gap.toProjectId ?? 'NULL'}, 'Leon', ` +
    `${sqlStr(r.barangay)}, ${sqlStr(r.barangayEnd)}, ${sqlNum(r.gap.surveyedKm)}, ${sqlNum(r.gap.mappedKm)}, ` +
    `${sqlStr(r.gap.gapType)}, ${sqlStr(r.gap.surfaceCondition)}, ${sqlStr(r.gap.reason)}, ` +
    `${sqlStr(r.gap.source)}, ${sqlStr(r.inventoryRoadName)}, ${sqlStr(r.gap.surfaceSummary)}, ` +
    `${sqlStr(r.route.routeSource)}, ${sqlStr(r.route.routeQuality)}, ` +
    `${sqlNum(start[0])}, ${sqlNum(start[1])}, ${sqlNum(end[0])}, ${sqlNum(end[1])}, ` +
    `${jsonbArr(pts)}, ${sqlNum(r.gap.marketDistanceKm)}, ${sqlBool(r.gap.connectsToMarket)})${comma}` +
    `  -- surveyed ${r.gap.surveyedKm} km unpaved on ${r.inventoryRoadName}`;
});

gapLines.push(gapValues.join('\n'));
gapLines.push('ON CONFLICT (gap_code) DO UPDATE SET');
[
  'from_project_id', 'to_project_id', 'barangay', 'barangay_end', 'gap_km', 'mapped_gap_km', 'gap_type',
  'surface_condition', 'gap_reason', 'gap_source', 'source_road_name',
  'source_surface_summary', 'route_source', 'route_quality', 'start_latitude',
  'start_longitude', 'end_latitude', 'end_longitude', 'gap_points',
  'market_distance_km', 'connects_to_market',
].forEach((col) => gapLines.push(`  ${col} = EXCLUDED.${col},`));
gapLines.push('  updated_at = now();');
gapLines.push('');
gapLines.push(`-- ${withGap.length} gaps, ${audit.gapSpreadKm.min}-${audit.gapSpreadKm.max} km (median ${audit.gapSpreadKm.median}).`);

writeFileSync(GAPS_SQL, `${gapLines.join('\n')}\n`);

console.log('');
console.log(`Wrote ${ROUTES_SQL}`);
console.log(`Wrote ${GAPS_SQL}`);
console.log('');
console.log('Review leon_route_corridor_audit.json before running either file.');
