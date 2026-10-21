/*
 * farmAttach.js — where a farm actually joins the road network, without
 * crossing a river.
 *
 * The routing service attaches a farm to whichever road is closest as the crow
 * flies, even if a river runs in between (the farm then appears to "walk across
 * the water"). Here every nearby road is considered and the closest point whose
 * straight walk from the farm crosses no river, stream or water area wins. The
 * route by road is then calculated from that point.
 *
 * Data: public/data/geo/<town>-roads.json and -waterways.json (OpenStreetMap,
 * made by scripts/fetch_leon_access_data.mjs). Leon only for now; elsewhere
 * `null` is returned and the routing service's own attach is used.
 */
import { haversineMeters } from './reportSubmission';
import { nearestPointOnPolyline } from './mapRouteUtils';

export const ATTACH_SEARCH_METERS = 2000;
// Water a person carrying a harvest cannot simply walk across.
export const BLOCKING_WATER = new Set(['river', 'stream', 'water', 'riverbank']);

const DATA_FILES = { leon: 'leon' };
const cache = new Map();

/** Loads roads + waterways for the municipality once; resolves null if unavailable. */
export function loadAccessData(municipality) {
  const key = DATA_FILES[String(municipality || '').trim().toLowerCase()];
  if (!key) return Promise.resolve(null);
  if (!cache.has(key)) {
    cache.set(key, Promise.all([
      fetch(`/data/geo/${key}-roads.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/data/geo/${key}-waterways.json`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([roads, water]) => (roads && water ? prepare(roads.roads, water.waterways) : null))
      .catch(() => { cache.delete(key); return null; }));
  }
  return cache.get(key);
}

function bboxOf(line) {
  let s = Infinity; let w = Infinity; let n = -Infinity; let e = -Infinity;
  line.forEach(([lat, lng]) => { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); e = Math.max(e, lng); });
  return [s, w, n, e];
}

/** Adds bounding boxes so most lines can be skipped without a full check. */
export function prepare(roads = [], waterways = []) {
  return {
    roads: roads.filter((r) => r.line?.length >= 2).map((r) => ({ ...r, bbox: bboxOf(r.line) })),
    water: waterways.filter((w) => w.line?.length >= 2 && BLOCKING_WATER.has(w.kind)).map((w) => ({ ...w, bbox: bboxOf(w.line) })),
  };
}

// Proper intersection of segments p1-p2 and p3-p4 (lat/lng treated as flat; fine at farm scale).
function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  const d1 = d(p3, p4, p1); const d2 = d(p3, p4, p2); const d3 = d(p1, p2, p3); const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when the straight walk a -> b crosses any blocking water line. */
export function crossesWater(a, b, water) {
  const [s, n] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [w, e] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return water.some((wl) => {
    const [ws, ww, wn, we] = wl.bbox;
    if (wn < s || ws > n || we < w || ww > e) return false;
    for (let i = 1; i < wl.line.length; i += 1) {
      if (segmentsCross(a, b, wl.line[i - 1], wl.line[i])) return true;
    }
    return false;
  });
}

/**
 * The best place for the farm to join a road: { point, meters, crossesWater, highway }.
 * Closest road point reachable without crossing water, within ATTACH_SEARCH_METERS;
 * if every nearby road is across water, the closest one with crossesWater: true.
 */
export function chooseAttachPoint(farm, data, maxMeters = ATTACH_SEARCH_METERS) {
  if (!farm || !data?.roads?.length) return null;
  const pad = maxMeters / 111000;
  const options = [];
  data.roads.forEach((road) => {
    const [s, w, n, e] = road.bbox;
    if (n < farm[0] - pad || s > farm[0] + pad || e < farm[1] - pad || w > farm[1] + pad) return;
    const hit = nearestPointOnPolyline(farm, road.line);
    if (hit && hit.distanceMeters <= maxMeters) options.push({ point: hit.point, meters: hit.distanceMeters, highway: road.highway });
  });
  if (options.length === 0) return null;
  options.sort((a, b) => a.meters - b.meters);
  const dry = options.find((o) => !crossesWater(farm, o.point, data.water));
  return dry ? { ...dry, crossesWater: false } : { ...options[0], crossesWater: true };
}

export { haversineMeters };
