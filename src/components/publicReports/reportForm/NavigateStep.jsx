/* After picking a road: directions to it on the map, from the reporter's live
 * position. When they reach the road (ARRIVAL_M, see reportSubmission.js) the
 * report opens by itself; "Report now" is locked until then, so a report can
 * only be made at the road. The guide is the same street-following one as the
 * dashboard's "nearest FMR road" (useRoadGuide + RoadGuideLayer). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { CheckCircle2Icon, ClipboardPenIcon, LockIcon, NavigationIcon } from 'lucide-react';
import { boundsFromPoints } from '../../../lib/mapRouteUtils';
import { useBasemap } from '../../../lib/basemaps';
import { useNearestRoads, useRoadGuide } from '../../../lib/useNearestRoads';
import { formatEta } from '../../../lib/inMapNavigation';
import { ARRIVAL_M, canReportFrom, distanceToLine, hasArrived } from '../../../lib/reportSubmission';
import { formatDistance, haversineMeters } from '../routeGeometry';
import BaseTiles from '../../map/BaseTiles';
import { RoadGuideLayer } from '../../map/NearestRoads';
import { routeEndIcon, routeStartIcon } from '../../map/routeMarkerIcons';
import { BasemapSwitch, ControlGroup, MapControlPanel } from '../../map/MapPanels';

const REROUTE_M = 300;     // moved this far from where the directions started: route again
const AUTO_OPEN_MS = 1500; // how long "You've arrived" shows before the report opens

function FitFirst({ points }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const bounds = boundsFromPoints(points);
    if (!bounds) return;
    done.current = true;
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  }, [map, points]);
  return null;
}

export default function NavigateStep({ gps, project, points, onReportNow, onBack }) {
  const [basemap, setBasemap] = useBasemap();
  const me = useMemo(() => (gps ? [gps.lat, gps.lng] : null), [gps]);

  // Directions start from where the reporter was when they picked the road and
  // are fetched again only after they have moved REROUTE_M, not on every GPS tick.
  const [origin, setOrigin] = useState(me);
  useEffect(() => {
    if (!me) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-anchors the route after a real move
    if (!origin || haversineMeters(origin, me) > REROUTE_M) setOrigin(me);
  }, [me, origin]);

  const lines = useMemo(() => [{ project, points }], [project, points]);
  const [road] = useNearestRoads(origin, lines, 1);
  const guide = useRoadGuide(origin, road || null);

  const distance = distanceToLine(gps, points);
  const arrived = hasArrived(distance, gps?.accuracy);
  // Same as `arrived`, except while the testing limit is on (reportSubmission.js).
  const canReport = canReportFrom(distance, gps?.accuracy);

  // Open the report once they arrive, unless they chose to stay on the map.
  const [stay, setStay] = useState(false);
  useEffect(() => {
    if (!arrived || stay) return undefined;
    const timer = setTimeout(onReportNow, AUTO_OPEN_MS);
    return () => clearTimeout(timer);
  }, [arrived, stay, onReportNow]);

  const start = points[0];
  const end = points[points.length - 1];
  const firstView = useMemo(() => (me ? [me, ...points] : points), [me, points]);

  return (
    <div className="report-step-in space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Pick another road
      </button>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Go to the road</p>
        <h3 className="mt-0.5 text-base font-semibold text-slate-900">{project.project_name}</h3>
        {project.municipality && <p className="text-xs text-slate-500">{project.municipality}</p>}
      </div>

      {/* Where they stand vs the road */}
      {arrived ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">You&apos;re at this road.</p>
            <p className="text-xs text-emerald-800">{stay ? 'Tap "Report now" when you are ready.' : 'Opening the report…'}</p>
          </div>
          {!stay && (
            <button type="button" onClick={() => setStay(true)} className="shrink-0 text-xs font-semibold text-emerald-800 underline underline-offset-2">
              Stay on map
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900" aria-live="polite">
          <NavigationIcon className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden="true" />
          <span>
            {!gps && 'Waiting for your location…'}
            {gps && (!guide || guide.status === 'loading') && `${formatDistance(distance)} away. Finding the way by road…`}
            {gps && guide?.status === 'ready' && <>About <strong>{formatDistance(guide.distanceM)}</strong> by road ({formatEta(guide.durationS)} by car). Follow the blue line; the report opens when you get there.</>}
            {gps && guide?.status === 'straight' && `${formatDistance(distance)} away in a straight line. No road route right now; the dashed line shows the direction.`}
          </span>
        </div>
      )}

      <div className="relative h-72 overflow-hidden rounded-2xl border border-slate-200 sm:h-80">
        <MapContainer center={me || start} zoom={15} className="z-0 h-full w-full">
          <BaseTiles basemap={basemap} />
          <FitFirst points={firstView} />
          {road && <RoadGuideLayer road={road} guide={guide} />}
          <Marker position={start} icon={routeStartIcon}><Tooltip direction="top">Start of the road</Tooltip></Marker>
          <Marker position={end} icon={routeEndIcon}><Tooltip direction="top">End of the road</Tooltip></Marker>
          {me && Number.isFinite(gps.accuracy) && gps.accuracy > 15 && (
            <Circle center={me} radius={gps.accuracy} interactive={false} pathOptions={{ color: '#2563eb', weight: 1, opacity: 0.4, fillOpacity: 0.08 }} />
          )}
          {me && (
            <CircleMarker center={me} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}>
              <Tooltip direction="top">You are here</Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
        <MapControlPanel compact defaultOpen={false}>
          <ControlGroup label="Basemap">
            <BasemapSwitch value={basemap} onChange={setBasemap} />
          </ControlGroup>
        </MapControlPanel>
      </div>

      <button
        type="button"
        onClick={onReportNow}
        disabled={!canReport}
        aria-describedby="report-now-rule"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
      >
        {canReport ? <ClipboardPenIcon className="size-4" aria-hidden="true" /> : <LockIcon className="size-4" aria-hidden="true" />}
        {canReport ? 'Report now' : 'Report opens at the road'}
      </button>
      <p id="report-now-rule" className="text-center text-[11px] text-slate-500">
        {arrived && 'Your location is checked again when you send the report.'}
        {!arrived && canReport && `Testing mode: reporting from ${formatDistance(distance)} away is allowed for now.`}
        {!canReport && `Reports can only be sent from the road itself (within ${ARRIVAL_M} m). ${gps ? `You are about ${formatDistance(distance)} away.` : 'Waiting for your location.'}`}
      </p>
    </div>
  );
}
