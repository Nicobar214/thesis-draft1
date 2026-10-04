export function normalizeRouteStatus(status) {
  if (!status) return '';
  const key = String(status).toLowerCase().replace(/[-\s]/g, '');
  if (key === 'ongoing') return 'On-Going';
  if (key === 'completed') return 'Completed';
  if (key === 'proposed') return 'Proposed';
  return status;
}

export function getRouteStatusTheme(status) {
  switch (normalizeRouteStatus(status)) {
    case 'Completed':
      return { line: '#10b981', stroke: '#059669', badge: 'bg-emerald-100 text-emerald-700' };
    case 'On-Going':
      return { line: '#f59e0b', stroke: '#d97706', badge: 'bg-amber-100 text-amber-700' };
    case 'Proposed':
      return { line: '#3b82f6', stroke: '#2563eb', badge: 'bg-sky-100 text-sky-700' };
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

  if (points.length === 0) {
    if (start) points.push(start);
    if (end) points.push(end);
  }

  const deduped = dedupePoints(points);
  const hasPolyline = deduped.length >= 2;

  return {
    points: deduped,
    hasPolyline,
    startPoint: deduped[0] || start || null,
    endPoint: deduped[deduped.length - 1] || end || null,
    hasRouteRecord: Boolean(routeRecord),

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
  if (normalizeRouteStatus(project.status) === 'Completed') return false;

  const target = new Date(project.target_completion_date);
  if (Number.isNaN(target.getTime())) return false;
  target.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return target < today;
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
      return { points: dedupePoints(out), lengthKm: km, truncated: true };
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
      return { points: dedupePoints(rest), lengthKm: calculatePolylineDistanceKm(rest) };
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

export async function fetchRoadAlignedPolyline(points) {
  if (!Array.isArray(points) || points.length < 2) return points || [];

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
  if (valid.length < 2) return points;

  const cacheKey = valid.map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join('|');
  if (roadSnapCache.has(cacheKey)) return roadSnapCache.get(cacheKey);

  try {
    const coordString = valid.map((point) => `${point[1]},${point[0]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Road snap request failed');

    const json = await res.json();
    const snapped = json?.routes?.[0]?.geometry?.coordinates
      ?.map((coord) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;
        const lng = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
      })
      .filter(Boolean);

    const result = snapped && snapped.length >= 2 ? snapped : points;
    roadSnapCache.set(cacheKey, result);
    return result;
  } catch {
    roadSnapCache.set(cacheKey, points);
    return points;
  }
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

