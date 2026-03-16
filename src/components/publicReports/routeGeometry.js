function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toPoint(lat, lng) {
  const la = toNum(lat);
  const lo = toNum(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return [la, lo];
}

export function haversineMeters(a, b) {
  if (!a || !b) return NaN;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return NaN;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

export function sumRouteLengthMeters(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

function projectToLocalMeters(ref, point) {
  const [refLat] = ref;
  const [lat, lng] = point;
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((refLat * Math.PI) / 180);
  return {
    x: lng * lngScale,
    y: lat * latScale,
  };
}

function unprojectFromLocalMeters(ref, xy) {
  const [refLat] = ref;
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((refLat * Math.PI) / 180);
  return [xy.y / latScale, xy.x / lngScale];
}

export function nearestPointOnRoute(routePoints, reportPoint) {
  if (!Array.isArray(routePoints) || routePoints.length < 2 || !reportPoint) {
    return null;
  }

  let best = null;
  let cumulativeBefore = 0;

  for (let i = 0; i < routePoints.length - 1; i += 1) {
    const a = routePoints[i];
    const b = routePoints[i + 1];

    if (!a || !b) continue;

    const pa = projectToLocalMeters(reportPoint, a);
    const pb = projectToLocalMeters(reportPoint, b);
    const pp = projectToLocalMeters(reportPoint, reportPoint);

    const abx = pb.x - pa.x;
    const aby = pb.y - pa.y;
    const apx = pp.x - pa.x;
    const apy = pp.y - pa.y;
    const ab2 = abx * abx + aby * aby;
    const tRaw = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
    const t = Math.max(0, Math.min(1, tRaw));

    const proj = { x: pa.x + abx * t, y: pa.y + aby * t };
    const nearestPoint = unprojectFromLocalMeters(reportPoint, proj);
    const dist = haversineMeters(reportPoint, nearestPoint);

    const segMeters = haversineMeters(a, b);
    const kmAtPoint = (cumulativeBefore + segMeters * t) / 1000;

    if (!best || dist < best.distanceMeters) {
      best = {
        distanceMeters: dist,
        nearestPoint,
        nearestSegment: [a, b],
        segmentIndex: i,
        progressRatio: t,
        kmAtPoint,
      };
    }

    cumulativeBefore += segMeters;
  }

  return best;
}

export function proximityBand(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return {
      label: 'Distance unavailable',
      className: 'bg-slate-100 text-slate-700 border-slate-200',
      code: 'unknown',
    };
  }

  if (distanceMeters <= 50) {
    return {
      label: 'Within 50m',
      className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      code: 'near',
    };
  }

  if (distanceMeters <= 200) {
    return {
      label: '50m to 200m',
      className: 'bg-amber-100 text-amber-700 border-amber-200',
      code: 'mid',
    };
  }

  return {
    label: 'Over 200m',
    className: 'bg-red-100 text-red-700 border-red-200',
    code: 'far',
  };
}

export function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return 'N/A';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(2)} km`;
}
