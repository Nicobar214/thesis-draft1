/* Most FMR projects (about half) have no mapped route, only a start and an end
 * pin, so their "road" is a straight line between the two. The real road
 * curves away from that line, typically by 90-190 m and in places by 400 m, so
 * someone standing on the road could be told it is 300 m away.
 *
 * This replaces those straight lines, for the roads nearest the user, with the
 * road itself as the road router (OSRM) follows it between the two pins
 * (fetchRoadAlignedPolyline: cached, joined to the pins, falls back to the
 * straight line). Projects with a mapped route are left exactly as they are,
 * and nothing is saved.
 *
 *   const lines = useRoadAlignedLines(allLines, me);  // [{ project, points, aligned? }] */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRoadAlignedPolyline, nearestPointOnPolyline } from './mapRouteUtils';

export const ALIGN_WITHIN_M = 3000; // only straight-line roads this close (to their line) are aligned
export const ALIGN_MAX = 12;        // at most this many per position, nearest first
const BATCH = 4;                     // OSRM requests in flight at once

/** A road known only by its two end pins. */
export const isStraightLine = (points) => Array.isArray(points) && points.length <= 2;

/** Ids of the straight-line roads worth aligning for `me`, nearest first. */
export function roadsToAlign(lines, me, { withinM = ALIGN_WITHIN_M, max = ALIGN_MAX } = {}) {
  if (!me) return [];
  return (lines || [])
    // pinsOnly: the pins are wrong (much further apart than the road), so the
    // road between them is not worth asking a router for.
    .filter((l) => isStraightLine(l.points) && !l.pinsOnly)
    .map((l) => ({ id: l.project.id, d: nearestPointOnPolyline(me, l.points)?.distanceMeters ?? Infinity }))
    .filter((x) => x.d <= withinM)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.id);
}

export function useRoadAlignedLines(lines, me, options) {
  const [alignedById, setAlignedById] = useState({});
  const requested = useRef(new Set());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const wanted = useMemo(() => roadsToAlign(lines, me, options), [lines, me, options]);
  const wantedKey = wanted.join(',');

  useEffect(() => {
    const byId = new Map((lines || []).map((l) => [l.project.id, l.points]));
    const todo = wanted.filter((id) => !requested.current.has(id) && byId.has(id));
    if (todo.length === 0) return undefined;
    todo.forEach((id) => requested.current.add(id));
    // Runs to the end even if the wanted set changes meanwhile (a GPS update);
    // only unmounting stops it.
    (async () => {
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async (id) => {
          const original = byId.get(id);
          const road = await fetchRoadAlignedPolyline(original, { smooth: false, alongLine: true });
          return [id, road !== original && road.length > 2 ? road : null];
        }));
        if (!alive.current) return;
        // A failed request is forgotten so it is tried again later.
        results.forEach(([id, road]) => { if (!road) requested.current.delete(id); });
        const found = results.filter(([, road]) => road);
        if (found.length) setAlignedById((prev) => ({ ...prev, ...Object.fromEntries(found) }));
      }
    })();
    return undefined;
    // `wantedKey` stands for `wanted`; `lines` only supplies the points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  return useMemo(() => (lines || []).map((l) => (
    alignedById[l.project.id] && isStraightLine(l.points)
      ? { ...l, points: alignedById[l.project.id], aligned: true }
      : l
  )), [lines, alignedById]);
}

export default useRoadAlignedLines;
