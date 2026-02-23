import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';

/* ─── Icons ─── */
const Icons = {
  Search: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  ),
  MapPin: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  MapPinLg: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  ArrowLeft: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
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
  Road: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
    </svg>
  ),
  Folder: () => (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  ),
  CheckCircle: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  Clock: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  Lightbulb: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  ),
  ExternalLink: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  ),
  Building: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
    </svg>
  ),
  Warning: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  ),
};

/* ─── Status Style Helper ─── */
function getStatusStyle(status) {
  const styles = {
    'Completed':  { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
    'On-Going':   { badge: 'bg-amber-100 text-amber-700',     bar: 'bg-amber-500',   dot: 'bg-amber-500' },
    'Proposed':   { badge: 'bg-sky-100 text-sky-700',          bar: 'bg-sky-500',     dot: 'bg-sky-500' },
  };
  return styles[status] || styles['Proposed'];
}

/* ─── Stat Card ─── */
function StatCard({ icon, value, label, variant = 'default' }) {
  const variants = {
    default: 'bg-zinc-100 text-zinc-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    sky: 'bg-sky-100 text-sky-600',
    violet: 'bg-violet-100 text-violet-600',
  };

  return (
    <article className="bg-white rounded-2xl p-5 border border-zinc-200/60 hover:border-zinc-300 transition-colors">
      <div className={`inline-flex items-center justify-center size-10 rounded-xl mb-3 ${variants[variant]}`}>
        {icon}
      </div>
      <p className="text-3xl font-semibold tracking-tight text-zinc-900">{value}</p>
      <p className="mt-1 text-sm text-zinc-500">{label}</p>
    </article>
  );
}

/* ─── Project List Card ─── */
function FMRProjectCard({ project, onClick }) {
  const style = getStatusStyle(project.status);

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-zinc-200/60 p-5 hover:border-zinc-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-zinc-900 group-hover:text-emerald-700 transition-colors line-clamp-2 text-sm leading-snug">
            {project.project_name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1.5 text-sm text-zinc-500">
            <Icons.MapPin />
            <span className="truncate">{project.municipality}, {project.province}</span>
          </div>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${style.badge}`}>
          {project.status}
        </span>
      </div>

      {/* Progress bar (only for On-Going) */}
      {project.status === 'On-Going' && (
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${project.accomplishment || 0}%` }} />
          </div>
          <span className="text-xs font-medium text-zinc-600 tabular-nums w-10 text-right">
            {project.accomplishment || 0}%
          </span>
        </div>
      )}

      {/* Completed indicator */}
      {project.status === 'Completed' && (
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-1.5 bg-emerald-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 w-full" />
          </div>
          <span className="text-xs font-medium text-emerald-600 tabular-nums w-10 text-right">100%</span>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-zinc-400 flex-wrap">
        {project.year_funded && (
          <span className="flex items-center gap-1">
            <Icons.Calendar /> FY {project.year_funded}
          </span>
        )}
        {project.project_length_km > 0 && (
          <span className="flex items-center gap-1">
            <Icons.Ruler /> {project.project_length_km} km
          </span>
        )}
        {project.target_completion_date && (
          <span className="flex items-center gap-1">
            <Icons.Calendar /> Target: {project.target_completion_date}
          </span>
        )}
        {project.date_completed && (
          <span className="flex items-center gap-1 text-emerald-500">
            <Icons.CheckCircle /> {project.date_completed}
          </span>
        )}
      </div>
    </button>
  );
}

/* ─── Skeleton ─── */
function ProjectSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1">
          <div className="h-5 w-3/4 bg-zinc-200 rounded mb-2" />
          <div className="h-4 w-1/2 bg-zinc-200 rounded" />
        </div>
        <div className="h-6 w-20 bg-zinc-200 rounded-full" />
      </div>
      <div className="h-1.5 bg-zinc-200 rounded-full mb-3" />
      <div className="flex gap-3">
        <div className="h-4 w-16 bg-zinc-200 rounded" />
        <div className="h-4 w-20 bg-zinc-200 rounded" />
      </div>
    </div>
  );
}

/* ─── Detail Item ─── */
function DetailItem({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-zinc-50 rounded-xl">
      <div className="size-8 bg-white rounded-lg grid place-items-center text-zinc-400 border border-zinc-100 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-zinc-800 break-words">{value}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   FMR PROJECT DETAIL VIEW
═══════════════════════════════════════════════════════════ */
function FMRProjectDetail({ project, onBack }) {
  const style = getStatusStyle(project.status);
  const hasCoords = project.start_latitude && project.start_longitude;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 transition-colors">
        <Icons.ArrowLeft /> Back to FMR Projects
      </button>

      {/* Project Header Card */}
      <div className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div className="flex-1">
              <h1 className="text-xl font-semibold text-zinc-900 leading-snug">{project.project_name}</h1>
              <p className="text-sm text-zinc-400 mt-1">
                DA-RAED Region VI &middot; Farm-to-Market Road Development Program
              </p>
            </div>
            <span className={`self-start px-3 py-1.5 rounded-full text-sm font-medium ${style.badge}`}>
              {project.status}
            </span>
          </div>

          {/* Progress bar */}
          {project.status !== 'Proposed' && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-zinc-700">Accomplishment</span>
                <span className="text-sm font-semibold text-zinc-900">{project.accomplishment || 0}%</span>
              </div>
              <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${project.accomplishment || 0}%` }} />
              </div>
            </div>
          )}

          {/* Detail Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailItem icon={<Icons.MapPin />} label="Location" value={project.location || 'N/A'} />
            <DetailItem icon={<Icons.Building />} label="Municipality" value={project.municipality || 'N/A'} />
            <DetailItem icon={<Icons.MapPinLg />} label="Province" value={`${project.province}, ${project.region}`} />
            
            {project.year_funded && (
              <DetailItem icon={<Icons.Calendar />} label="Year Funded" value={project.year_funded} />
            )}
            {project.target_completion_date && (
              <DetailItem icon={<Icons.Calendar />} label="Target Completion" value={project.target_completion_date} />
            )}
            {project.date_completed && (
              <DetailItem icon={<Icons.Calendar />} label="Date Completed" value={project.date_completed} />
            )}
            {project.project_length_km > 0 && (
              <DetailItem icon={<Icons.Ruler />} label="Road Length" value={`${project.project_length_km} km`} />
            )}
            {project.remarks && (
              <DetailItem icon={<Icons.Lightbulb />} label="Remarks" value={project.remarks} />
            )}
          </div>
        </div>

        {/* Coordinates Section (for completed projects with GPS data) */}
        {hasCoords && (
          <div className="border-t border-zinc-100 p-6">
            <h2 className="font-semibold text-zinc-900 mb-4 flex items-center gap-2">
              <Icons.MapPinLg /> GPS Coordinates
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <p className="text-xs text-emerald-600 font-medium uppercase tracking-wider mb-1">Start Point</p>
                <p className="text-sm font-mono text-emerald-800">
                  {project.start_latitude?.toFixed(6)}, {project.start_longitude?.toFixed(6)}
                </p>
              </div>
              <div className="p-4 bg-rose-50 rounded-xl border border-rose-100">
                <p className="text-xs text-rose-600 font-medium uppercase tracking-wider mb-1">End Point</p>
                <p className="text-sm font-mono text-rose-800">
                  {project.end_latitude?.toFixed(6)}, {project.end_longitude?.toFixed(6)}
                </p>
              </div>
            </div>
            <a
              href={`https://www.google.com/maps/dir/${project.start_latitude},${project.start_longitude}/${project.end_latitude},${project.end_longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-xl transition-colors"
            >
              <Icons.ExternalLink /> View Route on Google Maps
            </a>
          </div>
        )}
      </div>

      {/* Source Info */}
      <div className="p-5 bg-sky-50 rounded-2xl border border-sky-100">
        <p className="font-medium text-sky-900 mb-1">Data Source</p>
        <p className="text-sm text-sky-700 leading-relaxed">
          Department of Agriculture — Regional Agricultural Engineering Division (RAED), Regional Field Office VI - Western Visayas.
          Farm-to-Market Road Development Program (FMRDP).
        </p>
      </div>
    </div>
  );
}

/* ─── Status Filter Tabs ─── */
const statusFilters = ['All', 'On-Going', 'Completed', 'Proposed'];

/* ═══════════════════════════════════════════════════════════
   MAIN FMR PROJECTS PAGE
═══════════════════════════════════════════════════════════ */
export default function UserFMRProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);

  // Fetch FMR projects from Supabase
  useEffect(() => {
    fetchFMRProjects();
    const channel = supabase
      .channel('user-fmr-projects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, fetchFMRProjects)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchFMRProjects() {
    try {
      setFetchError(null);
      const { data, error } = await supabase
        .from('fmr_projects')
        .select('*')
        .order('status', { ascending: true })
        .order('accomplishment', { ascending: false });

      if (error) {
        console.error('Supabase fmr_projects error:', error);
        setFetchError(error.message);
        throw error;
      }

      setProjects(data || []);
    } catch (e) {
      console.error('Error fetching FMR projects:', e);
    } finally {
      setLoading(false);
    }
  }

  // Compute stats
  const stats = {
    total: projects.length,
    ongoing: projects.filter(p => p.status === 'On-Going').length,
    completed: projects.filter(p => p.status === 'Completed').length,
    proposed: projects.filter(p => p.status === 'Proposed').length,
    totalKm: projects.reduce((sum, p) => sum + (p.project_length_km || 0), 0).toFixed(2),
  };

  // Filter logic
  const filtered = projects.filter(p => {
    const name = (p.project_name || '').toLowerCase();
    const loc = (p.location || '').toLowerCase();
    const muni = (p.municipality || '').toLowerCase();
    const q = search.toLowerCase();

    const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q);
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // If a project is selected, show detail view
  if (selectedProject) {
    return (
      <UserLayout>
        <FMRProjectDetail project={selectedProject} onBack={() => setSelectedProject(null)} />
      </UserLayout>
    );
  }

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Header */}
        <section>
          <div className="flex items-center gap-3 mb-1">
            <div className="size-10 bg-emerald-100 rounded-xl grid place-items-center text-emerald-600">
              <Icons.Road />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">FMR Projects</h1>
              <p className="text-zinc-500 text-sm">Farm-to-Market Road Development Program — DA RAED Region VI</p>
            </div>
          </div>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-zinc-200/60 animate-pulse">
                <div className="size-10 bg-zinc-200 rounded-xl mb-3" />
                <div className="h-8 w-12 bg-zinc-200 rounded mb-2" />
                <div className="h-4 w-20 bg-zinc-200 rounded" />
              </div>
            ))
          ) : (
            <>
              <StatCard icon={<Icons.Road />} value={stats.total} label="Total Projects" variant="emerald" />
              <StatCard icon={<Icons.Clock />} value={stats.ongoing} label="On-Going" variant="amber" />
              <StatCard icon={<Icons.CheckCircle />} value={stats.completed} label="Completed" variant="sky" />
              <StatCard icon={<Icons.Lightbulb />} value={stats.proposed} label="Proposed" variant="violet" />
              <StatCard icon={<Icons.Ruler />} value={`${stats.totalKm} km`} label="Total Road Length" variant="default" />
            </>
          )}
        </section>

        {/* Error banner */}
        {fetchError && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <Icons.Warning />
            <div>
              <p className="font-medium">Unable to load FMR projects</p>
              <p className="mt-0.5 text-red-600">{fetchError}</p>
              <p className="mt-1 text-xs text-red-500">
                Make sure the <code className="bg-red-100 px-1 py-0.5 rounded">fmr_projects</code> table exists.
                Run the SQL in <code className="bg-red-100 px-1 py-0.5 rounded">supabase_fmr_projects_migration.sql</code> in your Supabase SQL Editor.
              </p>
            </div>
          </div>
        )}

        {/* Search & Filters */}
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
              placeholder="Search by name, municipality, location..."
              className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>

          {/* Status filter pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map(s => {
              const count = s === 'All' ? stats.total : s === 'On-Going' ? stats.ongoing : s === 'Completed' ? stats.completed : stats.proposed;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    statusFilter === s
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  {s} {!loading && <span className="text-xs opacity-75">({count})</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results count */}
        <p className="text-sm text-zinc-400">{filtered.length} project{filtered.length !== 1 ? 's' : ''} found</p>

        {/* Projects List */}
        <div className="space-y-4">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <ProjectSkeleton key={i} />)
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
              <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
                <Icons.Road />
              </div>
              <p className="font-medium text-zinc-900">
                {search || statusFilter !== 'All' ? 'No matching FMR projects' : 'No FMR projects loaded'}
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                {search || statusFilter !== 'All'
                  ? 'Try adjusting your search or filters'
                  : 'Run the SQL migration to load DA-RAED data'}
              </p>
            </div>
          ) : (
            filtered.map(p => (
              <FMRProjectCard key={p.id} project={p} onClick={() => setSelectedProject(p)} />
            ))
          )}
        </div>

        {/* Source Footer */}
        {!loading && projects.length > 0 && (
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100 text-center">
            <p className="text-xs text-zinc-400">
              Data from Department of Agriculture — RAED Region VI &middot; Farm-to-Market Road Development Program (FMRDP)
            </p>
          </div>
        )}
      </div>
    </UserLayout>
  );
}
