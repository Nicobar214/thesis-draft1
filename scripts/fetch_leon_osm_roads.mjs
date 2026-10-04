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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, loadBarangayCentroids, normalizeRoadName } from './lib/leonPlaceChain.mjs';

const REFRESH = process.argv.includes('--refresh');
const CACHE_PATH = resolve(REPO_ROOT, 'scripts', 'leon_osm_local_roads.geojson');

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

const buildQuery = (tile) => `[out:json][timeout:300];
(
  way["highway"~"^(${LOCAL_HIGHWAY_CLASSES.join('|')})$"](${tile.south},${tile.west},${tile.north},${tile.east});
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
 * Fetch every tile, retrying individually. The free endpoints fail a third of
 * requests with 504/502, and a tile silently returning nothing leaves a hole in
 * the network graph -- so failures are retried and then reported, never ignored.
 */
async function fetchLocalNetwork(bbox) {
  const tiles = tileBoundingBox(bbox, TILES_PER_SIDE);
  const merged = new Map();
  const failedTiles = [];

  for (const [index, tile] of tiles.entries()) {
    let got = null;
    for (let attempt = 1; attempt <= ATTEMPTS_PER_TILE; attempt += 1) {
      process.stdout.write(`  tile ${index + 1}/${tiles.length} attempt ${attempt}: `);
      try {
        got = await postQuery(buildQuery(tile));
        console.log(`${got.length} ways`);
        break;
      } catch (error) {
        console.log(`failed (${error.message})`);
        if (attempt < ATTEMPTS_PER_TILE) await sleep(4000 * attempt);
      }
    }
    if (got) {
      for (const el of got) merged.set(el.id, el);
    } else {
      failedTiles.push({ tile, index: index + 1 });
    }
    await sleep(1500);
  }

  return { elements: [...merged.values()], failedTiles };
}

function toFeatureCollection(elements, bbox, failedTiles) {
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
      excludedClasses: ['primary', 'secondary', 'tertiary', 'path'],
      excludedReason:
        'Trunk classes are excluded so routing cannot detour via the national road; path is excluded as footpaths are not farm-to-market roads.',
      wayCount: features.length,
      failedTiles,
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
if (existsSync(CACHE_PATH) && !REFRESH) {
  collection = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  console.log(`Using cached ${CACHE_PATH}`);
  console.log(`  fetched ${collection.properties?.fetchedAt}   ways ${collection.features.length}`);
} else {
  const bbox = leonBoundingBox();
  console.log(
    `Overpass bbox  S${bbox.south.toFixed(4)} W${bbox.west.toFixed(4)} N${bbox.north.toFixed(4)} E${bbox.east.toFixed(4)}`
  );
  const { elements, failedTiles } = await fetchLocalNetwork(bbox);
  if (elements.length === 0) throw new Error('Overpass returned no ways at all; try again later.');

  collection = toFeatureCollection(elements, bbox, failedTiles);
  writeFileSync(CACHE_PATH, `${JSON.stringify(collection)}\n`);
  console.log(`\nWrote ${CACHE_PATH}`);
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
