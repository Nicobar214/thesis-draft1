import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

import { buildRoutePoints, boundsFromPoints } from '../../lib/mapRouteUtils';

function FitToData({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!Array.isArray(points) || points.length === 0) return;
    const bounds = boundsFromPoints(points);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, points]);

  return null;
}

function HeatLayer({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !window.L || !window.L.heatLayer) return undefined;
    const layer = window.L.heatLayer(points || [], {
      radius: 24,
      blur: 18,
      maxZoom: 17,
      gradient: { 0.2: '#38bdf8', 0.5: '#f59e0b', 0.8: '#ef4444' },
    }).addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, points]);

  return null;
}

const startIcon = new L.DivIcon({
  className: 'lgu-route-start',
  html: '<div style="background:#16a34a;color:#fff;width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:10px;font-weight:700">S</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const endIcon = new L.DivIcon({
  className: 'lgu-route-end',
  html: '<div style="background:#dc2626;color:#fff;width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:10px;font-weight:700">E</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function LguRouteMap({ projects, routesByProjectId, reports, showHeat = false }) {
  const routeLayers = (projects || []).map((project) => {
    const routeRecord = routesByProjectId?.[project.id] || null;
    const routeData = buildRoutePoints(project, routeRecord);
    return {
      project,
      routeData,
    };
  });

  const reportPoints = (reports || [])
    .map((row) => {
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { ...row, lat, lng };
    })
    .filter(Boolean);

  const fitPoints = [];
  routeLayers.forEach((layer) => {
    (layer.routeData.points || []).forEach((pt) => fitPoints.push(pt));
  });
  reportPoints.forEach((row) => fitPoints.push([row.lat, row.lng]));

  const heatPoints = reportPoints.map((row) => [row.lat, row.lng, row.status === 'resolved' ? 0.3 : 0.9]);

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      <div className="h-[420px] w-full">
        <MapContainer center={[10.7, 122.56]} zoom={11} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {routeLayers.map(({ project, routeData }) => (
            <div key={project.id}>
              {routeData.points?.length >= 2 && (
                <Polyline positions={routeData.points} pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.75 }} />
              )}
              {routeData.startPoint && (
                <Marker position={routeData.startPoint} icon={startIcon}>
                  <Popup>{project.project_name} (Start)</Popup>
                </Marker>
              )}
              {routeData.endPoint && (
                <Marker position={routeData.endPoint} icon={endIcon}>
                  <Popup>{project.project_name} (End)</Popup>
                </Marker>
              )}
            </div>
          ))}

          {reportPoints.map((row) => (
            <CircleMarker
              key={row.id}
              center={[row.lat, row.lng]}
              radius={6}
              pathOptions={{
                color: row.status === 'resolved' ? '#10b981' : row.status === 'reviewed' ? '#3b82f6' : '#f59e0b',
                fillOpacity: 0.85,
                weight: 1.5,
              }}
            >
              <Popup>
                <div className="text-xs">
                  <p className="font-semibold">{row.project_name || 'Unlinked project'}</p>
                  <p>{row.barangay || 'N/A'}, {row.municipality || 'N/A'}</p>
                  <p>Status: {row.status || 'pending'}</p>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {showHeat && <HeatLayer points={heatPoints} />}
          <FitToData points={fitPoints} />
        </MapContainer>
      </div>
    </div>
  );
}
