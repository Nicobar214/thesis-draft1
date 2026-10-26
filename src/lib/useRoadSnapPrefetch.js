/* Makes "Snap to Road" feel instant: while a route is being set up (start, end,
 * waypoints), the road is fetched quietly in the background a moment after the
 * points stop changing. Clicking the button then reads the cached answer, or
 * joins the request already on its way (mapRouteUtils snapToRoad). Nothing is
 * changed in the form until the button is pressed.
 *
 *   useRoadSnapPrefetch(open ? [[sLat, sLng], ...waypoints, [eLat, eLng]] : null);
 *
 * Pass exactly the points (and options) the button sends, so both share one cache entry. */
import { useEffect } from 'react';
import { prefetchRoadSnap } from './mapRouteUtils';

const SETTLE_MS = 600; // wait until the user stops moving the pins
const PREFETCH_MAX_POINTS = 15;

const isRealPoint = (p) => Array.isArray(p)
  && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180
  && !(p[0] === 0 && p[1] === 0); // an empty field read as 0

// priority 'high': the user is waiting, so these go ahead of background map snapping.
export const SNAP_BUTTON_OPTIONS = { smooth: false, alongLine: true, priority: 'high' };

export function useRoadSnapPrefetch(points, options = SNAP_BUTTON_OPTIONS) {
  // Up to the 15 points one OSRM request carries: more means the route was just
  // snapped (dozens of road vertices), and re-routing it in the background would be wasted.
  const ready = Array.isArray(points) && points.length >= 2 && points.length <= PREFETCH_MAX_POINTS && points.every(isRealPoint);
  const key = ready ? points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|') : '';
  useEffect(() => {
    if (!key) return undefined;
    const timer = setTimeout(() => prefetchRoadSnap(points, options), SETTLE_MS);
    return () => clearTimeout(timer);
    // `key` stands for `points`; options are constant per caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export default useRoadSnapPrefetch;
