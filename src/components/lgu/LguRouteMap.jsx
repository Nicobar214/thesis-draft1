import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

import { buildRoutePoints, boundsFromPoints, getJitteredCentroid, fetchRoadAlignedPolyline } from '../../lib/mapRouteUtils';
import { getProjectBudgetSummary, formatPeso } from '../../lib/budgetEstimate';

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

function MapCenterFlyer({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.flyTo(center, zoom || 14, { animate: true, duration: 1.5 });
    }
  }, [center, zoom, map]);
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

function FarmerHeatmapLayer({ visible, points }) {
  const map = useMap();

  useEffect(() => {
    if (!visible || !map || !window.L || !window.L.heatLayer || !points || points.length === 0) return undefined;
    
    const layer = window.L.heatLayer(points, {
      radius: 30,
      blur: 20,
      maxZoom: 15,
      gradient: { 0.2: '#86efac', 0.5: '#fcd34d', 0.8: '#fca5a5', 1.0: '#ef4444' }
    }).addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, visible, points]);

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

export default function LguRouteMap({
  projects,
  routesByProjectId,
  tranchesByProjectId = {},
  reports,
  showHeat = false,
  farmerBeneficiaries = [],
  markets = [],
  mapCenter = null,
  mapZoom = 11,
  searchMarker = null
}) {
  const [showFarmerDots, setShowFarmerDots] = useState(false);
  const [showFarmerHeatmap, setShowFarmerHeatmap] = useState(false);
  const [showMarketsMap, setShowMarketsMap] = useState(true);
  const [selectedFarmerForPath, setSelectedFarmerForPath] = useState(null);
  const [farmerCropFilter, setFarmerCropFilter] = useState('All');
  const [snappedConnectionPoints, setSnappedConnectionPoints] = useState(null);

  const connectionPoints = useMemo(() => {
    if (!selectedFarmerForPath) return [];
    const farmLat = selectedFarmerForPath.farmLatitude || selectedFarmerForPath.gps?.lat;
    const farmLng = selectedFarmerForPath.farmLongitude || selectedFarmerForPath.gps?.lng;
    if (!farmLat || !farmLng) return [];

    const points = [[Number(farmLat), Number(farmLng)]];

    const linkedProj = (projects || []).find(p => p.id === selectedFarmerForPath.linkedProjectId);
    if (linkedProj && linkedProj.start_latitude && linkedProj.start_longitude) {
      points.push([Number(linkedProj.start_latitude), Number(linkedProj.start_longitude)]);
      if (linkedProj.end_latitude && linkedProj.end_longitude) {
        points.push([Number(linkedProj.end_latitude), Number(linkedProj.end_longitude)]);
      }
    }

    const linkedMarket = (markets || []).find(m => m.id === selectedFarmerForPath.nearestMarketId);
    if (linkedMarket && linkedMarket.latitude && linkedMarket.longitude) {
      points.push([Number(linkedMarket.latitude), Number(linkedMarket.longitude)]);
    }

    return points;
  }, [selectedFarmerForPath, projects, markets]);

  // Snap the farmer's supply-chain connection line onto real road geometry
  // (OSRM) instead of leaving it as a straight Euclidean line.
  useEffect(() => {
    let cancelled = false;
    fetchRoadAlignedPolyline(connectionPoints).then((snapped) => {
      if (!cancelled) setSnappedConnectionPoints(connectionPoints.length >= 2 ? snapped : null);
    });
    return () => { cancelled = true; };
  }, [connectionPoints]);

  const farmerCropOptions = useMemo(() => {
    const crops = new Set((farmerBeneficiaries || []).map((f) => f.crop).filter(Boolean));
    return ['All', ...[...crops].sort()];
  }, [farmerBeneficiaries]);

  const cropFilteredFarmerBeneficiaries = useMemo(() => {
    if (farmerCropFilter === 'All') return farmerBeneficiaries || [];
    return (farmerBeneficiaries || []).filter((f) => f.crop === farmerCropFilter);
  }, [farmerBeneficiaries, farmerCropFilter]);

  const municipalityCounts = {};
  const routeLayers = (projects || []).map((project) => {
    const routeRecord = routesByProjectId?.[project.id] || null;
    const routeData = buildRoutePoints(project, routeRecord);
    
    const hasActualCoordinates = routeData.hasPolyline || Boolean(project.start_latitude && project.start_longitude);
    let coordinates = null;
    if (hasActualCoordinates) {
      coordinates = routeData.startPoint || [project.start_latitude, project.start_longitude];
    } else {
      const muni = project.municipality || 'Leon';
      municipalityCounts[muni] = (municipalityCounts[muni] || 0) + 1;
      coordinates = getJitteredCentroid(muni, municipalityCounts[muni]);
    }

    return {
      project,
      routeData,
      coordinates,
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
    if (layer.routeData.points?.length > 0) {
      layer.routeData.points.forEach((pt) => fitPoints.push(pt));
    } else if (layer.coordinates) {
      fitPoints.push(layer.coordinates);
    }
  });
  reportPoints.forEach((row) => fitPoints.push([row.lat, row.lng]));

  const heatPoints = reportPoints.map((row) => [row.lat, row.lng, row.status === 'resolved' ? 0.3 : 0.9]);

  const farmerHeatPoints = useMemo(() => {
    return cropFilteredFarmerBeneficiaries
      .map((f) => {
        const lat = f.farmLatitude || f.gps?.lat;
        const lng = f.farmLongitude || f.gps?.lng;
        return lat && lng ? [Number(lat), Number(lng), 1.0] : null;
      })
      .filter(Boolean);
  }, [cropFilteredFarmerBeneficiaries]);

  return (
    <div className="relative h-[560px] w-full border border-slate-200 rounded-xl overflow-hidden shadow-inner">
      <MapContainer center={[10.7, 122.56]} zoom={11} style={{ width: '100%', height: '100%' }} scrollWheelZoom className="z-0">
        <MapCenterFlyer center={mapCenter} zoom={mapZoom} />
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {routeLayers.map(({ project, routeData, coordinates }) => (
          <div key={project.id}>
            {routeData.points?.length >= 2 && (
              <Polyline positions={routeData.points} pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.75 }} />
            )}
            {coordinates && (() => {
              const budget = getProjectBudgetSummary(project, tranchesByProjectId[project.id] || []);
              return (
                <Marker position={coordinates} icon={startIcon}>
                  <Popup>
                    <div className="p-1 space-y-0.5 text-xs text-slate-800">
                      <p className="font-bold text-teal-700">{project.project_name}</p>
                      <p><span className="font-semibold text-slate-500">Status:</span> {project.status || project.project_status || 'Completed'}</p>
                      <p><span className="font-semibold text-slate-500">Length:</span> {project.project_length_km || project.length_km || 0} km</p>
                      <p><span className="font-semibold text-slate-500">Source:</span> {project.source || 'DA'}</p>
                      <p className="pt-1 border-t border-slate-100">
                        <span className="font-semibold text-slate-500">Budget:</span> {formatPeso(budget.totalBudget)}{budget.budgetIsEstimated ? ' (est.)' : ''}
                        {' · '}Released {formatPeso(budget.released)}{budget.utilizationIsEstimated ? ' (est.)' : ''}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              );
            })()}
            {routeData.endPoint && !coordinates && (
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

        {/* Farmer Heatmap Layer */}
        <FarmerHeatmapLayer visible={showFarmerHeatmap} points={farmerHeatPoints} />

        {/* Markets Layer */}
        {showMarketsMap && (markets || []).map(m => (
          <Marker
            key={`market-${m.id}`}
            position={[Number(m.latitude), Number(m.longitude)]}
            icon={new L.DivIcon({
              className: 'custom-market-pin',
              html: `<div style="background:#4338ca;color:#fff;width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.2);font-size:14px">🏪</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            })}
          >
            <Popup>
              <div className="p-1 space-y-1 text-slate-800">
                <p className="font-bold text-sm text-indigo-700">{m.market_name}</p>
                <p className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded w-fit">{m.market_type}</p>
                <p className="text-xs"><span className="font-medium text-slate-500">Location:</span> {m.barangay || ''}, {m.municipality}</p>
                {m.operating_days && <p className="text-xs"><span className="font-medium text-slate-500">Days:</span> {m.operating_days}</p>}
                {m.operating_hours && <p className="text-xs"><span className="font-medium text-slate-500">Hours:</span> {m.operating_hours}</p>}
                {m.commodities_accepted?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.commodities_accepted.map(c => (
                      <span key={c} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Farmers Layer */}
        {showFarmerDots && cropFilteredFarmerBeneficiaries.map(f => {
          const lat = f.farmLatitude || f.gps?.lat;
          const lng = f.farmLongitude || f.gps?.lng;
          if (!lat || !lng) return null;
          
          const cropColor = 
            f.crop === 'Rice' ? '#10b981' :
            f.crop === 'Corn' ? '#f59e0b' :
            f.crop === 'Sugarcane' ? '#8b5cf6' :
            f.crop === 'Coconut' ? '#3b82f6' :
            f.crop === 'Vegetables' ? '#ec4899' :
            '#64748b';

          return (
            <CircleMarker
              key={`farmer-${f.id}`}
              center={[Number(lat), Number(lng)]}
              radius={6}
              pathOptions={{
                fillColor: cropColor,
                fillOpacity: 0.9,
                color: '#ffffff',
                weight: 1.5
              }}
            >
              <Popup>
                <div className="p-1 space-y-1 text-slate-800">
                  <p className="font-bold text-sm text-slate-900">{f.fullName}</p>
                  <p className="text-xs font-mono text-slate-500">{f.rsbsaNumber}</p>
                  <div className="text-xs pt-1 border-t border-slate-100 space-y-0.5">
                    <p><span className="font-semibold text-slate-500">Crop:</span> {f.crop} ({f.farmAreaHa ? f.farmAreaHa.toFixed(2) : '0.00'} ha)</p>
                    <p><span className="font-semibold text-slate-500">Barangay:</span> {f.barangay}</p>
                    <p><span className="font-semibold text-slate-500">Linked Road:</span> {f.linkedProject || 'N/A'}</p>
                    {f.nearestMarketId && (
                      <p><span className="font-semibold text-slate-500">Nearest Market:</span> {markets.find(m => m.id === f.nearestMarketId)?.market_name || 'N/A'}</p>
                    )}
                    {f.distanceToFmrKm && (
                      <p><span className="font-semibold text-slate-500">Road Distance:</span> {f.distanceToFmrKm} km</p>
                    )}
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setSelectedFarmerForPath(f)} 
                    className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 underline block mt-1.5"
                  >
                    Show Supply Chain Links
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Supply Chain Connection Lines (road-network-aligned, falls back to a straight line while snapping) */}
        {(() => {
          if (connectionPoints.length < 2) return null;

          return (
            <Polyline
              positions={snappedConnectionPoints || connectionPoints}
              pathOptions={{
                color: '#fb7185',
                weight: 3.5,
                dashArray: '5, 8',
                opacity: 0.95
              }}
            />
          );
        })()}

        {showHeat && <HeatLayer points={heatPoints} />}
        {searchMarker && (
          <Marker
            position={searchMarker}
            icon={new L.Icon({
              iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
              shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
            })}
          >
            <Popup>
              <div className="p-1 text-xs">
                <p className="font-bold text-slate-800">Searched Location</p>
              </div>
            </Popup>
          </Marker>
        )}
        <FitToData points={fitPoints} />
      </MapContainer>

      {/* Floating Map Layers Control Panel */}
      <div className="absolute bottom-4 right-4 z-[500] bg-white/95 border border-slate-200 rounded-xl shadow-md p-3 text-xs text-slate-700 space-y-1.5 min-w-[200px]">
        <p className="font-semibold text-slate-900 border-b border-slate-100 pb-1 mb-1">Supply Chain Layers</p>
        
        <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-600 hover:text-slate-950">
          <input
            type="checkbox"
            checked={showFarmerDots}
            onChange={(e) => {
              setShowFarmerDots(e.target.checked);
              if (!e.target.checked) setSelectedFarmerForPath(null);
            }}
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Show Farmers (Dots)
        </label>

        {showFarmerDots && (
          <div className="flex items-center gap-2 pl-6 font-medium text-slate-600">
            <span className="shrink-0">Crop:</span>
            <select
              value={farmerCropFilter}
              onChange={(e) => setFarmerCropFilter(e.target.value)}
              className="w-full rounded border-slate-300 text-[11px] py-0.5 focus:ring-teal-500 focus:border-teal-500"
            >
              {farmerCropOptions.map((crop) => (
                <option key={crop} value={crop}>{crop}</option>
              ))}
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-600 hover:text-slate-950">
          <input
            type="checkbox"
            checked={showFarmerHeatmap}
            onChange={(e) => setShowFarmerHeatmap(e.target.checked)}
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Show Farmer Density
        </label>
        
        <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-600 hover:text-slate-950">
          <input
            type="checkbox"
            checked={showMarketsMap}
            onChange={(e) => setShowMarketsMap(e.target.checked)}
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Show Markets (Icons)
        </label>

        {selectedFarmerForPath && (
          <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px]">
            <span className="text-slate-500 truncate max-w-[120px]">Dashed path: {selectedFarmerForPath.fullName}</span>
            <button 
              onClick={() => setSelectedFarmerForPath(null)} 
              className="text-red-500 hover:text-red-700 font-semibold"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
