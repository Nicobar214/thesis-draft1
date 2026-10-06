// Shared by StableHeatLayer and the report time-lapse so both measure density on
// the same ground grid. Keep these in step with the radius the layer is given.
export const HEAT_RADIUS_M = 1200;
export const HEAT_BLUR_RATIO = 0.6;

const M_PER_DEG = 111320;

/**
 * Heaviest ground cell in a set of [lat, lng, weight?] points. Cells are the same
 * size leaflet.heat aggregates on: (radius + blur) / 2, i.e. radiusMeters x
 * (1 + blurRatio) / 2 on the ground.
 */
export function cellPeak(points, radiusMeters = HEAT_RADIUS_M, blurRatio = HEAT_BLUR_RATIO) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const cellMeters = (radiusMeters * (1 + blurRatio)) / 2;
  const meanLat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const lngScale = M_PER_DEG * Math.cos((meanLat * Math.PI) / 180);
  const sums = new Map();
  let peak = 0;
  for (const p of points) {
    const key = `${Math.floor((p[1] * lngScale) / cellMeters)}:${Math.floor((p[0] * M_PER_DEG) / cellMeters)}`;
    const next = (sums.get(key) || 0) + (p[2] ?? 1);
    sums.set(key, next);
    if (next > peak) peak = next;
  }
  return peak;
}
