/*
 * barangayLocator.js — which barangay a map point is in, for the farmer
 * registration form (is the farm pin inside the barangay that was chosen?
 * which roads run through that barangay?).
 *
 * Exact: official barangay boundaries (PSA/NAMRIA PSGC 2023) for every Iloilo
 * municipality, one file per municipality in public/data/barangay-boundaries
 * (made by scripts/fetch_iloilo_barangay_boundaries.mjs), loaded when needed.
 *
 * Fallback, while a file loads or for a barangay without a shape: the closest
 * barangay center (src/data/leonBarangays.js, Leon only), only calling a pin
 * "outside" when clearly nearer another center (BORDER_MARGIN_METERS).
 * Otherwise the answer is 'unknown' rather than a guess.
 */
import { useEffect, useState } from 'react';
import LEON_BARANGAYS from '../data/leonBarangays';
import { haversineMeters } from './reportSubmission';

export const BORDER_MARGIN_METERS = 400;
// PSA boundaries are for statistics, not surveyed borders: a pin this close to
// the line still counts as inside, so a farm on the edge isn't wrongly flagged.
export const BOUNDARY_TOLERANCE_METERS = 150;
const BOUNDARY_DIR = '/data/barangay-boundaries/';

// "Barangay Zone I (Poblacion)" and "Barangay Zone I" are the same place.
const norm = (s) => String(s || '')
  .replace(/\([^)]*\)/g, ' ')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** Same barangay, ignoring case, accents, punctuation and "(Poblacion)"-style notes. */
export const sameBarangay = (a, b) => Boolean(a) && Boolean(b) && norm(a) === norm(b);

/* ------------------------------------------------------------------ */
/* Official boundaries                                                 */
/* ------------------------------------------------------------------ */

const boundaries = new Map(); // town key -> { byKey: Map(key -> {name, geometry, bbox}) } | null
const loading = new Map();    // town key -> Promise
let indexPromise = null;

function bboxOf(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity]; // minLng, minLat, maxLng, maxLat
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      box[0] = Math.min(box[0], c[0]); box[1] = Math.min(box[1], c[1]);
      box[2] = Math.max(box[2], c[0]); box[3] = Math.max(box[3], c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return box;
}

/** Stores parsed boundary data for a municipality (also used by tests). */
export function setBarangayBoundaries(municipality, data) {
  const byKey = new Map();
  (data?.barangays || []).forEach((b) => {
    if (b?.geometry?.coordinates) byKey.set(norm(b.name), { name: b.name, geometry: b.geometry, bbox: bboxOf(b.geometry) });
  });
  boundaries.set(norm(municipality), byKey.size ? { byKey } : null);
}

export function hasBoundaries(municipality) {
  return Boolean(boundaries.get(norm(municipality)));
}

/** Loads the municipality's boundary file once; resolves true when available. */
export function loadBarangayBoundaries(municipality) {
  const key = norm(municipality);
  if (!key) return Promise.resolve(false);
  if (boundaries.has(key)) return Promise.resolve(Boolean(boundaries.get(key)));
  if (loading.has(key)) return loading.get(key);

  const job = (async () => {
    try {
      indexPromise = indexPromise || fetch(`${BOUNDARY_DIR}index.json`).then((r) => (r.ok ? r.json() : null));
      const index = await indexPromise;
      const file = Object.entries(index?.municipalities || {}).find(([name]) => norm(name) === key)?.[1];
      if (!file) { boundaries.set(key, null); return false; }
      const res = await fetch(`${BOUNDARY_DIR}${file}`);
      if (!res.ok) throw new Error(`boundary file ${res.status}`);
      setBarangayBoundaries(municipality, await res.json());
      return hasBoundaries(municipality);
    } catch (err) {
      indexPromise = null; // try again next time (e.g. offline before first use)
      console.warn('[barangay] boundaries unavailable, using the approximate check', err?.message || err);
      return false;
    } finally {
      loading.delete(key);
    }
  })();
  loading.set(key, job);
  return job;
}

/** Ray casting on one ring of [lng, lat] points. */
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is [lat, lng] inside a GeoJSON Polygon / MultiPolygon (holes respected)? */
export function pointInGeometry(lat, lng, geometry) {
  const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
  return polygons.some((rings) => rings.length > 0
    && inRing(lng, lat, rings[0])
    && !rings.slice(1).some((hole) => inRing(lng, lat, hole)));
}

/** Shortest distance (m) from [lat, lng] to the outline of a geometry. */
export function distanceToGeometryMeters(lat, lng, geometry) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
  let best = Infinity;
  polygons.forEach((rings) => rings.forEach((ring) => {
    for (let i = 1; i < ring.length; i += 1) {
      const ax = (ring[i - 1][0] - lng) * kx; const ay = (ring[i - 1][1] - lat) * ky;
      const bx = (ring[i][0] - lng) * kx; const by = (ring[i][1] - lat) * ky;
      const dx = bx - ax; const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }));
  return best;
}

function inShape(shape, lat, lng) {
  const [minLng, minLat, maxLng, maxLat] = shape.bbox;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;
  return pointInGeometry(lat, lng, shape.geometry);
}

/** The barangay (official boundary) containing the point, or null. */
export function barangayAt(lat, lng, municipality) {
  const town = boundaries.get(norm(municipality));
  if (!town || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const shape of town.byKey.values()) if (inShape(shape, lat, lng)) return shape.name;
  return null;
}

/** The municipality's official barangay names (A-Z) once its boundaries are loaded, else []. */
export function barangayNames(municipality) {
  const town = boundaries.get(norm(municipality));
  return town ? [...town.byKey.values()].map((s) => s.name).sort((a, b) => a.localeCompare(b)) : [];
}

/**
 * Which barangay a pin is in, for filling in a form:
 * { name, exact: true } from the official boundary, { name, exact: false } from
 * the nearest barangay center (approximate, Leon only), { outside: true } when
 * the boundaries are loaded and the pin is in none of the municipality's
 * barangays, or null when it cannot be told.
 */
export function locateBarangay(lat, lng, municipality) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || !la || !ln) return null;
  if (hasBoundaries(municipality)) {
    const name = barangayAt(la, ln, municipality);
    return name ? { name, exact: true } : { outside: true };
  }
  const near = nearestBarangay(la, ln, municipality);
  return near ? { name: near.name, exact: false } : null;
}

/** The selected barangay's official outline (GeoJSON geometry) once loaded, else null. */
export function barangayGeometry(municipality, barangay) {
  return boundaries.get(norm(municipality))?.byKey.get(norm(barangay))?.geometry || null;
}

/** Loads boundaries for the municipality; re-renders the caller when they arrive. */
export function useBarangayBoundaries(municipality) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!municipality || boundaries.has(norm(municipality))) return undefined;
    let alive = true;
    loadBarangayBoundaries(municipality).then(() => { if (alive) setVersion((v) => v + 1); });
    return () => { alive = false; };
  }, [municipality]);
  return hasBoundaries(municipality);
}

/* ------------------------------------------------------------------ */
/* Approximate fallback: closest barangay center (Leon)               */
/* ------------------------------------------------------------------ */

const CENTERS_BY_TOWN = { leon: LEON_BARANGAYS };
const centersFor = (municipality) => CENTERS_BY_TOWN[norm(municipality)] || null;

export function hasBarangayCenters(municipality, barangay) {
  const centers = centersFor(municipality);
  if (!centers) return false;
  return barangay ? centers.some((c) => norm(c.name) === norm(barangay)) : true;
}

/** The barangay whose center is closest to the point: { name, distanceMeters } or null. */
export function nearestBarangay(lat, lng, municipality) {
  const centers = centersFor(municipality);
  if (!centers || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  centers.forEach((c) => {
    const d = haversineMeters(lat, lng, c.lat, c.lng);
    if (!best || d < best.distanceMeters) best = { name: c.name, distanceMeters: d };
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* Checks used by the form                                             */
/* ------------------------------------------------------------------ */

/**
 * Is the pin inside the chosen barangay?
 * { status: 'inside' | 'outside' | 'unknown', nearest, exact }
 * nearest.name = the barangay the pin is actually in (when known).
 */
export function checkPinInBarangay({ lat, lng, municipality, barangay }) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!barangay || !Number.isFinite(la) || !Number.isFinite(ln) || !la || !ln) return { status: 'unknown', nearest: null, exact: false };

  const own = boundaries.get(norm(municipality))?.byKey.get(norm(barangay));
  if (own) {
    if (inShape(own, la, ln)) return { status: 'inside', nearest: { name: own.name }, exact: true };
    if (distanceToGeometryMeters(la, ln, own.geometry) <= BOUNDARY_TOLERANCE_METERS) {
      return { status: 'inside', nearest: { name: own.name }, exact: true, nearBorder: true };
    }
    const actual = barangayAt(la, ln, municipality);
    return { status: 'outside', nearest: { name: actual || `outside ${municipality}` }, exact: true };
  }

  const ownCenter = centersFor(municipality)?.find((c) => norm(c.name) === norm(barangay));
  if (!ownCenter) return { status: 'unknown', nearest: null, exact: false };
  const nearest = nearestBarangay(la, ln, municipality);
  if (!nearest || norm(nearest.name) === norm(barangay)) return { status: 'inside', nearest, exact: false };
  const toOwn = haversineMeters(la, ln, ownCenter.lat, ownCenter.lng);
  return toOwn - nearest.distanceMeters > BORDER_MARGIN_METERS
    ? { status: 'outside', nearest, exact: false }
    : { status: 'inside', nearest, exact: false };
}

/** True when any point of a road line falls in the barangay. */
export function lineCrossesBarangay(points, municipality, barangay) {
  if (!Array.isArray(points) || !barangay) return false;
  const own = boundaries.get(norm(municipality))?.byKey.get(norm(barangay));
  if (own) return points.some((p) => inShape(own, Number(p?.[0]), Number(p?.[1])));

  if (!hasBarangayCenters(municipality, barangay)) return false;
  const target = norm(barangay);
  return points.some((p) => {
    const hit = nearestBarangay(Number(p?.[0]), Number(p?.[1]), municipality);
    return hit && norm(hit.name) === target;
  });
}
