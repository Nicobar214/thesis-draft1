import { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { buildRoutePoints, boundsFromPoints } from '../../lib/mapRouteUtils';
import {
  formatDistance,
  nearestPointOnRoute,
  proximityBand,
  sumRouteLengthMeters,
  toPoint,
} from './routeGeometry';

const startIcon = new L.DivIcon({
  className: 'kalsatrack-route-start-marker',
  html: '<div style="background:#16a34a;color:#fff;width:26px;height:26px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.25)">S</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const endIcon = new L.DivIcon({
  className: 'kalsatrack-route-end-marker',
  html: '<div style="background:#dc2626;color:#fff;width:26px;height:26px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.25)">E</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const reportIcon = new L.DivIcon({
  className: 'kalsatrack-route-report-marker',
  html: '<div style="background:#0f766e;color:#fff;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.25)">R</div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function MapFlyController({ focusTarget, bounds }) {
  const map = useMap();
  useEffect(() => {
    if (focusTarget && Array.isArray(focusTarget) && Number.isFinite(Number(focusTarget[0])) && Number.isFinite(Number(focusTarget[1]))) {
      map.flyTo([Number(focusTarget[0]), Number(focusTarget[1])], 16, { duration: 1.2 });
    } else if (focusTarget === 'fit' && bounds) {
      map.fitBounds(bounds, { padding: [24, 24], duration: 1.2 });
    }
  }, [focusTarget, bounds, map]);
  return null;
}

export default function PublicReportRouteMapPanel({
  project,
  routeRecord,
  reportLatitude,
  reportLongitude,
  heightClass = 'h-72',
  title = 'Project Route and Report Location',
  showLegend = true,
  focusTarget = null,
  onResetFocus = null,
}) {
  const reportPoint = useMemo(() => toPoint(reportLatitude, reportLongitude), [reportLatitude, reportLongitude]);

  const routeData = useMemo(() => buildRoutePoints(project, routeRecord), [project, routeRecord]);
  const routePoints = routeData.points || [];
  const routeStart = routeData.startPoint || null;
  const routeEnd = routeData.endPoint || null;

  const nearest = useMemo(() => {
    if (!reportPoint || routePoints.length < 2) return null;
    return nearestPointOnRoute(routePoints, reportPoint);
  }, [routePoints, reportPoint]);

  const routeLengthMeters = useMemo(() => {
    const declaredKm = Number(project?.project_length_km);
    if (Number.isFinite(declaredKm) && declaredKm > 0) return declaredKm * 1000;
    return sumRouteLengthMeters(routePoints);
  }, [project, routePoints]);

  const distanceMeters = nearest?.distanceMeters;
  const band = proximityBand(distanceMeters);
  const nearKmLabel = Number.isFinite(nearest?.kmAtPoint)
    ? `Report is near KM ${nearest.kmAtPoint.toFixed(1)} of this project`
    : 'Nearest KM point unavailable';

  const mapPoints = useMemo(() => {
    const pts = [];
    routePoints.forEach((p) => pts.push(p));
    if (reportPoint) pts.push(reportPoint);
    if (nearest?.nearestPoint) pts.push(nearest.nearestPoint);
    return pts;
  }, [routePoints, reportPoint, nearest]);

  const bounds = useMemo(() => boundsFromPoints(mapPoints), [mapPoints]);
  const center = reportPoint || routeStart || [10.7, 122.56];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
            <span className={`px-2.5 py-0.5 rounded-full border font-semibold ${band.className}`}>
              {formatDistance(distanceMeters)} from route
            </span>
            <span className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-white text-slate-700 font-semibold">
              Route length: {formatDistance(routeLengthMeters)}
            </span>
            <span className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-white text-slate-700 font-semibold">
              {nearKmLabel}
            </span>
          </div>
        </div>
        {onResetFocus && (
          <button
            type="button"
            onClick={onResetFocus}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shrink-0 shadow-2xs"
          >
            🔍 Reset Full View
          </button>
        )}
      </div>

      {showLegend && (
        <div className="px-4 py-2 border-b border-slate-100 bg-white text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
          <span>Green S: Project start</span>
          <span>Red E: Project end</span>
          <span>Teal R: Citizen report GPS</span>
        </div>
      )}

      <div className={`${heightClass} w-full`}>
        <MapContainer
          center={center}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
          scrollWheelZoom={true}
          whenReady={(event) => {
            if (bounds) {
              event.target.fitBounds(bounds, { padding: [24, 24] });
            }
          }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapFlyController focusTarget={focusTarget} bounds={bounds} />

          {routePoints.length >= 2 && (
            <Polyline positions={routePoints} pathOptions={{ color: '#0f766e', weight: 5, opacity: 0.75 }} />
          )}

          {nearest?.nearestSegment && (
            <Polyline positions={nearest.nearestSegment} pathOptions={{ color: '#f59e0b', weight: 8, opacity: 0.5 }} />
          )}

          {routeStart && (
            <Marker position={routeStart} icon={startIcon}>
              <Popup>Project Start Point</Popup>
            </Marker>
          )}

          {routeEnd && (
            <Marker position={routeEnd} icon={endIcon}>
              <Popup>Project End Point</Popup>
            </Marker>
          )}

          {reportPoint && (
            <Marker position={reportPoint} icon={reportIcon}>
              <Popup>Citizen Report Location</Popup>
              <Tooltip direction="top" offset={[0, -12]} permanent>
                Report Pin
              </Tooltip>
            </Marker>
          )}

          {nearest?.nearestPoint && (
            <CircleMarker
              center={nearest.nearestPoint}
              radius={6}
              pathOptions={{ color: '#111827', fillColor: '#f8fafc', fillOpacity: 1, weight: 2 }}
            >
              <Popup>Nearest point on route line</Popup>
            </CircleMarker>
          )}

          {reportPoint && nearest?.nearestPoint && (
            <Polyline
              positions={[reportPoint, nearest.nearestPoint]}
              pathOptions={{ color: '#334155', dashArray: '6 6', weight: 2 }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}
