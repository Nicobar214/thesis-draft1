import { MapPinIcon, TriangleAlertIcon } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, Circle, CircleMarker, Polyline, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import GapSegmentLayer from '../components/map/GapSegmentLayer';
import { MapLegend, LegendGroup, LegendLine, LegendDot, MapControlPanel, ControlGroup, LayerToggle, BasemapSwitch } from '../components/map/MapPanels';
import StableHeatLayer from '../components/map/StableHeatLayer';
import MapSearchBox from '../components/map/MapSearchBox';
import BaseTiles from '../components/map/BaseTiles';
import { useBasemap } from '../lib/basemaps';
import { norm } from '../lib/placeSearch';
import { CITIZEN_STATUS_HEX, useMyReports } from '../lib/useMyReports';
import { getCitizenStatus } from '../lib/publicReportStatus';
import RouteEndpointMarkers from '../components/map/RouteEndpointMarkers';
import {
  buildRoutePoints,
  boundsFromPoints,
  createDisplayRoutePoints,
  fetchRoadAlignedPolyline,
  getProjectBarangay,
  getRouteStatusTheme,
  getTargetDateChip,
  isOverdueProject,
  normalizeRouteStatus,
  getJitteredCentroid,
} from '../lib/mapRouteUtils';
import { getProjectBudgetSummary, formatPeso } from '../lib/budgetEstimate';
import { formatPercentage } from '../lib/percentageFormat';

import Icons from '../components/Icons';
import UserLayout from '../components/UserLayout';
import FmrProjectDetailDialog from '../components/FmrProjectDetailDialog';
import { useProjectFollows } from '../lib/useProjectFollows';
import 'leaflet/dist/leaflet.css';
import { storeGlyph } from '../lib/mapMarkerIcons';

/* â”€â”€â”€ Icons â”€â”€â”€ */
/* â”€â”€â”€ Normalize status for consistent filtering â”€â”€â”€ */
function normalizeStatus(s) {
  return normalizeRouteStatus(s);
}

/* â”€â”€â”€ Status color helpers â”€â”€â”€ */
function getStatusColor(status) {
  const theme = getRouteStatusTheme(status);
  return { fill: theme.line, stroke: theme.stroke, bg: 'bg-slate-500' };
}

function getStatusBadge(status) {
  switch (normalizeStatus(status)) {
    case 'Completed': return 'bg-emerald-100 text-emerald-700';
    case 'On-Going':  return 'bg-amber-100 text-amber-700';
    case 'Proposed':  return 'bg-sky-100 text-sky-700';
    default:          return 'bg-slate-100 text-slate-700';
  }
}
/* ─── Geofencing helpers ─── */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function segmentMidpoint(p) {
  if (!p.start_latitude || !p.end_latitude) return null;
  return { lat: (p.start_latitude + p.end_latitude) / 2, lng: (p.start_longitude + p.end_longitude) / 2 };
}

function geofenceRadius(p) {
  if (!p.start_latitude || !p.end_latitude) return 500;
  const segLen = haversineMeters(p.start_latitude, p.start_longitude, p.end_latitude, p.end_longitude);
  return Math.max(500, (segLen / 2) + 300);
}

function isProjectNearby(userLat, userLng, p) {
  const radius = geofenceRadius(p);
  const mid = segmentMidpoint(p);
  const nearMid = mid ? haversineMeters(userLat, userLng, mid.lat, mid.lng) <= radius : false;
  const nearStart = p.start_latitude ? haversineMeters(userLat, userLng, p.start_latitude, p.start_longitude) <= 400 : false;
  const nearEnd = p.end_latitude ? haversineMeters(userLat, userLng, p.end_latitude, p.end_longitude) <= 400 : false;
  return nearMid || nearStart || nearEnd;
}

function fmtDistance(m) {
  if (m < 1000) return `~${Math.round(m)}m`;
  return `~${(m / 1000).toFixed(1)}km`;
}
/* ─── Map bounds fitter ─── */
function FitBounds({ points, filterKey }) {
  const map = useMap();
  const lastKeyRef = useRef('');

  useEffect(() => {
    if (!points || points.length === 0) return;
    if (filterKey === undefined || lastKeyRef.current !== filterKey) {
      if (filterKey !== undefined) {
        lastKeyRef.current = filterKey;
      }
      const bounds = boundsFromPoints(points);
      if (bounds) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  }, [points, filterKey, map]);

  return null;
}

/* Flies to the place picked in the search box. */
function SearchFlyController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target.coords, target.zoom, { duration: 1 });
  }, [target, map]);
  return null;
}

function SelectedProjectMapController({ selectedProject }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedProject) return;

    const startLat = Number(selectedProject.start_latitude || selectedProject.startLatitude);
    const startLng = Number(selectedProject.start_longitude || selectedProject.startLongitude);
    const endLat = Number(selectedProject.end_latitude || selectedProject.endLatitude);
    const endLng = Number(selectedProject.end_longitude || selectedProject.endLongitude);

    if (Number.isFinite(startLat) && Number.isFinite(startLng)) {
      if (Number.isFinite(endLat) && Number.isFinite(endLng)) {
        const bounds = L.latLngBounds([startLat, startLng], [endLat, endLng]);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      } else {
        map.flyTo([startLat, startLng], 15);
      }
    }
  }, [selectedProject, map]);

  return null;
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

/* ─── Status Filter Tabs ─── */
const statusFilters = ['All', 'On-Going', 'Proposed', 'Completed'];

/* â”€â”€â”€ Year options from data â”€â”€â”€ */
function getYearOptions(projects) {
  const years = [...new Set(projects.map(p => Number(p.year_funded)).filter(y => y && !isNaN(y)))].sort((a, b) => b - a);
  return years;
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAIN MAP VIEW PAGE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function UserMapView({ embedded = false } = {}) {
  const [projects, setProjects] = useState([]);
  const [tranchesByProjectId, setTranchesByProjectId] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [searchTarget, setSearchTarget] = useState(null); // { coords, zoom }
  const [statusFilter, setStatusFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState('All');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  // Selecting a project focuses it on the map; this controls the details dialog.
  // Closing the dialog keeps the selection so the map stays focused on the road.
  const [detailOpen, setDetailOpen] = useState(false);
  const follows = useProjectFollows();
  const closeDetail = () => setDetailOpen(false);
  const openProject = (project) => { setSelectedProject(project); setDetailOpen(true); };
  const [hoveredProjectId, setHoveredProjectId] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [routeByProjectId, setRouteByProjectId] = useState({});
  const [reportCountByProjectId, setReportCountByProjectId] = useState({});
  const [snappedRouteByProjectId, setSnappedRouteByProjectId] = useState({});

  // Farmer & Market Supply Chain layers (PII-free for citizen view)
  const [farmerBeneficiaries, setFarmerBeneficiaries] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [showFarmerDots, setShowFarmerDots] = useState(false);
  const [roadGaps, setRoadGaps] = useState([]);
  const [showRoadGaps, setShowRoadGaps] = useState(false);
  const [showFarmerHeatmap, setShowFarmerHeatmap] = useState(false);
  const [showMarketsMap, setShowMarketsMap] = useState(true);
  const [showMyReports, setShowMyReports] = useState(true);
  const [basemap, setBasemap] = useBasemap();
  // Only signed-in citizens have reports; the embedded landing-page map has none.
  const { reports: myReports } = useMyReports({ enabled: !embedded });

  // Geofencing state
  const [userLocation, setUserLocation] = useState(null); // { lat, lng, accuracy }
  const [nearbyProjects, setNearbyProjects] = useState(new Set());
  const gpsWatchRef = useRef(null);

  // Start GPS watcher for geofencing
  useEffect(() => {
    if (!navigator.geolocation) return;
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => { /* permission denied or unavailable — silently skip */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
    return () => {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
      }
    };
  }, []);

  // Fetch data
  useEffect(() => {
    fetchProjects();
    fetchProjectRoutes();
    fetchRoadGaps();
    fetchProjectReportCounts();
    fetchFarmerBeneficiaries();
    fetchMarkets();
    fetchProjectTranches();

    const channel = supabase
      .channel('map-view-fmr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, fetchProjects)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_routes' }, fetchProjectRoutes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'road_network_gaps' }, fetchRoadGaps)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, fetchProjectReportCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'farmer_beneficiaries' }, fetchFarmerBeneficiaries)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_locations' }, fetchMarkets)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tranches' }, fetchProjectTranches)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchFarmerBeneficiaries() {
    try {
      const { data, error } = await supabase
        .from('farmer_beneficiaries')
        .select('id, farm_latitude, farm_longitude, crop');
      if (error) throw error;
      setFarmerBeneficiaries(data || []);
    } catch (err) {
      console.error('Error fetching farmer beneficiaries:', err);
    }
  }

  async function fetchMarkets() {
    try {
      const { data, error } = await supabase
        .from('market_locations')
        .select('*')
        .order('market_name', { ascending: true });
      if (error) throw error;
      setMarkets(data || []);
    } catch (err) {
      console.error('Error fetching markets:', err);
    }
  }

  async function fetchProjects() {
    try {
      setFetchError(null);
      const { data, error } = await supabase
        .from('fmr_projects')
        .select('*')
        .order('year_funded', { ascending: false });

      if (error) {
        setFetchError(error.message);
        throw error;
      }
      setProjects(data || []);
    } catch (e) {
      console.error('Error fetching projects for map:', e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchProjectTranches() {
    try {
      const { data, error } = await supabase
        .from('project_tranches')
        // Citizens see budget totals only - never who released a tranche or internal notes.
        .select('id, project_id, tranche_order, tranche_name, percentage, amount, required_progress, status, released_amount, released_date')
        .order('tranche_order', { ascending: true });
      if (error) throw error;
      const map = {};
      (data || []).forEach((t) => {
        if (!map[t.project_id]) map[t.project_id] = [];
        map[t.project_id].push(t);
      });
      setTranchesByProjectId(map);
    } catch (e) {
      console.error('Error fetching project tranches:', e);
    }
  }

  async function fetchRoadGaps() {
    try {
      const { data, error } = await supabase
        .from('road_network_gaps')
        .select('*')
        .order('gap_km', { ascending: false });
      // Keep the map usable if the table is absent in a given deployment.
      setRoadGaps(error ? [] : data || []);
    } catch {
      setRoadGaps([]);
    }
  }

  async function fetchProjectRoutes() {
    try {
      const { data, error } = await supabase.from('project_routes').select('*');
      if (error) {
        // Keep map functional when project_routes does not exist yet in a deployment.
        setRouteByProjectId({});
        return;
      }

      const next = {};
      (data || []).forEach((route) => {
        if (!route?.project_id) return;
        next[route.project_id] = route;
      });
      setRouteByProjectId(next);
    } catch {
      setRouteByProjectId({});
    }
  }

  async function fetchProjectReportCounts() {
    try {
      const { data, error } = await supabase
        .from('public_reports_citizen_view')
        .select('project_id, project_name');

      if (error) return;

      const counts = {};
      const byName = {};
      projects.forEach((p) => {
        const name = String(p.project_name || '').trim().toLowerCase();
        if (name) byName[name] = p.id;
      });

      (data || []).forEach((row) => {
        let key = row.project_id;
        if (!key && row.project_name) {
          key = byName[String(row.project_name).trim().toLowerCase()] || null;
        }
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
      });

      setReportCountByProjectId(counts);
    } catch {
      setReportCountByProjectId({});
    }
  }

  // Filter logic
  const filtered = useMemo(() => {
    return projects.filter(p => {
      const q = norm(search).replace(/ /g, '');
      const haystack = norm([p.project_name, p.location, p.municipality, getProjectBarangay(p)].join(' ')).replace(/ /g, '');

      const matchesSearch = !q || haystack.includes(q);
      const matchesStatus = statusFilter === 'All' || normalizeStatus(p.status) === statusFilter;
      const matchesYear = yearFilter === 'All' || String(Number(p.year_funded)) === yearFilter;
      const matchesMunicipality = municipalityFilter === 'All' || (p.municipality || '') === municipalityFilter;
      const matchesOverdue = !showOverdueOnly || isOverdueProject(p);
      return matchesSearch && matchesStatus && matchesYear && matchesMunicipality && matchesOverdue;
    });
  }, [projects, search, statusFilter, yearFilter, municipalityFilter, showOverdueOnly]);

  const mapEntities = useMemo(() => {
    const municipalityCounts = {};
    return filtered.map((project) => {
      const route = buildRoutePoints(project, routeByProjectId[project.id]);
      
      const hasActualCoordinates = route.hasPolyline || Boolean(project.start_latitude && project.start_longitude);
      let coordinates = null;
      let isApproximate = false;
      let isCentroidFallback = false;

      if (hasActualCoordinates) {
        coordinates = route.startPoint || [project.start_latitude, project.start_longitude];
        const remarks = String(project.remarks || '').toLowerCase();
        if (remarks.includes('auto-geocoded')) {
          isApproximate = true;
        }
      } else {
        isCentroidFallback = true;
        const muni = project.municipality || 'Leon';
        municipalityCounts[muni] = (municipalityCounts[muni] || 0) + 1;
        coordinates = getJitteredCentroid(muni, municipalityCounts[muni]);
      }

      return {
        project,
        route,
        coordinates,
        isApproximate,
        isCentroidFallback,
        hasFallbackPin: !route.hasPolyline || isCentroidFallback || isApproximate,
      };
    });
  }, [filtered, routeByProjectId]);

  const mappable = useMemo(() => {
    return mapEntities.filter((entity) => entity.coordinates && Number.isFinite(entity.coordinates[0]));
  }, [mapEntities]);

  useEffect(() => {
    let cancelled = false;

    async function snapRoutes() {
      // Only snap routes that don't already have an official detailed route record in project_routes
      const candidates = mappable.filter((entity) => entity.route.hasPolyline && !entity.route.hasRouteRecord).slice(0, 50);
      const snappedEntries = await Promise.all(
        candidates.map(async (entity) => {
          const snapped = await fetchRoadAlignedPolyline(entity.route.points);
          return [entity.project.id, snapped];
        })
      );

      if (cancelled) return;
      setSnappedRouteByProjectId((prev) => {
        const next = { ...prev };
        snappedEntries.forEach(([projectId, points]) => {
          next[projectId] = points;
        });
        return next;
      });
    }

    snapRoutes();
    return () => {
      cancelled = true;
    };
  }, [mappable]);

  const mapBoundsPoints = useMemo(() => {
    const pts = [];
    mappable.forEach((entity) => {
      const routePoints = snappedRouteByProjectId[entity.project.id] || entity.route.points;
      if (routePoints.length > 0) {
        pts.push(...routePoints);
      } else if (entity.coordinates) {
        pts.push(entity.coordinates);
      }
    });
    return pts;
  }, [mappable, snappedRouteByProjectId]);

  // Recompute nearby projects whenever location or mappable projects change
  useEffect(() => {
    if (!userLocation) return;
    const ids = new Set(
      mappable
        .filter((entity) => isProjectNearby(userLocation.lat, userLocation.lng, entity.project))
        .map((entity) => entity.project.id)
    );
    setNearbyProjects(ids);
  }, [userLocation, mappable]);

  useEffect(() => {
    fetchProjectReportCounts();
  }, [projects]);

  // Program-wide counts (every project, whatever the filters), shown on the chips and the stats row.
  const programCounts = useMemo(() => ({
    All: projects.length,
    Completed: projects.filter((p) => normalizeStatus(p.status) === 'Completed').length,
    'On-Going': projects.filter((p) => normalizeStatus(p.status) === 'On-Going').length,
    Proposed: projects.filter((p) => normalizeStatus(p.status) === 'Proposed').length,
    totalKm: projects.reduce((sum, p) => sum + (Number(p.project_length_km) || 0), 0).toFixed(2),
  }), [projects]);

  // Stats
  const stats = useMemo(() => ({
    total: filtered.length,
    mapped: mappable.length,
    completed: filtered.filter(p => normalizeStatus(p.status) === 'Completed').length,
    ongoing: filtered.filter(p => normalizeStatus(p.status) === 'On-Going').length,
    proposed: filtered.filter(p => normalizeStatus(p.status) === 'Proposed').length,
    totalKm: filtered.reduce((s, p) => s + (p.project_length_km || 0), 0).toFixed(2),
  }), [filtered, mappable]);

  const yearOptions = useMemo(() => getYearOptions(projects), [projects]);
  const municipalityOptions = useMemo(
    () => [...new Set(projects.map((p) => p.municipality).filter(Boolean))].sort(),
    [projects]
  );

  // Iloilo center
  const center = [10.89, 122.45];

  const layoutProps = embedded
    ? {
        requireAuth: false,
        showSidebar: false,
        showHeader: false,
        rootClassName: 'bg-transparent',
        mainClassName: 'min-h-0',
        contentClassName: 'px-0 py-0 pt-0',
      }
    : {};

  const farmerHeatPoints = useMemo(() => {
    return (farmerBeneficiaries || [])
      .map((f) => {
        const lat = f.farm_latitude || f.farmLatitude;
        const lng = f.farm_longitude || f.farmLongitude;
        return lat && lng ? [Number(lat), Number(lng), 1.0] : null;
      })
      .filter(Boolean);
  }, [farmerBeneficiaries]);

  const filterKey = `${search}-${statusFilter}-${yearFilter}-${municipalityFilter}-${showOverdueOnly}`;

  return (
    <UserLayout {...layoutProps}>
      <div className="space-y-4">
        {/* Header */}
        <section>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="size-10 bg-emerald-100 rounded-xl grid place-items-center text-teal-600">
                <Icons.MapPin />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Map View</h1>
                <p className="text-slate-500 text-sm">FMR Project locations across Iloilo Province</p>
              </div>
            </div>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-slate-700 lg:hidden"
            >
              <Icons.List /> Projects ({filtered.length})
            </button>
          </div>
        </section>

        {/* Error banner */}
        {fetchError && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <Icons.Warning />
            <div>
              <p className="font-medium">Unable to load FMR projects</p>
              <p className="mt-0.5 text-red-600">{fetchError}</p>
            </div>
          </div>
        )}

        {/* Filters bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <MapSearchBox
              projects={projects}
              value={search}
              onChange={setSearch}
              placeholder="Search a barangay, road or project..."
              inputClassName="py-2.5 text-sm"
              onSelect={(place) => {
                // A project narrows the list to itself; a place just moves the map.
                setSearch(place.type === 'project' ? place.label : '');
                setSearchTarget({ coords: [place.lat, place.lng], zoom: place.zoom });
              }}
            />
          </div>

          {/* Year filter */}
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            className="px-3.5 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
          >
            <option value="All">All Years</option>
            {yearOptions.map(y => (
              <option key={y} value={String(y)}>FY {y}</option>
            ))}
          </select>

          <select
            value={municipalityFilter}
            onChange={e => setMunicipalityFilter(e.target.value)}
            className="px-3.5 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
          >
            <option value="All">All Municipalities</option>
            {municipalityOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <button
            onClick={() => setShowOverdueOnly((prev) => !prev)}
            className={`px-3.5 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap border transition-all ${
              showOverdueOnly
                ? 'bg-red-600 border-red-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Show Overdue Only
          </button>

          {/* Status pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                  statusFilter === s
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {s}
                <span className={`ml-1.5 text-xs tabular-nums ${statusFilter === s ? 'text-teal-100' : 'text-slate-400'}`}>{programCounts[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* GPS / Nearby banner */}
        {userLocation && nearbyProjects.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-800">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-500" />
            </span>
            <span className="font-medium">
              <MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{nearbyProjects.size} project{nearbyProjects.size > 1 ? 's' : ''} detected near your current location
            </span>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
          <span className="font-semibold text-slate-700">{programCounts.All} FMR projects</span>
          <span className="text-slate-300">|</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-emerald-500 inline-block" /> {programCounts.Completed} Completed</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500 inline-block" /> {programCounts['On-Going']} On-Going</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-blue-500 inline-block" /> {programCounts.Proposed} Proposed</span>
          <span className="text-slate-300">|</span>
          <span>{programCounts.totalKm} km total</span>
          {filtered.length !== programCounts.All && (
            <>
              <span className="text-slate-300">|</span>
              <span className="font-medium text-teal-700">Showing {filtered.length} ({stats.mapped} on map)</span>
            </>
          )}
        </div>

        {/* Main content: Map + sidebar */}
        <div className={`flex gap-4 relative ${showSidebar ? 'z-[60]' : 'z-10'}`}>
          {/* Map */}
          <div className="flex-1 relative bg-white rounded-2xl border border-slate-200/60 overflow-hidden" style={{ height: 'calc(100dvh - 320px)', minHeight: '420px' }}>
            {loading ? (
              <div className="h-full flex items-center justify-center bg-slate-50">
                <div className="text-center">
                  <div className="size-10 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Loading map data...</p>
                </div>
              </div>
            ) : (
              <MapContainer
                center={center}
                zoom={9}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={true}
                className="z-0"
              >
                <BaseTiles basemap={basemap} />
                <FitBounds points={mapBoundsPoints} filterKey={filterKey} />
                <SelectedProjectMapController selectedProject={selectedProject} />
                <SearchFlyController target={searchTarget} />

                {/* User location: geofence zone + pulsing marker */}
                {userLocation && (() => {
                  const nearbyList = mappable
                    .filter(entity => nearbyProjects.has(entity.project.id))
                    .map(entity => entity.project);
                  const smallestRadius = nearbyList.length > 0
                    ? Math.min(...nearbyList.map(geofenceRadius))
                    : 500;
                  return (
                    <>
                      <Circle
                        center={[userLocation.lat, userLocation.lng]}
                        radius={smallestRadius}
                        pathOptions={{ color: '#0d9488', fillColor: '#0d9488', fillOpacity: 0.07, weight: 1.5, dashArray: '5 4' }}
                      />
                      {/* Outer pulsing ring */}
                      <CircleMarker
                        center={[userLocation.lat, userLocation.lng]}
                        radius={16}
                        pathOptions={{ color: '#0d9488', fillColor: '#0d9488', fillOpacity: 0.15, weight: 1 }}
                      />
                      {/* Inner solid dot */}
                      <CircleMarker
                        center={[userLocation.lat, userLocation.lng]}
                        radius={7}
                        pathOptions={{ color: '#fff', fillColor: '#0d9488', fillOpacity: 1, weight: 2 }}
                      >
                        <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                          <span style={{ fontSize: '11px', fontWeight: 600 }}>You are here</span>
                          {userLocation.accuracy && (
                            <><br /><span style={{ fontSize: '10px', color: '#6b7280' }}>±{Math.round(userLocation.accuracy)}m accuracy</span></>
                          )}
                        </Tooltip>
                      </CircleMarker>
                    </>
                  );
                })()}

                {mappable.map(({ project, route, coordinates, isApproximate, isCentroidFallback, hasFallbackPin }) => {
                  const color = getStatusColor(project.status);
                  const isSelected = selectedProject?.id === project.id;
                  const isFocused = isSelected || hoveredProjectId === project.id;
                  const isNearby = nearbyProjects.has(project.id);
                  const normalizedStatus = normalizeStatus(project.status);
                  const progress = Number(project.accomplishment || 0);
                  const budget = getProjectBudgetSummary(project, tranchesByProjectId[project.id] || []);
                  const reportsCount = reportCountByProjectId[project.id] || 0;
                  const targetChip = getTargetDateChip(project.target_completion_date, normalizedStatus === 'Completed');
                  const routePoints = snappedRouteByProjectId[project.id] || route.points;
                  const displayRoutePoints = createDisplayRoutePoints(routePoints, project.id);
                  const routeStart = routePoints[0] || route.startPoint;
                  const routeEnd = routePoints[routePoints.length - 1] || route.endPoint;

                  return (
                    <div key={project.id}>
                      {route.hasPolyline && !isCentroidFallback && (
                        <>
                          {isFocused && (
                            <Polyline
                              positions={displayRoutePoints}
                              pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }}
                            />
                          )}
                          <Polyline
                            positions={displayRoutePoints}
                            pathOptions={{
                              color: isNearby ? '#0d9488' : color.fill,
                              weight: isFocused ? 5.5 : 3.4,
                              opacity: isFocused ? 0.96 : 0.72,
                            }}
                            eventHandlers={{
                              mouseover: () => setHoveredProjectId(project.id),
                              mouseout: () => setHoveredProjectId(null),
                              click: () => openProject(project),
                            }}
                          >
                            <Tooltip sticky direction="top" offset={[0, -12]} opacity={0.97}>
                              <div className="min-w-[180px]">
                                <p className="text-xs font-semibold text-slate-900">{project.project_name}</p>
                                <p className="text-[11px] text-slate-600 mt-0.5">{normalizedStatus} • {project.municipality || 'N/A'}</p>
                              </div>
                            </Tooltip>
                            <Popup maxWidth={360} className="custom-popup">
                              <div className="space-y-3 min-w-[260px]">
                                <div className="flex items-start justify-between gap-3">
                                  <h3 className="font-semibold text-slate-900 text-sm leading-snug">{project.project_name}</h3>
                                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getStatusBadge(project.status)}`}>
                                    {normalizedStatus}
                                  </span>
                                </div>

                                <div>
                                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                    <span>Progress</span>
                                    <span className="font-semibold text-slate-700">{formatPercentage(progress)}</span>
                                  </div>
                                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.min(progress, 100)}%` }} />
                                  </div>
                                </div>

                                <div className="text-xs text-slate-600 space-y-1">
                                  <p>{project.municipality || 'N/A'}, {getProjectBarangay(project)}</p>
                                  <p>FY {project.year_funded || 'N/A'} • {project.project_length_km || 0} km</p>
                                  <p>
                                    Budget: <strong>{formatPeso(budget.totalBudget)}</strong>
                                    <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.budgetIsEstimated ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                      {budget.budgetIsEstimated ? 'Est.' : 'Official'}
                                    </span>
                                  </p>
                                  {targetChip && (
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${targetChip.className}`}>
                                      {targetChip.text}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  <a
                                    href={`/reports?search=${encodeURIComponent(project.project_name || '')}`}
                                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-sky-100 text-sky-700 hover:bg-sky-200"
                                  >
                                    {reportsCount} public reports
                                  </a>
                                  <a
                                    href={`/projects/${project.id}`}
                                    className="inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-medium bg-slate-900 text-white hover:bg-slate-800"
                                  >
                                    View Details
                                  </a>
                                </div>
                              </div>
                            </Popup>
                          </Polyline>

                          {/* Labelled S/E pins plus a mid-route direction arrow. Previously a
                              4px green dot and a 10px orange dot, which showed that something was
                              at each end but not which way the road ran. */}
                          <RouteEndpointMarkers
                            project={project}
                            routeData={{ ...route, startPoint: routeStart, endPoint: routeEnd }}
                            displayPoints={displayRoutePoints}
                            isFocused={isFocused}
                            lineColor={color}
                          />
                        </>
                      )}

                      {hasFallbackPin && coordinates && (
                        <CircleMarker
                          center={coordinates}
                          radius={isSelected ? 9 : 6}
                          pathOptions={{
                            fillColor: color.fill,
                            color: color.stroke,
                            weight: isSelected ? 3 : 1.5,
                            fillOpacity: isSelected ? 0.9 : 0.7,
                            dashArray: isCentroidFallback ? '3, 4' : undefined
                          }}
                          eventHandlers={{
                            mouseover: () => setHoveredProjectId(project.id),
                            mouseout: () => setHoveredProjectId(null),
                            click: () => openProject(project),
                          }}
                        >
                          <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                            <div className="p-1">
                              <strong className="text-slate-900 block font-semibold">{project.project_name}</strong>
                              <span className="text-[10px] text-slate-500 block mt-0.5">
                                {isCentroidFallback ? <><TriangleAlertIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Centroid Fallback</> : <><MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Barangay Center</>}
                              </span>
                            </div>
                          </Tooltip>
                          <Popup maxWidth={360} className="custom-popup">
                            <div className="space-y-3 min-w-[260px]">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <h3 className="font-semibold text-slate-900 text-sm leading-snug">{project.project_name}</h3>
                                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                    {isCentroidFallback ? 'MUNICIPAL CENTROID PIN' : 'BARANGAY CENTER GEOTAG'}
                                  </p>
                                </div>
                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getStatusBadge(project.status)}`}>
                                  {normalizedStatus}
                                </span>
                              </div>

                              <div>
                                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                  <span>Progress</span>
                                  <span className="font-semibold text-slate-700">{formatPercentage(progress)}</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.min(progress, 100)}%` }} />
                                </div>
                              </div>

                              <div className="text-xs text-slate-600 space-y-1.5 p-2 bg-slate-50 rounded-lg border border-slate-100">
                                <p><strong>Location:</strong> {project.municipality || 'N/A'}, {getProjectBarangay(project)}</p>
                                <p><strong>Funding:</strong> FY {project.year_funded || 'N/A'} • {project.project_length_km || 0} km</p>
                                <p>
                                  <strong>Budget:</strong> {formatPeso(budget.totalBudget)}
                                  <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.budgetIsEstimated ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    {budget.budgetIsEstimated ? 'Est.' : 'Official'}
                                  </span>
                                </p>
                                {isCentroidFallback && (
                                  <p className="text-[10px] text-amber-700 font-medium"><TriangleAlertIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />No exact coordinates. Placed at municipal center centroid.</p>
                                )}
                                {isApproximate && (
                                  <p className="text-[10px] text-orange-700 font-medium"><MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Coordinates auto-geocoded to Barangay center.</p>
                                )}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
                                <a
                                  href={`/reports?search=${encodeURIComponent(project.project_name || '')}`}
                                  className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-sky-100 text-sky-700 hover:bg-sky-200"
                                >
                                  {reportsCount} reports
                                </a>
                                <a
                                  href={`/projects/${project.id}`}
                                  className="inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-medium bg-slate-900 text-white hover:bg-slate-800"
                                >
                                  View Details
                                </a>
                              </div>
                            </div>
                          </Popup>
                        </CircleMarker>
                      )}
                    </div>
                  );
                })}
                {/* Farmer Heatmap Layer */}
                <FarmerHeatmapLayer visible={showFarmerHeatmap} points={farmerHeatPoints} />

                {/* Unpaved gaps beyond each funded route, from public.road_network_gaps */}
                <GapSegmentLayer gaps={roadGaps} visible={showRoadGaps} />

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

                {/* Farmers Layer (Dots only - strictly anonymous) */}
                {showFarmerDots && (farmerBeneficiaries || []).map(f => {
                  const lat = f.farm_latitude || f.farmLatitude;
                  const lng = f.farm_longitude || f.farmLongitude;
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
                      radius={5.5}
                      pathOptions={{
                        fillColor: cropColor,
                        fillOpacity: 0.9,
                        color: '#ffffff',
                        weight: 1.5
                      }}
                    >
                      <Tooltip direction="top" opacity={0.9}>
                        <span className="text-xs font-semibold text-slate-700">Crop Beneficiary ({f.crop || 'N/A'})</span>
                      </Tooltip>
                    </CircleMarker>
                  );
                })}
                {/* The citizen's own reports, colored by where they are in the workflow */}
                {!embedded && showMyReports && myReports.map((r) => {
                  const lat = Number(r.latitude);
                  const lng = Number(r.longitude);
                  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                  const status = getCitizenStatus(r);
                  const color = CITIZEN_STATUS_HEX[status.key] || '#64748b';
                  return (
                    <Marker
                      key={`my-report-${r.id}`}
                      position={[lat, lng]}
                      icon={L.divIcon({
                        className: 'citizen-report-marker',
                        html: `<div style="background:${color};width:24px;height:24px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><div style="width:7px;height:7px;border-radius:9999px;background:#fff"></div></div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12],
                        popupAnchor: [0, -12],
                      })}
                    >
                      <Popup>
                        <div className="space-y-1 text-xs">
                          <p className="font-semibold text-slate-900">Your report: {status.label}</p>
                          <p className="text-slate-600">{r.description}</p>
                          <p className="text-slate-500">{status.helper}</p>
                          <a href="/user/reports" className="font-semibold text-emerald-700 hover:underline">Open in My Reports</a>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            )}

            <MapLegend>
              <LegendGroup label="Roads">
                {stats.completed > 0 && <LegendLine color="bg-emerald-500" label="Completed" count={stats.completed} />}
                {stats.ongoing > 0 && <LegendLine color="bg-amber-500" label="On-Going" count={stats.ongoing} />}
                {stats.proposed > 0 && <LegendLine color="bg-blue-500" label="Proposed" count={stats.proposed} />}
              </LegendGroup>
              <LegendGroup label="Markers">
                {mappable.length > 0 && <LegendDot color="bg-emerald-600" text="S" label="Route start" />}
                {mappable.length > 0 && <LegendDot color="bg-orange-500" text="E" label="Route end" />}
                {mapEntities.some((e) => e.isApproximate) && <LegendDot color="bg-emerald-50" ring="border-2 border-emerald-700" label="Barangay geocoded" />}
                {mapEntities.some((e) => e.isCentroidFallback) && <LegendDot color="bg-amber-50" ring="border-2 border-dashed border-amber-600" label="Centroid fallback (no GPS)" />}
              </LegendGroup>
              {(showRoadGaps || showMarketsMap || showFarmerDots || showFarmerHeatmap) && (
                <LegendGroup label="Layers">
                  {showRoadGaps && <LegendLine color="border-red-500" dashed label="Unpaved road gap" />}
                  {showMarketsMap && <LegendDot color="bg-indigo-700" label="Market" />}
                  {showFarmerDots && <LegendDot color="bg-teal-600" label="Farmer (anonymous)" />}
                  {showFarmerHeatmap && (
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-6 shrink-0 rounded" style={{ background: 'linear-gradient(90deg,#86efac,#fcd34d,#fca5a5,#ef4444)' }} />
                      <span>Farmer density</span>
                    </div>
                  )}
                </LegendGroup>
              )}
              {!embedded && showMyReports && myReports.length > 0 && (
                <LegendGroup label="My reports">
                  <LegendDot color="" style={{ background: CITIZEN_STATUS_HEX.submitted }} label="Submitted" />
                  <LegendDot color="" style={{ background: CITIZEN_STATUS_HEX.under_review }} label="In review / inspection" />
                  <LegendDot color="" style={{ background: CITIZEN_STATUS_HEX.resolved }} label="Resolved" />
                </LegendGroup>
              )}
            </MapLegend>

            <MapControlPanel>
              <ControlGroup label="Layers">
                <LayerToggle checked={showMarketsMap} onChange={setShowMarketsMap} label="Markets" />
                <LayerToggle checked={showRoadGaps} onChange={setShowRoadGaps} label={`Road gaps (${roadGaps.length})`} accent="text-red-600 focus:ring-red-500" />
                <LayerToggle checked={showFarmerDots} onChange={setShowFarmerDots} label="Farmers (dots)" />
                <LayerToggle checked={showFarmerHeatmap} onChange={setShowFarmerHeatmap} label="Farmer density" />
                {!embedded && <LayerToggle checked={showMyReports} onChange={setShowMyReports} label={`My reports (${myReports.length})`} />}
              </ControlGroup>
              <ControlGroup label="Basemap">
                <BasemapSwitch value={basemap} onChange={setBasemap} />
              </ControlGroup>
            </MapControlPanel>
          </div>

          {/* Sidebar project list (desktop always visible, mobile toggled) */}
          <aside
            className={`
              ${showSidebar ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
              fixed lg:static inset-y-0 right-0 z-50 w-[min(20rem,88vw)] lg:w-80
              bg-white lg:rounded-2xl border border-slate-200/60 
              transition-transform duration-300 lg:transition-none
              flex flex-col overflow-hidden
              h-dvh lg:h-[calc(100dvh-320px)] lg:min-h-[450px]
            `}
          >
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <div>
                <h2 className="font-semibold text-slate-900 text-sm">Projects</h2>
                <p className="text-xs text-slate-400">{filtered.length} total &middot; {mappable.length} mapped</p>
              </div>
              <button
                onClick={() => setShowSidebar(false)}
                className="lg:hidden p-1 text-slate-400 hover:text-slate-600"
              >
                <Icons.X />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-50">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">No projects match the filters</div>
              ) : (
                filtered.map(p => {
                  const isActive = selectedProject?.id === p.id;
                  const hasPins = p.start_latitude && p.start_longitude;
                  const color = getStatusColor(p.status);
                  const isNearby = nearbyProjects.has(p.id);
                  const mid = segmentMidpoint(p);
                  const distM = mid && userLocation
                    ? haversineMeters(userLocation.lat, userLocation.lng, mid.lat, mid.lng)
                    : null;

                  return (
                    <button
                      key={p.id}
                      onClick={() => { openProject(p); setShowSidebar(false); }}
                      className={`w-full text-left px-4 py-3 transition-colors text-sm ${
                        isActive
                          ? 'bg-emerald-50 border-l-2 border-emerald-500'
                          : isNearby
                          ? 'bg-teal-50/60 border-l-2 border-teal-400 hover:bg-teal-50'
                          : 'hover:bg-slate-50 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="size-2.5 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: isNearby ? '#0d9488' : color.fill }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium line-clamp-2 leading-snug ${isActive ? 'text-emerald-800' : isNearby ? 'text-teal-800' : 'text-slate-800'}`}>
                            {p.project_name}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 flex-wrap">
                            {p.municipality && <span>{p.municipality}</span>}
                            {p.year_funded && <span>FY {p.year_funded}</span>}
                            {p.project_length_km > 0 && <span>{p.project_length_km} km</span>}
                            {distM !== null && (
                              <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 font-medium">
                                <MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{fmtDistance(distM)}
                              </span>
                            )}
                          </div>
                          {!hasPins && (
                            <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              No GPS
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Mobile sidebar overlay */}
          {showSidebar && (
            <div
              className="lg:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => setShowSidebar(false)}
            />
          )}
        </div>

        {/* Selected project detail card */}
        {selectedProject && detailOpen && (
          <FmrProjectDetailDialog
            project={selectedProject}
            tranches={tranchesByProjectId[selectedProject.id] || []}
            follow={follows.followProps(selectedProject.id)}
            onClose={closeDetail}
          />
        )}

        {/* Source */}
        {!loading && projects.length > 0 && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
            <p className="text-xs text-slate-400">
              Data from Department of Agriculture - RAED Region VI &middot; Farm-to-Market Road Development Program (FMRDP)
            </p>
          </div>
        )}
      </div>
    </UserLayout>
  );
}



