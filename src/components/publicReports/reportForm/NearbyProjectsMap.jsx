/* The first thing a reporter sees after tapping Report: where they are, and
 * the FMR roads around them. Nearby roads are drawn in their status color with
 * the same number as their card in the list below; every other road is drawn
 * faintly for context. Tapping any road picks it (same as tapping its card). */
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { boundsFromPoints, getRouteStatusTheme } from '../../../lib/mapRouteUtils';
import { useBasemap } from '../../../lib/basemaps';
import { formatDistance } from '../routeGeometry';
import BaseTiles from '../../map/BaseTiles';
import { BasemapSwitch, ControlGroup, MapControlPanel } from '../../map/MapPanels';

function numberIcon(n, color) {
  return L.divIcon({
    className: 'kt-nearby-number',
    html: `<div style="background:${color};color:#fff;width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font:700 11px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3)">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/* Frame the reporter and the nearby roads once (and again when the set changes). */
function FitNearby({ me, roads }) {
  const map = useMap();
  const key = `${roads.map((r) => r.project.id).join(',')}`;
  const last = useRef(null);
  useEffect(() => {
    if (!me || last.current === key) return;
    last.current = key;
    const bounds = boundsFromPoints([me, ...roads.flatMap((r) => [r.points[0], r.point, r.points[r.points.length - 1]]).filter(Boolean)]);
    if (roads.length && bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
    else map.setView(me, 16);
  }, [map, me, roads, key]);
  return null;
}

/**
 * gps: { lat, lng, accuracy }; lines: [{ project, points }] (every drawable road);
 * nearbyRoads: [{ project, points, distance, point }] nearest first; onPick(project).
 */
export default function NearbyProjectsMap({ gps, lines, nearbyRoads, onPick }) {
  const [basemap, setBasemap] = useBasemap();
  const me = useMemo(() => (gps ? [gps.lat, gps.lng] : null), [gps]);
  const nearbyIds = useMemo(() => new Set(nearbyRoads.map((r) => r.project.id)), [nearbyRoads]);
  // Only roads within view distance are drawn faintly; the whole province is noise here.
  const context = useMemo(() => {
    if (!me) return [];
    const box = 0.05; // ~5 km around the reporter
    return lines.filter(({ project, points }) => !nearbyIds.has(project.id)
      && points.some(([lat, lng]) => Math.abs(lat - me[0]) < box && Math.abs(lng - me[1]) < box));
  }, [lines, me, nearbyIds]);

  if (!me) return null;

  return (
    <div className="relative h-64 overflow-hidden rounded-2xl border border-slate-200 sm:h-72">
      <MapContainer center={me} zoom={16} className="z-0 h-full w-full">
        <BaseTiles basemap={basemap} />
        <FitNearby me={me} roads={nearbyRoads} />
        {context.map(({ project, points }) => (
          <Polyline
            key={`ctx-${project.id}`}
            positions={points}
            pathOptions={{ color: getRouteStatusTheme(project.status).line, weight: 3, opacity: 0.35 }}
            eventHandlers={{ click: () => onPick(project) }}
          >
            <Tooltip sticky>{project.project_name}</Tooltip>
          </Polyline>
        ))}
        {nearbyRoads.map((road, i) => {
          const color = getRouteStatusTheme(road.project.status).line;
          return (
            <Fragment key={road.project.id}>
              <Polyline positions={road.points} interactive={false} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
              <Polyline positions={road.points} pathOptions={{ color, weight: 5, opacity: 1 }} eventHandlers={{ click: () => onPick(road.project) }}>
                <Tooltip sticky>{road.project.project_name} · {formatDistance(road.distance)} away</Tooltip>
              </Polyline>
              {road.point && (
                <Marker position={road.point} icon={numberIcon(i + 1, color)} eventHandlers={{ click: () => onPick(road.project) }}>
                  <Tooltip direction="top">{road.project.project_name}</Tooltip>
                </Marker>
              )}
            </Fragment>
          );
        })}
        {Number.isFinite(gps.accuracy) && gps.accuracy > 15 && (
          <Circle center={me} radius={gps.accuracy} interactive={false} pathOptions={{ color: '#2563eb', weight: 1, opacity: 0.4, fillOpacity: 0.08 }} />
        )}
        <CircleMarker center={me} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}>
          <Tooltip direction="top">You are here</Tooltip>
        </CircleMarker>
      </MapContainer>
      <MapControlPanel compact defaultOpen={false}>
        <ControlGroup label="Basemap">
          <BasemapSwitch value={basemap} onChange={setBasemap} />
        </ControlGroup>
      </MapControlPanel>
    </div>
  );
}
