import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Polyline, Marker, Popup, Tooltip, Circle, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CrosshairIcon, ExpandIcon, MapPinIcon } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { buildRoutePoints, boundsFromPoints, getRouteStatusTheme, normalizeRouteStatus } from '../../lib/mapRouteUtils';
import { storeGlyph } from '../../lib/mapMarkerIcons';
import { useBasemap } from '../../lib/basemaps';
import RouteEndpointMarkers from './RouteEndpointMarkers';
import GapSegmentLayer from './GapSegmentLayer';
import BaseTiles from './BaseTiles';
import { MapLegend, LegendGroup, LegendLine, LegendDot, MapControlPanel, ControlGroup, LayerToggle, BasemapSwitch } from './MapPanels';
import { getCitizenStatus } from '../../lib/publicReportStatus';
import { CITIZEN_STATUS_HEX, useMyReports } from '../../lib/useMyReports';
import { formatDistance, nearestPointOnRoute, toPoint } from '../publicReports/routeGeometry';

const DEFAULT_CENTER = [10.89, 122.45];
const ROAD_STATUSES = ['Completed', 'On-Going', 'Proposed'];

function marketIcon() {
  return L.divIcon({
    className: 'custom-market-pin',
    html: `<div style="background:#4338ca;color:#fff;width:26px;height:26px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.25)">${storeGlyph(13)}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function reportIcon(color) {
  return L.divIcon({
    className: 'citizen-report-marker',
    html: `<div style="background:${color};width:22px;height:22px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><div style="width:6px;height:6px;border-radius:9999px;background:#fff"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });
}

function FitTo({ points, fitKey }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    if (last.current === fitKey) return;
    const bounds = boundsFromPoints(points);
    if (!bounds) return;
    last.current = fitKey;
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  }, [map, points, fitKey]);
  return null;
}

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 14, { duration: 1 });
  }, [map, target]);
  return null;
}

/**
 * Dashboard-sized map for the citizen: FMR routes plus the citizen's own report
 * pins, and (on request) the nearest FMR road to where they are standing. The
 * full tool lives on the Map View page.
 */
export default function CitizenOverviewMap() {
  const { reports } = useMyReports();
  const [projects, setProjects] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [basemap, setBasemap] = useBasemap();
  const [layers, setLayers] = useState({ roads: true, endpoints: true, reports: true, markets: true, gaps: false });
  const [roadStatusOn, setRoadStatusOn] = useState({ Completed: true, 'On-Going': true, Proposed: true });
  const [me, setMe] = useState(null);
  const [geoError, setGeoError] = useState('');
  const [locating, setLocating] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, r, m, g] = await Promise.allSettled([
        supabase.from('fmr_projects').select('*'),
        supabase.from('project_routes').select('*'),
        supabase.from('market_locations').select('*'),
        supabase.from('road_network_gaps').select('*'),
      ]);
      if (!alive) return;
      const rows = (res) => (res.status === 'fulfilled' && !res.value.error ? res.value.data || [] : []);
      setProjects(rows(p));
      setRoutes(rows(r));
      setMarkets(rows(m));
      setGaps(rows(g));
    })();
    return () => { alive = false; };
  }, []);

  const allRouteLines = useMemo(() => {
    const byProject = new Map(routes.map((r) => [r.project_id, r]));
    return projects
      .map((project) => {
        const data = buildRoutePoints(project, byProject.get(project.id) || null);
        return data.points.length >= 2 ? { project, points: data.points, data } : null;
      })
      .filter(Boolean);
  }, [projects, routes]);
  const routeLines = useMemo(
    () => allRouteLines.filter(({ project }) => roadStatusOn[normalizeRouteStatus(project.status)] !== false),
    [allRouteLines, roadStatusOn],
  );
  const roadCounts = useMemo(() => {
    const c = { Completed: 0, 'On-Going': 0, Proposed: 0 };
    allRouteLines.forEach(({ project }) => { const k = normalizeRouteStatus(project.status); if (k in c) c[k] += 1; });
    return c;
  }, [allRouteLines]);
  const reportStatusCounts = useMemo(() => {
    const c = new Map();
    reports.forEach((r) => { const st = getCitizenStatus(r); c.set(st.key, { label: st.label, n: (c.get(st.key)?.n || 0) + 1 }); });
    return c;
  }, [reports]);

  const pins = useMemo(() => reports
    .map((report) => {
      const point = toPoint(report.latitude, report.longitude);
      return point ? { report, point, status: getCitizenStatus(report) } : null;
    })
    .filter(Boolean), [reports]);

  const nearestRoad = useMemo(() => {
    if (!me) return null;
    let best = null;
    allRouteLines.forEach(({ project, points }) => {
      const hit = nearestPointOnRoute(points, me);
      if (hit && (!best || hit.distanceMeters < best.distance)) best = { project, distance: hit.distanceMeters };
    });
    return best;
  }, [me, allRouteLines]);

  const fitPoints = useMemo(() => {
    if (pins.length) return pins.map((p) => p.point);
    return allRouteLines.flatMap((r) => r.points);
  }, [pins, allRouteLines]);

  const locate = () => {
    if (!navigator.geolocation) { setGeoError('Location is not available on this device.'); return; }
    setGeoError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = [pos.coords.latitude, pos.coords.longitude];
        setMe(point);
        setFlyTarget([...point]);
        setLocating(false);
      },
      (err) => {
        setGeoError(err.code === 1 ? 'Location permission was denied.' : 'Could not read your location.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const recent = reports.slice(0, 4);
  const setLayer = (key) => (value) => setLayers((prev) => ({ ...prev, [key]: value }));
  const setRoadStatus = (key) => (value) => setRoadStatusOn((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <div className="relative overflow-hidden rounded-xl border border-slate-200">
        <MapContainer center={DEFAULT_CENTER} zoom={10} className="h-[340px] sm:h-[420px] w-full z-0" scrollWheelZoom zoomControl={false}>
          <BaseTiles basemap={basemap} />
          <FitTo points={fitPoints.length ? fitPoints : [DEFAULT_CENTER]} fitKey={`${pins.length}-${allRouteLines.length ? 'r' : 'n'}`} />
          <FlyTo target={flyTarget} />
          {layers.roads && routeLines.map(({ project, points, data }) => (
            <Fragment key={project.id}>
              <Polyline positions={points} pathOptions={{ color: getRouteStatusTheme(project.status).line, weight: 3, opacity: 0.85 }}>
                <Tooltip sticky>{project.project_name}{project.status ? ` (${project.status})` : ''}</Tooltip>
              </Polyline>
              {layers.endpoints && <RouteEndpointMarkers project={project} routeData={data} lineColor={getRouteStatusTheme(project.status).line} />}
            </Fragment>
          ))}
          <GapSegmentLayer gaps={gaps} visible={layers.gaps} />
          {layers.markets && markets.filter((m) => Number.isFinite(Number(m.latitude)) && Number.isFinite(Number(m.longitude))).map((m) => (
            <Marker key={`market-${m.id}`} position={[Number(m.latitude), Number(m.longitude)]} icon={marketIcon()}>
              <Popup>
                <div className="space-y-0.5 text-xs">
                  <p className="font-semibold text-indigo-700">{m.market_name}</p>
                  {m.market_type && <p className="text-slate-600">{m.market_type}</p>}
                </div>
              </Popup>
            </Marker>
          ))}
          {layers.reports && pins.map(({ report, point, status }) => (
            <Marker key={report.id} position={point} icon={reportIcon(CITIZEN_STATUS_HEX[status.key] || '#64748b')}>
              <Popup>
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-slate-900">{status.label}</p>
                  <p className="text-slate-600 line-clamp-3">{report.description}</p>
                  <Link to="/user/reports" className="font-semibold text-emerald-700 hover:underline">View my reports</Link>
                </div>
              </Popup>
            </Marker>
          ))}
          {me && (
            <>
              <Circle center={me} radius={60} pathOptions={{ color: '#0d9488', weight: 1, fillOpacity: 0.12 }} />
              <CircleMarker center={me} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#0d9488', fillOpacity: 1 }}>
                <Tooltip>You are here</Tooltip>
              </CircleMarker>
            </>
          )}
        </MapContainer>
        <MapLegend compact>
          <LegendGroup label="Roads">
            {ROAD_STATUSES.filter((k) => layers.roads && roadStatusOn[k] && roadCounts[k] > 0).map((k) => (
              <LegendLine key={k} color={k === 'Completed' ? 'bg-emerald-500' : k === 'On-Going' ? 'bg-amber-500' : 'bg-blue-500'} label={k} count={roadCounts[k]} />
            ))}
            {layers.roads && layers.endpoints && <LegendDot style={{ background: '#16a34a' }} label="Start (S)" />}
            {layers.roads && layers.endpoints && <LegendDot style={{ background: '#f97316' }} label="End (E)" />}
            {layers.gaps && <LegendLine color="border-red-500" dashed label="Unpaved gap" count={gaps.length} />}
          </LegendGroup>
          <LegendGroup label="Places">
            {layers.markets && markets.length > 0 && <LegendDot style={{ background: '#4338ca' }} label="Market" count={markets.length} />}
            {me && <LegendDot style={{ background: '#0d9488' }} label="You are here" />}
          </LegendGroup>
          <LegendGroup label="Your reports">
            {layers.reports && [...reportStatusCounts.entries()].map(([key, v]) => (
              <LegendDot key={key} style={{ background: CITIZEN_STATUS_HEX[key] || '#64748b' }} label={v.label} count={v.n} />
            ))}
          </LegendGroup>
        </MapLegend>

        <MapControlPanel compact defaultOpen={false}>
          <ControlGroup label="Layers">
            <LayerToggle checked={layers.roads} onChange={setLayer('roads')} label="FMR roads" />
            <LayerToggle checked={layers.endpoints} onChange={setLayer('endpoints')} label="Start / end pins" />
            <LayerToggle checked={layers.gaps} onChange={setLayer('gaps')} label="Unpaved gaps" accent="text-red-600 focus:ring-red-500" />
            <LayerToggle checked={layers.markets} onChange={setLayer('markets')} label="Markets" />
            <LayerToggle checked={layers.reports} onChange={setLayer('reports')} label="My reports" />
          </ControlGroup>
          <ControlGroup label="Road status">
            {ROAD_STATUSES.map((k) => (
              <LayerToggle key={k} checked={roadStatusOn[k]} onChange={setRoadStatus(k)} label={`${k} (${roadCounts[k]})`} accent="text-emerald-600 focus:ring-emerald-500" />
            ))}
          </ControlGroup>
          <ControlGroup label="Basemap">
            <BasemapSwitch value={basemap} onChange={setBasemap} />
          </ControlGroup>
        </MapControlPanel>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <CrosshairIcon className="size-3.5" aria-hidden="true" /> {locating ? 'Locating...' : 'Find the nearest FMR road to me'}
        </button>
        {geoError && <p role="alert" className="text-xs text-red-600">{geoError}</p>}
        {nearestRoad && (
          <p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-900">
            Nearest FMR road: <strong>{nearestRoad.project.project_name}</strong>, about {formatDistance(nearestRoad.distance)} away.
          </p>
        )}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <MapPinIcon className="size-4 text-emerald-700" aria-hidden="true" /> Your reports on the map
          </p>
          {recent.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
              You have not submitted a report yet. Reports you file show here as pins.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((r) => {
                const status = getCitizenStatus(r);
                const point = toPoint(r.latitude, r.longitude);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={!point}
                      onClick={() => point && setFlyTarget([...point])}
                      className="flex w-full items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-white"
                    >
                      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: CITIZEN_STATUS_HEX[status.key] || '#64748b' }} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-slate-800">{r.description || 'Road report'}</span>
                        <span className="block text-[11px] text-slate-500">
                          {status.label}{[r.barangay, r.municipality].filter(Boolean).length ? ` · ${[r.barangay, r.municipality].filter(Boolean).join(', ')}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link
          to="/user/map"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
        >
          <ExpandIcon className="size-3.5" aria-hidden="true" /> Open full map
        </Link>
      </div>
    </div>
  );
}
