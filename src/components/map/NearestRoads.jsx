/* "Find the nearest FMR road to me", shared by the citizen dashboard map and
 * the full geospatial map: the closest roads to the citizen, and a guide that
 * follows the actual streets to the one they pick (OSRM car router, the same
 * one used for in-map navigation), falling back to a dashed straight line. */
import { useEffect, useRef } from 'react';
import { CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet';
import { ChevronRightIcon, RouteIcon } from 'lucide-react';
import { boundsFromPoints, getRouteStatusTheme, normalizeRouteStatus } from '../../lib/mapRouteUtils';
import { formatEta } from '../../lib/inMapNavigation';
import { formatDistance } from '../publicReports/routeGeometry';
import { LegendDot, LegendGroup, LegendLine } from './MapPanels';

const ROAD_LEGEND_COLOR = { Completed: 'bg-emerald-500', 'On-Going': 'bg-amber-500', Proposed: 'bg-blue-500' };

/** Legend for RoadGuideLayer: what the highlighted road, the blue route and its dots mean. */
export function RoadGuideLegend({ road, guide }) {
  if (!road) return null;
  const ready = guide?.status === 'ready' ? guide : null;
  return (
    <LegendGroup label="Directions">
      <LegendLine color={ROAD_LEGEND_COLOR[normalizeRouteStatus(road.project.status)] || 'bg-slate-500'} label="Road you are going to" />
      {ready
        ? <LegendLine color="bg-blue-600" label="Route by road from you" />
        : <LegendLine color="border-blue-600" dashed label="Straight line (route loading)" />}
      {ready && (ready.startGap || ready.endGap) && <LegendLine color="border-blue-600" dashed label="Short walk off the street" />}
      {ready && <LegendDot color="bg-blue-600" label="Where you reach the road" />}
    </LegendGroup>
  );
}

/** Map layers for the picked road: the road itself highlighted, and the guide to it. */
export function RoadGuideLayer({ road, guide, onRoadClick }) {
  const map = useMap();
  const framed = useRef(null);
  const ready = guide?.status === 'ready' ? guide : null;

  // Bring the trip into view: the citizen and the road's closest point right
  // away, then the whole street route and road once it arrives.
  useEffect(() => {
    if (!road || !guide || framed.current === guide) return;
    framed.current = guide;
    const points = ready ? [guide.from, ...ready.points, ready.entry] : [guide.from, guide.entry];
    const bounds = boundsFromPoints(points);
    if (bounds) map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 17, duration: 1 });
  }, [map, road, guide, ready]);

  if (!road) return null;
  const color = getRouteStatusTheme(road.project.status).line;
  return (
    <>
      <Polyline positions={road.points} interactive={false} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
      <Polyline
        positions={road.points}
        pathOptions={{ color, weight: 5, opacity: 1 }}
        eventHandlers={onRoadClick ? { click: () => onRoadClick(road.project) } : undefined}
      >
        <Tooltip sticky>{road.project.project_name}</Tooltip>
      </Polyline>
      {ready && (
        <>
          <Polyline positions={ready.points} interactive={false} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }} />
          <Polyline positions={ready.points} interactive={false} pathOptions={{ color: '#2563eb', weight: 5, opacity: 1, lineJoin: 'round', lineCap: 'round' }} />
          {/* Short stretches off the street (to where you stand, onto the road) */}
          {ready.startGap && <Polyline positions={ready.startGap} interactive={false} pathOptions={{ color: '#2563eb', weight: 3, dashArray: '2 7', lineCap: 'round' }} />}
          {ready.endGap && <Polyline positions={ready.endGap} interactive={false} pathOptions={{ color: '#2563eb', weight: 3, dashArray: '2 7', lineCap: 'round' }} />}
          <CircleMarker center={ready.entry} radius={6} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }}>
            <Tooltip>Where you reach {road.project.project_name}</Tooltip>
          </CircleMarker>
        </>
      )}
      {guide && !ready && (
        <Polyline positions={[guide.from, guide.entry]} interactive={false} pathOptions={{ color: '#2563eb', weight: 2, dashArray: '5 6' }} />
      )}
    </>
  );
}

/** One line about the guide to the picked road, under the list. */
function GuideNote({ road, guide }) {
  if (!road || !guide) return null;
  if (guide.status === 'loading') return <p className="text-[11px] text-slate-500">Finding the way by road…</p>;
  if (guide.status === 'ready') {
    return (
      <p className="text-[11px] text-teal-800">
        About <strong>{formatDistance(guide.distanceM)}</strong> by road ({formatEta(guide.durationS)} by car) to <strong>{road.project.project_name}</strong>.
      </p>
    );
  }
  return <p className="text-[11px] text-slate-500">No road route right now. The dashed line shows the straight-line direction.</p>;
}

/** The list of nearest roads. Clicking a row picks it; the arrow opens its details. */
export function NearestRoadsList({ roads, focusedId, onFocus, onDetails, guide, focusedRoad, emptyText = 'No FMR road with a mapped route was found yet.' }) {
  if (roads.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {roads.map((road, i) => {
          const focused = road.project.id === focusedId;
          return (
            <li key={road.project.id} className={`flex items-stretch overflow-hidden rounded-lg border bg-white ${focused ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-slate-200'}`}>
              <button
                type="button"
                onClick={() => onFocus(road)}
                title="Show the way on the map"
                className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: getRouteStatusTheme(road.project.status).line }}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-slate-800">{road.project.project_name}</span>
                  <span className="block text-[11px] text-slate-500">
                    {formatDistance(road.distance)} away · {normalizeRouteStatus(road.project.status)}{road.project.municipality ? ` · ${road.project.municipality}` : ''}
                  </span>
                </span>
              </button>
              {onDetails && (
                <button
                  type="button"
                  onClick={() => onDetails(road.project)}
                  aria-label={`View details of ${road.project.project_name}`}
                  title="View details"
                  className="border-l border-slate-100 px-2 text-slate-400 hover:bg-slate-50 hover:text-emerald-700"
                >
                  <ChevronRightIcon className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <GuideNote road={focusedRoad} guide={guide} />
    </div>
  );
}

export function NearestRoadsHeading({ action = null }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <RouteIcon className="size-4 text-emerald-700" aria-hidden="true" /> Nearest FMR roads
      </p>
      {action}
    </div>
  );
}
