/*
 * farmRoadAccess.js — how a farm's harvest actually reaches its FMR road.
 *
 * Farmers move harvested crops, so "nearest" must mean passable with a load:
 *   - VEHICLE route (OSRM car profile): roads open to motor vehicles, so a
 *     truck or tricycle can carry the load. This is the main, saved route.
 *   - CARRY distance: from the farm to the nearest vehicle road, crops are
 *     carried by hand or carabao. Shown separately, and warned about when long.
 *   - WALKING route (FOSSGIS OSRM foot profile): adds footpaths, steps and
 *     footbridges. Shown only as a shortcut when it is clearly shorter, and
 *     labelled as on foot / carabao only.
 * The closest point "as the crow flies" can be across a river, so spots along
 * the FMR road are tested on each network (one table request per network) and
 * the shortest real trip wins. If no network answers: a straight line, flagged.
 *
 *   findRoadAccess(farm, roadLine) -> {
 *     point, path, km, byRoad, offRoadMeters,   // the main route (vehicle when available)
 *     mode: 'vehicle' | 'walking' | 'straight',
 *     carryMeters,                              // farm -> nearest vehicle road
 *     farCarry,                                 // carryMeters > FAR_CARRY_METERS
 *     shortcut: { path, km } | null,            // walking shortcut worth showing
 *   }
 */
import { haversineMeters } from './reportSubmission';
import { fetchRoadAlignedPolyline, nearestPointOnPolyline } from './mapRouteUtils';

const NETWORKS = {
  vehicle: { table: 'https://router.project-osrm.org/table/v1/driving', route: null }, // route via fetchRoadAlignedPolyline (cached)
  walking: {
    table: 'https://routing.openstreetmap.de/routed-foot/table/v1/driving',
    route: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  },
};
export const MAX_CANDIDATES = 20;
export const SHORTCUT_RATIO = 0.7;      // walking shown when at most 70% of the vehicle trip
export const FAR_CARRY_METERS = 1000;   // beyond this, crops are carried a long way

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
 * Picks the candidate with the shortest trip from an OSRM table answer.
 * Each trip = walk to the network + travel on it + walk from the network to the spot.
 */
export function pickShortestByRoad(table, candidates) {
  const row = table?.distances?.[0];
  if (!Array.isArray(row)) return null;
  const startWalk = Number(table?.sources?.[0]?.distance) || 0;
  let best = null;
  candidates.forEach((point, j) => {
    const travel = row[j + 1];
    if (!Number.isFinite(travel)) return;
    const endWalk = Number(table?.destinations?.[j + 1]?.distance) || 0;
    const total = startWalk + travel + endWalk;
    if (!best || total < best.meters) best = { point, meters: total, index: j };
  });
  return best ? { ...best, offRoadMeters: startWalk } : null;
}

/**
 * Decides what to show from the two legs ({ path, km, offRoadMeters, point } or null).
 * Pure, so the rules are tested on their own.
 */
export function chooseHaulRoute({ vehicle, walking, straight }) {
  if (vehicle) {
    const showShortcut = Boolean(walking) && walking.km <= vehicle.km * SHORTCUT_RATIO;
    return {
      ...vehicle,
      mode: 'vehicle',
      byRoad: true,
      carryMeters: vehicle.offRoadMeters,
      farCarry: vehicle.offRoadMeters > FAR_CARRY_METERS,
      shortcut: showShortcut ? { path: walking.path, km: walking.km } : null,
    };
  }
  if (walking) {
    return { ...walking, mode: 'walking', byRoad: true, carryMeters: null, farCarry: true, shortcut: null };
  }
  return straight ? { ...straight, mode: 'straight', byRoad: false, carryMeters: null, farCarry: false, shortcut: null } : null;
}

async function routeOnFoot(from, to) {
  const coords = [from, to].map((p) => `${p[1]},${p[0]}`).join(';');
  const res = await fetch(`${NETWORKS.walking.route}/${coords}?overview=full&geometries=geojson`);
  if (!res.ok) throw new Error(`foot route ${res.status}`);
  const json = await res.json();
  return (json?.routes?.[0]?.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]);
}

// `attach` (lib/farmAttach.js) is where the farm joins the road network without
// crossing water; routing starts there instead of at the farm pin, so the router
// can't attach the farm to a road across a river.
async function bestLeg(network, farm, candidates, attach = null) {
  const origin = attach?.point || farm;
  const coords = [origin, ...candidates].map((p) => `${p[1]},${p[0]}`).join(';');
  const res = await fetch(`${NETWORKS[network].table}/${coords}?sources=0&annotations=distance`);
  if (!res.ok) throw new Error(`${network} table ${res.status}`);
  const best = pickShortestByRoad(await res.json(), candidates);
  if (!best) return null;
  const routed = network === 'vehicle'
    ? await fetchRoadAlignedPolyline([origin, best.point])
    : await routeOnFoot(origin, best.point);
  if (!Array.isArray(routed) || routed.length <= 2) return null;
  const path = attach ? [farm, origin, ...routed, best.point] : [farm, ...routed, best.point];
  const offRoadMeters = attach ? attach.meters + best.offRoadMeters : best.offRoadMeters;
  return { point: best.point, path, km: lineKm(path), offRoadMeters };
}

const cache = new Map();

export async function findRoadAccess(farm, roadLine, attach = null) {
  const line = (roadLine || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (!farm || line.length === 0) return null;

  const nearest = nearestPointOnPolyline(farm, line);
  const straight = nearest
    ? { point: nearest.point, path: [farm, nearest.point], km: nearest.distanceMeters / 1000, offRoadMeters: null }
    : null;

  const candidates = sampleAlongLine(line);
  if (nearest) candidates.push(nearest.point);
  const start = attach?.point || farm;
  const key = `${farm.map((v) => v.toFixed(5)).join(',')}>${start.map((v) => v.toFixed(5)).join(',')}|${candidates.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';')}`;
  if (cache.has(key)) return cache.get(key);

  const [vehicleRes, walkingRes] = await Promise.allSettled([
    bestLeg('vehicle', farm, candidates, attach),
    bestLeg('walking', farm, candidates, attach),
  ]);
  const vehicle = vehicleRes.status === 'fulfilled' ? vehicleRes.value : null;
  const walking = walkingRes.status === 'fulfilled' ? walkingRes.value : null;
  if (vehicleRes.status === 'rejected' && walkingRes.status === 'rejected') {
    console.warn('[farm-access] road networks unavailable, using a straight line', vehicleRes.reason?.message || vehicleRes.reason);
  }

  const result = { ...chooseHaulRoute({ vehicle, walking, straight }), crossesWater: Boolean(attach?.crossesWater) };
  if (vehicle || walking) cache.set(key, result); // never cache the offline fallback
  return result;
}

/* ------------------------------------------------------------------ */
/* Ranking several candidate roads for one farm                        */
/* ------------------------------------------------------------------ */

export const OSRM_TABLE_MAX = 99; // farm + candidates per table request

/**
 * Best trip per road from one OSRM table answer.
 * owners[j] = road id of candidates[j]. Returns Map(id -> { meters, point, offRoadMeters }).
 */
export function bestPerRoad(table, owners, candidates) {
  const row = table?.distances?.[0];
  const out = new Map();
  if (!Array.isArray(row)) return out;
  const startWalk = Number(table?.sources?.[0]?.distance) || 0;
  candidates.forEach((point, j) => {
    const travel = row[j + 1];
    if (!Number.isFinite(travel)) return;
    const meters = startWalk + travel + (Number(table?.destinations?.[j + 1]?.distance) || 0);
    const prev = out.get(owners[j]);
    if (!prev || meters < prev.meters) out.set(owners[j], { meters, point, offRoadMeters: startWalk });
  });
  return out;
}

const rankCache = new Map();

/**
 * Ranks candidate roads by the real distance by vehicle road from the farm, in
 * one request. roads: [{ id, line }]. Returns Map(id -> { meters, point, offRoadMeters })
 * — empty when the road network can't be reached (callers keep straight-line order).
 */
export async function rankRoadsByAccess(farm, roads, attach = null) {
  const usable = (roads || []).filter((r) => Array.isArray(r.line) && r.line.length > 0);
  if (!farm || usable.length === 0) return new Map();
  const perRoad = Math.max(2, Math.min(8, Math.floor(OSRM_TABLE_MAX / usable.length)));
  const owners = [];
  const candidates = [];
  usable.forEach((r) => {
    const pts = sampleAlongLine(r.line, perRoad);
    const near = nearestPointOnPolyline(farm, r.line);
    if (near) pts.push(near.point);
    pts.forEach((p) => { owners.push(r.id); candidates.push(p); });
  });
  if (candidates.length > OSRM_TABLE_MAX) candidates.length = owners.length = OSRM_TABLE_MAX;

  const origin = attach?.point || farm;
  const key = `${origin.map((v) => v.toFixed(5)).join(',')}|${usable.map((r) => r.id).join(',')}|${candidates.length}`;
  if (rankCache.has(key)) return rankCache.get(key);
  try {
    const coords = [origin, ...candidates].map((p) => `${p[1]},${p[0]}`).join(';');
    const res = await fetch(`${NETWORKS.vehicle.table}/${coords}?sources=0&annotations=distance`);
    if (!res.ok) throw new Error(`table ${res.status}`);
    const ranked = bestPerRoad(await res.json(), owners, candidates);
    // Count the walk from the farm to where it joins the road network.
    if (attach) ranked.forEach((v) => { v.meters += attach.meters; v.offRoadMeters += attach.meters; });
    rankCache.set(key, ranked);
    return ranked;
  } catch (err) {
    console.warn('[farm-access] could not rank roads by road distance', err?.message || err);
    return new Map();
  }
}

/* ------------------------------------------------------------------ */
/* Drawing a road that only has a start and an end                     */
/* ------------------------------------------------------------------ */

export const SNAP_MAX_DETOUR = 2.5;

/**
 * A road saved with only its two ends is drawn straight and can cut across a
 * river. Follow the real road network between the ends instead — unless that
 * would be a long detour (the road isn't on the map yet), in which case the
 * straight line is the more honest drawing. Returns the line to draw.
 */
export async function snapRoadLine(line) {
  const pts = (line || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (pts.length < 2 || pts.length > 3) return line;
  const routed = await fetchRoadAlignedPolyline(pts);
  if (!Array.isArray(routed) || routed.length <= pts.length) return line;
  return lineKm(routed) <= lineKm(pts) * SNAP_MAX_DETOUR ? routed : line;
}
