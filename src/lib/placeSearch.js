import LEON_BARANGAYS from '../data/leonBarangays';
import { ILOILO_MUNICIPALITY_CENTROIDS, getProjectBarangay } from './mapRouteUtils';

/*
 * Map place search, local first.
 *
 * The old search sent every query to a public web geocoder, took its first hit
 * and often flew to a same-named place elsewhere. This answers from data we
 * already trust (Leon barangays, municipalities, FMR projects) in the same
 * keystroke, and only asks the web for what is not known locally.
 */

const TYPE_ORDER = { barangay: 0, municipality: 1, project: 2, place: 3 };
const ZOOM = { barangay: 14, municipality: 12, project: 15, place: 15 };

/** Lowercase, accent-free, punctuation and hyphens collapsed to single spaces. */
export function norm(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const squash = (text) => norm(text).replace(/ /g, '');

/** Edit distance, bailing out early once it must exceed `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 0 = no match. Higher is better. */
function scoreKey(query, key) {
  const q = squash(query);
  const k = squash(key);
  if (!q || !k) return 0;
  if (q === k) return 100;
  if (k.startsWith(q)) return 90 - Math.min(10, k.length - q.length);
  if (norm(key).split(' ').some((word) => word.startsWith(q))) return 78;
  if (k.includes(q)) return 62;
  // Typos: tolerate 1 slip on a short name, 2 on a long one, comparing against
  // the same-length prefix too so a half-typed name still matches.
  if (q.length >= 4) {
    const allowed = q.length >= 8 ? 2 : 1;
    const whole = distance(q, k, allowed);
    const prefix = k.length > q.length ? distance(q, k.slice(0, q.length), allowed) : allowed + 1;
    const best = Math.min(whole, prefix);
    if (best <= allowed) return 54 - best * 4;
  }
  return 0;
}

function scoreEntry(query, entry) {
  const keys = [entry.label, ...(entry.aliases || [])];
  let best = 0;
  for (const key of keys) best = Math.max(best, scoreKey(query, key));
  if (best > 0) return best;

  // "bucari leon": every word must match the name or where it is.
  const tokens = norm(query).split(' ').filter(Boolean);
  if (tokens.length < 2) return 0;
  const haystack = [...keys, entry.sublabel || ''].map(norm).join(' ');
  const words = haystack.split(' ');
  const hit = tokens.every((t) => words.some((w) => w.startsWith(t)));
  return hit ? 48 : 0;
}

/* ------------------------------ sources ------------------------------ */

function toPoint(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  return Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 && lo === 0) ? { lat: la, lng: lo } : null;
}

const STATIC_ENTRIES = [
  ...LEON_BARANGAYS.map((b) => ({
    id: `brgy:${b.name}`,
    type: 'barangay',
    label: b.name,
    aliases: b.aliases,
    sublabel: 'Barangay · Leon, Iloilo',
    lat: b.lat,
    lng: b.lng,
    approx: Boolean(b.approx),
  })),
  ...Object.entries(ILOILO_MUNICIPALITY_CENTROIDS)
    .filter(([name]) => name !== 'Passi City')
    .map(([name, [lat, lng]]) => ({
      id: `muni:${name}`,
      type: 'municipality',
      label: name,
      sublabel: 'Municipality · Iloilo',
      lat,
      lng,
    })),
];

/** FMR projects that have a start point, as search entries. */
export function projectEntries(projects) {
  const out = [];
  for (const p of projects || []) {
    const pt = toPoint(p.start_latitude, p.start_longitude);
    if (!pt || !p.project_name) continue;
    const barangay = getProjectBarangay(p);
    out.push({
      id: `proj:${p.id}`,
      type: 'project',
      label: p.project_name,
      sublabel: ['FMR project', barangay !== 'N/A' ? barangay : null, p.municipality].filter(Boolean).join(' · '),
      ...pt,
    });
  }
  return out;
}

/**
 * Instant results. `extra` is any caller-supplied entries (usually projectEntries).
 * Returns at most `limit`, best first.
 */
export function searchLocal(query, extra = [], limit = 8) {
  if (!norm(query)) return [];
  const scored = [];
  for (const entry of [...STATIC_ENTRIES, ...extra]) {
    const score = scoreEntry(query, entry);
    if (score > 0) scored.push({ ...entry, zoom: ZOOM[entry.type], score });
  }
  scored.sort((a, b) => b.score - a.score
    || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
    || a.label.localeCompare(b.label));
  return scored.slice(0, limit);
}

/* ------------------------- web fallback ------------------------- */

const remoteCache = new Map();
let lastRemoteAt = 0;
const MIN_GAP_MS = 1100; // the public geocoder allows about one request per second

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function remoteLabel(hit) {
  const a = hit.address || {};
  const name = hit.name || a.village || a.suburb || a.town || a.city || a.road || hit.display_name.split(',')[0];
  const where = [a.municipality || a.town || a.city || a.county, a.state || 'Iloilo'].filter(Boolean);
  return { label: name, sublabel: ['Place', ...where].join(' · ') };
}

/**
 * Web lookup limited to Iloilo, five results, cached per query for the session.
 * Throws AbortError if `signal` fires, and returns [] for any other failure so
 * the caller can stay quiet; local results are already on screen.
 */
export async function searchRemote(query, signal) {
  const key = norm(query);
  if (key.length < 3) return [];
  if (remoteCache.has(key)) return remoteCache.get(key);

  const wait = Math.max(0, lastRemoteAt + MIN_GAP_MS - Date.now());
  if (wait) await sleep(wait);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  lastRemoteAt = Date.now();

  try {
    const params = new URLSearchParams({
      q: `${query}, Iloilo`,
      format: 'jsonv2',
      limit: '5',
      addressdetails: '1',
      countrycodes: 'ph',
      viewbox: '121.9,11.6,123.3,10.3', // west, north, east, south: Iloilo province
      bounded: '1',
      'accept-language': 'en',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal });
    if (!res.ok) return [];
    const rows = await res.json();
    const seen = new Set();
    const results = [];
    for (const hit of rows) {
      const pt = toPoint(hit.lat, hit.lon);
      if (!pt) continue;
      const { label, sublabel } = remoteLabel(hit);
      const dedupe = `${norm(label)}:${pt.lat.toFixed(3)}:${pt.lng.toFixed(3)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const bb = hit.boundingbox?.map(Number);
      results.push({
        id: `osm:${hit.place_id}`,
        type: 'place',
        label,
        sublabel,
        ...pt,
        zoom: ZOOM.place,
        bounds: bb && bb.every(Number.isFinite) ? [[bb[0], bb[2]], [bb[1], bb[3]]] : undefined,
      });
    }
    remoteCache.set(key, results);
    return results;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return [];
  }
}

/* --------------------------- recent searches --------------------------- */

const RECENT_KEY = 'kalsatrack.mapSearch.recent';

export function loadRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function saveRecent(result) {
  try {
    const { id, type, label, sublabel, lat, lng, zoom, approx } = result;
    const next = [{ id, type, label, sublabel, lat, lng, zoom, approx }, ...loadRecent().filter((r) => r.id !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: recents are a convenience only */
  }
}
