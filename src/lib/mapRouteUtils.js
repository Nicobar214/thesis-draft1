import { HALTED_STATUS_STYLES, haltedStatusLabel, isHaltedStatus } from './delayCases';

export function normalizeRouteStatus(status) {
  if (!status) return '';
  const key = String(status).toLowerCase().replace(/[-\s]/g, '');
  if (key === 'ongoing') return 'On-Going';
  if (key === 'completed') return 'Completed';
  if (key === 'proposed') return 'Proposed';
  return haltedStatusLabel(status) || status;
}

export function getRouteStatusTheme(status) {
  switch (normalizeRouteStatus(status)) {
    case 'Completed':
      return { line: '#10b981', stroke: '#059669', badge: 'bg-emerald-100 text-emerald-700' };
    case 'On-Going':
      return { line: '#f59e0b', stroke: '#d97706', badge: 'bg-amber-100 text-amber-700' };
    case 'Proposed':
      return { line: '#3b82f6', stroke: '#2563eb', badge: 'bg-sky-100 text-sky-700' };
    case 'Suspended':
    case 'Terminated': {
      const h = HALTED_STATUS_STYLES[normalizeRouteStatus(status)];
      return { line: h.fill, stroke: h.stroke, badge: h.badge };
    }
    default:
      return { line: '#64748b', stroke: '#475569', badge: 'bg-slate-100 text-slate-700' };
  }
}

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pointFromObject(point) {
  if (!point || typeof point !== 'object') return null;
  if (Array.isArray(point) && point.length >= 2) {
    const lat = toNum(point[0]);
    const lng = toNum(point[1]);
    return lat !== null && lng !== null ? [lat, lng] : null;
  }

  const lat = toNum(point.lat ?? point.latitude ?? point.start_latitude ?? point.end_latitude);
  const lng = toNum(point.lng ?? point.lon ?? point.longitude ?? point.start_longitude ?? point.end_longitude);
  return lat !== null && lng !== null ? [lat, lng] : null;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pointsFromGeoJson(geoJson) {
  if (!geoJson || typeof geoJson !== 'object') return [];
  if (geoJson.type !== 'LineString' || !Array.isArray(geoJson.coordinates)) return [];
  return geoJson.coordinates
    .map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return null;
      const lng = toNum(coord[0]);
      const lat = toNum(coord[1]);
      if (lat === null || lng === null) return null;
      return [lat, lng];
    })
    .filter(Boolean);
}

function dedupePoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    const key = `${point[0].toFixed(6)}:${point[1].toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse a stored list of points into [[lat, lng], ...].
 *
 * Tolerates every shape this app has written: a JSON string or a parsed array,
 * holding [lat,lng] pairs (SQL seeds) or {lat,lng} / {latitude,longitude} objects
 * (admin route builder). Used for project_routes.route_points and
 * road_network_gaps.gap_points, which share the same encoding.
 */
export function parsePointList(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(pointFromObject).filter(Boolean);
}

export function buildRoutePoints(project, routeRecord) {
  const points = [];

  const start = pointFromObject({ lat: project?.start_latitude, lng: project?.start_longitude });
  const end = pointFromObject({ lat: project?.end_latitude, lng: project?.end_longitude });

  if (routeRecord) {
    const routeStart = pointFromObject({ lat: routeRecord.start_latitude, lng: routeRecord.start_longitude });
    const routeEnd = pointFromObject({ lat: routeRecord.end_latitude, lng: routeRecord.end_longitude });

    if (routeStart) points.push(routeStart);

    const routePointsRaw = parseMaybeJson(routeRecord.route_points ?? routeRecord.points ?? routeRecord.coordinates ?? routeRecord.waypoints);
    if (Array.isArray(routePointsRaw)) {
      routePointsRaw.forEach((pt) => {
        const parsed = pointFromObject(pt);
        if (parsed) points.push(parsed);
      });
    }

    const geoJsonRaw = parseMaybeJson(routeRecord.route_geojson ?? routeRecord.geojson);
    const geoJsonPoints = pointsFromGeoJson(geoJsonRaw);
    points.push(...geoJsonPoints);

    if (routeEnd) points.push(routeEnd);
  }

  // No mapped route: a straight line between the two pins. A road is never
  // shorter than the straight line between its ends, so pins much farther apart
  // than the declared length mean one pin is wrong (e.g. 0.72 km road, pins
  // 11 km apart). Then only the start is kept rather than a line across town.
  let endpointsMismatch = false;
  if (points.length === 0) {
    if (start) points.push(start);
    const declaredKm = toNum(project?.project_length_km);
    endpointsMismatch = Boolean(start && end && declaredKm > 0 && haversineKm(start, end) > declaredKm * 2 + 0.5);
    if (end && !endpointsMismatch) points.push(end);
  }

  const deduped = dedupePoints(points);
  const hasPolyline = deduped.length >= 2;

  return {
    points: deduped,
    hasPolyline,
    startPoint: deduped[0] || start || null,
    endPoint: deduped[deduped.length - 1] || end || null,
    hasRouteRecord: Boolean(routeRecord),
    endpointsMismatch,

    // Provenance and length, surfaced here rather than threaded through arguments
    // so every caller of buildRoutePoints gets them without changing its signature.
    // `declaredLengthKm` is the official project extent; `mappedLengthKm` is the
    // length of the stored geometry. They should agree, and where they do not the
    // UI can say so instead of quietly showing one of them.
    declaredLengthKm: toNum(routeRecord?.declared_length_km) ?? toNum(project?.project_length_km),
    mappedLengthKm: toNum(routeRecord?.mapped_length_km),
    routeSource: routeRecord?.route_source ?? null,
    routeQuality: routeRecord?.route_quality ?? null,
    startBarangay: project?.barangay ?? null,
    endBarangay: project?.barangay_end ?? null,
  };
}

export function getTargetDateChip(targetDate, completed) {
  if (!targetDate) return null;
  const date = new Date(targetDate);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((date.getTime() - today.getTime()) / 86400000);
  if (completed) {
    return { className: 'bg-emerald-100 text-emerald-700', text: `Target ${targetDate}` };
  }

  if (diffDays < 0) {
    return {
      className: 'bg-red-100 text-red-700',
      text: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`,
    };
  }

  return {
    className: 'bg-emerald-100 text-emerald-700',
    text: `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`,
  };
}

// DA's informal turnaround target for validating an LGU project proposal.
export const PROPOSAL_SLA_DAYS = 15;

export function getPendingDaysChip(submittedAt, status) {
  if (status !== 'Submitted' && status !== 'Under Validation') return null;
  const submitted = new Date(submittedAt);
  if (Number.isNaN(submitted.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  submitted.setHours(0, 0, 0, 0);
  const diffDays = Math.max(0, Math.round((today.getTime() - submitted.getTime()) / 86400000));

  if (diffDays > PROPOSAL_SLA_DAYS) {
    return { className: 'bg-red-100 text-red-700', text: `Pending ${diffDays} days — SLA exceeded` };
  }
  if (diffDays >= PROPOSAL_SLA_DAYS - 5) {
    return { className: 'bg-amber-100 text-amber-700', text: `Pending ${diffDays} day${diffDays === 1 ? '' : 's'}` };
  }
  return { className: 'bg-slate-100 text-slate-600', text: `Pending ${diffDays} day${diffDays === 1 ? '' : 's'}` };
}

export function isOverdueProject(project) {
  if (!project?.target_completion_date) return false;
  if (normalizeRouteStatus(project.status) === 'Completed' || isHaltedStatus(project.status)) return false;

  const target = new Date(project.target_completion_date);
  if (Number.isNaN(target.getTime())) return false;
  target.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return target < today;
}

/**
 * How much to trust a project's plotted position.
 *
 * Replaces four separate copies of `remarks.includes('auto-geocoded')` across
 * Dashboard.jsx and UserMapView.jsx. That test string-matched a free-text notes
 * column, which forced the background geocoder to write machine text into
 * `remarks` just so the maps could detect its own output. Provenance now has a
 * real column, `fmr_projects.coordinate_source` (supabase_coordinate_source_column.sql).
 *
 * Returns one of:
 *   'surveyed'    - geometry traced to a road network or supplied by the DA
 *   'approximate' - placed at the barangay centre by the geocoder
 *   'unknown'     - no coordinates at all; the map falls back to a municipal pin
 *
 * Precedence, most reliable signal first:
 *   1. No coordinates anywhere (no route polyline, no start lat/lng) -> 'unknown'.
 *      Nothing below matters if there is nothing to plot.
 *   2. A project_routes row with a known `route_source` -> 'surveyed'. An actual
 *      drawn or generated path is the strongest evidence available, and it wins
 *      even if `coordinate_source` disagrees (e.g. a project was geocoded first,
 *      then later routed by the OSM generator but the project row was never
 *      re-stamped).
 *   3. `project.coordinate_source` -- the real column, so trusted ahead of the
 *      legacy marker below: 'nominatim-barangay' -> 'approximate'; anything else
 *      truthy ('da-records', 'osm-local-graph', ...) -> 'surveyed'.
 *   4. `project.remarks` containing 'auto-geocoded' -- the legacy marker, read
 *      only for rows from before supabase_coordinate_source_column.sql has run.
 *      -> 'approximate'.
 *   5. Otherwise, coordinates exist with no negative signal -> 'surveyed'. This
 *      is what a plain DA-RAED row with real coordinates and no remarks note
 *      looks like, both before and after the migration.
 */
export function getLocationConfidence(project, routeRecord = null) {
  const route = buildRoutePoints(project, routeRecord);
  const hasCoordinates = route.hasPolyline || Boolean(project?.start_latitude && project?.start_longitude);
  if (!hasCoordinates) return 'unknown';

  if (routeRecord?.route_source) return 'surveyed';

  const source = String(project?.coordinate_source || '').toLowerCase();
  if (source === 'nominatim-barangay') return 'approximate';
  if (source) return 'surveyed';

  if (String(project?.remarks || '').toLowerCase().includes('auto-geocoded')) return 'approximate';

  return 'surveyed';
}

/**
 * The barangay a project sits in.
 *
 * Prefers the real `barangay` column, which fmr_projects previously did not have
 * at all -- the barangay was buried in free-text `location` and recovered by
 * splitting on the first comma, which yields "Brgy. Alupidian" for DA-RAED rows
 * and the bare barangay for LGU rows. The split is kept as the fallback so rows
 * outside Leon, which are not backfilled, keep working exactly as before.
 */
export function getProjectBarangay(project) {
  const column = String(project?.barangay || '').trim();
  if (column) return column;

  const location = String(project?.location || '').trim();
  if (!location) return 'N/A';
  const first = location.split(',')[0]?.trim();
  return first || location;
}

export function boundsFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

const EARTH_RADIUS_KM = 6371;

// Accepts every point shape this app stores: [lat, lng] arrays (SQL seeds),
// {lat, lng} objects (admin route builder), and {latitude, longitude} rows.
export function coordPair(point) {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  return [
    Number(point?.lat ?? point?.latitude),
    Number(point?.lng ?? point?.longitude),
  ];
}

function isFinitePair(pair) {
  return Number.isFinite(pair[0]) && Number.isFinite(pair[1]);
}

function toValidPairs(points) {
  if (!Array.isArray(points)) return [];
  return points.map(coordPair).filter(isFinitePair);
}

export function haversineKm(p1, p2) {
  const [lat1, lng1] = coordPair(p1);
  const [lat2, lng2] = coordPair(p2);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Closest point on a road line to `point`, and the distance to it in meters.
 * Unlike measuring to the road's start, this finds where a farm actually meets
 * the road -- a long road passing right beside the farm counts as close.
 * Works on a flat local projection, which is accurate at farm-to-road scale.
 *
 * @param {[number, number]} point     [lat, lng]
 * @param {[number, number][]} polyline [lat, lng] vertices (one vertex is fine)
 * @returns {{ point: [number, number], distanceMeters: number } | null}
 */
export function nearestPointOnPolyline(point, polyline) {
  const [lat0, lng0] = point || [];
  if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) return null;
  const vertices = (polyline || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (vertices.length === 0) return null;

  const M_PER_DEG = 111320;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  // Local meters relative to `point`, which sits at the origin.
  const toXY = ([lat, lng]) => [(lng - lng0) * kx, (lat - lat0) * M_PER_DEG];
  const toLatLng = ([x, y]) => [lat0 + y / M_PER_DEG, lng0 + x / kx];

  let best = null;
  const consider = (xy) => {
    const d = Math.hypot(xy[0], xy[1]);
    if (!best || d < best.d) best = { xy, d };
  };

  if (vertices.length === 1) consider(toXY(vertices[0]));
  for (let i = 0; i < vertices.length - 1; i += 1) {
    const [ax, ay] = toXY(vertices[i]);
    const [bx, by] = toXY(vertices[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lenSq));
    consider([ax + t * dx, ay + t * dy]);
  }

  return { point: toLatLng(best.xy), distanceMeters: best.d };
}

export function calculatePolylineDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalKm += haversineKm(points[i], points[i + 1]);
  }
  return totalKm;
}

// Linear interpolation is accurate enough here: OSRM vertices are metres apart,
// so great-circle curvature within one segment is far below display precision.
function interpolateSegment(p1, p2, fraction) {
  const [lat1, lng1] = coordPair(p1);
  const [lat2, lng2] = coordPair(p2);
  return [lat1 + (lat2 - lat1) * fraction, lng1 + (lng2 - lng1) * fraction];
}

/**
 * Truncate a polyline to an exact chainage, interpolating the final vertex.
 *
 * This is what makes a generated route honest: an FMR project concretes a
 * *portion* of a real barangay road, so we take a real road-following corridor
 * and cut it at the project's declared length rather than stretching a straight
 * line to fit. If the corridor is shorter than `km` the whole corridor comes
 * back and `lengthKm` reports what was actually available, so callers can tell
 * the difference between "cut to fit" and "ran out of road".
 */
export function cutPolylineAtKm(points, km) {
  const valid = toValidPairs(points);
  if (valid.length < 2 || !Number.isFinite(km) || km <= 0) {
    return { points: valid, lengthKm: calculatePolylineDistanceKm(valid), truncated: false };
  }

  const out = [valid[0]];
  let accKm = 0;

  for (let i = 0; i < valid.length - 1; i++) {
    const segmentKm = haversineKm(valid[i], valid[i + 1]);
    if (segmentKm <= 0) continue;

    if (accKm + segmentKm >= km) {
      out.push(interpolateSegment(valid[i], valid[i + 1], (km - accKm) / segmentKm));
      // Deliberately NOT dedupePoints: that is a global dedupe keyed on 6 decimal
      // places, so it drops any vertex whose key appeared anywhere earlier in the
      // line. On a detailed corridor that deletes interior vertices and shortens
      // the result -- it cost project 205 61 m against a 1.58 km target. A cut
      // whose whole purpose is an exact length must preserve every vertex.
      return { points: out, lengthKm: km, truncated: true };
    }

    accKm += segmentKm;
    out.push(valid[i + 1]);
  }

  // Corridor was shorter than requested.
  return { points: out, lengthKm: accKm, truncated: false };
}

/** The remainder of a polyline *after* the given chainage — the gap corridor. */
export function slicePolylineFromKm(points, km) {
  const valid = toValidPairs(points);
  if (valid.length < 2) return { points: valid, lengthKm: 0 };
  if (!Number.isFinite(km) || km <= 0) {
    return { points: valid, lengthKm: calculatePolylineDistanceKm(valid) };
  }

  let accKm = 0;
  for (let i = 0; i < valid.length - 1; i++) {
    const segmentKm = haversineKm(valid[i], valid[i + 1]);
    if (segmentKm <= 0) continue;

    if (accKm + segmentKm > km) {
      const cut = interpolateSegment(valid[i], valid[i + 1], (km - accKm) / segmentKm);
      const rest = [cut, ...valid.slice(i + 1)];
      // Same reason as cutPolylineAtKm: no global dedupe on a length-critical slice.
      return { points: rest, lengthKm: calculatePolylineDistanceKm(rest) };
    }
    accKm += segmentKm;
  }

  return { points: [], lengthKm: 0 };
}

export function interpolateAlongPolyline(points, km) {
  const { points: cut } = cutPolylineAtKm(points, km);
  return cut.length > 0 ? cut[cut.length - 1] : null;
}

/** Initial great-circle bearing in degrees, 0 = north. Used to rotate arrow icons. */
export function bearingBetween(from, to) {
  const [lat1, lng1] = coordPair(from);
  const [lat2, lng2] = coordPair(to);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Halfway-by-distance point plus the local heading there, for a direction arrow. */
export function polylineMidpointWithBearing(points) {
  const valid = toValidPairs(points);
  if (valid.length < 2) return null;

  const totalKm = calculatePolylineDistanceKm(valid);
  if (totalKm <= 0) return null;
  const halfKm = totalKm / 2;

  let accKm = 0;
  for (let i = 0; i < valid.length - 1; i++) {
    const segmentKm = haversineKm(valid[i], valid[i + 1]);
    if (segmentKm <= 0) continue;

    if (accKm + segmentKm >= halfKm) {
      return {
        point: interpolateSegment(valid[i], valid[i + 1], (halfKm - accKm) / segmentKm),
        bearing: bearingBetween(valid[i], valid[i + 1]),
      };
    }
    accKm += segmentKm;
  }

  const last = valid.length - 1;
  return { point: valid[last], bearing: bearingBetween(valid[last - 1], valid[last]) };
}

function hashRouteKey(routeKey) {
  let hash = 0;
  for (const ch of String(routeKey || 'route')) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function offsetPointMeters(point, angleRad, meters) {
  const lat = Number(point?.[0]);
  const lng = Number(point?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(meters)) return point;
  const latOffset = (Math.sin(angleRad) * meters) / 111320;
  const lngOffset = (Math.cos(angleRad) * meters) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + latOffset, lng + lngOffset];
}

// Above this vertex count a route carries enough of its own shape that the
// anti-overlap jitter is unnecessary, and applying it would distort real geometry.
const DISPLAY_OFFSET_MAX_VERTICES = 10;

export function createDisplayRoutePoints(points, routeKey, maxOffsetMeters = 8) {
  if (!Array.isArray(points) || points.length < 2) return points || [];

  const valid = points
    .map((point) => [Number(point?.[0]), Number(point?.[1])])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (valid.length < 2) return points;

  const hash = hashRouteKey(routeKey);
  const offsetStep = (hash % 7) - 3;
  if (offsetStep === 0) return valid;

  const offsetMeters = Math.max(-maxOffsetMeters, Math.min(maxOffsetMeters, offsetStep * 2.5));
  const angleRad = ((hash % 360) * Math.PI) / 180;

  if (valid.length === 2) {
    const start = valid[0];
    const end = valid[1];
    const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    return [start, offsetPointMeters(mid, angleRad, offsetMeters), end];
  }

  // Only nudge sparse routes. The lateral offset exists so two projects sharing a
  // barangay road stay visually distinguishable, which matters for the 2-4 vertex
  // routes it was written for. Applying it to a detailed corridor would perturb
  // every one of its interior vertices, changing both the drawn shape and the
  // rendered length away from the project's declared km -- so a detailed route is
  // returned untouched, since it has enough real shape to tell routes apart anyway.
  if (valid.length > DISPLAY_OFFSET_MAX_VERTICES) return valid;

  return valid.map((point, index) => {
    if (index === 0 || index === valid.length - 1) return point;
    return offsetPointMeters(point, angleRad, offsetMeters);
  });
}

const roadSnapCache = new Map();
const roadSnapInFlight = new Map(); // cache key -> pending request, shared by callers

/* Snapped roads are also kept in the browser for a week, so opening a map again
 * does not ask the free routers for every road again (the dashboard snaps ~130
 * straight-line projects; the routers ask for about 1 request a second). Only
 * real routes are stored, as in roadSnapCache. */
const SNAP_STORE_KEY = 'roadSnapCache.v1';
const SNAP_STORE_DAYS = 7;
const SNAP_STORE_MAX = 400; // roads kept; the oldest go first
let snapStore = null; // { [cacheKey]: { at, line } }

function readSnapStore() {
  if (snapStore) return snapStore;
  snapStore = {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SNAP_STORE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : {};
    const fresh = Date.now() - SNAP_STORE_DAYS * 86400000;
    Object.entries(parsed || {}).forEach(([key, v]) => {
      if (v && v.at > fresh && Array.isArray(v.line) && v.line.length >= 2) snapStore[key] = v;
    });
  } catch {
    // Storage blocked or corrupt: start empty; snapping still works.
  }
  return snapStore;
}

function storedRoad(cacheKey) {
  return readSnapStore()[cacheKey]?.line || null;
}

function storeRoad(cacheKey, line) {
  const store = readSnapStore();
  store[cacheKey] = { at: Date.now(), line };
  const keys = Object.keys(store);
  if (keys.length > SNAP_STORE_MAX) {
    keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - SNAP_STORE_MAX).forEach((k) => delete store[k]);
  }
  try {
    localStorage.setItem(SNAP_STORE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: the in-memory cache still has it.
  }
}

/* At most SNAP_MAX_IN_FLIGHT router requests at once, so a map that snaps many
 * roads does not fire them all in one burst (which gets the connection rate
 * limited, and then the Snap to Road button fails too). Requests the user is
 * waiting for (priority 'high': the button and its prefetch) go ahead of
 * background map snapping. */
const SNAP_MAX_IN_FLIGHT = 2;
let snapRunning = 0;
const snapQueue = { high: [], low: [] };

function runQueued(task, priority) {
  return new Promise((resolve) => {
    snapQueue[priority === 'high' ? 'high' : 'low'].push({ task, resolve });
    pumpSnapQueue();
  });
}

function pumpSnapQueue() {
  while (snapRunning < SNAP_MAX_IN_FLIGHT) {
    const job = snapQueue.high.shift() || snapQueue.low.shift();
    if (!job) return;
    snapRunning += 1;
    job.task().then(job.resolve, () => job.resolve(null)).finally(() => {
      snapRunning -= 1;
      pumpSnapQueue();
    });
  }
}
const strayWarned = new Set(); // cache keys already reported as strayed (warn once)

const OSRM_MAX_WAYPOINTS = 15;

/**
 * Reduce a polyline to at most `max` vertices by taking evenly spaced samples,
 * always retaining the first and last so the route keeps its true extent.
 */
export function decimatePoints(points, max = OSRM_MAX_WAYPOINTS) {
  if (!Array.isArray(points)) return [];
  if (points.length <= max) return points;

  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/**
 * True when a route record's geometry already follows the road network, so
 * re-snapping it client-side would be wasted work and could distort it.
 */
export function isAlreadyRoadAligned(routeRecord) {
  const source = String(routeRecord?.route_source || '').toLowerCase();
  return source.startsWith('osrm') || source.startsWith('osm');
}

/* Cleaning up a snapped line. OSRM routes through every via-point, so a point
 * drawn a little off the road makes it drive to that point and back: a short
 * out-and-back "spike", or a loop around a block. Those are display artefacts,
 * not road, and are cut out here. The saved route itself is never changed. */
const SPIKE_RETURN_M = 12;      // the line came back within this of an earlier point...
const SPIKE_MAX_LENGTH_M = 800; // ...after a detour no longer than this: cut it out
const SNAP_MIN_DEVIATION_M = 250; // a snapped line this far from the drawn one took a wrong road

function metersBetween(a, b) {
  return haversineKm(a, b) * 1000;
}

/**
 * Remove out-and-back spikes and small loops from a road-snapped line: when the
 * line returns to (nearly) a point it already passed, within a short distance,
 * everything in between is dropped.
 */
export function removeRouteSpikes(points, { returnM = SPIKE_RETURN_M, maxLengthM = SPIKE_MAX_LENGTH_M } = {}) {
  const pts = toValidPairs(points);
  if (pts.length < 4) return pts;
  const out = [pts[0]];
  const along = [0]; // distance along `out` to each kept vertex
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    const here = along[along.length - 1] + metersBetween(out[out.length - 1], p);
    // Look back (not at the vertex just before) for a point this one returns to.
    let cut = -1;
    for (let k = out.length - 2; k >= 0; k -= 1) {
      if (here - along[k] > maxLengthM) break;
      if (metersBetween(out[k], p) > returnM) continue;
      // Only a real excursion counts: dense vertices on a straight road are
      // also close together, but the line never left the spot.
      const wentAway = out.slice(k + 1).some((q) => metersBetween(out[k], q) > returnM * 2);
      if (wentAway) { cut = k; break; }
    }
    if (cut >= 0) {
      out.length = cut + 1;
      along.length = cut + 1;
      continue; // `p` duplicates out[cut]; keep the earlier vertex
    }
    out.push(p);
    along.push(here);
  }
  return out.length >= 2 ? out : pts;
}

/**
 * Make the snapped line start and end exactly at the project's own pins. OSRM
 * stops at the nearest road it knows, which for a farm road is often short of
 * the pin (the last stretch is not on the map yet); a straight link covers that
 * part. A pin just beside the road is joined at a shallow angle (joinEndToPin).
 */
export function connectToPins(line, start, end, minGapM = 3) {
  let pts = toValidPairs(line);
  if (pts.length < 2) return pts;
  const s0 = coordPair(start);
  const e0 = coordPair(end);
  // The pins are where the user put them and are never moved: the line always
  // starts and ends exactly on them.
  if (isFinitePair(e0)) pts = joinEndToPin(pts, e0, minGapM);
  if (isFinitePair(s0)) pts = joinEndToPin(pts.reverse(), s0, minGapM).reverse();
  return pts;
}

/* OSRM stops on the road's centre line at the point nearest the pin, so a pin
 * set on the road's edge (or a few metres off by GPS) was joined by a link at a
 * right angle: an "L" hook at the end of the road. A pin that close is ON the
 * road, so the line leaves the centre line a little earlier and runs into the
 * pin at a shallow angle instead. A pin farther off is on a stretch the map
 * does not have yet, and keeps its straight link. */
const PIN_BESIDE_ROAD_M = 25; // pin this close to where OSRM stopped: it is on the road
const PIN_TAPER_MIN_M = 15;
const PIN_TAPER_MAX_M = 60;

/** `pts` ending exactly on `pin`, approached at a shallow angle when the pin is beside the road. */
function joinEndToPin(pts, pin, minGapM) {
  const last = pts[pts.length - 1];
  const offset = metersBetween(last, pin);
  if (offset <= minGapM) return [...pts.slice(0, -1), pin];
  if (offset > PIN_BESIDE_ROAD_M) return [...pts, pin];

  // Walk back along the road ~3x the offset (never more than 40% of the line).
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += metersBetween(pts[i - 1], pts[i]);
  const taper = Math.min(Math.max(offset * 3, PIN_TAPER_MIN_M), PIN_TAPER_MAX_M, total * 0.4);
  let left = taper;
  for (let i = pts.length - 1; i > 0; i -= 1) {
    const seg = metersBetween(pts[i - 1], pts[i]);
    if (seg >= left) {
      const u = seg > 0 ? (seg - left) / seg : 0; // from pts[i - 1] towards pts[i]
      const cut = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
      return [...pts.slice(0, i), cut, pin];
    }
    left -= seg;
  }
  return [pts[0], pin];
}

/**
 * Round the sharp corners of a road line for display (Chaikin corner cutting),
 * never cutting more than `maxCutM` off a corner so the line stays on the road.
 * The first and last points are kept exactly.
 */
export function smoothRouteCorners(points, { maxCutM = 6, passes = 2 } = {}) {
  let pts = toValidPairs(points);
  for (let pass = 0; pass < passes && pts.length >= 3; pass += 1) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = metersBetween(a, b);
      const t = len > 0 ? Math.min(0.25, maxCutM / len) : 0;
      const lerp = (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      if (i > 0) out.push(lerp(t));
      if (i < pts.length - 2) out.push(lerp(1 - t));
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Farthest any vertex of `line` gets from the polyline `reference`, in meters. */
export function maxDeviationMeters(line, reference) {
  let worst = 0;
  for (const p of line) {
    const near = nearestPointOnPolyline(p, reference);
    if (near && near.distanceMeters > worst) worst = near.distanceMeters;
  }
  return worst;
}

/**
 * The route drawn along real roads (OSRM), for display: spikes cut out, joined
 * to the start and end pins, corners gently rounded. Falls back to the points
 * as given. Nothing is saved; pass { smooth: false } when the result is going
 * to be stored as waypoints (the "Snap to Road" buttons), to keep it compact.
 *
 * Pass { alongLine: true } when the points ARE the road (a project known only
 * by its two pins) rather than a trip from A to B. OSRM returns the shortest
 * drive between the pins, which for a farm road missing from the map can be a
 * 7 km loop over other roads; with alongLine that is refused and the straight
 * line kept, as it already is for a drawn route of 3+ points.
 */
export async function fetchRoadAlignedPolyline(points, options = {}) {
  return (await snapToRoad(points, options)).points;
}

/**
 * Same as fetchRoadAlignedPolyline, but also says whether the road was found,
 * so a "Snap to Road" button can tell the user instead of claiming success.
 * declaredKm: the project's official length; with alongLine, a snapped road
 * longer than twice that (+0.5 km) is refused (reason 'too_long').
 * @returns {Promise<{ points: [number, number][], snapped: boolean, reason?: 'failed' | 'strayed' | 'too_long' }>}
 */
export async function snapToRoad(points, { smooth = true, alongLine = false, priority = 'low', declaredKm = null } = {}) {
  if (!Array.isArray(points) || points.length < 2) return { points: points || [], snapped: false, reason: 'failed' };
  const finish = (line) => ({ points: smooth ? smoothRouteCorners(line) : line, snapped: true });

  // Keep requests lightweight and API-safe: OSRM is asked for at most
  // OSRM_MAX_WAYPOINTS via-points.
  //
  // This used to be `points.slice(0, 15)`, which took the FIRST 15 vertices and
  // routed through only those -- on a detailed corridor that is its first few
  // hundred metres, so the rest of the route was silently discarded. Decimating
  // evenly and always keeping the last vertex preserves the route's full extent.
  const clamped = decimatePoints(points, OSRM_MAX_WAYPOINTS)
    .map((point) => [Number(point[0]), Number(point[1])]);
  const valid = clamped.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (valid.length < 2) return { points, snapped: false, reason: 'failed' };

  const cacheKey = valid.map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join('|');
  // The cache holds the road OSRM gave; whether to use it depends on the
  // caller (alongLine), so the stray check runs on every call, cached or not.
  let cleaned = roadSnapCache.get(cacheKey) || storedRoad(cacheKey);
  if (cleaned) roadSnapCache.set(cacheKey, cleaned);
  if (!cleaned) {
    // A request already on its way for these points (a prefetch, another map)
    // is shared instead of sent again.
    if (!roadSnapInFlight.has(cacheKey)) {
      roadSnapInFlight.set(cacheKey, runQueued(() => requestRoad(valid), priority).finally(() => roadSnapInFlight.delete(cacheKey)));
    }
    cleaned = await roadSnapInFlight.get(cacheKey);
    if (!cleaned) return { points, snapped: false, reason: 'failed' };
    roadSnapCache.set(cacheKey, cleaned);
    storeRoad(cacheKey, cleaned);
  }

  // A drawn route (3+ points), or a road given by its pins (alongLine), should
  // be followed, not replaced: if the snapped line wanders far from it, OSRM
  // took another road, so keep the line as drawn. Two points without alongLine
  // is plain A-to-B routing (to a market, to a farm), where any road goes.
  if (valid.length >= 3 || alongLine) {
    let longestLegM = 0;
    for (let i = 1; i < valid.length; i += 1) longestLegM = Math.max(longestLegM, metersBetween(valid[i - 1], valid[i]));
    const allowedM = Math.max(SNAP_MIN_DEVIATION_M, longestLegM * 0.5);
    if (maxDeviationMeters(cleaned, valid) > allowedM) {
      if (!strayWarned.has(cacheKey)) {
        strayWarned.add(cacheKey);
        console.warn('Road snap strayed from the drawn route; keeping it as drawn.', { cacheKey });
      }
      return { points, snapped: false, reason: 'strayed' };
    }
  }
  // A project road given by its pins (alongLine) with a known length: a snapped
  // road much longer than that is the drive between two far-apart pins (a pin
  // is wrong), not the road itself, e.g. 19.8 km for a 0.72 km FMR.
  const declared = Number(declaredKm);
  if (alongLine && declared > 0) {
    let snappedKm = 0;
    for (let i = 1; i < cleaned.length; i += 1) snappedKm += haversineKm(cleaned[i - 1], cleaned[i]);
    if (snappedKm > declared * 2 + 0.5) return { points, snapped: false, reason: 'too_long' };
  }
  return finish(cleaned);
}

/* Three free public road routers, all on OpenStreetMap roads: the OSRM demo
 * server, FOSSGIS's Valhalla, and FOSSGIS's OSRM. Each is fast (~0.7 s) most of
 * the time, but any of them can hang for 15 s or stop answering for a while
 * (a rate limit, maintenance). So the request is "hedged": the first router is
 * asked, and if it has not answered within SNAP_HEDGE_MS (or fails) the next is
 * asked too; whichever answers first wins and the others are cancelled. A router
 * that failed or was too slow goes to the back of the line for
 * ROUTER_COOLDOWN_MS, so the next snaps go straight to one that works.
 * Nothing waits longer than SNAP_TIMEOUT_MS. */
const SNAP_HEDGE_MS = 1200;
const SNAP_TIMEOUT_MS = 8000;
const ROUTER_COOLDOWN_MS = 2 * 60 * 1000;

// continue_straight=false: at a slightly-off via-point OSRM may turn back
// (a spike, cut out by removeRouteSpikes) instead of looping around a whole block.
// (OSRM refuses unknown query parameters, so nothing else may be added here.)
const osrmUrl = (base) => (points) =>
  `${base}/${points.map(([lat, lng]) => `${lng},${lat}`).join(';')}?overview=full&geometries=geojson&continue_straight=false`;

const ROUTERS = [
  { name: 'osrm-demo', url: osrmUrl('https://router.project-osrm.org/route/v1/driving'), parse: routeFromOsrm },
  {
    name: 'valhalla-fossgis',
    url: (points) => `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify({
      locations: points.map(([lat, lng]) => ({ lat, lon: lng })),
      costing: 'auto',
      directions_type: 'none',
    }))}`,
    parse: routeFromValhalla,
  },
  { name: 'osrm-fossgis', url: osrmUrl('https://routing.openstreetmap.de/routed-car/route/v1/driving'), parse: routeFromOsrm },
];
const routerDownUntil = new Map(); // router name -> time it may lead again

/** Routers in the order to ask them: ones that recently failed go last. */
function routerOrder(now = Date.now()) {
  const resting = (r) => (routerDownUntil.get(r.name) || 0) > now;
  return [...ROUTERS.filter((r) => !resting(r)), ...ROUTERS.filter(resting)];
}

/** [lat, lng] points of the first route in an OSRM response, or null. */
function routeFromOsrm(json) {
  const line = json?.routes?.[0]?.geometry?.coordinates
    ?.map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return null;
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    })
    .filter(Boolean);
  return line && line.length >= 2 ? line : null;
}

/** Google's encoded polyline format; Valhalla uses 6 decimal places. */
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    for (let k = 0; k < 2; k += 1) {
      let shift = 0;
      let result = 0;
      let b;
      do {
        b = str.charCodeAt(i) - 63;
        i += 1;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += delta; else lng += delta;
    }
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

/** [lat, lng] points of a Valhalla route (one shape per leg, joined), or null. */
function routeFromValhalla(json) {
  const legs = json?.trip?.legs;
  if (!Array.isArray(legs) || !legs.length) return null;
  const line = [];
  legs.forEach((leg) => {
    const pts = typeof leg?.shape === 'string' ? decodePolyline(leg.shape, 6) : [];
    line.push(...(line.length ? pts.slice(1) : pts)); // each leg starts where the last ended
  });
  return line.length >= 2 ? line : null;
}

/** The first route any router returns for `points`, or null (all failed / timed out). */
function fetchRouteHedged(points) {
  const order = routerOrder();
  return new Promise((resolve) => {
    const asked = []; // { router, controller, at }
    let failed = 0;
    let done = false;
    let hedgeTimer = null;
    const rest = (router) => routerDownUntil.set(router.name, Date.now() + ROUTER_COOLDOWN_MS);
    const finish = (line, winner = null) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      const now = Date.now();
      asked.forEach(({ router, controller, at }) => {
        if (router === winner) { routerDownUntil.delete(router.name); return; }
        controller.abort(); // cancel the slower ones
        if (now - at >= SNAP_HEDGE_MS) rest(router); // it had its chance and said nothing
      });
      resolve(line);
    };
    const ask = () => {
      if (done || asked.length >= order.length) return;
      const router = order[asked.length];
      const controller = new AbortController();
      asked.push({ router, controller, at: Date.now() });
      if (asked.length < order.length) hedgeTimer = setTimeout(ask, SNAP_HEDGE_MS);
      fetch(router.url(points), { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`${router.name}: road snap request failed (${res.status})`);
          const line = router.parse(await res.json());
          if (!line) throw new Error(`${router.name}: no route`);
          finish(line, router);
        })
        .catch((err) => {
          if (done) return;
          rest(router);
          failed += 1;
          if (failed >= order.length) {
            console.warn('Road snap failed on every router; using a straight line.', err?.message || err);
            finish(null);
          } else {
            clearTimeout(hedgeTimer);
            ask(); // this one failed: ask the next router now, without waiting
          }
        });
    };
    const deadline = setTimeout(() => {
      console.warn('Road snap timed out; using a straight line.');
      finish(null);
    }, SNAP_TIMEOUT_MS);
    ask();
  });
}

/** The cleaned road through `valid`, or null if no router gave one. */
async function requestRoad(valid) {
  const snapped = await fetchRouteHedged(valid);
  // Only a genuine route is returned (and cached by snapToRoad). Caching the
  // straight-line fallback would turn one bad response (a slow demo server, a
  // momentary rate limit) into a permanent failure for these coordinates
  // for the rest of the session, since nothing would ever retry them.
  return snapped ? connectToPins(removeRouteSpikes(snapped), valid[0], valid[valid.length - 1]) : null;
}

/** Tests only: forget every cached road, resting router and stored road. */
export function resetRoadSnapState() {
  roadSnapCache.clear();
  roadSnapInFlight.clear();
  routerDownUntil.clear();
  strayWarned.clear();
  snapStore = {};
  try { localStorage.removeItem(SNAP_STORE_KEY); } catch { /* no storage */ }
}

/**
 * Start snapping `points` in the background so a later snapToRoad with the
 * same points (the Snap to Road button) answers at once from the cache.
 */
export function prefetchRoadSnap(points, options) {
  snapToRoad(points, options).catch(() => {});
}

export const ILOILO_MUNICIPALITY_CENTROIDS = {
  'Leon': [10.7853, 122.3831],
  'Barotac Nuevo': [10.8931, 122.7058],
  'Passi': [11.1072, 122.6417],
  'Passi City': [11.1072, 122.6417],
  'Janiuay': [10.9525, 122.5028],
  'Dumangas': [10.8267, 122.7139],
  'Santa Barbara': [10.8247, 122.5350],
  'Pototan': [10.9381, 122.6289],
  'Cabatuan': [10.8789, 122.4831],
  'Alimodian': [10.7719, 122.4286],
  'San Miguel': [10.7869, 122.4633],
  'Tigbauan': [10.6783, 122.3789],
  'Oton': [10.6975, 122.4772],
  'Miagao': [10.6406, 122.2308],
  'Guimbal': [10.6594, 122.3161],
  'Zarraga': [10.8144, 122.6267],
  'New Lucena': [10.8703, 122.6094],
  'Badiangan': [10.9631, 122.5458],
  'Leganes': [10.7831, 122.5972],
  'Pavia': [10.7714, 122.5422],
  'Dingle': [10.9992, 122.6711],
  'Dueñas': [11.0631, 122.6231],
  'Lambunao': [11.0547, 122.4833],
  'Calinog': [11.1247, 122.5286],
  'Bingawan': [11.1739, 122.5117],
  'San Enrique': [11.0558, 122.7308],
  'Anilao': [10.9767, 122.7483],
  'Banate': [11.0261, 122.8028],
  'San Rafael': [11.1444, 122.8464],
  'Barotac Viejo': [11.0361, 122.8431],
  'Ajuy': [11.1717, 122.9722],
  'Sara': [11.2589, 123.0139],
  'Concepcion': [11.2189, 123.1097],
  'San Dionisio': [11.2725, 123.0958],
  'Batad': [11.3283, 123.1114],
  'Balasan': [11.4300, 123.0800],
  'Estancia': [11.4553, 123.1517],
  'Carles': [11.5658, 123.1678],
  'Tubungan': [10.7650, 122.2858],
  'Igbaras': [10.7186, 122.2650],
  'San Joaquin': [10.5900, 122.1400],
  'Iloilo': [10.9500, 122.6000]
};

export function getMunicipalityCentroid(municipalityName) {
  if (!municipalityName) return ILOILO_MUNICIPALITY_CENTROIDS.Iloilo;
  const name = String(municipalityName).trim();
  return ILOILO_MUNICIPALITY_CENTROIDS[name] || ILOILO_MUNICIPALITY_CENTROIDS.Iloilo;
}

export function getJitteredCentroid(municipalityName, index = 0) {
  const base = getMunicipalityCentroid(municipalityName);
  if (index === 0) return base;
  
  // Distribute multiple markers in a deterministic spiral around the base center
  const angle = index * 0.5; 
  const radius = 0.003 + (index * 0.0005); 
  const latOffset = Math.sin(angle) * radius;
  const lngOffset = Math.cos(angle) * radius;
  return [base[0] + latOffset, base[1] + lngOffset];
}

const geocodeCache = new Map();

export async function geocodeFmrLocation(municipality, location) {
  const muni = String(municipality || '').trim();
  const loc = String(location || '').trim();
  if (!muni) return null;

  // Clean the location: e.g. extract first barangay name from routes like "Agboy Norte-Siol Norte Rd"
  let queryLoc = loc;
  if (loc.includes('-')) {
    queryLoc = loc.split('-')[0].trim();
  } else if (loc.includes(',')) {
    queryLoc = loc.split(',')[0].trim();
  }
  // Remove trailing "Rd", "Road", etc.
  queryLoc = queryLoc.replace(/\s+(Rd|Road|St|Street|FMR|Fmr)$/i, '').trim();

  // If we only have municipality and no location, just use municipal centroid
  if (!queryLoc || queryLoc.toLowerCase() === muni.toLowerCase()) {
    return getMunicipalityCentroid(muni);
  }

  const query = `${queryLoc}, ${muni}, Iloilo, Philippines`;
  const cacheKey = query.toLowerCase();

  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

  // Check localStorage to speed up subsequent reloads
  try {
    const stored = localStorage.getItem(`geocode:${cacheKey}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      geocodeCache.set(cacheKey, parsed);
      return parsed;
    }
  } catch (e) {
    console.error('localStorage access error', e);
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'KalsaTrack-DA-Admin-Dashboard'
      }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data && data.length > 0) {
      const coords = [Number(data[0].lat), Number(data[0].lon)];
      try {
        localStorage.setItem(`geocode:${cacheKey}`, JSON.stringify(coords));
      } catch (e) {
        // Safe fail if storage is full
      }
      geocodeCache.set(cacheKey, coords);
      return coords;
    }
  } catch (e) {
    console.warn(`Geocoding failed for ${query}:`, e);
  }

  return null;
}

