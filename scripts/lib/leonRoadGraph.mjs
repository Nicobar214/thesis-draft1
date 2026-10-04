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
  for (const feature of collection.features || []) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const wayId = feature.properties?.osmWayId ?? feature.id ?? null;

    let prevKey = addNode(coords[0][1], coords[0][0]);
    for (let i = 1; i < coords.length; i += 1) {
      const [lng, lat] = coords[i];
      const key = addNode(lat, lng);
      if (key === prevKey) continue;

      const a = nodes.get(prevKey);
      const b = nodes.get(key);
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (km > 0) {
        adjacency.get(prevKey).push({ to: key, km, wayId });
        adjacency.get(key).push({ to: prevKey, km, wayId });
        edgeCount += 1;
      }
      prevKey = key;
    }
  }

  return { nodes, adjacency, wayCount: (collection.features || []).length, edgeCount };
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

  const dist = new Map([[fromKey, 0]]);
  const prev = new Map();
  const settled = new Set();
  const heap = new MinHeap();
  heap.push(fromKey, 0);

  while (heap.size > 0) {
    const key = heap.pop();
    if (settled.has(key)) continue;
    settled.add(key);
    if (key === toKey) break;

    const base = dist.get(key) ?? Infinity;
    for (const edge of graph.adjacency.get(key) || []) {
      if (settled.has(edge.to)) continue;
      const candidate = base + edge.km;
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate);
        prev.set(edge.to, { from: key, wayId: edge.wayId });
        heap.push(edge.to, candidate);
      }
    }
  }

  if (!settled.has(toKey)) return null;

  const points = [];
  const wayIds = [];
  let cursor = toKey;
  while (cursor !== undefined && cursor !== null) {
    const node = graph.nodes.get(cursor);
    points.push([node.lat, node.lng]);
    const step = prev.get(cursor);
    if (!step) break;
    if (step.wayId !== null && step.wayId !== undefined) wayIds.push(step.wayId);
    cursor = step.from;
  }
  points.reverse();
  wayIds.reverse();

  return { points, km: dist.get(toKey), wayIds: [...new Set(wayIds)] };
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
export function walkOutward(graph, startKey, maxKm, preferBearing = null) {
  if (!graph.nodes.has(startKey)) return null;

  const start = graph.nodes.get(startKey);
  const visited = new Set([startKey]);
  const points = [[start.lat, start.lng]];
  const wayIds = [];
  let totalKm = 0;
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

    let chosen = options[0];
    if (incoming !== null && incoming !== undefined) {
      let bestDelta = Infinity;
      for (const edge of options) {
        const to = graph.nodes.get(edge.to);
        const delta = angleDelta(incoming, bearing([from.lat, from.lng], [to.lat, to.lng]));
        if (delta < bestDelta) { bestDelta = delta; chosen = edge; }
      }
    }

    const to = graph.nodes.get(chosen.to);
    visited.add(chosen.to);
    points.push([to.lat, to.lng]);
    if (chosen.wayId !== null && chosen.wayId !== undefined) wayIds.push(chosen.wayId);
    totalKm += chosen.km;
    cursor = chosen.to;
  }

  if (points.length < 2) return null;
  return { points, km: totalKm, wayIds: [...new Set(wayIds)] };
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
