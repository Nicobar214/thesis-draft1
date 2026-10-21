/* Hooks behind "Find the nearest FMR road to me" (components/map/NearestRoads.jsx). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchBestEntryIndex, fetchDrivingRoute } from './inMapNavigation';
import { haversineMeters, nearestPointOnRoute } from '../components/publicReports/routeGeometry';

export const NEAREST_COUNT = 4;
const ENTRY_SPACING_M = 100; // candidate entry points along the road, this far apart
const ENTRY_CANDIDATES = 8; // how many of them are checked by street distance
const GAP_M = 15; // an off-street stretch shorter than this is not drawn

/**
 * Places where someone could join the road: points every ENTRY_SPACING_M along
 * it (and its two ends), keeping the ENTRY_CANDIDATES closest to `me` in a
 * straight line, always including the straight-line nearest point.
 */
export function entryCandidates(points, nearest, me, max = ENTRY_CANDIDATES) {
  const samples = [points[0]];
  let sinceLast = 0;
  for (let i = 1; i < points.length; i += 1) {
    sinceLast += haversineMeters(points[i - 1], points[i]);
    if (sinceLast >= ENTRY_SPACING_M) { samples.push(points[i]); sinceLast = 0; }
  }
  samples.push(points[points.length - 1]);
  const ranked = samples
    .map((p) => ({ p, d: haversineMeters(me, p) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.p);
  const out = [nearest];
  for (const p of ranked) {
    if (out.length >= max) break;
    if (out.every((q) => haversineMeters(p, q) > ENTRY_SPACING_M / 2)) out.push(p);
  }
  return out;
}

/** lines: [{ project, points }]; me: [lat, lng]. Nearest first, with the closest point on each road. */
export function useNearestRoads(me, lines, count = NEAREST_COUNT) {
  return useMemo(() => {
    if (!me) return [];
    return lines
      .map(({ project, points }) => {
        const hit = nearestPointOnRoute(points, me);
        return hit ? { project, points, distance: hit.distanceMeters, point: hit.nearestPoint } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
  }, [me, lines, count]);
}

/**
 * The street route from the citizen to the picked road, fetched once per road
 * (from where the citizen was when they picked it), not on every GPS update.
 * It joins the road where it is really closest by street, not where it is
 * closest in a straight line. Returns
 * { from, entry, points, startGap, endGap, distanceM, durationS, status } or null,
 * status 'loading' | 'ready' | 'straight'; the gaps are short off-street
 * stretches at either end (null when under GAP_M).
 */
export function useRoadGuide(me, road) {
  const [guide, setGuide] = useState(null);
  const meRef = useRef(me);
  useEffect(() => { meRef.current = me; }, [me]);
  const roadId = road?.project.id ?? null;
  const roadPoints = road?.points;
  const nearest = road?.point;

  useEffect(() => {
    const from = meRef.current;
    if (roadId == null || !from || !nearest || !roadPoints) return undefined;
    let cancelled = false;
    const ctrl = new AbortController();
    setGuide({ roadId, from, entry: nearest, points: null, status: 'loading' });
    // A router that does not answer in time is treated like no route at all.
    const timer = setTimeout(() => ctrl.abort(), 15000);
    (async () => {
      const candidates = entryCandidates(roadPoints, nearest, from);
      let entry = nearest;
      try {
        entry = candidates[await fetchBestEntryIndex(from, candidates, { signal: ctrl.signal })] || nearest;
      } catch (err) {
        if (ctrl.signal.aborted) throw err;
        // No table answer: still try the straight-line nearest point.
      }
      const route = await fetchDrivingRoute(from, entry, { signal: ctrl.signal });
      const first = route.points[0];
      const last = route.points[route.points.length - 1];
      return {
        roadId,
        from,
        entry,
        points: route.points,
        startGap: haversineMeters(from, first) > GAP_M ? [from, first] : null,
        endGap: haversineMeters(last, entry) > GAP_M ? [last, entry] : null,
        distanceM: route.distanceM,
        durationS: route.durationS,
        status: 'ready',
      };
    })()
      .then((next) => { if (!cancelled) setGuide(next); })
      .catch(() => {
        if (!cancelled) setGuide({ roadId, from, entry: nearest, points: null, status: 'straight' });
      })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [roadId, roadPoints, nearest]);

  return guide && guide.roadId === roadId ? guide : null;
}
