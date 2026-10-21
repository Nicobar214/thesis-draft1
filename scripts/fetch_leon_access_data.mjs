// Builds the two small files the farmer-registration map uses to find where a
// farm can actually reach a road WITHOUT crossing a river:
//
//   public/data/geo/leon-waterways.json  rivers, streams and water areas (OpenStreetMap)
//   public/data/geo/leon-roads.json      roads a vehicle can use (from the cached
//                                        scripts/leon_osm_local_roads.geojson)
//
// Shipped with the app so the check is instant and works offline, instead of
// depending on the public Overpass servers, which fail often.
//
//   node scripts/fetch_leon_access_data.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, loadBarangayCentroids } from './lib/leonPlaceChain.mjs';

const OUT_DIR = resolve(REPO_ROOT, 'public', 'data', 'geo');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Roads the public car router (OSRM) can route on: a farm joins the network here.
const VEHICLE_CLASSES = new Set([
  'residential', 'unclassified', 'service', 'living_street', 'road',
  'tertiary', 'secondary', 'primary', 'tertiary_link', 'secondary_link', 'primary_link',
]);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const r5 = (n) => Number(n.toFixed(5));

function bbox(padDeg = 0.03) {
  const c = Object.values(loadBarangayCentroids());
  return {
    south: Math.min(...c.map((p) => p.lat)) - padDeg,
    west: Math.min(...c.map((p) => p.lng)) - padDeg,
    north: Math.max(...c.map((p) => p.lat)) + padDeg,
    east: Math.max(...c.map((p) => p.lng)) + padDeg,
  };
}

async function overpass(query) {
  let last = null;
  for (let round = 0; round < 4; round += 1) {
    for (const endpoint of ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'KalsaTrack thesis farm-access data (educational use)',
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: query }).toString(),
        });
        if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.elements)) throw new Error('malformed response');
        return json.elements;
      } catch (err) {
        last = err;
        console.warn('  retry:', err.message);
      }
    }
    await sleep(5000 * (round + 1));
  }
  throw last;
}

const b = bbox();
const box = `${b.south},${b.west},${b.north},${b.east}`;
console.log('Leon area', box);

// 1) Water: rivers and streams (lines) and mapped water areas (outlines).
const water = await overpass(`[out:json][timeout:180];
(
  way["waterway"~"^(river|stream|canal)$"](${box});
  way["natural"="water"](${box});
  way["waterway"="riverbank"](${box});
);
out geom tags;`);
const waterways = water
  .filter((w) => Array.isArray(w.geometry) && w.geometry.length >= 2)
  .map((w) => ({
    kind: w.tags?.waterway || (w.tags?.natural === 'water' ? 'water' : 'water'),
    name: w.tags?.name || null,
    line: w.geometry.map((p) => [r5(p.lat), r5(p.lon)]),
  }));

// 2) Roads, from the cached local network.
const roadsGeo = JSON.parse(readFileSync(resolve(REPO_ROOT, 'scripts', 'leon_osm_local_roads.geojson'), 'utf8'));
const roads = roadsGeo.features
  .filter((f) => VEHICLE_CLASSES.has(f.properties?.highway) && f.geometry?.type === 'LineString')
  .map((f) => ({
    highway: f.properties.highway,
    line: f.geometry.coordinates.map(([lng, lat]) => [r5(lat), r5(lng)]),
  }));

mkdirSync(OUT_DIR, { recursive: true });
const source = 'OpenStreetMap contributors (ODbL)';
writeFileSync(resolve(OUT_DIR, 'leon-waterways.json'), JSON.stringify({ source, bbox: b, waterways }));
writeFileSync(resolve(OUT_DIR, 'leon-roads.json'), JSON.stringify({ source, bbox: b, roads }));
const kinds = waterways.reduce((m, w) => ({ ...m, [w.kind]: (m[w.kind] || 0) + 1 }), {});
console.log(`waterways: ${waterways.length}`, kinds);
console.log(`roads: ${roads.length}`);
