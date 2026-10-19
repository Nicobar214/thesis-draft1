/*
 * farmRoadAccess.js — how a farm actually reaches its FMR road.
 *
 * The closest point "as the crow flies" can be across a river, a creek or a
 * ravine. Instead, spots along the FMR road are tested against the real road
 * network (OSRM table service, one request) and the one with the shortest
 * route by road wins; its route is then drawn (OSRM route service).
 *
 *   findRoadAccess(farm, roadLine) -> {
 *     point,          // where the farm joins the FMR road
 *     path,           // farm -> ... -> point, following roads
 *     km,             // length of that path
 *     byRoad,         // false when the road network could not be reached (straight line)
 *     offRoadMeters,  // farm to the nearest mapped road/path (walk across the field)
 *   }
 */
import { haversineMeters } from './reportSubmission';
import { fetchRoadAlignedPolyline, nearestPointOnPolyline } from './mapRouteUtils';

const OSRM = 'https://router.project-osrm.org';
export const MAX_CANDIDATES = 20;

const lineKm = (pts) => pts.reduce((sum, p, i) => (i ? sum + haversineMeters(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) : 0), 0) / 1000;

/** Up to `max` points spread evenly (by distance) along the line, ends included. */
export function sampleAlongLine(line, max = MAX_CANDIDATES) {
  const pts = (line || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (pts.length <= 1) return pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + haversineMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const total = cum[cum.length - 1];
  if (total === 0) return [pts[0]];
  const out = [];
  for (let k = 0; k < max; k += 1) {
    const target = (total * k) / (max - 1);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i += 1;
    const span = cum[i] - cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[i - 1]) / span));
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
  }
  return out;
}

/**
 * Picks the candidate with the shortest trip by road from an OSRM table answer.
 * Each trip = walk to the network + drive + walk from the network to the spot.
 */
export function pickShortestByRoad(table, candidates) {
  const row = table?.distances?.[0];
  if (!Array.isArray(row)) return null;
  const startWalk = Number(table?.sources?.[0]?.distance) || 0;
  let best = null;
  candidates.forEach((point, j) => {
    const drive = row[j + 1];
    if (!Number.isFinite(drive)) return;
    const endWalk = Number(table?.destinations?.[j + 1]?.distance) || 0;
    const total = startWalk + drive + endWalk;
    if (!best || total < best.meters) best = { point, meters: total, index: j };
  });
  return best ? { ...best, offRoadMeters: startWalk } : null;
}

const cache = new Map();

export async function findRoadAccess(farm, roadLine) {
  const line = (roadLine || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (!farm || line.length === 0) return null;

  const nearest = nearestPointOnPolyline(farm, line);
  const straight = nearest
    ? { point: nearest.point, path: [farm, nearest.point], km: nearest.distanceMeters / 1000, byRoad: false, offRoadMeters: null }
    : null;

  const candidates = sampleAlongLine(line);
  if (nearest) candidates.push(nearest.point);
  const key = `${farm.map((v) => v.toFixed(5)).join(',')}|${candidates.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';')}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const coords = [farm, ...candidates].map((p) => `${p[1]},${p[0]}`).join(';');
    const res = await fetch(`${OSRM}/table/v1/driving/${coords}?sources=0&annotations=distance`);
    if (!res.ok) throw new Error(`table ${res.status}`);
    const best = pickShortestByRoad(await res.json(), candidates);
    if (!best) return straight;

    const routed = await fetchRoadAlignedPolyline([farm, best.point]);
    const path = Array.isArray(routed) && routed.length > 2 ? [farm, ...routed, best.point] : [farm, best.point];
    const result = {
      point: best.point,
      path,
      km: lineKm(path),
      byRoad: path.length > 2,
      offRoadMeters: best.offRoadMeters,
    };
    cache.set(key, result);
    return result;
  } catch (err) {
    console.warn('[farm-access] road network unavailable, using a straight line', err?.message || err);
    return straight;
  }
}
