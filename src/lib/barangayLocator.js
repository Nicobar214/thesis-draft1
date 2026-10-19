/*
 * barangayLocator.js — which barangay a map point is in, for the farmer
 * registration form (is the farm pin inside the barangay that was chosen?
 * which roads run through that barangay?).
 *
 * There are no barangay boundary shapes in the system, only each barangay's
 * center point (src/data/leonBarangays.js, from OpenStreetMap; Leon only). A
 * point is taken to belong to the barangay whose center is closest. That is
 * accurate except near a border, so a pin is only called "outside" when it is
 * clearly closer to another barangay (BORDER_MARGIN_METERS). Municipalities or
 * barangays without center points answer 'unknown' instead of guessing.
 */
import LEON_BARANGAYS from '../data/leonBarangays';
import { haversineMeters } from './reportSubmission';

export const BORDER_MARGIN_METERS = 400;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const CENTERS_BY_TOWN = { leon: LEON_BARANGAYS };

function centersFor(municipality) {
  return CENTERS_BY_TOWN[norm(municipality)] || null;
}

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

/**
 * Is the pin inside the chosen barangay?
 * { status: 'inside' | 'outside' | 'unknown', nearest }  (nearest = likely barangay when outside)
 */
export function checkPinInBarangay({ lat, lng, municipality, barangay }) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!barangay || !Number.isFinite(la) || !Number.isFinite(ln) || !la || !ln) return { status: 'unknown', nearest: null };
  const centers = centersFor(municipality);
  const own = centers?.find((c) => norm(c.name) === norm(barangay));
  if (!own) return { status: 'unknown', nearest: null };

  const nearest = nearestBarangay(la, ln, municipality);
  if (!nearest || norm(nearest.name) === norm(barangay)) return { status: 'inside', nearest };
  const toOwn = haversineMeters(la, ln, own.lat, own.lng);
  return toOwn - nearest.distanceMeters > BORDER_MARGIN_METERS
    ? { status: 'outside', nearest }
    : { status: 'inside', nearest };
}

/** True when any point of a road line falls in the barangay (by closest center). */
export function lineCrossesBarangay(points, municipality, barangay) {
  if (!hasBarangayCenters(municipality, barangay) || !Array.isArray(points)) return false;
  const target = norm(barangay);
  return points.some((p) => {
    const hit = nearestBarangay(Number(p?.[0]), Number(p?.[1]), municipality);
    return hit && norm(hit.name) === target;
  });
}
