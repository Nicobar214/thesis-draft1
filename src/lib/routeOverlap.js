/* Does a new FMR route run on top of an existing project's road?
 *
 * The new route is sampled every ~10 m; a sample counts as "on" another road
 * when it lies within OVERLAP_METERS of that road's line (GPS-drawn lines of the
 * same road rarely coincide exactly). Touching another road at a junction or an
 * end point is normal for a road network, so short contacts are ignored. */

export const OVERLAP_METERS = 20;
// Shorter shared stretches are a junction or a shared end point, not overlap.
export const MIN_OVERLAP_METERS = 50;
const SAMPLE_STEP_METERS = 10;

const M_PER_DEG_LAT = 111320;

function toXY([lat, lng], refLat) {
  return [lng * M_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180), lat * M_PER_DEG_LAT];
}

function segmentLength(a, b, refLat) {
  const [ax, ay] = toXY(a, refLat);
  const [bx, by] = toXY(b, refLat);
  return Math.hypot(bx - ax, by - ay);
}

/* Shortest distance (m) from a point to a polyline. */
export function distanceToLine(point, line) {
  if (!point || !Array.isArray(line) || line.length === 0) return Infinity;
  const refLat = point[0];
  const [px, py] = toXY(point, refLat);
  if (line.length === 1) {
    const [x, y] = toXY(line[0], refLat);
    return Math.hypot(px - x, py - y);
  }
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = toXY(line[i - 1], refLat);
    const [bx, by] = toXY(line[i], refLat);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/* Points every ~stepM metres along a polyline (end points included). */
export function samplePolyline(line, stepM = SAMPLE_STEP_METERS) {
  const pts = (line || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.round(segmentLength(a, b, a[0]) / stepM));
    for (let k = 1; k <= n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

export function polylineLengthMeters(line) {
  let total = 0;
  for (let i = 1; i < (line || []).length; i += 1) total += segmentLength(line[i - 1], line[i], line[i - 1][0]);
  return total;
}

/**
 * Existing projects the new route runs on top of, most overlap first.
 * projects: [{ id, name, line: [[lat, lng], ...] }]
 * Returns [{ id, name, overlapMeters, share }] where share is the fraction of
 * the new route that lies on that project's road. Also returns `segments`:
 * the overlapping stretches of the new route, for drawing them on the map.
 */
export function findRouteOverlaps(route, projects = []) {
  const samples = samplePolyline(route);
  if (samples.length < 2) return { overlaps: [], segments: [] };
  const totalMeters = polylineLengthMeters(route) || 1;
  const stepMeters = totalMeters / (samples.length - 1);
  const onAny = new Array(samples.length).fill(false);

  const overlaps = projects
    .filter((p) => Array.isArray(p.line) && p.line.length >= 2)
    .map((p) => {
      let hits = 0;
      samples.forEach((pt, i) => {
        if (distanceToLine(pt, p.line) <= OVERLAP_METERS) {
          hits += 1;
          onAny[i] = true;
        }
      });
      const overlapMeters = Math.max(0, hits - 1) * stepMeters;
      return { id: p.id, name: p.name, overlapMeters, share: Math.min(1, overlapMeters / totalMeters) };
    })
    .filter((o) => o.overlapMeters >= MIN_OVERLAP_METERS)
    .sort((a, b) => b.overlapMeters - a.overlapMeters);

  // Continuous runs of overlapping samples, as polylines.
  const segments = [];
  let run = [];
  samples.forEach((pt, i) => {
    if (onAny[i]) run.push(pt);
    else {
      if (run.length >= 2) segments.push(run);
      run = [];
    }
  });
  if (run.length >= 2) segments.push(run);

  return { overlaps, segments: overlaps.length ? segments : [] };
}
