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

export function getProjectBarangay(project) {
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

const roadSnapCache = new Map();

export async function fetchRoadAlignedPolyline(points) {
  if (!Array.isArray(points) || points.length < 2) return points || [];

  // Keep requests lightweight and API-safe.
  const clamped = points.slice(0, 15).map((point) => [Number(point[0]), Number(point[1])]);
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
