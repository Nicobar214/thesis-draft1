import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, Tooltip, Circle, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import {
  CrosshairIcon,
  ExpandIcon,
  NavigationIcon,
  RouteIcon,
} from 'lucide-react';

import { supabaseFieldEngineer as supabase } from '../../lib/supabase';
import { buildRoutePoints, boundsFromPoints, getRouteStatusTheme, normalizeRouteStatus } from '../../lib/mapRouteUtils';
import RouteEndpointMarkers from '../map/RouteEndpointMarkers';
import { resolveCategory, SEVERITY_TAXONOMY } from '../../lib/publicReportStatus';
import { haversineMeters, nearestPointOnRoute, formatDistance, toPoint } from './routeGeometry';
import GapSegmentLayer from '../map/GapSegmentLayer';
import StableHeatLayer from '../map/StableHeatLayer';
import BaseTiles from '../map/BaseTiles';
import { useBasemap } from '../../lib/basemaps';
import { MapLegend, LegendGroup, LegendLine, LegendDot, MapControlPanel, ControlGroup, LayerToggle, BasemapSwitch } from '../map/MapPanels';

const DEFAULT_CENTER = [10.7, 122.56];
const GEOFENCE_M = 500; // same radius the repair-verification camera lock and server check enforce

const STATUS_META = {
  assigned: { label: 'Assigned', color: '#2563eb' },
  in_progress: { label: 'In progress', color: '#d97706' },
  rejected: { label: 'Needs rework', color: '#dc2626' },
  inspected: { label: 'Inspected', color: '#059669' },
  validated: { label: 'Validated', color: '#059669' },
};
const statusMeta = (s) => STATUS_META[s] || { label: s || 'Unknown', color: '#64748b' };
const isDone = (s) => s === 'inspected' || s === 'validated';


const SEVERITY_WEIGHT = { safety: 1, flood: 0.8, issue: 0.6, general: 0.4 };

// How much of the baseline weight each engineer status keeps. The heat layer should show
// where work is still needed, so finished sites fade and failed inspections stay hot.
const STATUS_HEAT = { assigned: 1, in_progress: 0.9, rejected: 1, inspected: 0.3, validated: 0.12 };
const AGE_FULL_DAYS = 30; // an open report reaches its full age bonus after this long

// Intensity (0-1) a report contributes to the damage-hotspot heat layer:
// category severity x how unfinished the site is, nudged up the longer it has waited.
function hotspotWeight(site, now) {
  const base = SEVERITY_WEIGHT[site.category] ?? 0.5;
  const status = site.report.engineer_status;
  const stillOpen = STATUS_HEAT[status] ?? 1;
  const since = new Date(site.report.created_at).getTime();
  const days = Number.isFinite(since) ? Math.max(0, (now - since) / 86_400_000) : 0;
  const ageBonus = 1 + 0.3 * Math.min(1, days / AGE_FULL_DAYS);
  return Math.min(1, base * stillOpen * ageBonus);
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'rejected', label: 'Needs rework' },
  { value: 'done', label: 'Inspected / validated' },
];

function reportIcon(color, label) {
  return L.divIcon({
    className: 'fe-report-marker',
    html: `<div style="background:${color};color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);font-size:12px;font-weight:700">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

const doneGlyph = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function FitBounds({ points, fitKey }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    if (last.current === fitKey) return;
    const bounds = boundsFromPoints(points);
    if (!bounds) return;
    last.current = fitKey;
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
  }, [map, points, fitKey]);
  return null;
}

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 16), { duration: 1 });
  }, [map, target]);
  return null;
}

function HeatLayer({ visible, points }) {
  return (
    <StableHeatLayer
      visible={visible}
      points={points}
      radiusMeters={1500}
      gradient={{ 0.2: '#86efac', 0.5: '#fcd34d', 0.8: '#fb923c', 1.0: '#dc2626' }}
    />
  );
}

// Greedy nearest-neighbour visiting order. Not an optimal tour, but cheap and
// predictable for the handful of open sites an engineer holds at once.
function visitOrder(sites, origin) {
  const remaining = [...sites];
  const ordered = [];
  let here = origin;
  if (!here && remaining.length) {
    remaining.sort((a, b) => new Date(a.report.assigned_at || a.report.created_at) - new Date(b.report.assigned_at || b.report.created_at));
    const first = remaining.shift();
    ordered.push(first);
    here = first.point;
  }
  while (remaining.length) {
    let bi = 0;
    let bd = Infinity;
    remaining.forEach((s, i) => {
      const d = haversineMeters(here, s.point);
      if (d < bd) { bd = d; bi = i; }
    });
    const [next] = remaining.splice(bi, 1);
    ordered.push(next);
    here = next.point;
  }
  return ordered;
}

const COMPACT_LAYERS = { reports: true, routes: true, endpoints: true, gaps: false, links: false, geofence: false, heat: false };
const FULL_LAYERS = { reports: true, routes: true, endpoints: true, gaps: true, links: true, geofence: false, heat: false };

/**
 * compact: the dashboard-home overview (report markers, routes, next three stops). It
 * shares every layer, the legend and the basemap switch with the full tool, which lives
 * behind onOpenFullMap and adds filters, tracking and navigation.
 */
export default function FieldEngineerMap({ reports, onOpenReport, compact = false, initialStatus = 'all', onOpenFullMap }) {
  const [now] = useState(() => Date.now()); // fixed at mount; keeps render pure
  const [projects, setProjects] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [basemap, setBasemap] = useBasemap();
  const [layers, setLayers] = useState(compact ? COMPACT_LAYERS : FULL_LAYERS);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [me, setMe] = useState(null); // { point, accuracy }
  const [tracking, setTracking] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [flyTarget, setFlyTarget] = useState(null);
  const [fitKey, setFitKey] = useState(0);
  const watchRef = useRef(null);

  const setLayer = (key) => (value) => setLayers((prev) => ({ ...prev, [key]: value }));

  // Context layers. Each query is independent so one missing table or policy
  // only removes its own layer instead of blanking the whole map.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, r, g] = await Promise.allSettled([
        supabase.from('fmr_projects').select('*'),
        supabase.from('project_routes').select('*'),
        supabase.from('road_network_gaps').select('*'),
      ]);
      if (!alive) return;
      const rows = (res) => (res.status === 'fulfilled' && !res.value.error ? res.value.data || [] : []);
      setProjects(rows(p));
      setRoutes(rows(r));
      setGaps(rows(g));
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => () => {
    if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  const toggleTracking = useCallback(() => {
    if (tracking) {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setTracking(false);
      return;
    }
    if (!navigator.geolocation) {
      setGeoError('Location is not available on this device.');
      return;
    }
    setGeoError('');
    setTracking(true);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point = [pos.coords.latitude, pos.coords.longitude];
        setMe({ point, accuracy: pos.coords.accuracy });
      },
      (err) => {
        setGeoError(err.code === 1 ? 'Location permission was denied.' : 'Could not read your location.');
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [tracking]);

  const routeByProject = useMemo(() => {
    const byProject = new Map();
    const routeRows = new Map(routes.map((r) => [r.project_id, r]));
    projects.forEach((project) => {
      const data = buildRoutePoints(project, routeRows.get(project.id) || null);
      if (data.points.length >= 2) byProject.set(project.id, { project, points: data.points, data });
    });
    return byProject;
  }, [projects, routes]);

  // One record per geotagged report, with its link to the FMR road network.
  const sites = useMemo(() => (reports || []).map((report) => {
    const point = toPoint(report.latitude, report.longitude);
    if (!point) return null;
    const entry = report.project_id ? routeByProject.get(report.project_id) : null;
    const nearest = entry ? nearestPointOnRoute(entry.points, point) : null;
    return {
      report,
      point,
      category: resolveCategory(report),
      projectName: entry?.project?.project_name || report.project_name || null,
      nearest,
    };
  }).filter(Boolean), [reports, routeByProject]);

  const visibleSites = useMemo(() => sites.filter(({ report, category }) => {
    const s = report.engineer_status;
    if (statusFilter === 'done' ? !isDone(s) : statusFilter !== 'all' && s !== statusFilter) return false;
    if (categoryFilter !== 'all' && category !== categoryFilter) return false;
    return true;
  }), [sites, statusFilter, categoryFilter]);

  const ordered = useMemo(
    () => visitOrder(visibleSites.filter((s) => !isDone(s.report.engineer_status)), me?.point || null),
    [visibleSites, me],
  );
  const orderOf = useMemo(() => new Map(ordered.map((s, i) => [s.report.id, i + 1])), [ordered]);
  const completedSites = useMemo(() => visibleSites.filter((s) => isDone(s.report.engineer_status)), [visibleSites]);

  const heatPoints = useMemo(
    () => visibleSites.map((s) => [s.point[0], s.point[1], hotspotWeight(s, now)]),
    [visibleSites, now],
  );

  const fitPoints = useMemo(() => {
    const pts = visibleSites.map((s) => s.point);
    return pts.length ? pts : [DEFAULT_CENTER];
  }, [visibleSites]);

  const linked = visibleSites.filter((s) => s.nearest).length;
  const avgLink = linked
    ? visibleSites.filter((s) => s.nearest).reduce((sum, s) => sum + s.nearest.distanceMeters, 0) / linked
    : null;

  const distanceFromMe = (point) => (me ? haversineMeters(me.point, point) : null);
  const navUrl = (point) => `https://www.google.com/maps/dir/?api=1&destination=${point[0]},${point[1]}&travelmode=driving`;

  const active = layers;
  const routeStatuses = new Set([...routeByProject.values()].map((v) => normalizeRouteStatus(v.project.status)));


  const mapOverlays = (
    <>
            <FlyTo target={flyTarget} />
            <HeatLayer visible={active.heat} points={heatPoints} />

            {active.routes && [...routeByProject.values()].map(({ project, points, data }) => {
              const theme = getRouteStatusTheme(project.status);
              return (
                <Fragment key={project.id}>
                  <Polyline positions={points} pathOptions={{ color: theme.line, weight: 4, opacity: 0.85 }}>
                    <Tooltip sticky>{project.project_name}{project.status ? ` (${project.status})` : ''}</Tooltip>
                  </Polyline>
                  {active.endpoints && <RouteEndpointMarkers project={project} routeData={data} lineColor={theme.line} />}
                </Fragment>
              );
            })}

            <GapSegmentLayer gaps={gaps} visible={active.gaps} />

            {active.links && visibleSites.map((s) => s.nearest && (
              <Polyline
                key={`link-${s.report.id}`}
                positions={[s.point, s.nearest.nearestPoint]}
                pathOptions={{ color: '#475569', weight: 2, dashArray: '4 6', opacity: 0.9 }}
              />
            ))}

            {active.geofence && visibleSites.map((s) => (
              <Circle
                key={`fence-${s.report.id}`}
                center={s.point}
                radius={GEOFENCE_M}
                pathOptions={{ color: statusMeta(s.report.engineer_status).color, weight: 1.5, fillOpacity: 0.07, dashArray: '6 4' }}
              />
            ))}

            {active.reports && visibleSites.map((s) => {
              const { report } = s;
              const meta = statusMeta(report.engineer_status);
              const order = orderOf.get(report.id);
              const icon = reportIcon(meta.color, isDone(report.engineer_status) ? doneGlyph : order || '');
              const fromMe = distanceFromMe(s.point);
              return (
                <Marker key={report.id} position={s.point} icon={icon}>
                  <Popup minWidth={230}>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: meta.color }} />
                        <strong className="text-slate-900">{meta.label}</strong>
                        {order && <span className="text-slate-500">Stop {order}</span>}
                      </div>
                      <p className="text-slate-800 font-medium">{[report.barangay, report.municipality].filter(Boolean).join(', ') || 'Unknown location'}</p>
                      {SEVERITY_TAXONOMY[s.category] && <p className="text-slate-500">{SEVERITY_TAXONOMY[s.category].label}</p>}
                      <p className="text-slate-600 line-clamp-3">{report.description}</p>
                      {s.projectName && <p className="text-slate-500">Project: {s.projectName}</p>}
                      {s.nearest && <p className="text-slate-500">{formatDistance(s.nearest.distanceMeters)} from the FMR route (near KM {s.nearest.kmAtPoint.toFixed(1)})</p>}
                      {fromMe != null && <p className="text-slate-500">{formatDistance(fromMe)} from you</p>}
                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={() => onOpenReport?.(report)} className="rounded-md bg-teal-600 px-2.5 py-1 font-semibold text-white hover:bg-teal-700">
                          Open inspection
                        </button>
                        <a href={navUrl(s.point)} target="_blank" rel="noopener noreferrer" className="rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50">
                          Navigate
                        </a>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {me && (
              <>
                <Circle center={me.point} radius={Math.max(me.accuracy || 0, 5)} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.12 }} />
                <CircleMarker center={me.point} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }}>
                  <Tooltip>You are here{me.accuracy ? ` (±${Math.round(me.accuracy)} m)` : ''}</Tooltip>
                </CircleMarker>
              </>
            )}
    </>
  );
  const mapPanels = (
    <>
          <MapLegend compact={compact}>
            <LegendGroup label="Report status">
              {['assigned', 'in_progress', 'rejected', 'inspected'].map((k) => (
                <LegendDot key={k} color="" style={{ background: statusMeta(k).color }} label={k === 'inspected' ? 'Inspected / validated' : statusMeta(k).label} />
              ))}
            </LegendGroup>
            {(active.routes || active.links || active.gaps || active.geofence || active.heat) && (
              <LegendGroup label="Layers">
                {active.routes && routeStatuses.has('Completed') && <LegendLine color="bg-emerald-500" label="Completed route" />}
                {active.routes && routeStatuses.has('On-Going') && <LegendLine color="bg-amber-500" label="Ongoing route" />}
                {active.routes && active.endpoints && <LegendDot style={{ background: '#16a34a' }} label="Route start (S)" />}
                {active.routes && active.endpoints && <LegendDot style={{ background: '#f97316' }} label="Route end (E)" />}
                {active.gaps && <LegendLine color="border-red-500" dashed label="Unpaved gap" />}
                {active.links && <LegendLine color="border-slate-500" dashed label="Report to road" />}
                {active.geofence && <LegendLine color="border-teal-600" dashed label={`${GEOFENCE_M} m geofence`} />}
                {active.heat && (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-6 shrink-0 rounded" style={{ background: 'linear-gradient(90deg,#86efac,#fcd34d,#fb923c,#dc2626)' }} />
                    <span>Damage hotspots</span>
                  </div>
                )}
              </LegendGroup>
            )}
          </MapLegend>

          <MapControlPanel compact={compact} defaultOpen={!compact}>
            <ControlGroup label="Layers">
              <LayerToggle checked={active.reports} onChange={setLayer('reports')} label="Report sites" />
              <LayerToggle checked={active.routes} onChange={setLayer('routes')} label="FMR routes" />
              <LayerToggle checked={active.endpoints} onChange={setLayer('endpoints')} label="Route start / end pins" />
              <LayerToggle checked={active.gaps} onChange={setLayer('gaps')} label="Unpaved gaps" />
              <LayerToggle checked={active.links} onChange={setLayer('links')} label="Link to nearest road" />
              <LayerToggle checked={active.geofence} onChange={setLayer('geofence')} label={`${GEOFENCE_M} m geofence`} />
              <LayerToggle checked={active.heat} onChange={setLayer('heat')} label="Damage hotspots" />
            </ControlGroup>
            <ControlGroup label="Basemap">
              <BasemapSwitch value={basemap} onChange={setBasemap} />
            </ControlGroup>
          </MapControlPanel>
    </>
  );

  if (compact) {
    const nextStops = ordered.slice(0, 3);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="relative overflow-hidden rounded-xl border border-slate-200">
          <MapContainer center={DEFAULT_CENTER} zoom={11} className="h-[420px] w-full z-0" scrollWheelZoom zoomControl={false}>
            <BaseTiles basemap={basemap} />
            <FitBounds points={fitPoints} fitKey={`compact-${sites.length ? 'data' : 'none'}`} />
            {mapOverlays}
          </MapContainer>
          {mapPanels}
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <RouteIcon className="size-4 text-teal-600" aria-hidden="true" /> Next stops
            </p>
            <span className="text-[11px] text-slate-400">oldest first</span>
          </div>
          {nextStops.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
              {sites.length === 0 ? 'No geotagged reports are assigned to you yet.' : 'Nothing left to inspect.'}
            </p>
          ) : (
            <ol className="space-y-2">
              {nextStops.map((st, i) => (
                <li key={st.report.id}>
                  <button
                    type="button"
                    onClick={() => onOpenReport?.(st.report)}
                    className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: statusMeta(st.report.engineer_status).color }}>{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-800">{[st.report.barangay, st.report.municipality].filter(Boolean).join(', ') || 'Unknown location'}</span>
                      <span className="block text-[11px] text-slate-500">
                        {statusMeta(st.report.engineer_status).label}
                        {st.nearest && ` · ${formatDistance(st.nearest.distanceMeters)} from route`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {onOpenFullMap && (
            <button
              type="button"
              onClick={() => onOpenFullMap('all')}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700"
            >
              <ExpandIcon className="size-3.5" aria-hidden="true" /> Open full map
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="space-y-3 min-w-0">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          >
            {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            aria-label="Filter by issue type"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          >
            <option value="all">All issue types</option>
            {Object.entries(SEVERITY_TAXONOMY).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFitKey((k) => k + 1)}
              className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExpandIcon className="size-3.5" aria-hidden="true" /> Fit sites
            </button>
            <button
              type="button"
              onClick={toggleTracking}
              aria-pressed={tracking}
              className={`inline-flex items-center gap-1.5 h-9 rounded-lg border px-2.5 text-xs font-medium transition ${tracking ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <CrosshairIcon className="size-3.5" aria-hidden="true" /> {tracking ? 'Tracking location' : 'Track my location'}
            </button>
          </div>
        </div>
        {geoError && <p role="alert" className="text-xs text-red-600 px-1">{geoError}</p>}

        {/* Map */}
        <div className="relative bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <MapContainer center={DEFAULT_CENTER} zoom={11} className="h-[560px] w-full z-0" scrollWheelZoom>
            <BaseTiles basemap={basemap} />
            <FitBounds points={fitPoints} fitKey={`${fitKey}-${sites.length ? 'data' : 'none'}`} />
            {mapOverlays}
          </MapContainer>

          {mapPanels}
        </div>
      </div>

      {/* Side panel */}
      <aside className="space-y-3 min-w-0">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-lg font-semibold text-slate-900">{visibleSites.length}</p>
            <p className="text-[11px] text-slate-500">Sites shown</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-lg font-semibold text-slate-900">{linked}</p>
            <p className="text-[11px] text-slate-500">Linked to a route</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-lg font-semibold text-slate-900">{avgLink == null ? '—' : formatDistance(avgLink)}</p>
            <p className="text-[11px] text-slate-500">Avg. to road</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <RouteIcon className="size-4 text-teal-600" aria-hidden="true" /> Suggested visit order
            </p>
            <span className="text-[11px] text-slate-400">{me ? 'from your location' : 'oldest first'}</span>
          </div>
          {ordered.length === 0 && completedSites.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500">
              {sites.length === 0 ? 'No geotagged reports are assigned to you yet.' : 'No sites match the current filters.'}
            </p>
          ) : (
            <ul className="max-h-[430px] divide-y divide-slate-100 overflow-y-auto">
              {[...ordered, ...completedSites].map((s) => {
                const meta = statusMeta(s.report.engineer_status);
                const order = orderOf.get(s.report.id);
                const fromMe = distanceFromMe(s.point);
                return (
                  <li key={s.report.id} className="flex items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setFlyTarget({ lat: s.point[0], lng: s.point[1], t: Date.now() })}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <span
                        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ background: meta.color }}
                      >
                        {order || <span dangerouslySetInnerHTML={{ __html: doneGlyph.replace('width="14" height="14"', 'width="12" height="12"') }} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-slate-800">
                          {[s.report.barangay, s.report.municipality].filter(Boolean).join(', ') || 'Unknown location'}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {meta.label}
                          {fromMe != null && ` · ${formatDistance(fromMe)} away`}
                          {s.nearest && ` · ${formatDistance(s.nearest.distanceMeters)} from route`}
                        </span>
                      </span>
                    </button>
                    <div className="flex shrink-0 flex-col gap-1">
                      <a
                        href={navUrl(s.point)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Navigate to site"
                        title="Navigate"
                        className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                      >
                        <NavigationIcon className="size-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="px-1 text-[11px] leading-relaxed text-slate-400">
          Visit order is a nearest-site-first estimate by straight-line distance, not a road-routed optimum.
          Route and gap layers show only the data recorded in the system.
        </p>
      </aside>
    </div>
  );
}
