import { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

import { normalizeRouteStatus, buildRoutePoints, boundsFromPoints, getJitteredCentroid, fetchRoadAlignedPolyline, createDisplayRoutePoints, isAlreadyRoadAligned } from '../../lib/mapRouteUtils';
import { getProjectBudgetSummary, formatPeso } from '../../lib/budgetEstimate';
import GapSegmentLayer from '../map/GapSegmentLayer';
import { MapLegend, LegendGroup, LegendLine, LegendDot, MapControlPanel, ControlGroup, LayerToggle, BasemapSwitch } from '../map/MapPanels';
import StableHeatLayer from '../map/StableHeatLayer';
import BaseTiles from '../map/BaseTiles';
import { useBasemap } from '../../lib/basemaps';
import { centroidFallbackIcon } from '../map/routeMarkerIcons';
import { storeGlyph } from '../../lib/mapMarkerIcons';
import { normalizeUserProjectStatus, getStatusStyle } from '../../lib/projectStatus';
import { formatPercentage } from '../../lib/percentageFormat';
import FmrProjectDetailDialog from '../FmrProjectDetailDialog';

// Same content whether the user clicks the route line, its start, or its end.
// Built from <div>s, not <p>s: leaflet.css gives popup paragraphs a 1.3em
// margin that would blow the spacing apart.
function ProjectPopupContent({ project, routeData, budget, onViewDetails }) {
  const status = normalizeUserProjectStatus(project.status);
  const style = getStatusStyle(status);
  const pct = Math.min(100, Math.max(0, Number(project.accomplishment) || 0));
  const place = [project.barangay && `Brgy. ${project.barangay}`, project.municipality].filter(Boolean).join(', ') || project.location;
  const length = Number(project.project_length_km || project.length_km) || 0;
  const dateLabel = status === 'Completed' ? 'Completed' : 'Target';
  const dateValue = status === 'Completed' ? project.date_completed : project.target_completion_date;

  return (
    <div className="w-64 space-y-2.5 text-xs text-slate-700">
      <div>
        <div className="font-bold leading-snug text-slate-900">{project.project_name}</div>
        {place && <div className="mt-0.5 text-slate-500">{place}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.badge}`}>{status}</span>
        {project.year_funded && <span className="text-slate-500">Funded {project.year_funded}</span>}
      </div>

      {status !== 'Proposed' && (
        <div>
          <div className="flex justify-between">
            <span className="text-slate-500">Accomplishment</span>
            <span className="font-semibold text-slate-900">{formatPercentage(pct)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-slate-500">Length</span>
        <span className="text-right font-medium text-slate-900">{length > 0 ? `${length} km` : 'N/A'}</span>
        {dateValue && (
          <>
            <span className="text-slate-500">{dateLabel}</span>
            <span className="text-right font-medium text-slate-900">{dateValue}</span>
          </>
        )}
        <span className="text-slate-500">Budget</span>
        <span className="text-right font-medium text-slate-900">
          {formatPeso(budget.totalBudget)}{budget.budgetIsEstimated ? ' (est.)' : ''}
        </span>
        <span className="text-slate-500">Released</span>
        <span className="text-right font-medium text-slate-900">
          {formatPeso(budget.released)}{budget.utilizationIsEstimated ? ' (est.)' : ''}
        </span>
      </div>

      {project.remarks && (
        <div className="border-t border-slate-100 pt-2 leading-relaxed text-slate-600">{project.remarks}</div>
      )}

      {/* Reports the route's actual stored provenance, not an assumed one. */}
      <div className="text-[11px] text-slate-500">
        Alignment: {routeData.routeSource
          ? `${routeData.routeSource}${routeData.routeQuality ? ` (${routeData.routeQuality})` : ''}`
          : 'approximate — no surveyed route on file'}
      </div>

      <button
        type="button"
        onClick={onViewDetails}
        className="w-full rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800"
      >
        View full details
      </button>
    </div>
  );
}

const REPORT_STATUS_COLOR = {
  pending: '#f59e0b',
  reviewed: '#0ea5e9',
  resolved: '#059669',
  dismissed: '#64748b',
};

function reportPinIcon(color, needsAction) {
  const ring = needsAction ? 'box-shadow:0 0 0 3px #dc2626,0 2px 5px rgba(0,0,0,.35)' : 'box-shadow:0 2px 5px rgba(0,0,0,.35)';
  return new L.DivIcon({
    className: 'lgu-report-pin',
    html: `<div style="background:${color};width:22px;height:22px;border-radius:9999px;border:2px solid #fff;${ring};display:flex;align-items:center;justify-content:center"><div style="width:6px;height:6px;border-radius:9999px;background:#fff"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });
}

// Refits only when WHICH projects are shown changes (filters/search), never
// on a plain re-render. Keying on the `points` array itself refit the map on
// every render -- each road-snapped route arriving, each realtime refresh --
// which yanked the view back out while the user was zooming in.
function FitToData({ fitKey, points }) {
  const map = useMap();
  const latestPoints = useRef(points);
  const hasPoints = Array.isArray(points) && points.length > 0;

  useEffect(() => {
    latestPoints.current = points;
  });

  useEffect(() => {
    if (!hasPoints) return;
    const bounds = boundsFromPoints(latestPoints.current);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, fitKey, hasPoints]);

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
  return (
    <StableHeatLayer
      points={points}
      radiusMeters={800}
      maxRadiusPx={100}
      // A municipal view usually has only a handful of reports, so a small
      // natural cluster shouldn't read as intensely as a true hotspot does
      // on the provincewide admin map -- more headroom keeps it calmer.
      maxHeadroom={2.5}
      gradient={{ 0.2: '#38bdf8', 0.5: '#f59e0b', 0.8: '#ef4444' }}
    />
  );
}

function FarmerHeatmapLayer({ visible, points }) {
  return (
    <StableHeatLayer
      visible={visible}
      points={points}
      radiusMeters={1500}
      gradient={{ 0.2: '#86efac', 0.5: '#fcd34d', 0.8: '#fca5a5', 1.0: '#ef4444' }}
    />
  );
}

const startIcon = new L.DivIcon({
  className: 'lgu-route-start',
  html: '<div style="background:#16a34a;width:10px;height:10px;border-radius:9999px;border:2px solid #fff;box-shadow:0 0 0 1px rgba(22,101,52,.55),0 1px 3px rgba(0,0,0,.25)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const endIcon = new L.DivIcon({
  className: 'lgu-route-end',
  html: '<div style="background:#f97316;width:10px;height:10px;border-radius:9999px;border:2px solid #fff;box-shadow:0 0 0 1px rgba(194,65,12,.6),0 1px 3px rgba(0,0,0,.25)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
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
  searchMarker = null,
  roadGaps = [],
  escalations = [],
}) {
  const [showFarmerDots, setShowFarmerDots] = useState(false);
  const [showFarmerHeatmap, setShowFarmerHeatmap] = useState(false);
  const [showMarketsMap, setShowMarketsMap] = useState(true);
  const [selectedFarmerForPath, setSelectedFarmerForPath] = useState(null);
  const [farmerCropFilter, setFarmerCropFilter] = useState('All');
  const [showRoadGaps, setShowRoadGaps] = useState(true);
  const [showReportPins, setShowReportPins] = useState(true);
  const [basemap, setBasemap] = useBasemap();
  const [snappedConnectionPoints, setSnappedConnectionPoints] = useState({ key: null, points: null });
  const [snappedProjectRoutes, setSnappedProjectRoutes] = useState({});
  const [focusedProjectId, setFocusedProjectId] = useState(null);
  const [detailProject, setDetailProject] = useState(null);
  const [focusedGapId, setFocusedGapId] = useState(null);

  const connectionPoints = useMemo(() => {
    if (!selectedFarmerForPath) return [];

    const farmLat = selectedFarmerForPath.farmLatitude || selectedFarmerForPath.gps?.lat;
    const farmLng = selectedFarmerForPath.farmLongitude || selectedFarmerForPath.gps?.lng;
    if (!farmLat || !farmLng) return [];

    const points = [[Number(farmLat), Number(farmLng)]];

    const linkedProject = (projects || []).find((project) => project.id === selectedFarmerForPath.linkedProjectId);
    if (linkedProject?.start_latitude && linkedProject?.start_longitude) {
      points.push([Number(linkedProject.start_latitude), Number(linkedProject.start_longitude)]);
      if (linkedProject.end_latitude && linkedProject.end_longitude) {
        points.push([Number(linkedProject.end_latitude), Number(linkedProject.end_longitude)]);
      }
    }

    const linkedMarket = (markets || []).find((market) => market.id === selectedFarmerForPath.nearestMarketId);
    if (linkedMarket?.latitude && linkedMarket?.longitude) {
      points.push([Number(linkedMarket.latitude), Number(linkedMarket.longitude)]);
    }

    return points.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  }, [markets, projects, selectedFarmerForPath]);

  const connectionKey = useMemo(() => {
    return connectionPoints.map(([lat, lng]) => `${lat},${lng}`).join('|');
  }, [connectionPoints]);

  // Snap the farmer's supply-chain connection line onto real road geometry
  // (OSRM) instead of leaving it as a straight Euclidean line.
  useEffect(() => {
    if (connectionPoints.length < 2) return undefined;

    let cancelled = false;
    fetchRoadAlignedPolyline(connectionPoints).then((snapped) => {
      if (!cancelled) setSnappedConnectionPoints({ key: connectionKey, points: snapped });
    });
    return () => { cancelled = true; };
  }, [connectionKey, connectionPoints]);

  // Auto-snap all project routes to real road network geometry via OSRM
  useEffect(() => {
    let active = true;
    (projects || []).forEach((project) => {
      const routeRecord = routesByProjectId?.[project.id] || null;
      const routeData = buildRoutePoints(project, routeRecord);

      // Only snap routes that have no stored geometry of their own. Without this
      // guard a stored multi-vertex route gets round-tripped through OSRM on every
      // load, which re-routes it through a sampled subset of its own vertices and
      // throws away the surveyed alignment and its calibrated length. Dashboard.jsx
      // and UserMapView.jsx already guarded this way; this map did not.
      if (routeData.hasRouteRecord || isAlreadyRoadAligned(routeRecord)) return;

      if (routeData.points && routeData.points.length >= 2) {
        fetchRoadAlignedPolyline(routeData.points).then((snapped) => {
          if (active && snapped && snapped.length >= 2) {
            setSnappedProjectRoutes((prev) => ({
              ...prev,
              [project.id]: snapped,
            }));
          }
        });
      }
    });
    return () => { active = false; };
  }, [projects, routesByProjectId]);

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
      // False when coordinates is a jittered municipal centroid rather than a real
      // route start, so the marker does not label a guess as the road's start.
      hasRealCoordinates: hasActualCoordinates,
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

  const fitKey = useMemo(
    () => (projects || []).map((p) => p.id).sort().join(','),
    [projects]
  );

  const fitPoints = [];
  routeLayers.forEach((layer) => {
    if (layer.routeData.points?.length > 0) {
      layer.routeData.points.forEach((pt) => fitPoints.push(pt));
    } else if (layer.coordinates) {
      fitPoints.push(layer.coordinates);
    }
  });
  reportPoints.forEach((row) => fitPoints.push([row.lat, row.lng]));

  // Reports the LGU is being asked to act on get a red ring so they stand out.
  const actionReportIds = useMemo(
    () => new Set((escalations || []).filter((e) => e.escalation_status === 'for_action').map((e) => e.report_id)),
    [escalations],
  );

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

  const statusCount = (projects || []).reduce((acc, p) => {
    const key = normalizeRouteStatus(p.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="relative h-[560px] w-full border border-slate-200 rounded-xl overflow-hidden shadow-inner">
      <MapContainer center={[10.7, 122.56]} zoom={11} style={{ width: '100%', height: '100%' }} scrollWheelZoom className="z-0">
        <MapCenterFlyer center={mapCenter} zoom={mapZoom} />
        <BaseTiles basemap={basemap} />

        {routeLayers.map(({ project, routeData, coordinates, hasRealCoordinates }) => {
          const effectivePoints = snappedProjectRoutes[project.id] || routeData.points;
          const displayPoints = createDisplayRoutePoints(effectivePoints, project.id);
          const isFocused = focusedProjectId === project.id;
          const lineHandlers = {
            mouseover: () => setFocusedProjectId(project.id),
            mouseout: () => setFocusedProjectId(null),
            click: () => setFocusedProjectId(project.id),
          };
          const budget = getProjectBudgetSummary(project, tranchesByProjectId[project.id] || []);
          const popup = (
            <Popup maxWidth={300}>
              <ProjectPopupContent
                project={project}
                routeData={routeData}
                budget={budget}
                onViewDetails={() => setDetailProject(project)}
              />
            </Popup>
          );
          return (
            <div key={project.id}>
              {effectivePoints?.length >= 2 && (
                <>
                  {isFocused && (
                    <Polyline
                      positions={displayPoints}
                      pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }}
                    />
                  )}
                  <Polyline
                    positions={displayPoints}
                    pathOptions={{
                      color: '#0f766e',
                      weight: isFocused ? 5.5 : 3.4,
                      opacity: isFocused ? 0.95 : 0.72,
                    }}
                    eventHandlers={lineHandlers}
                  >
                    {popup}
                  </Polyline>
                </>
              )}
              {coordinates && (
                <Marker position={coordinates} icon={hasRealCoordinates ? startIcon : centroidFallbackIcon} eventHandlers={lineHandlers}>
                  {popup}
                </Marker>
              )}
              {routeData.endPoint && (
                <Marker position={routeData.endPoint} icon={endIcon} eventHandlers={lineHandlers}>
                  {popup}
                </Marker>
              )}
            </div>
          );
        })}

        {/* Module 1: road network gaps, from public.road_network_gaps */}
        <GapSegmentLayer
          gaps={roadGaps}
          visible={showRoadGaps}
          focusedGapId={focusedGapId}
          onFocusGap={setFocusedGapId}
        />

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
              html: `<div style="background:#4338ca;color:#fff;width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.2);font-size:14px">${storeGlyph(14)}</div>`,
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
              positions={
                snappedConnectionPoints.key === connectionKey && snappedConnectionPoints.points
                  ? snappedConnectionPoints.points
                  : connectionPoints
              }
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
        {showReportPins && reportPoints.map((row) => {
          const color = REPORT_STATUS_COLOR[row.status] || '#64748b';
          const needsAction = actionReportIds.has(row.id);
          return (
            <Marker
              key={`report-pin-${row.id}`}
              position={[row.lat, row.lng]}
              icon={reportPinIcon(color, needsAction)}
              zIndexOffset={needsAction ? 500 : 0}
            >
              <Popup>
                <div className="space-y-1 p-1 text-xs">
                  <p className="font-bold text-slate-900 capitalize">{row.status || 'pending'}{needsAction ? ' · needs LGU action' : ''}</p>
                  <p className="text-slate-600">{row.description}</p>
                  <p className="text-slate-500">{[row.barangay, row.municipality].filter(Boolean).join(', ')}</p>
                  {row.project_name && <p className="text-slate-500">Project: {row.project_name}</p>}
                </div>
              </Popup>
            </Marker>
          );
        })}
        <FitToData fitKey={fitKey} points={fitPoints} />
      </MapContainer>

      {detailProject && (
        <FmrProjectDetailDialog
          project={detailProject}
          tranches={tranchesByProjectId[detailProject.id] || []}
          onClose={() => setDetailProject(null)}
        />
      )}

      <MapLegend>
        <LegendGroup label="Projects">
          {statusCount['Completed'] > 0 && <LegendLine color="bg-emerald-500" label="Completed" count={statusCount['Completed']} />}
          {statusCount['On-Going'] > 0 && <LegendLine color="bg-amber-500" label="On-Going" count={statusCount['On-Going']} />}
          {statusCount['Proposed'] > 0 && <LegendLine color="bg-blue-500" label="Proposed" count={statusCount['Proposed']} />}
        </LegendGroup>
        {(showRoadGaps || showMarketsMap || showFarmerDots || showFarmerHeatmap) && (
          <LegendGroup label="Layers">
            {showRoadGaps && <LegendLine color="border-red-500" dashed label="Road network gap" />}
            {showMarketsMap && <LegendDot color="bg-indigo-700" label="Market" />}
            {showFarmerDots && <LegendDot color="bg-teal-600" label="Farmer" />}
            {showFarmerHeatmap && (
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-6 shrink-0 rounded" style={{ background: 'linear-gradient(90deg,#86efac,#fcd34d,#fca5a5,#ef4444)' }} />
                <span>Farmer density</span>
              </div>
            )}
          </LegendGroup>
        )}
        {showReportPins && reportPoints.length > 0 && (
          <LegendGroup label="Citizen reports">
            {[['pending', 'Pending'], ['reviewed', 'Reviewed'], ['resolved', 'Resolved']].map(([k, label]) => (
              <LegendDot key={k} color="" style={{ background: REPORT_STATUS_COLOR[k] }} label={label} />
            ))}
          </LegendGroup>
        )}
      </MapLegend>

      <MapControlPanel>
        <ControlGroup label="Layers">
          <LayerToggle
            checked={showReportPins}
            onChange={setShowReportPins}
            label={`Citizen reports (${reportPoints.length})${actionReportIds.size > 0 ? ` · ${actionReportIds.size} need action` : ''}`}
          />
          <LayerToggle checked={showRoadGaps} onChange={setShowRoadGaps} label={`Road network gaps (${roadGaps.length})`} accent="text-red-600 focus:ring-red-500" />
          <LayerToggle checked={showMarketsMap} onChange={setShowMarketsMap} label="Markets" />
        </ControlGroup>

        <ControlGroup label="Supply chain">
          <LayerToggle
            checked={showFarmerDots}
            onChange={(on) => {
              setShowFarmerDots(on);
              if (!on) setSelectedFarmerForPath(null);
            }}
            label="Farmers (dots)"
          />
          {showFarmerDots && (
            <div className="flex items-center gap-2 pl-6 font-medium text-slate-600">
              <span className="shrink-0">Crop</span>
              <select
                value={farmerCropFilter}
                onChange={(e) => setFarmerCropFilter(e.target.value)}
                className="w-full rounded border-slate-300 py-0.5 text-[11px] focus:border-teal-500 focus:ring-teal-500"
              >
                {farmerCropOptions.map((crop) => (
                  <option key={crop} value={crop}>{crop}</option>
                ))}
              </select>
            </div>
          )}
          <LayerToggle checked={showFarmerHeatmap} onChange={setShowFarmerHeatmap} label="Farmer density" />
          {selectedFarmerForPath && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10px]">
              <span className="max-w-[130px] truncate text-slate-500">Path: {selectedFarmerForPath.fullName}</span>
              <button type="button" onClick={() => setSelectedFarmerForPath(null)} className="font-semibold text-red-500 hover:text-red-700">
                Clear
              </button>
            </div>
          )}
        </ControlGroup>

        <ControlGroup label="Basemap">
          <BasemapSwitch value={basemap} onChange={setBasemap} />
        </ControlGroup>
      </MapControlPanel>
    </div>
  );
}
