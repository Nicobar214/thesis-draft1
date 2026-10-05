// Fetch Leon's LOCAL road network from OpenStreetMap via Overpass, once, and
// cache it to scripts/leon_osm_local_roads.geojson.
//
// WHY NOT OSRM: the public OSRM demo server routes a *car*. Asked to connect two
// adjacent barangay centroids it will go out to the national road and back, which
// is what produced the 39 existing project_routes rows flagged
// "road-snapped approximate - length mismatch" (avg declared 1.33 km vs avg mapped
// 5.21 km, worst 16.96 km off). Truncating such a path to the declared length
// would put the right NUMBER on the wrong GEOMETRY, and would hide the fact that
// it is approximate -- worse for a thesis than an obviously straight line.
//
// WHY NOT MATCH BY NAME: OSM carries only ~108 distinct road names inside Leon,
// and they are Poblacion town streets plus inter-municipal roads. Against the
// LGU's 143 surveyed barangay roads that matches 0 exactly and 4 partially. The
// barangay network is in OSM, but as UNNAMED ways.
//
// SO: fetch the unnamed local network and route on it as a graph. Deliberately
// EXCLUDES primary/secondary/tertiary -- those are the classes a car router
// detours through, and a farm-to-market barangay road is none of them. Measured
// coverage: 74 of 85 barangay centroids sit within 600 m of a way in this set.
//
//   node scripts/fetch_leon_osm_roads.mjs             # use cache if present
//   node scripts/fetch_leon_osm_roads.mjs --refresh   # re-query Overpass

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, loadBarangayCentroids, normalizeRoadName } from './lib/leonPlaceChain.mjs';

const REFRESH = process.argv.includes('--refresh');
const USE_PARTIAL = process.argv.includes('--use-partial');
const CACHE_PATH = resolve(REPO_ROOT, 'scripts', 'leon_osm_local_roads.geojson');
// Per-tile progress, so an interrupted fetch resumes instead of restarting.
const PARTIAL_PATH = resolve(REPO_ROOT, 'scripts', '.leon_osm_tiles_partial.json');

const bboxKey = (b) =>
  [b.south, b.west, b.north, b.east].map((n) => n.toFixed(5)).join(',') +
  '|' + LOCAL_HIGHWAY_CLASSES.join('+') + '|' + TILES_PER_SIDE;

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/**
 * Local road classes only. `track` matters: many Leon barangay roads are mapped
 * as tracks. `path` is excluded (footpaths are not FMR roads), and so are
 * primary/secondary/tertiary -- including those is what lets a route detour onto
 * the national road.
 */
const LOCAL_HIGHWAY_CLASSES = [
  'residential', 'unclassified', 'track', 'service', 'living_street', 'road',
];

/**
 * Trunk classes, fetched too but marked so the router can charge a high cost for
 * them (see leonRoadGraph.CLASS_COST).
 *
 * Excluding them outright was wrong: Leon's barangay roads largely connect to one
 * another THROUGH the tertiary/secondary network, so dropping those classes left a
 * graph of 12,012 nodes with only 11,819 edges -- a forest of 279 disconnected
 * fragments, in which most corridors were far too short to host a project route.
 * Including them at a heavy cost instead keeps routes on local roads wherever a
 * local route exists, while still allowing a barangay-to-barangay path to exist at
 * all. There are only ~160 of these ways, so the extra query is cheap.
 */
const TRUNK_HIGHWAY_CLASSES = [
  'primary', 'secondary', 'tertiary',
  'primary_link', 'secondary_link', 'tertiary_link',
];

const TILES_PER_SIDE = 3;
const ATTEMPTS_PER_TILE = 3;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function leonBoundingBox(padDeg = 0.015) {
  const centroids = Object.values(loadBarangayCentroids());
  const lats = centroids.map((c) => c.lat);
  const lngs = centroids.map((c) => c.lng);
  return {
    south: Math.min(...lats) - padDeg,
    west: Math.min(...lngs) - padDeg,
    north: Math.max(...lats) + padDeg,
    east: Math.max(...lngs) + padDeg,
  };
}

function tileBoundingBox(bbox, n) {
  const dLat = (bbox.north - bbox.south) / n;
  const dLng = (bbox.east - bbox.west) / n;
  const tiles = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      tiles.push({
        south: bbox.south + i * dLat,
        north: bbox.south + (i + 1) * dLat,
        west: bbox.west + j * dLng,
        east: bbox.west + (j + 1) * dLng,
      });
    }
  }
  return tiles;
}

const buildQuery = (tile, classes = LOCAL_HIGHWAY_CLASSES) => `[out:json][timeout:300];
(
  way["highway"~"^(${classes.join('|')})$"](${tile.south},${tile.west},${tile.north},${tile.east});
);
out geom tags;`;

async function postQuery(query) {
  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'KalsaTrack thesis route generator (educational use)',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.elements)) throw new Error('malformed response');
      return json.elements;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('unknown Overpass failure');
}

/**
 * Fetch every tile, retrying individually, saving progress after each one.
 *
 * The free endpoints fail roughly a third of requests with 504/502, and a tile
 * that silently returns nothing leaves a hole in the network graph -- so failures
 * are retried and then reported, never ignored.
 *
 * Each completed tile is written to a partial-progress file immediately. A full
 * run takes 10-20 minutes against these endpoints, and losing all of it to one
 * interruption (a closed terminal, a killed background job) means starting over;
 * with this, a re-run skips the tiles already in hand.
 */
async function fetchLocalNetwork(bbox) {
  const tiles = tileBoundingBox(bbox, TILES_PER_SIDE);

  let done = {};
  if (existsSync(PARTIAL_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(PARTIAL_PATH, 'utf8'));
      if (saved.bboxKey === bboxKey(bbox)) {
        done = saved.tiles || {};
        const count = Object.keys(done).length;
        if (count > 0) console.log(`  resuming: ${count}/${tiles.length} tile(s) already fetched`);
      }
    } catch {
      // A corrupt partial file is not worth failing over; start fresh.
    }
  }

  for (const [index, tile] of tiles.entries()) {
    const id = String(index + 1);
    if (done[id]) {
      console.log(`  tile ${id}/${tiles.length}: cached (${done[id].length} ways)`);
      continue;
    }

    // --use-partial builds the network from whatever tiles are already cached
    // instead of querying. Leon's northern tiles sit over the Bucari highlands,
    // where Overpass times out repeatedly and there is little mapped road to find;
    // this allows work to proceed on a network with documented holes rather than
    // blocking on endpoints that may never answer. The holes are recorded in the
    // output's properties and reported in the coverage summary.
    if (USE_PARTIAL) {
      console.log(`  tile ${id}/${tiles.length}: skipped (--use-partial)`);
      continue;
    }

    for (let attempt = 1; attempt <= ATTEMPTS_PER_TILE; attempt += 1) {
      process.stdout.write(`  tile ${id}/${tiles.length} attempt ${attempt}: `);
      try {
        const got = await postQuery(buildQuery(tile));

        // An empty result is treated as a failure and retried. These endpoints
        // sometimes answer 200 with no elements instead of erroring, and a tile
        // over inhabited Leon should never have zero local roads -- accepting the
        // empty answer silently punches a hole in the routing graph and makes
        // barangays look unreachable. Only a repeated empty answer is believed.
        if (got.length === 0 && attempt < ATTEMPTS_PER_TILE) {
          console.log('0 ways (suspicious, retrying)');
          await sleep(4000 * attempt);
          continue;
        }

        console.log(`${got.length} ways${got.length === 0 ? ' (empty after all attempts)' : ''}`);
        done[id] = got;
        writeFileSync(PARTIAL_PATH, JSON.stringify({ bboxKey: bboxKey(bbox), tiles: done }));
        break;
      } catch (error) {
        console.log(`failed (${error.message})`);
        if (attempt < ATTEMPTS_PER_TILE) await sleep(4000 * attempt);
      }
    }
    await sleep(1500);
  }

  // One extra whole-bbox query for the trunk classes -- only ~160 ways, light
  // enough not to need tiling. Cached under its own key alongside the tiles.
  // Attempted even under --use-partial: it is a single light query, and without the
  // trunk classes the graph is too fragmented to route on at all.
  if (done.trunk) {
    console.log(`  trunk classes: cached (${done.trunk.length} ways)`);
  } else {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_TILE; attempt += 1) {
      process.stdout.write(`  trunk classes attempt ${attempt}: `);
      try {
        const got = await postQuery(buildQuery(bbox, TRUNK_HIGHWAY_CLASSES));

        // Same empty-response guard as the tiles: Leon is crossed by named
        // secondary and tertiary roads, so zero trunk ways means the endpoint
        // answered without data, not that none exist.
        if (got.length === 0 && attempt < ATTEMPTS_PER_TILE) {
          console.log('0 ways (suspicious, retrying)');
          await sleep(4000 * attempt);
          continue;
        }

        console.log(`${got.length} ways${got.length === 0 ? ' (empty after all attempts)' : ''}`);
        done.trunk = got;
        writeFileSync(PARTIAL_PATH, JSON.stringify({ bboxKey: bboxKey(bbox), tiles: done }));
        break;
      } catch (error) {
        console.log(`failed (${error.message})`);
        if (attempt < ATTEMPTS_PER_TILE) await sleep(4000 * attempt);
      }
    }
  }

  const merged = new Map();
  for (const elements of Object.values(done)) {
    for (const el of elements) merged.set(el.id, el);
  }
  const failedTiles = tiles
    .map((tile, index) => ({ tile, index: index + 1 }))
    .filter(({ index }) => !done[String(index)]);

  // Tiles that answered, but with nothing. Reported separately from outright
  // failures because they are the more dangerous case: the run looks clean while
  // the routing graph quietly has a hole in it.
  const emptyTiles = tiles
    .map((tile, index) => ({ tile, index: index + 1 }))
    .filter(({ index }) => done[String(index)] && done[String(index)].length === 0);

  return { elements: [...merged.values()], failedTiles, emptyTiles };
}

function toFeatureCollection(elements, bbox, failedTiles, emptyTiles = []) {
  const features = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    // GeoJSON order is [lng, lat]. The app stores [lat, lng]; the generator
    // converts on read, so this file stays valid GeoJSON.
    const coords = el.geometry
      .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => [Number(p.lon.toFixed(7)), Number(p.lat.toFixed(7))]);
    if (coords.length < 2) continue;

    const tags = el.tags || {};
    features.push({
      type: 'Feature',
      id: el.id,
      properties: {
        osmWayId: el.id,
        name: tags.name || null,
        nameNormalized: tags.name ? normalizeRoadName(tags.name) : null,
        highway: tags.highway || null,
        // How the router should treat this way. Trunk ways are kept for
        // connectivity but charged a heavy cost, so a route only uses one when no
        // local alternative exists.
        routingClass: TRUNK_HIGHWAY_CLASSES.includes(tags.highway) ? 'trunk' : 'local',
        surface: tags.surface || null,
        tracktype: tags.tracktype || null,
      },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  return {
    type: 'FeatureCollection',
    properties: {
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL 1.0, (c) OpenStreetMap contributors',
      fetchedAt: new Date().toISOString(),
      bbox,
      highwayClasses: LOCAL_HIGHWAY_CLASSES,
      trunkClasses: TRUNK_HIGHWAY_CLASSES,
      excludedClasses: ['path', 'footway', 'cycleway', 'steps'],
      routingNote:
        'Local classes route at true cost. Trunk classes are included for connectivity '
        + '(Leon barangay roads interconnect through them) but charged a heavy cost multiplier, '
        + 'so a path only uses a trunk road where no local alternative exists. Footpaths are '
        + 'excluded entirely as they are not farm-to-market roads.',
      wayCount: features.length,
      failedTiles,
      emptyTiles: emptyTiles.map((t) => t.index),
    },
    features,
  };
}

const haversineMeters = (aLat, aLng, bLat, bLng) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

// ---------------------------------------------------------------------------

let collection;
if (existsSync(CACHE_PATH) && !REFRESH && !USE_PARTIAL) {
  collection = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  console.log(`Using cached ${CACHE_PATH}`);
  console.log(`  fetched ${collection.properties?.fetchedAt}   ways ${collection.features.length}`);
} else {
  const bbox = leonBoundingBox();
  console.log(
    `Overpass bbox  S${bbox.south.toFixed(4)} W${bbox.west.toFixed(4)} N${bbox.north.toFixed(4)} E${bbox.east.toFixed(4)}`
  );
  const { elements, failedTiles, emptyTiles } = await fetchLocalNetwork(bbox);
  if (elements.length === 0) throw new Error('Overpass returned no ways at all; try again later.');

  collection = toFeatureCollection(elements, bbox, failedTiles, emptyTiles);
  writeFileSync(CACHE_PATH, `${JSON.stringify(collection)}\n`);
  console.log(`\nWrote ${CACHE_PATH}`);
  // Keep the per-tile progress file only while tiles are still outstanding, so a
  // later --refresh can resume them rather than re-fetching what already worked.
  if (failedTiles.length === 0 && emptyTiles.length === 0 && existsSync(PARTIAL_PATH)) rmSync(PARTIAL_PATH);
  if (emptyTiles.length > 0) {
    console.log('  WARNING: tile(s) ' + emptyTiles.map((t) => t.index).join(', ') + ' returned zero ways after every attempt.');
    console.log('  Verify against the coverage report below; a hole here makes barangays look unreachable.');
  }
  if (failedTiles.length > 0) {
    console.log(`  WARNING: ${failedTiles.length} tile(s) never succeeded (${failedTiles.map((f) => f.index).join(', ')}).`);
    console.log('  The network has holes there. Re-run with --refresh to fill them.');
  }
}

// --- coverage report -------------------------------------------------------

let totalKm = 0;
const vertices = [];
for (const f of collection.features) {
  const c = f.geometry.coordinates;
  for (const [lng, lat] of c) vertices.push([lat, lng]);
  for (let i = 1; i < c.length; i += 1) {
    totalKm += haversineMeters(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]) / 1000;
  }
}

const byClass = collection.features.reduce((acc, f) => {
  acc[f.properties.highway] = (acc[f.properties.highway] || 0) + 1;
  return acc;
}, {});

const centroids = loadBarangayCentroids();
const bands = { '<100m': 0, '<300m': 0, '<600m': 0, '<1km': 0, '>=1km': 0 };
const uncovered = [];
for (const [name, c] of Object.entries(centroids)) {
  let best = Infinity;
  for (const [lat, lng] of vertices) {
    const d = haversineMeters(c.lat, c.lng, lat, lng);
    if (d < best) best = d;
  }
  if (best < 100) bands['<100m'] += 1;
  else if (best < 300) bands['<300m'] += 1;
  else if (best < 600) bands['<600m'] += 1;
  else if (best < 1000) bands['<1km'] += 1;
  else {
    bands['>=1km'] += 1;
    uncovered.push(`${name} (${(best / 1000).toFixed(1)} km)`);
  }
}

console.log('');
console.log(`Local-class ways:      ${collection.features.length}`);
console.log(`  vertices:           ${vertices.length}`);
console.log(`  network length:     ${totalKm.toFixed(1)} km`);
console.log(`  named / unnamed:    ${collection.features.filter((f) => f.properties.name).length} / ${collection.features.filter((f) => !f.properties.name).length}`);
console.log(`  by class:           ${JSON.stringify(byClass)}`);
console.log('');
console.log('Nearest local road to each barangay centroid:');
console.log(`  ${JSON.stringify(bands)}`);
if (uncovered.length > 0) {
  console.log(`  Not covered (>= 1 km), these fall back to a flagged approximation:`);
  console.log(`    ${uncovered.join(', ')}`);
}
