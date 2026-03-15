import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

import Icons from '../components/Icons';
import UserLayout from '../components/UserLayout';
import { normalizeProjectName } from '../lib/projectHelpers';
/* â”€â”€â”€ Icons â”€â”€â”€ */

function normalizeUserProjectStatus(status) {
  const lower = String(status || '').toLowerCase().replace(/[-\s]/g, '');
  if (lower === 'ongoing') return 'On-Going';
  if (lower === 'proposed' || lower === 'pending') return 'Pending';
  if (lower === 'completed') return 'Completed';
  return status || 'Pending';
}

/* â”€â”€â”€ Status Style Helper â”€â”€â”€ */
function getStatusStyle(status) {
  const styles = {
    'Completed':  { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
    'On-Going':   { badge: 'bg-amber-100 text-amber-700',     bar: 'bg-amber-500',   dot: 'bg-amber-500' },
    'Pending':    { badge: 'bg-sky-100 text-sky-700',          bar: 'bg-sky-500',     dot: 'bg-sky-500' },
  };
  return styles[status] || styles['Pending'];
}

/* â”€â”€â”€ Stat Card â”€â”€â”€ */
function StatCard({ icon, value, label, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-100 text-teal-600',
    amber: 'bg-amber-100 text-amber-600',
    sky: 'bg-sky-100 text-sky-600',
    violet: 'bg-violet-100 text-violet-600',
  };

  return (
    <article className="bg-white rounded-2xl p-5 border border-slate-200/60 hover:border-zinc-300 transition-colors">
      <div className={`inline-flex items-center justify-center size-10 rounded-xl mb-3 ${variants[variant]}`}>
        {icon}
      </div>
      <p className="text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </article>
  );
}

/* â”€â”€â”€ Project List Card â”€â”€â”€ */
function FMRProjectCard({ project, onClick }) {
  const normalizedStatus = normalizeUserProjectStatus(project.status);
  const style = getStatusStyle(normalizedStatus);
  const name = normalizeProjectName(project);

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/60 p-5 hover:border-zinc-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 group-hover:text-teal-700 transition-colors line-clamp-2 text-sm leading-snug">
            {name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1.5 text-sm text-slate-500">
            <Icons.MapPin />
            <span className="truncate">{project.municipality}, {project.province}</span>
          </div>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${style.badge}`}>
          {normalizedStatus}
        </span>
      </div>

      {/* Progress bar (only for On-Going) */}
      {normalizedStatus === 'On-Going' && (
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${project.accomplishment || 0}%` }} />
          </div>
          <span className="text-xs font-medium text-slate-600 tabular-nums w-10 text-right">
            {project.accomplishment || 0}%
          </span>
        </div>
      )}

      {/* Completed indicator */}
      {normalizedStatus === 'Completed' && (
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-1.5 bg-emerald-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 w-full" />
          </div>
          <span className="text-xs font-medium text-teal-600 tabular-nums w-10 text-right">100%</span>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
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

/* â”€â”€â”€ Skeleton â”€â”€â”€ */
function ProjectSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 p-5 animate-pulse">
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

/* â”€â”€â”€ Detail Item â”€â”€â”€ */
function DetailItem({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-slate-50 rounded-xl">
      <div className="size-8 bg-white rounded-lg grid place-items-center text-slate-400 border border-slate-100 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-slate-800 break-words">{value}</p>
      </div>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   FMR PROJECT DETAIL VIEW
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function FMRProjectDetail({ project, onBack }) {
  const style = getStatusStyle(project.status);
  const hasCoords = project.start_latitude && project.start_longitude;
  const name = normalizeProjectName(project);

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors">
        <Icons.ArrowLeft /> Back to FMR Projects
      </button>

      {/* Project Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div className="flex-1">
              <h1 className="text-xl font-semibold text-slate-900 leading-snug">{name}</h1>
              <p className="text-sm text-slate-400 mt-1">
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
                <span className="text-sm font-medium text-slate-700">Accomplishment</span>
                <span className="text-sm font-semibold text-slate-900">{project.accomplishment || 0}%</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
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
          <div className="border-t border-slate-100 p-6">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Icons.MapPinLg /> GPS Coordinates
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <p className="text-xs text-teal-600 font-medium uppercase tracking-wider mb-1">Start Point</p>
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
          Department of Agriculture - Regional Agricultural Engineering Division (RAED), Regional Field Office VI - Western Visayas.
          Farm-to-Market Road Development Program (FMRDP).
        </p>
      </div>
    </div>
  );
}

/* â”€â”€â”€ Status Filter Tabs â”€â”€â”€ */
const statusFilters = ['On-Going', 'Pending', 'Completed'];

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAIN FMR PROJECTS PAGE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function UserFMRProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('On-Going');
  const [yearFilter, setYearFilter] = useState('All');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('latest');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const projectsPerPage = 8;

  const getProjectDate = (project) => {
    const candidates = [
      project.updated_at,
      project.created_at,
      project.date_completed,
      project.target_completion_date,
    ];
    for (const value of candidates) {
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  };

  const inDateRange = (projectDate, from, to) => {
    if (!projectDate) return !from && !to;
    if (from) {
      const fromDate = new Date(`${from}T00:00:00`);
      if (projectDate < fromDate) return false;
    }
    if (to) {
      const toDate = new Date(`${to}T23:59:59`);
      if (projectDate > toDate) return false;
    }
    return true;
  };

  // Fetch FMR projects from Supabase
  useEffect(() => {
    fetchFMRProjects();
    const channel = supabase
      .channel('user-fmr-projects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, fetchFMRProjects)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, yearFilter, municipalityFilter, dateFrom, dateTo, sortBy]);

  async function fetchFMRProjects() {
    try {
      setFetchError(null);
      const { data, error } = await supabase
        .from('fmr_projects')
        .select('*')
        .order('status', { ascending: true })
        .order('accomplishment', { ascending: false });

      if (error) {
        setFetchError(error.message);
        throw error;
      }

      setProjects(data || []);
    } catch (e) {
      setFetchError(e.message || 'Failed to load FMR projects.');
    } finally {
      setLoading(false);
    }
  }

  // Compute stats
  const stats = {
    total: projects.length,
    ongoing: projects.filter(p => normalizeUserProjectStatus(p.status) === 'On-Going').length,
    pending: projects.filter(p => normalizeUserProjectStatus(p.status) === 'Pending').length,
    completed: projects.filter(p => normalizeUserProjectStatus(p.status) === 'Completed').length,
    totalKm: projects.reduce((sum, p) => sum + (p.project_length_km || 0), 0).toFixed(2),
  };

  const yearOptions = [...new Set(projects.map((p) => Number(p.year_funded)).filter((y) => y && !Number.isNaN(y)))].sort((a, b) => b - a);
  const municipalityOptions = [...new Set(projects.map((p) => p.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // Filter logic
  const filtered = projects.filter(p => {
    const name = (p.project_name || '').toLowerCase();
    const loc = (p.location || '').toLowerCase();
    const muni = (p.municipality || '').toLowerCase();
    const q = search.toLowerCase();

    const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q);
    const matchesStatus = normalizeUserProjectStatus(p.status) === statusFilter;
    const matchesYear = yearFilter === 'All' || String(Number(p.year_funded)) === yearFilter;
    const matchesMunicipality = municipalityFilter === 'All' || p.municipality === municipalityFilter;
    const matchesDate = inDateRange(getProjectDate(p), dateFrom, dateTo);
    return matchesSearch && matchesStatus && matchesYear && matchesMunicipality && matchesDate;
  }).sort((a, b) => {
    if (sortBy === 'name-asc') {
      return (a.project_name || '').localeCompare(b.project_name || '');
    }
    if (sortBy === 'name-desc') {
      return (b.project_name || '').localeCompare(a.project_name || '');
    }
    if (sortBy === 'progress-desc') {
      return (Number(b.accomplishment) || 0) - (Number(a.accomplishment) || 0);
    }
    if (sortBy === 'progress-asc') {
      return (Number(a.accomplishment) || 0) - (Number(b.accomplishment) || 0);
    }
    const aDate = getProjectDate(a)?.getTime() || 0;
    const bDate = getProjectDate(b)?.getTime() || 0;
    return bDate - aDate;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / projectsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedProjects = filtered.slice(
    (safeCurrentPage - 1) * projectsPerPage,
    safeCurrentPage * projectsPerPage
  );

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
            <div className="size-10 bg-emerald-100 rounded-xl grid place-items-center text-teal-600">
              <Icons.Road />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FMR Projects</h1>
              <p className="text-slate-500 text-sm">Farm-to-Market Road Development Program - DA RAED Region VI</p>
            </div>
          </div>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200/60 animate-pulse">
                <div className="size-10 bg-zinc-200 rounded-xl mb-3" />
                <div className="h-8 w-12 bg-zinc-200 rounded mb-2" />
                <div className="h-4 w-20 bg-zinc-200 rounded" />
              </div>
            ))
          ) : (
            <>
              <StatCard icon={<Icons.Road />} value={stats.total} label="Total Projects" variant="emerald" />
              <StatCard icon={<Icons.Clock />} value={stats.ongoing} label="On-Going" variant="amber" />
              <StatCard icon={<Icons.Lightbulb />} value={stats.pending} label="Pending" variant="violet" />
              <StatCard icon={<Icons.CheckCircle />} value={stats.completed} label="Completed" variant="sky" />
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
        <div className="space-y-3">
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
              placeholder="Search by name, municipality, location..."
              className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"
            />
          </div>

          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[140px]"
          >
            <option value="All">All Years</option>
            {yearOptions.map((year) => (
              <option key={year} value={String(year)}>FY {year}</option>
            ))}
          </select>

          <select
            value={municipalityFilter}
            onChange={(e) => setMunicipalityFilter(e.target.value)}
            className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[170px]"
          >
            <option value="All">All Municipalities</option>
            {municipalityOptions.map((municipality) => (
              <option key={municipality} value={municipality}>{municipality}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[170px]"
          >
            <option value="latest">Sort: Latest</option>
            <option value="name-asc">Sort: Name A-Z</option>
            <option value="name-desc">Sort: Name Z-A</option>
            <option value="progress-desc">Sort: Progress High-Low</option>
            <option value="progress-asc">Sort: Progress Low-High</option>
          </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Start Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                max={dateTo || undefined}
                aria-label="Start Date"
                title="Start Date"
                className="w-full px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">End Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom || undefined}
                aria-label="End Date"
                title="End Date"
                className="w-full px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
              />
            </div>
          </div>

          {/* Status filter pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map(s => {
              const count = s === 'On-Going' ? stats.ongoing : s === 'Pending' ? stats.pending : stats.completed;
              return (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setCurrentPage(1); }}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    statusFilter === s
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {s} {!loading && <span className="text-xs opacity-75">({count})</span>}
                </button>
              );
            })}
          </div>

          {(search || statusFilter !== 'On-Going' || yearFilter !== 'All' || municipalityFilter !== 'All' || dateFrom || dateTo || sortBy !== 'latest') && (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setSearch('');
                  setStatusFilter('On-Going');
                  setYearFilter('All');
                  setMunicipalityFilter('All');
                  setDateFrom('');
                  setDateTo('');
                  setSortBy('latest');
                  setCurrentPage(1);
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-100 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        {/* Results count */}
        <p className="text-sm text-slate-400">{filtered.length} project{filtered.length !== 1 ? 's' : ''} found</p>

        {/* Projects List */}
        <div className="space-y-4">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <ProjectSkeleton key={i} />)
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
              <div className="mx-auto size-14 bg-slate-100 rounded-xl grid place-items-center text-slate-400 mb-3">
                <Icons.Road />
              </div>
              <p className="font-medium text-slate-900">
                {search || statusFilter !== 'On-Going' ? 'No matching FMR projects' : 'No FMR projects loaded'}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {search || statusFilter !== 'On-Going'
                  ? 'Try adjusting your search or filters'
                  : 'Run the SQL migration to load DA-RAED data'}
              </p>
            </div>
          ) : (
            paginatedProjects.map(p => (
              <FMRProjectCard key={p.id} project={p} onClick={() => setSelectedProject(p)} />
            ))
          )}
        </div>

        {!loading && filtered.length > 0 && totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              Page <span className="font-semibold text-slate-700">{safeCurrentPage}</span> of <span className="font-semibold text-slate-700">{totalPages}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    safeCurrentPage === page
                      ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                      : 'border border-slate-200 hover:bg-white hover:border-slate-300 shadow-sm'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Source Footer */}
        {!loading && projects.length > 0 && (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
            <p className="text-xs text-slate-400">
              Data from Department of Agriculture - RAED Region VI &middot; Farm-to-Market Road Development Program (FMRDP)
            </p>
          </div>
        )}

        {showBackToTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-6 right-6 z-20 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium shadow-lg"
          >
            Back to top
          </button>
        )}
      </div>
    </UserLayout>
  );
}



