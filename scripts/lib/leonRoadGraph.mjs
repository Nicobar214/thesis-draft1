// A routing graph over Leon's local OSM road network.
//
// Replaces the use of the public OSRM demo server for generating project route
// geometry. OSRM routes a car on the full network, so between two adjacent
// barangays it detours onto the national road -- the cause of the 39 existing
// project_routes rows whose mapped length is multiples of the declared length.
//
// This graph is built only from local classes (residential, unclassified, track,
// service, living_street, road), so a path through it physically cannot use the
// national road. Paths are therefore plausible farm-to-market alignments, and
// every edge cites the OSM way it came from.
//
// Nodes are keyed on exact coordinates. Overpass `out geom` emits each way's
// vertices at full precision and the fetch script rounds them to 7 decimal
// places, so two ways meeting at a shared OSM node produce byte-identical keys
// and the graph connects there. Ways that merely cross without a shared node are
// correctly NOT connected -- that is a real grade separation or a mapping gap,
// not something to paper over.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './leonPlaceChain.mjs';

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(aLat, aLng, bLat, bLng) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const nodeKey = (lat, lng) => `${lat.toFixed(7)},${lng.toFixed(7)}`;

/**
 * Cost multipliers by road class.
 *
 * Routing minimizes COST while distances are always measured in true km, so these
 * change which roads a path prefers without distorting any reported length.
 *
 * A farm-to-market route should stay on barangay roads. But excluding trunk classes
 * from the graph outright left it disconnected -- 12,012 nodes, 11,819 edges, 279
 * fragments -- because Leon's barangay roads largely interconnect THROUGH the
 * tertiary network. Charging a trunk road several times its length keeps it
 * available as a last resort while ensuring any local detour of comparable length
 * wins, which is the behaviour a car router does not give us.
 */
export const CLASS_COST = {
  residential: 1,
  unclassified: 1,
  living_street: 1,
  road: 1.2,
  track: 1.3,          // slightly discouraged: often rough, but genuinely used as FMR
  service: 1.6,        // driveways and yard roads; real but rarely the through route
  tertiary: 4,
  tertiary_link: 4,
  secondary: 8,
  secondary_link: 8,
  primary: 16,
  primary_link: 16,
};

const costFor = (highway) => CLASS_COST[highway] ?? 2;

/** Minimal binary min-heap, enough for Dijkstra over ~15k nodes. */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }

  push(value, priority) {
    this.items.push({ value, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop() {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < this.items.length && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
}

export function loadLocalNetwork(
  path = resolve(REPO_ROOT, 'scripts', 'leon_osm_local_roads.geojson')
) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Build an undirected weighted graph from the local-road FeatureCollection.
 * Returns { nodes, adjacency, wayCount, edgeCount }.
 */
export function buildGraph(collection) {
  /** key -> { lat, lng } */
  const nodes = new Map();
  /** key -> Array<{ to, km, wayId }> */
  const adjacency = new Map();

  const addNode = (lat, lng) => {
    const key = nodeKey(lat, lng);
    if (!nodes.has(key)) {
      nodes.set(key, { lat, lng });
      adjacency.set(key, []);
    }
    return key;
  };

  let edgeCount = 0;
  let trunkEdgeCount = 0;
  for (const feature of collection.features || []) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const wayId = feature.properties?.osmWayId ?? feature.id ?? null;
    const highway = feature.properties?.highway ?? null;
    const isTrunk = feature.properties?.routingClass === 'trunk';
    const multiplier = costFor(highway);

    let prevKey = addNode(coords[0][1], coords[0][0]);
    for (let i = 1; i < coords.length; i += 1) {
      const [lng, lat] = coords[i];
      const key = addNode(lat, lng);
      if (key === prevKey) continue;

      const a = nodes.get(prevKey);
      const b = nodes.get(key);
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (km > 0) {
        // `km` is the true distance used for every length we report; `cost` only
        // steers which path Dijkstra picks.
        const edge = { km, cost: km * multiplier, wayId, highway, isTrunk };
        adjacency.get(prevKey).push({ ...edge, to: key });
        adjacency.get(key).push({ ...edge, to: prevKey });
        edgeCount += 1;
        if (isTrunk) trunkEdgeCount += 1;
      }
      prevKey = key;
    }
  }

  return {
    nodes,
    adjacency,
    wayCount: (collection.features || []).length,
    edgeCount,
    trunkEdgeCount,
  };
}

/**
 * Label connected components. A rural local-road network is genuinely fragmented,
 * so callers must check that two points share a component before asking for a
 * path -- otherwise Dijkstra scans the whole graph only to return null.
 */
export function labelComponents(graph) {
  const componentOf = new Map();
  const sizes = [];

  for (const start of graph.nodes.keys()) {
    if (componentOf.has(start)) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [start];
    componentOf.set(start, id);

    while (stack.length > 0) {
      const key = stack.pop();
      count += 1;
      for (const edge of graph.adjacency.get(key) || []) {
        if (!componentOf.has(edge.to)) {
          componentOf.set(edge.to, id);
          stack.push(edge.to);
        }
      }
    }
    sizes.push(count);
  }

  return { componentOf, sizes };
}

/** Nearest graph node to a coordinate, by straight-line distance. */
export function nearestNode(graph, lat, lng) {
  let bestKey = null;
  let bestKm = Infinity;
  for (const [key, node] of graph.nodes) {
    const km = haversineKm(lat, lng, node.lat, node.lng);
    if (km < bestKm) { bestKm = km; bestKey = key; }
  }
  return bestKey ? { key: bestKey, distanceKm: bestKm, node: graph.nodes.get(bestKey) } : null;
}

/**
 * Dijkstra shortest path. Returns { points: [[lat,lng],...], km, wayIds } or null
 * when the two nodes are not connected.
 */
export function shortestPath(graph, fromKey, toKey) {
  if (!graph.nodes.has(fromKey) || !graph.nodes.has(toKey)) return null;
  if (fromKey === toKey) {
    const n = graph.nodes.get(fromKey);
    return { points: [[n.lat, n.lng]], km: 0, wayIds: [] };
  }

  // Dijkstra on COST so local roads are preferred; true km is accumulated
  // alongside and is what gets reported.
  const cost = new Map([[fromKey, 0]]);
  const prev = new Map();
  const settled = new Set();
  const heap = new MinHeap();
  heap.push(fromKey, 0);

  while (heap.size > 0) {
    const key = heap.pop();
    if (settled.has(key)) continue;
    settled.add(key);
    if (key === toKey) break;

    const base = cost.get(key) ?? Infinity;
    for (const edge of graph.adjacency.get(key) || []) {
      if (settled.has(edge.to)) continue;
      const candidate = base + edge.cost;
      if (candidate < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, candidate);
        prev.set(edge.to, { from: key, wayId: edge.wayId, km: edge.km, isTrunk: edge.isTrunk });
        heap.push(edge.to, candidate);
      }
    }
  }

  if (!settled.has(toKey)) return null;

  const points = [];
  const nodeKeys = [];
  const wayIds = [];
  let km = 0;
  let trunkKm = 0;
  let cursor = toKey;
  while (cursor !== undefined && cursor !== null) {
    const node = graph.nodes.get(cursor);
    points.push([node.lat, node.lng]);
    nodeKeys.push(cursor);
    const step = prev.get(cursor);
    if (!step) break;
    if (step.wayId !== null && step.wayId !== undefined) wayIds.push(step.wayId);
    km += step.km;
    if (step.isTrunk) trunkKm += step.km;
    cursor = step.from;
  }
  points.reverse();
  nodeKeys.reverse();
  wayIds.reverse();

  return {
    points,
    // Returned so a caller extending this path can seed walkOutward's visited set
    // with it; otherwise the extension walks straight back along the path.
    nodeKeys,
    km,
    // How much of the path had to fall back to a trunk road -- recorded so route
    // quality can reflect it instead of silently presenting a highway as an FMR.
    trunkKm,
    trunkShare: km > 0 ? trunkKm / km : 0,
    wayIds: [...new Set(wayIds)],
  };
}

/**
 * Walk outward from a node collecting the longest path the local network allows,
 * up to `maxKm`. Used for single-barangay projects, where there is no second
 * centroid to aim at: the project runs some declared distance along the barangay's
 * own road, so we follow real road geometry rather than inventing a bearing.
 *
 * Greedy longest-first with no revisiting, which keeps the walk heading away from
 * where it started instead of doubling back on itself.
 */
export function walkOutward(graph, startKey, maxKm, preferBearing = null, visitedSeed = null) {
  if (!graph.nodes.has(startKey)) return null;

  const start = graph.nodes.get(startKey);
  // `visitedSeed` lets a caller forbid nodes already used by a path this walk is
  // extending. Without it the walk reverses straight back down that path, and the
  // gap drawn beyond the route ends up retracing the route itself.
  const visited = new Set(visitedSeed ? [...visitedSeed, startKey] : [startKey]);
  const points = [[start.lat, start.lng]];
  const wayIds = [];
  let totalKm = 0;
  let trunkKm = 0;
  let cursor = startKey;

  while (totalKm < maxKm) {
    const options = (graph.adjacency.get(cursor) || []).filter((e) => !visited.has(e.to));
    if (options.length === 0) break;

    // Prefer continuing roughly straight: the edge whose direction best matches
    // the direction we arrived from (or `preferBearing` on the first step).
    const from = graph.nodes.get(cursor);
    const incoming = points.length >= 2
      ? bearing(points[points.length - 2], [from.lat, from.lng])
      : preferBearing;

    // Score each option on how straight it continues and how local it is, so the
    // walk follows the through-road rather than turning onto a trunk road or a
    // driveway the moment one appears.
    let chosen = options[0];
    let bestScore = Infinity;
    for (const edge of options) {
      const to = graph.nodes.get(edge.to);
      const turn = incoming === null || incoming === undefined
        ? 0
        : angleDelta(incoming, bearing([from.lat, from.lng], [to.lat, to.lng]));
      // 90 degrees of turning costs about as much as doubling the class penalty.
      const score = turn + (edge.cost / Math.max(edge.km, 1e-6)) * 30;
      if (score < bestScore) { bestScore = score; chosen = edge; }
    }

    const to = graph.nodes.get(chosen.to);
    visited.add(chosen.to);
    points.push([to.lat, to.lng]);
    if (chosen.wayId !== null && chosen.wayId !== undefined) wayIds.push(chosen.wayId);
    totalKm += chosen.km;
    if (chosen.isTrunk) trunkKm += chosen.km;
    cursor = chosen.to;
  }

  if (points.length < 2) return null;
  return {
    points,
    km: totalKm,
    trunkKm,
    trunkShare: totalKm > 0 ? trunkKm / totalKm : 0,
    wayIds: [...new Set(wayIds)],
  };
}

/**
 * Find a path from `startKey` whose length is as close as possible to `targetKm`
 * without falling short, using the whole reachable component.
 *
 * This replaces a greedy outward walk for the single-anchor case. A greedy walk
 * picks the straightest-and-most-local edge at each step and cannot backtrack, so
 * it strands itself in cul-de-sacs: it produced a 0.04 km line for a 0.87 km
 * project, and 17 routes came out below half their declared length. Searching the
 * component instead guarantees that if enough connected road exists anywhere
 * reachable, the route gets it.
 *
 * `forbidden` excludes nodes already used by a path being extended, so an
 * extension cannot double back along it.
 */
export function farthestPathWithinKm(graph, startKey, targetKm, forbidden = null) {
  if (!graph.nodes.has(startKey)) return null;
  const blocked = forbidden instanceof Set ? forbidden : new Set(forbidden || []);

  const cost = new Map([[startKey, 0]]);
  const km = new Map([[startKey, 0]]);
  const prev = new Map();
  const settled = new Set();
  const heap = new MinHeap();
  heap.push(startKey, 0);

  let best = { key: startKey, km: 0 };

  while (heap.size > 0) {
    const key = heap.pop();
    if (settled.has(key)) continue;
    settled.add(key);

    const hereKm = km.get(key) ?? 0;
    // Prefer the smallest path that still meets the target; otherwise track the
    // longest path found anywhere.
    const meets = hereKm >= targetKm;
    const bestMeets = best.km >= targetKm;
    if (meets && (!bestMeets || hereKm < best.km)) best = { key, km: hereKm };
    else if (!meets && !bestMeets && hereKm > best.km) best = { key, km: hereKm };

    // No point expanding beyond a comfortable margin past the target.
    if (hereKm > targetKm * 1.5 + 1) continue;

    const baseCost = cost.get(key) ?? Infinity;
    for (const edge of graph.adjacency.get(key) || []) {
      if (settled.has(edge.to) || blocked.has(edge.to)) continue;
      const candidate = baseCost + edge.cost;
      if (candidate < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, candidate);
        km.set(edge.to, hereKm + edge.km);
        prev.set(edge.to, { from: key, wayId: edge.wayId, km: edge.km, isTrunk: edge.isTrunk });
        heap.push(edge.to, candidate);
      }
    }
  }

  if (best.key === startKey) return null;

  const points = [];
  const nodeKeys = [];
  const wayIds = [];
  let totalKm = 0;
  let trunkKm = 0;
  let cursor = best.key;
  while (cursor !== undefined && cursor !== null) {
    const node = graph.nodes.get(cursor);
    points.push([node.lat, node.lng]);
    nodeKeys.push(cursor);
    const step = prev.get(cursor);
    if (!step) break;
    if (step.wayId !== null && step.wayId !== undefined) wayIds.push(step.wayId);
    totalKm += step.km;
    if (step.isTrunk) trunkKm += step.km;
    cursor = step.from;
  }
  points.reverse();
  nodeKeys.reverse();
  wayIds.reverse();

  if (points.length < 2) return null;
  return {
    points,
    nodeKeys,
    km: totalKm,
    trunkKm,
    trunkShare: totalKm > 0 ? trunkKm / totalKm : 0,
    wayIds: [...new Set(wayIds)],
  };
}

function bearing(from, to) {
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const dLng = rad(to[1] - from[1]);
  const y = Math.sin(dLng) * Math.cos(rad(to[0]));
  const x =
    Math.cos(rad(from[0])) * Math.sin(rad(to[0])) -
    Math.sin(rad(from[0])) * Math.cos(rad(to[0])) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function angleDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
