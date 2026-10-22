/* The road a priority task is about, on a map: the line (a gap dashed red, a
 * project in its status color) with its start (S) and end (E), and in-map
 * directions from where the engineer or contractor is standing to the nearest
 * point of the road (the same guide as the citizen's "nearest FMR road"). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLinkIcon, NavigationIcon, XIcon } from 'lucide-react';
import { boundsFromPoints, getRouteStatusTheme } from '../../lib/mapRouteUtils';
import { useBasemap } from '../../lib/basemaps';
import { useNearestRoads, useRoadGuide } from '../../lib/useNearestRoads';
import { formatEta } from '../../lib/inMapNavigation';
import { geoErrorMessage } from '../../lib/onSiteLocation';
import { formatDistance } from '../publicReports/routeGeometry';
import BaseTiles from '../map/BaseTiles';
import { RoadGuideLayer } from '../map/NearestRoads';
import { GAP_PATH_OPTIONS, routeEndIcon, routeStartIcon } from '../map/routeMarkerIcons';
import { BasemapSwitch, ControlGroup, MapControlPanel } from '../map/MapPanels';

function FitOnce({ points }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    const bounds = boundsFromPoints(points);
    if (!bounds) return undefined;
    // Fit once the map is actually visible: inside a collapsed section it has
    // no size yet, and fitting then would frame the road at the wrong zoom.
    const fit = () => {
      const size = map.getSize();
      if (done.current || !size.x || !size.y) return;
      done.current = true;
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
    };
    fit();
    map.on('resize', fit);
    return () => map.off('resize', fit);
  }, [map, points]);
  return null;
}

/** points: [[lat, lng]]; kind 'gap' | 'project'; status (project) for its color. */
export default function PriorityTaskMap({ points, title, kind, status }) {
  const [basemap, setBasemap] = useBasemap();
  const [me, setMe] = useState(null);
  const [navOn, setNavOn] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const watchRef = useRef(null);

  const stop = useCallback(() => {
    if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current);
    watchRef.current = null;
    setNavOn(false);
  }, []);
  useEffect(() => stop, [stop]);

  const start = () => {
    if (!navigator.geolocation) { setGeoError('Location is not available on this device.'); return; }
    setGeoError('');
    setLocating(true);
    setNavOn(true);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => { setMe([pos.coords.latitude, pos.coords.longitude]); setLocating(false); },
      (err) => { setGeoError(geoErrorMessage(err)); setLocating(false); stop(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  };

  const lines = useMemo(
    () => (points?.length >= 2 ? [{ project: { id: 'task', project_name: title, status }, points }] : []),
    [points, title, status],
  );
  const [road] = useNearestRoads(navOn ? me : null, lines, 1);
  const guide = useRoadGuide(me, navOn ? road : null);

  if (!points || points.length < 2) {
    return <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">No mapped location for this road yet.</p>;
  }
  const start0 = points[0];
  const end0 = points[points.length - 1];
  const lineStyle = kind === 'gap' ? GAP_PATH_OPTIONS : { color: getRouteStatusTheme(status).line, weight: 5, opacity: 1 };
  const target = road?.point || start0;
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${target[0]},${target[1]}&travelmode=driving`;

  return (
    <div className="space-y-2">
      <div className="relative h-60 overflow-hidden rounded-xl border border-slate-200 sm:h-72">
        <MapContainer center={start0} zoom={15} className="h-full w-full z-0" scrollWheelZoom={false}>
          <BaseTiles basemap={basemap} />
          <FitOnce points={points} />
          <Polyline positions={points} interactive={false} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
          <Polyline positions={points} pathOptions={lineStyle}>
            <Tooltip sticky>{title}</Tooltip>
          </Polyline>
          <Marker position={start0} icon={routeStartIcon}><Tooltip direction="top">Start of the road</Tooltip></Marker>
          <Marker position={end0} icon={routeEndIcon}><Tooltip direction="top">End of the road</Tooltip></Marker>
          {navOn && road && <RoadGuideLayer road={road} guide={guide} />}
          {me && (
            <CircleMarker center={me} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }}>
              <Tooltip>You are here</Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
        <MapControlPanel compact defaultOpen={false}>
          <ControlGroup label="Basemap">
            <BasemapSwitch value={basemap} onChange={setBasemap} />
          </ControlGroup>
        </MapControlPanel>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {navOn ? (
          <button type="button" onClick={stop} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">
            <XIcon className="size-3.5" aria-hidden="true" /> Stop directions
          </button>
        ) : (
          <button type="button" onClick={start} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700">
            <NavigationIcon className="size-3.5" aria-hidden="true" /> Directions to this road
          </button>
        )}
        <span className="text-slate-600" aria-live="polite">
          {locating && 'Finding your location…'}
          {!locating && navOn && guide?.status === 'loading' && 'Finding the way by road…'}
          {!locating && navOn && guide?.status === 'ready' && `About ${formatDistance(guide.distanceM)} by road, ${formatEta(guide.durationS)} by car. Follow the blue line.`}
          {!locating && navOn && guide?.status === 'straight' && road && `${formatDistance(road.distance)} away (straight line). No road route right now.`}
        </span>
        <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 hover:underline">
          <ExternalLinkIcon className="size-3" aria-hidden="true" /> Google Maps
        </a>
      </div>
      {geoError && <p role="alert" className="text-xs text-rose-600">{geoError}</p>}
    </div>
  );
}
