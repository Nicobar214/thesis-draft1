import L from 'leaflet';

// Shared Leaflet marker icons for route endpoints, direction arrows and road gaps.
//
// Seven places previously defined their own start/end markers inline, and they had
// drifted apart: UserMapView and Dashboard used a 4px CircleMarker for the start
// but a 10px divIcon for the end, LguProposalsTab used 14px, LguRouteMap 10px, and
// LguDashboard rebuilt its icons inside the render body on every pass. None of
// them said which end was which -- two coloured dots of the same size read as
// "something here", not "the road runs this way".
//
// Colours keep the existing language (green = start, orange = end) so the change
// is legibility, not relearning.

export const ROUTE_START_COLOR = '#16a34a';
export const ROUTE_END_COLOR = '#f97316';
export const GAP_COLOR = '#ef4444';

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * Labelled teardrop pin. The letter is what makes start and end unambiguous at a
 * glance, which two same-sized dots never were.
 */
function labelledPin({ letter, fill, className }) {
  return new L.DivIcon({
    className,
    html: `<svg width="22" height="28" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M11 27C11 27 20 16.6 20 10.4A9 9 0 1 0 2 10.4C2 16.6 11 27 11 27Z"
        fill="${fill}" stroke="#ffffff" stroke-width="2.2"
        style="filter:drop-shadow(0 1px 2px rgba(15,23,42,.45))"/>
  <text x="11" y="14.2" text-anchor="middle" font-family="${FONT}"
        font-size="10.5" font-weight="700" fill="#ffffff">${letter}</text>
</svg>`,
    iconSize: [22, 28],
    // Anchor at the tip, so the pin points at the coordinate rather than covering it.
    iconAnchor: [11, 27],
    tooltipAnchor: [11, -14],
  });
}

export const routeStartIcon = labelledPin({
  letter: 'S', fill: ROUTE_START_COLOR, className: 'kt-route-start',
});

export const routeEndIcon = labelledPin({
  letter: 'E', fill: ROUTE_END_COLOR, className: 'kt-route-end',
});

/**
 * Small unlabelled dots, for dense views where ~300 labelled pins would bury the
 * map. Same colours, so the meaning carries over from the zoomed-in view.
 */
function smallDot(fill, className) {
  return new L.DivIcon({
    className,
    html: `<div style="background:${fill};width:9px;height:9px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 2px rgba(15,23,42,.4)"></div>`,
    iconSize: [9, 9],
    iconAnchor: [4.5, 4.5],
    tooltipAnchor: [0, -8],
  });
}

export const routeStartDotIcon = smallDot(ROUTE_START_COLOR, 'kt-route-start-dot');
export const routeEndDotIcon = smallDot(ROUTE_END_COLOR, 'kt-route-end-dot');

/**
 * Hollow dashed ring for a project pinned at a municipal centroid because it has
 * no geometry. Visually distinct from a real endpoint on purpose: LguRouteMap used
 * the green START icon for this, so "we don't know where this is" looked exactly
 * like "the road starts here".
 */
export const centroidFallbackIcon = new L.DivIcon({
  className: 'kt-centroid-fallback',
  html: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="8" cy="8" r="6" fill="rgba(255,255,255,.75)" stroke="#64748b"
          stroke-width="1.8" stroke-dasharray="3 2.5"/>
</svg>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  tooltipAnchor: [0, -10],
});

/**
 * Chevron rotated to the local heading, placed mid-route. This is what shows the
 * direction of travel when the endpoint pins are hidden at low zoom.
 */
export function directionArrowIcon(bearingDeg, color = '#0f766e') {
  const rotation = Number.isFinite(bearingDeg) ? bearingDeg : 0;
  return new L.DivIcon({
    className: 'kt-route-arrow',
    // SVG points north; Leaflet gives no rotation, so rotate the wrapper. The
    // bearing is compass degrees, which matches a clockwise CSS rotation.
    html: `<div style="transform:rotate(${rotation}deg);transform-origin:50% 50%;line-height:0">
  <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M7 1.5 L11.4 11.2 L7 8.9 L2.6 11.2 Z"
          fill="${color}" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"/>
  </svg>
</div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    tooltipAnchor: [0, -10],
  });
}

/** Square endcap marking where an unpaved gap begins and ends. */
export const gapEndcapIcon = new L.DivIcon({
  className: 'kt-gap-endcap',
  html: `<div style="background:${GAP_COLOR};width:8px;height:8px;border:1.6px solid #fff;box-shadow:0 1px 2px rgba(15,23,42,.4)"></div>`,
  iconSize: [8, 8],
  iconAnchor: [4, 4],
  tooltipAnchor: [0, -8],
});

/** Dashed red line style for gap polylines. */
export const GAP_PATH_OPTIONS = {
  color: GAP_COLOR,
  weight: 4,
  dashArray: '7 7',
  opacity: 0.9,
  lineCap: 'butt',
};
