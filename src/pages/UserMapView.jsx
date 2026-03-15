import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import { supabase } from '../lib/supabase';

import Icons from '../components/Icons';
import UserLayout from '../components/UserLayout';
import 'leaflet/dist/leaflet.css';

/* â”€â”€â”€ Icons â”€â”€â”€ */
/* â”€â”€â”€ Normalize status for consistent filtering â”€â”€â”€ */
function normalizeStatus(s) {
  if (!s) return '';
  const lower = s.toLowerCase().replace(/[-\s]/g, '');
  if (lower === 'ongoing') return 'On-Going';
  if (lower === 'completed') return 'Completed';
  if (lower === 'proposed') return 'Proposed';
  return s;
}

/* â”€â”€â”€ Status color helpers â”€â”€â”€ */
function getStatusColor(status) {
  switch (normalizeStatus(status)) {
    case 'Completed': return { fill: '#10b981', stroke: '#059669', bg: 'bg-emerald-500' };
    case 'On-Going':  return { fill: '#f59e0b', stroke: '#d97706', bg: 'bg-amber-500' };
    case 'Proposed':  return { fill: '#3b82f6', stroke: '#2563eb', bg: 'bg-blue-500' };
    default:          return { fill: '#6b7280', stroke: '#4b5563', bg: 'bg-slate-500' };
  }
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
/* â”€â”€â”€ Map bounds fitter â”€â”€â”€ */
function FitBounds({ projects }) {
  const map = useMap();

  useEffect(() => {
    if (projects.length === 0) return;
    const lats = projects.map(p => p.start_latitude).filter(Boolean);
    const lngs = projects.map(p => p.start_longitude).filter(Boolean);
    if (lats.length === 0) return;

    const bounds = [
      [Math.min(...lats) - 0.05, Math.min(...lngs) - 0.05],
      [Math.max(...lats) + 0.05, Math.max(...lngs) + 0.05],
    ];
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [projects, map]);

  return null;
}

/* â”€â”€â”€ Status Filter Tabs â”€â”€â”€ */
const statusFilters = ['All', 'Completed', 'On-Going', 'Proposed'];

/* â”€â”€â”€ Year options from data â”€â”€â”€ */
function getYearOptions(projects) {
  const years = [...new Set(projects.map(p => Number(p.year_funded)).filter(y => y && !isNaN(y)))].sort((a, b) => b - a);
  return years;
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAIN MAP VIEW PAGE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function UserMapView() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);

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

  // Recompute nearby projects whenever location or mappable projects change
  useEffect(() => {
    if (!userLocation) return;
    const ids = new Set(
      mappable
        .filter((p) => isProjectNearby(userLocation.lat, userLocation.lng, p))
        .map((p) => p.id)
    );
    setNearbyProjects(ids);
  }, [userLocation, mappable]);

  // Fetch data
  useEffect(() => {
    fetchProjects();
    const channel = supabase
      .channel('map-view-fmr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, fetchProjects)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

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

  // Filter logic
  const filtered = useMemo(() => {
    return projects.filter(p => {
      const q = search.toLowerCase();
      const name = (p.project_name || '').toLowerCase();
      const loc = (p.location || '').toLowerCase();
      const muni = (p.municipality || '').toLowerCase();

      const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q);
      const matchesStatus = statusFilter === 'All' || normalizeStatus(p.status) === statusFilter;
      const matchesYear = yearFilter === 'All' || String(Number(p.year_funded)) === yearFilter;
      return matchesSearch && matchesStatus && matchesYear;
    });
  }, [projects, search, statusFilter, yearFilter]);

  // Only show projects that have valid coordinates on the map
  const mappable = useMemo(() => {
    return filtered.filter(p => p.start_latitude && p.start_longitude);
  }, [filtered]);

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

  // Iloilo center
  const center = [10.89, 122.45];

  return (
    <UserLayout>
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
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Icons.Search />
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, municipality..."
              className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"
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
              📍 {nearbyProjects.size} project{nearbyProjects.size > 1 ? 's' : ''} detected near your current location
            </span>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
          <span>{stats.mapped} pins on map</span>
          <span className="text-slate-300">|</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-emerald-500 inline-block" /> {stats.completed} Completed</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500 inline-block" /> {stats.ongoing} On-Going</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-blue-500 inline-block" /> {stats.proposed} Proposed</span>
          <span className="text-slate-300">|</span>
          <span>{stats.totalKm} km total</span>
        </div>

        {/* Main content: Map + sidebar */}
        <div className="flex gap-4 relative z-10">
          {/* Map */}
          <div className="flex-1 bg-white rounded-2xl border border-slate-200/60 overflow-hidden" style={{ height: 'calc(100vh - 320px)', minHeight: '450px' }}>
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
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitBounds projects={mappable} />

                {/* User location: geofence zone + pulsing marker */}
                {userLocation && (() => {
                  const nearbyList = mappable.filter(p => nearbyProjects.has(p.id));
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

                {mappable.map(project => {
                  const color = getStatusColor(project.status);
                  const isSelected = selectedProject?.id === project.id;
                  const isNearby = nearbyProjects.has(project.id);

                  return (
                    <CircleMarker
                      key={project.id}
                      center={[project.start_latitude, project.start_longitude]}
                      radius={isSelected ? 12 : isNearby ? 10 : 7}
                      pathOptions={{
                        fillColor: isNearby ? '#0d9488' : color.fill,
                        color: isSelected ? '#000' : isNearby ? '#0f766e' : color.stroke,
                        weight: isSelected ? 3 : isNearby ? 2.5 : 2,
                        opacity: 1,
                        fillOpacity: isNearby ? 0.95 : 0.85,
                      }}
                      eventHandlers={{
                        click: () => {
                          setSelectedProject(project);
                          setShowSidebar(true);
                        },
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                        <span style={{ fontWeight: 600, fontSize: '12px' }}>{project.project_name}</span>
                        <br />
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>{normalizeStatus(project.status)} Â· {project.municipality || 'N/A'}</span>
                      </Tooltip>
                      <Popup maxWidth={320} className="custom-popup">
                        <div className="p-1">
                          <h3 className="font-semibold text-slate-900 text-sm leading-snug mb-2">
                            {project.project_name}
                          </h3>
                          <div className="space-y-1.5 text-xs text-slate-600">
                            <p className="flex items-center gap-1.5">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(project.status)}`}>
                                {project.status}
                              </span>
                            </p>
                            {project.municipality && (
                              <p className="flex items-center gap-1">
                                ðŸ“ {project.municipality}, {project.province || 'Iloilo'}
                              </p>
                            )}
                            {project.year_funded && (
                              <p className="flex items-center gap-1">
                                ðŸ“… FY {project.year_funded}
                              </p>
                            )}
                            {project.project_length_km > 0 && (
                              <p className="flex items-center gap-1">
                                ðŸ“ {project.project_length_km} km
                              </p>
                            )}
                            {project.date_completed && (
                              <p className="flex items-center gap-1 text-teal-600">
                                âœ… Completed: {project.date_completed}
                              </p>
                            )}
                            {project.start_latitude && project.end_latitude && (
                              <a
                                href={`https://www.google.com/maps/dir/${project.start_latitude},${project.start_longitude}/${project.end_latitude},${project.end_longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 mt-1 text-teal-600 hover:text-teal-700 font-medium"
                              >
                                View route on Google Maps â†—
                              </a>
                            )}
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            )}
          </div>

          {/* Sidebar project list (desktop always visible, mobile toggled) */}
          <aside
            className={`
              ${showSidebar ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
              fixed lg:static inset-y-0 right-0 z-50 w-80 lg:w-80
              bg-white lg:rounded-2xl border border-slate-200/60 
              transition-transform duration-300 lg:transition-none
              flex flex-col overflow-hidden
            `}
            style={{ height: 'calc(100vh - 320px)', minHeight: '450px' }}
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
                      onClick={() => setSelectedProject(p)}
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
                                📍 {fmtDistance(distM)}
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
        {selectedProject && (
          <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <h2 className="font-semibold text-slate-900 leading-snug">{selectedProject.project_name}</h2>
                <p className="text-sm text-slate-400 mt-1">
                  DA-RAED Region VI &middot; Farm-to-Market Road Development Program
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadge(selectedProject.status)}`}>
                  {selectedProject.status}
                </span>
                <button
                  onClick={() => setSelectedProject(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Icons.X />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {selectedProject.municipality && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Municipality</p>
                  <p className="text-sm font-medium text-slate-800">{selectedProject.municipality}</p>
                </div>
              )}
              {selectedProject.year_funded && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Year Funded</p>
                  <p className="text-sm font-medium text-slate-800">FY {selectedProject.year_funded}</p>
                </div>
              )}
              {selectedProject.project_length_km > 0 && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Road Length</p>
                  <p className="text-sm font-medium text-slate-800">{selectedProject.project_length_km} km</p>
                </div>
              )}
              {selectedProject.date_completed && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <p className="text-xs text-teal-600 uppercase tracking-wider mb-0.5">Completed</p>
                  <p className="text-sm font-medium text-emerald-800">{selectedProject.date_completed}</p>
                </div>
              )}
              {selectedProject.target_completion_date && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <p className="text-xs text-amber-600 uppercase tracking-wider mb-0.5">Target</p>
                  <p className="text-sm font-medium text-amber-800">{selectedProject.target_completion_date}</p>
                </div>
              )}
            </div>

            {/* GPS coordinates + Google Maps link */}
            {selectedProject.start_latitude && selectedProject.end_latitude && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md font-mono">
                    START: {selectedProject.start_latitude?.toFixed(6)}, {selectedProject.start_longitude?.toFixed(6)}
                  </span>
                  <span>â†’</span>
                  <span className="px-2 py-1 bg-rose-50 text-rose-700 rounded-md font-mono">
                    END: {selectedProject.end_latitude?.toFixed(6)}, {selectedProject.end_longitude?.toFixed(6)}
                  </span>
                </div>
                <a
                  href={`https://www.google.com/maps/dir/${selectedProject.start_latitude},${selectedProject.start_longitude}/${selectedProject.end_latitude},${selectedProject.end_longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <Icons.ExternalLink /> Google Maps
                </a>
              </div>
            )}
          </div>
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



