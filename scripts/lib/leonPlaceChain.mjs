// Shared Leon place-name parser.
//
// Used by the inventory regenerator, the route/gap generator and the verifier so
// all three agree on what barangay a road name refers to.
//
// Why this exists: src/data/leonRoadInventory.json's `barangay` field was derived
// by scripts/generate_leon_csv_sql.mjs:190 doing `roadName.split(/[-–—,]/)` and
// taking the first part. Leon has eleven barangays whose names legitimately
// contain a hyphen (Cabunga-an, Carara-an, Lang-og, Odong-odong, Tu-og,
// Tina-an Norte/Sur, Cabolo-an …), so that split truncated them to "Cabunga",
// "Lang", "Tu", "Tina" and so on — 21 of 82 distinct values were not barangays.
// Leon_barangay_roads.csv has no barangay column at all; it has to be derived
// from the road name, which is what this module does properly.
//
// The matcher is longest-name-first with SPAN OCCUPANCY: once a name claims a
// character range, no shorter name may match inside it. Without that, "Gines"
// matches inside "Jamog Gines" and project 276 ("Jamog Gines Road", declared
// 0.14 km) parses as a two-barangay chain 10.27 km long — a 73x error that the
// previous per-name regex approach produced.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

const { default: ILOILO_LOCATIONS } = await import(
  new URL('../../src/data/iloiloLocations.js', import.meta.url).href
);

/** The 85 canonical Leon barangays. Authoritative spelling. */
export const LEON_BARANGAYS = [...ILOILO_LOCATIONS.municipalities.Leon.barangays];

/**
 * Spellings that appear in the LGU CSV / DA project names but are not the
 * canonical barangay name. Every entry is a real variant observed in the data,
 * not a speculative one.
 */
export const BARANGAY_ALIASES = {
  // Abbreviated in the CSV ("Tac. Norte-Marirong Rd.").
  'Tac. Norte': 'Tacuyong Norte',
  'Tac. Sur': 'Tacuyong Sur',
  // Hyphen variants of the canonical spelling.
  'Talacu-an': 'Talacuan',
  Caboloan: 'Cabolo-an',
  Langog: 'Lang-og',
  'Odong-Odong': 'Odong-odong',
  // Seen in DA-RAED project names for the Alimodian-side barangay.
  'Abang-abang': 'Abang-abang',
};

/**
 * Place tokens that look like barangays in road names but are sitios, landmarks
 * or informal locality names. They are recorded as `sitios` (useful as interior
 * corridor hints) and never used as a barangay anchor.
 */
export const NON_BARANGAY_PLACES = [
  'Takasi', 'Limotan', 'Kalapadan', 'Dugo', 'Bunga', 'Talibong', 'Bugo',
  'Bangalad', 'Lanot', 'Dao', 'Baong', 'Tibod', 'Lintian', 'Tumotob',
  'Kananghan', 'Iguaras', 'Cumpan', 'Sibucao', 'Lampigaw', 'Pinon-an',
  'Caboloan', 'Cemetery', 'Center',
];

/**
 * Roads whose name contains no resolvable barangay. Each is a deliberate,
 * reviewable judgement with the reason recorded, so the audit can show exactly
 * which rows rest on inference rather than on a name match.
 *
 * `null` means genuinely unresolved: the row keeps barangay = null, is flagged
 * in the audit, and is excluded from gap derivation. That is preferable to
 * guessing a barangay and presenting it as surveyed.
 */
export const MANUAL_ROAD_BARANGAY = {
  // The municipal centre and the municipal cemetery both sit in Poblacion.
  'Center Road': { barangay: 'Poblacion', reason: 'Municipal centre road; Leon town centre is Poblacion.' },
  'Cemetery Road.': { barangay: 'Poblacion', reason: 'Leon public cemetery is in Poblacion.' },
  // Sitio / locality roads with no barangay in the name.
  'Limotan Road': { barangay: null, reason: 'Limotan is a sitio; no barangay in the road name.' },
  'Kalapadan Road': { barangay: null, reason: 'Kalapadan is a sitio; no barangay in the road name.' },
  'Sitio Dugo Road': { barangay: null, reason: 'Sitio Dugo; parent barangay not stated in the CSV.' },
  'Takasi-Bunga Road': { barangay: null, reason: 'Takasi and Bunga are both sitios.' },
};

const isLetter = (ch) => Boolean(ch) && ch.toLowerCase() !== ch.toUpperCase();

/** Collapse whitespace; keep original casing so matches can be reported verbatim. */
export function tidy(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Strip CSV numbering and road-type noise so a road name can be compared to a
 * project name. "11. Bacolod-Cabunga-an Rd." -> "bacolod cabunga an"
 */
export function normalizeRoadName(text) {
  return stripCsvNumbering(text)
    .toLowerCase()
    .replace(/\b(rd|road|fmr)\b\.?/g, ' ')
    .replace(/\(new\)|\bnew\b|\bsection\s*\d+\b|\bjct\b|\bbrgy\b\.?|\bproper\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drop the leading "12. " the CSV prefixes to road names.
 *
 * Tolerates two real defects in Leon_barangay_roads.csv: row 51 is numbered
 * "49.." with a doubled period, and row 77 carries no number at all.
 */
export function stripCsvNumbering(text) {
  return tidy(text).replace(/^\d*\.+\s*/, '').trim();
}

function findBoundedOccurrences(haystack, needle) {
  const hay = haystack.toLowerCase();
  const nee = needle.toLowerCase();
  const out = [];
  if (!nee) return out;

  let i = 0;
  while ((i = hay.indexOf(nee, i)) !== -1) {
    const before = i > 0 ? haystack[i - 1] : '';
    const after = haystack[i + nee.length] || '';
    // Word boundary on both sides, so "Gines" does not match inside "Ginesville"
    // and "Agta" does not match inside "Agtambo".
    if (!isLetter(before) && !isLetter(after)) out.push(i);
    i += 1;
  }
  return out;
}

const precededBySitio = (haystack, index) =>
  haystack.slice(Math.max(0, index - 8), index).toLowerCase().endsWith('sitio ');

/**
 * Parse an ordered chain of places out of a road or project name.
 *
 * Returns barangays in the order they appear in the text, which is the travel
 * order of the road — so chain[0] is the host barangay and chain.at(-1) is the
 * far end. Sitios and known non-barangay localities come back separately.
 */
export function parsePlaceChain(text) {
  const haystack = tidy(text);
  const taken = new Array(haystack.length).fill(false);
  const hits = [];
  const sitios = [];

  const claim = (index, length) => {
    for (let k = index; k < index + length; k += 1) {
      if (taken[k]) return false;
    }
    for (let k = index; k < index + length; k += 1) taken[k] = true;
    return true;
  };

  // Candidates: canonical names plus alias spellings, longest first. Longest-first
  // combined with span occupancy is what prevents the Jamog Gines / Gines collision.
  const candidates = [
    ...LEON_BARANGAYS.map((name) => ({ match: name, canonical: name })),
    ...Object.entries(BARANGAY_ALIASES).map(([alias, canonical]) => ({ match: alias, canonical })),
  ].sort((a, b) => b.match.length - a.match.length);

  for (const { match, canonical } of candidates) {
    for (const index of findBoundedOccurrences(haystack, match)) {
      if (precededBySitio(haystack, index)) {
        sitios.push({ name: match, index });
        continue;
      }
      if (!claim(index, match.length)) continue;
      hits.push({ barangay: canonical, index, matchedAs: match });
    }
  }

  // Non-barangay localities, recorded only in spans nothing else claimed.
  for (const place of [...NON_BARANGAY_PLACES].sort((a, b) => b.length - a.length)) {
    for (const index of findBoundedOccurrences(haystack, place)) {
      if (!claim(index, place.length)) continue;
      sitios.push({ name: place, index });
    }
  }

  const ordered = hits.sort((a, b) => a.index - b.index);
  const chain = [];
  for (const hit of ordered) {
    if (!chain.includes(hit.barangay)) chain.push(hit.barangay);
  }

  return {
    chain,
    sitios: sitios.sort((a, b) => a.index - b.index).map((s) => s.name),
    hostBarangay: chain[0] ?? null,
    terminalBarangay: chain.length > 1 ? chain[chain.length - 1] : null,
    matches: ordered,
  };
}

/**
 * Resolve the barangay for an inventory road: name parse first, then the
 * reviewable manual map. Always reports how the answer was obtained.
 */
export function resolveRoadBarangay(roadName) {
  const clean = stripCsvNumbering(roadName);
  const parsed = parsePlaceChain(clean);

  if (parsed.hostBarangay) {
    return {
      barangay: parsed.hostBarangay,
      barangayEnd: parsed.terminalBarangay,
      source: 'name-parse',
      reason: null,
      chain: parsed.chain,
      sitios: parsed.sitios,
    };
  }

  const manual = MANUAL_ROAD_BARANGAY[clean];
  if (manual) {
    return {
      barangay: manual.barangay,
      barangayEnd: null,
      source: manual.barangay ? 'manual-inferred' : 'unresolved',
      reason: manual.reason,
      chain: [],
      sitios: parsed.sitios,
    };
  }

  return {
    barangay: null,
    barangayEnd: null,
    source: 'unresolved',
    reason: 'No barangay found in the road name and no manual mapping recorded.',
    chain: [],
    sitios: parsed.sitios,
  };
}

/** Barangay centroids: the geocode cache plus hand-placed overrides. */
export function loadBarangayCentroids() {
  const cache = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'scripts', 'barangay_geocode_cache.json'), 'utf8')
  );

  // Hand-placed from PhilAtlas barangay profiles where the geocoder missed or
  // returned an outlier. Carried through to the audit as `hand-placed` so the
  // thesis does not present them as geocoded results.
  const overrides = {
    Ayubo: { lat: 10.7927, lng: 122.3249 },
    Baje: { lat: 10.7987, lng: 122.3414 },
    'Biri Sur': { lat: 10.7594, lng: 122.3923 },
    Salngan: { lat: 10.7801, lng: 122.3654 },
    Talacuan: { lat: 10.7730, lng: 122.3894 },
    Tunguan: { lat: 10.8704, lng: 122.3346 },
    // Biri Norte had no centroid at all, which silently anchored projects 220
    // and 221 on their DESTINATION barangay. Placed from the PhilAtlas profile.
    'Biri Norte': { lat: 10.7669, lng: 122.3889 },
  };

  const centroids = {};
  for (const [name, value] of Object.entries(cache)) {
    centroids[name] = { lat: Number(value.lat), lng: Number(value.lng), source: value.source || 'nominatim' };
  }
  for (const [name, value] of Object.entries(overrides)) {
    centroids[name] = { ...value, source: 'hand-placed (PhilAtlas)' };
  }
  return centroids;
}

/** Barangays in the gazetteer that still have no coordinate — must be empty. */
export function barangaysMissingCentroids(centroids = loadBarangayCentroids()) {
  return LEON_BARANGAYS.filter((name) => !centroids[name]);
}
