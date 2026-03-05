import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';
import 'leaflet/dist/leaflet.css';

/* ─── Icons ─── */
const Icons = {
  Search: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  ),
  MapPin: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  Road: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
    </svg>
  ),
  Calendar: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v9.75" />
    </svg>
  ),
  Ruler: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
    </svg>
  ),
  CheckCircle: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  Clock: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  Lightbulb: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  ),
  ExternalLink: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  ),
  List: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  ),
  X: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  ),
  Warning: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  ),
};

/* ─── Normalize status for consistent filtering ─── */
function normalizeStatus(s) {
  if (!s) return '';
  const lower = s.toLowerCase().replace(/[-\s]/g, '');
  if (lower === 'ongoing') return 'On-Going';
  if (lower === 'completed') return 'Completed';
  if (lower === 'proposed') return 'Proposed';
  return s;
}

/* ─── Status color helpers ─── */
function getStatusColor(status) {
  switch (normalizeStatus(status)) {
    case 'Completed': return { fill: '#10b981', stroke: '#059669', bg: 'bg-emerald-500' };
    case 'On-Going':  return { fill: '#f59e0b', stroke: '#d97706', bg: 'bg-amber-500' };
    case 'Proposed':  return { fill: '#3b82f6', stroke: '#2563eb', bg: 'bg-blue-500' };
    default:          return { fill: '#6b7280', stroke: '#4b5563', bg: 'bg-zinc-500' };
  }
}

function getStatusBadge(status) {
  switch (normalizeStatus(status)) {
    case 'Completed': return 'bg-emerald-100 text-emerald-700';
    case 'On-Going':  return 'bg-amber-100 text-amber-700';
    case 'Proposed':  return 'bg-sky-100 text-sky-700';
    default:          return 'bg-zinc-100 text-zinc-700';
  }
}

/* ─── Map bounds fitter ─── */
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

/* ─── Status Filter Tabs ─── */
const statusFilters = ['All', 'Completed', 'On-Going', 'Proposed'];

/* ─── Year options from data ─── */
function getYearOptions(projects) {
  const years = [...new Set(projects.map(p => Number(p.year_funded)).filter(y => y && !isNaN(y)))].sort((a, b) => b - a);
  return years;
}

/* ═══════════════════════════════════════════════════════════
   MAIN MAP VIEW PAGE
═══════════════════════════════════════════════════════════ */
export default function UserMapView() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);

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
              <div className="size-10 bg-emerald-100 rounded-xl grid place-items-center text-emerald-600">
                <Icons.MapPin />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Map View</h1>
                <p className="text-zinc-500 text-sm">FMR Project locations across Iloilo Province</p>
              </div>
            </div>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors text-zinc-700 lg:hidden"
            >
              <Icons.List /> Projects
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
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
              <Icons.Search />
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, municipality..."
              className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>

          {/* Year filter */}
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            className="px-3.5 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
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
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-zinc-500 flex-wrap">
          <span>{stats.mapped} pins on map</span>
          <span className="text-zinc-300">|</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-emerald-500 inline-block" /> {stats.completed} Completed</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500 inline-block" /> {stats.ongoing} On-Going</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-blue-500 inline-block" /> {stats.proposed} Proposed</span>
          <span className="text-zinc-300">|</span>
          <span>{stats.totalKm} km total</span>
        </div>

        {/* Main content: Map + sidebar */}
        <div className="flex gap-4 relative">
          {/* Map */}
          <div className="flex-1 bg-white rounded-2xl border border-zinc-200/60 overflow-hidden" style={{ height: 'calc(100vh - 320px)', minHeight: '450px' }}>
            {loading ? (
              <div className="h-full flex items-center justify-center bg-zinc-50">
                <div className="text-center">
                  <div className="size-10 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">Loading map data...</p>
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

                {mappable.map(project => {
                  const color = getStatusColor(project.status);
                  const isSelected = selectedProject?.id === project.id;

                  return (
                    <CircleMarker
                      key={project.id}
                      center={[project.start_latitude, project.start_longitude]}
                      radius={isSelected ? 10 : 7}
                      pathOptions={{
                        fillColor: color.fill,
                        color: isSelected ? '#000' : color.stroke,
                        weight: isSelected ? 3 : 2,
                        opacity: 1,
                        fillOpacity: 0.85,
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
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>{normalizeStatus(project.status)} · {project.municipality || 'N/A'}</span>
                      </Tooltip>
                      <Popup maxWidth={320} className="custom-popup">
                        <div className="p-1">
                          <h3 className="font-semibold text-zinc-900 text-sm leading-snug mb-2">
                            {project.project_name}
                          </h3>
                          <div className="space-y-1.5 text-xs text-zinc-600">
                            <p className="flex items-center gap-1.5">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(project.status)}`}>
                                {project.status}
                              </span>
                            </p>
                            {project.municipality && (
                              <p className="flex items-center gap-1">
                                📍 {project.municipality}, {project.province || 'Iloilo'}
                              </p>
                            )}
                            {project.year_funded && (
                              <p className="flex items-center gap-1">
                                📅 FY {project.year_funded}
                              </p>
                            )}
                            {project.project_length_km > 0 && (
                              <p className="flex items-center gap-1">
                                📏 {project.project_length_km} km
                              </p>
                            )}
                            {project.date_completed && (
                              <p className="flex items-center gap-1 text-emerald-600">
                                ✅ Completed: {project.date_completed}
                              </p>
                            )}
                            {project.start_latitude && project.end_latitude && (
                              <a
                                href={`https://www.google.com/maps/dir/${project.start_latitude},${project.start_longitude}/${project.end_latitude},${project.end_longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 mt-1 text-emerald-600 hover:text-emerald-700 font-medium"
                              >
                                View route on Google Maps ↗
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
              fixed lg:static inset-y-0 right-0 z-40 w-80 lg:w-80
              bg-white lg:rounded-2xl border border-zinc-200/60 
              transition-transform duration-300 lg:transition-none
              flex flex-col overflow-hidden
            `}
            style={{ height: 'calc(100vh - 320px)', minHeight: '450px' }}
          >
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
              <div>
                <h2 className="font-semibold text-zinc-900 text-sm">Projects</h2>
                <p className="text-xs text-zinc-400">{filtered.length} total &middot; {mappable.length} mapped</p>
              </div>
              <button
                onClick={() => setShowSidebar(false)}
                className="lg:hidden p-1 text-zinc-400 hover:text-zinc-600"
              >
                <Icons.X />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-50">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-zinc-400 text-sm">No projects match the filters</div>
              ) : (
                filtered.map(p => {
                  const isActive = selectedProject?.id === p.id;
                  const hasPins = p.start_latitude && p.start_longitude;
                  const color = getStatusColor(p.status);

                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProject(p)}
                      className={`w-full text-left px-4 py-3 transition-colors text-sm ${
                        isActive ? 'bg-emerald-50 border-l-2 border-emerald-500' : 'hover:bg-zinc-50 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="size-2.5 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: color.fill }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium line-clamp-2 leading-snug ${isActive ? 'text-emerald-800' : 'text-zinc-800'}`}>
                            {p.project_name}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
                            {p.municipality && <span>{p.municipality}</span>}
                            {p.year_funded && <span>FY {p.year_funded}</span>}
                            {p.project_length_km > 0 && <span>{p.project_length_km} km</span>}
                          </div>
                          {!hasPins && (
                            <span className="text-xs text-zinc-300 italic">No GPS data</span>
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
              className="lg:hidden fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
              onClick={() => setShowSidebar(false)}
            />
          )}
        </div>

        {/* Selected project detail card */}
        {selectedProject && (
          <div className="bg-white rounded-2xl border border-zinc-200/60 p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <h2 className="font-semibold text-zinc-900 leading-snug">{selectedProject.project_name}</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  DA-RAED Region VI &middot; Farm-to-Market Road Development Program
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadge(selectedProject.status)}`}>
                  {selectedProject.status}
                </span>
                <button
                  onClick={() => setSelectedProject(null)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  <Icons.X />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {selectedProject.municipality && (
                <div className="p-3 bg-zinc-50 rounded-xl">
                  <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">Municipality</p>
                  <p className="text-sm font-medium text-zinc-800">{selectedProject.municipality}</p>
                </div>
              )}
              {selectedProject.year_funded && (
                <div className="p-3 bg-zinc-50 rounded-xl">
                  <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">Year Funded</p>
                  <p className="text-sm font-medium text-zinc-800">FY {selectedProject.year_funded}</p>
                </div>
              )}
              {selectedProject.project_length_km > 0 && (
                <div className="p-3 bg-zinc-50 rounded-xl">
                  <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">Road Length</p>
                  <p className="text-sm font-medium text-zinc-800">{selectedProject.project_length_km} km</p>
                </div>
              )}
              {selectedProject.date_completed && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <p className="text-xs text-emerald-600 uppercase tracking-wider mb-0.5">Completed</p>
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
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md font-mono">
                    START: {selectedProject.start_latitude?.toFixed(6)}, {selectedProject.start_longitude?.toFixed(6)}
                  </span>
                  <span>→</span>
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
          <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 text-center">
            <p className="text-xs text-zinc-400">
              Data from Department of Agriculture — RAED Region VI &middot; Farm-to-Market Road Development Program (FMRDP)
            </p>
          </div>
        )}
      </div>
    </UserLayout>
  );
}
