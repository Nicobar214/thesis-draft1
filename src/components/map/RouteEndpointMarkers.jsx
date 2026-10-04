import { Marker, Tooltip } from 'react-leaflet';

import {
  polylineMidpointWithBearing,
  calculatePolylineDistanceKm,
  getProjectBarangay,
} from '../../lib/mapRouteUtils';
import useMapZoom from './useMapZoom';
import {
  routeStartIcon,
  routeEndIcon,
  routeStartDotIcon,
  routeEndDotIcon,
  directionArrowIcon,
} from './routeMarkerIcons';

/** Zoom at or above which endpoint pins carry their S/E labels. */
const LABEL_ZOOM = 13;

/**
 * Start and end markers for one project route, plus a mid-route direction arrow.
 *
 * Replaces seven divergent inline implementations. Two things it does that none of
 * them did:
 *
 *  - Labels the ends "S" and "E", so which way the road runs is readable rather
 *    than inferred from two same-sized coloured dots.
 *  - Drops the labels back to small dots below zoom 13 unless the route is
 *    focused. Leon alone has ~149 routes; 300 labelled pins at municipal zoom
 *    would bury the map and make the change a regression. The direction arrow
 *    stays on the line at every zoom, so heading is never lost.
 */
export default function RouteEndpointMarkers({
  project,
  routeData,
  displayPoints = null,
  isFocused = false,
  lineColor = '#0f766e',
  showArrow = true,
  eventHandlers = undefined,
}) {
  const zoom = useMapZoom();

  const startPoint = routeData?.startPoint;
  const endPoint = routeData?.endPoint;
  if (!startPoint && !endPoint) return null;

  const labelled = isFocused || zoom >= LABEL_ZOOM;
  const points = displayPoints?.length >= 2 ? displayPoints : routeData?.points;
  const hasLine = Array.isArray(points) && points.length >= 2;

  // Prefer the stored declared length; fall back to measuring the drawn polyline.
  const declaredKm = Number(
    routeData?.declaredLengthKm ?? project?.project_length_km ?? project?.length_km
  );
  const lengthKm = Number.isFinite(declaredKm) && declaredKm > 0
    ? declaredKm
    : hasLine ? calculatePolylineDistanceKm(points) : null;

  const startBarangay = project?.barangay || getProjectBarangay(project);
  const endBarangay = project?.barangay_end || null;

  const midpoint = showArrow && hasLine ? polylineMidpointWithBearing(points) : null;

  return (
    <>
      {startPoint && (
        <Marker
          position={startPoint}
          icon={labelled ? routeStartIcon : routeStartDotIcon}
          eventHandlers={eventHandlers}
          zIndexOffset={400}
        >
          <Tooltip direction="top" offset={[0, -4]}>
            <span className="text-[11px]">
              <strong>Start</strong>
              {startBarangay && startBarangay !== 'N/A' ? ` — Brgy. ${startBarangay}` : ''}
            </span>
          </Tooltip>
        </Marker>
      )}

      {midpoint && (
        <Marker
          position={midpoint.point}
          icon={directionArrowIcon(midpoint.bearing, lineColor)}
          interactive={false}
          keyboard={false}
          zIndexOffset={200}
        />
      )}

      {endPoint && (
        <Marker
          position={endPoint}
          icon={labelled ? routeEndIcon : routeEndDotIcon}
          eventHandlers={eventHandlers}
          zIndexOffset={400}
        >
          <Tooltip direction="top" offset={[0, -4]}>
            <span className="text-[11px]">
              <strong>End</strong>
              {endBarangay ? ` — Brgy. ${endBarangay}` : ''}
              {Number.isFinite(lengthKm) && lengthKm > 0 ? ` · ${lengthKm.toFixed(2)} km` : ''}
            </span>
          </Tooltip>
        </Marker>
      )}
    </>
  );
}
