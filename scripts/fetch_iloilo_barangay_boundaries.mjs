// Downloads official barangay boundaries for every Iloilo municipality and
// writes one small file per municipality to public/data/barangay-boundaries/.
//
// Source: github.com/faeldon/philippines-json-maps (MIT), PSA/NAMRIA PSGC 2023,
// high-resolution polygons. Re-run to refresh:  node scripts/fetch_iloilo_barangay_boundaries.mjs
//
// Names are matched to src/data/iloiloLocations.js so the app's barangay picker
// and the polygons agree; anything that doesn't match is printed at the end.
import { mkdir, writeFile } from 'node:fs/promises';
import ILOILO_LOCATIONS, { getBarangays, getMunicipalities } from '../src/data/iloiloLocations.js';

void ILOILO_LOCATIONS;
const BASE = 'https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson';
const PROVINCE = '603000000';
const OUT = new URL('../public/data/barangay-boundaries/', import.meta.url);
const SOURCE = 'PSA/NAMRIA PSGC 2023 via github.com/faeldon/philippines-json-maps (MIT)';

// Official name -> name used in the app.
const TOWN_ALIASES = { 'City of Passi': 'Passi City' };

// "Barangay Zone I (Poblacion)" and "Barangay Zone I" are the same place: ignore text in brackets.
const norm = (s) => String(s || '').replace(/\([^)]*\)/g, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const slug = (s) => norm(s).replace(/ /g, '-');
const round = (coords) => (typeof coords[0] === 'number'
  ? [Number(coords[0].toFixed(5)), Number(coords[1].toFixed(5))]
  : coords.map(round));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const appTowns = new Map(getMunicipalities().map((m) => [norm(m), m]));
const towns = (await getJson(`${BASE}/provdists/lowres/municities-provdist-${PROVINCE}.0.001.json`)).features
  .map((f) => ({ psgc: f.properties.adm3_psgc, official: f.properties.adm3_en }));

await mkdir(OUT, { recursive: true });
const index = {};
const problems = [];

for (const town of towns) {
  const appName = appTowns.get(norm(TOWN_ALIASES[town.official] || town.official));
  if (!appName) { problems.push(`municipality not in app: ${town.official}`); continue; }

  // High resolution: the low-res shapes leave gaps between barangays.
  const geo = await getJson(`${BASE}/municities/hires/bgysubmuns-municity-${town.psgc}.0.1.json`);
  const appBarangays = new Map(getBarangays(appName).map((b) => [norm(b), b]));
  const matched = new Set();
  const barangays = geo.features.filter((f) => {
    // A few source records have no shape; the app falls back to its center-point check for them.
    if (f.geometry) return true;
    problems.push(`${appName}: "${f.properties.adm4_en}" has no shape in the source data`);
    return false;
  }).map((f) => {
    const official = f.properties.adm4_en;
    const name = appBarangays.get(norm(official)) || official;
    if (appBarangays.has(norm(official))) matched.add(norm(official));
    else problems.push(`${appName}: boundary "${official}" not in the app's barangay list`);
    return { name, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } };
  });
  for (const [key, b] of appBarangays) if (!matched.has(key)) problems.push(`${appName}: app barangay "${b}" has no boundary`);

  const file = `${slug(appName)}.json`;
  await writeFile(new URL(file, OUT), JSON.stringify({ municipality: appName, psgc: town.psgc, source: SOURCE, barangays }));
  index[appName] = file;
  console.log(`${appName}: ${barangays.length} barangays`);
}

await writeFile(new URL('index.json', OUT), JSON.stringify({ source: SOURCE, municipalities: index }, null, 1));
console.log(`\n${Object.keys(index).length} municipalities written.`);
if (problems.length) console.log(`\nNot matched (${problems.length}):\n  ${problems.join('\n  ')}`);
