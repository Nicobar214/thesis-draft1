import { useMemo, useState } from 'react';
import { MapPinIcon, SearchIcon } from 'lucide-react';
import { distToProject, fmtDist, sortProjectsByDistance } from '../../../lib/reportSubmission';

function statusCls(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('complet'))                                               return 'bg-emerald-100 text-emerald-700';
  if (s.includes('progress') || s.includes('going') || s.includes('ongoing')) return 'bg-blue-100 text-blue-700';
  if (s.includes('proposed'))                                              return 'bg-sky-100 text-sky-700';
  return 'bg-slate-100 text-slate-600';
}

function matchesStatusFilter(status, filter) {
  if (filter === 'All') return true;
  const s = (status || '').toLowerCase();
  if (filter === 'Completed') return s.includes('complet');
  if (filter === 'On-Going') return s.includes('progress') || s.includes('going') || s.includes('ongoing');
  if (filter === 'Proposed') return s.includes('proposed');
  return true;
}

const STATUS_FILTERS = ['All', 'On-Going', 'Proposed', 'Completed'];
// "Browse all" is the fallback for when GPS can't find anything nearby, so it's the
// one place this list can grow to the full project count (300+) -- reveal it in pages
// instead of mounting every card, which is both slow to render and a long thumb-scroll.
const BROWSE_PAGE_SIZE = 20;

/** Choose which project the report is about: nearby first, with a wider search and browse-all fallback. */
export default function PickingStep({
  gps,
  allProjects,
  nearby,
  browseAll,
  widerSearch,
  isOffline,
  cachedProjectsMeta,
  setWiderSearch,
  setBrowseAll,
  setSelProject,
  setStep,
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [visibleCount, setVisibleCount] = useState(BROWSE_PAGE_SIZE);

  // A new search or filter invalidates whatever page was revealed -- each
  // setter below resets the reveal at the moment it changes the query,
  // rather than reacting to the change after the fact in an effect.
  const updateQuery = (value) => { setQuery(value); setVisibleCount(BROWSE_PAGE_SIZE); };
  const updateStatusFilter = (value) => { setStatusFilter(value); setVisibleCount(BROWSE_PAGE_SIZE); };

  const browseFiltered = useMemo(() => {
    if (!browseAll) return [];
    const sorted = sortProjectsByDistance(allProjects, gps);
    const q = query.trim().toLowerCase();
    return sorted.filter((p) => {
      const matchesQuery = !q
        || (p.project_name || '').toLowerCase().includes(q)
        || (p.municipality || '').toLowerCase().includes(q)
        || (p.location || '').toLowerCase().includes(q);
      return matchesQuery && matchesStatusFilter(p.status, statusFilter);
    });
  }, [browseAll, allProjects, gps, query, statusFilter]);

  const displayList = browseAll ? browseFiltered.slice(0, visibleCount) : nearby;
  const lowAcc = gps && gps.accuracy > 100;

  return (
      <div className="report-step-in space-y-4">
        {/* GPS / found banner */}
        <div className={`px-4 py-3.5 rounded-2xl border ${lowAcc ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${lowAcc ? 'bg-amber-400' : 'bg-teal-400'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${lowAcc ? 'bg-amber-500' : 'bg-teal-500'}`} />
            </span>
            <span className={`text-sm font-semibold ${lowAcc ? 'text-amber-900' : 'text-teal-900'}`}>
              {browseAll
                ? `Showing ${displayList.length} of ${browseFiltered.length} project${browseFiltered.length !== 1 ? 's' : ''}`
                : widerSearch
                ? `${nearby.length} project${nearby.length !== 1 ? 's' : ''} within 1km`
                : <><MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Found {nearby.length} project{nearby.length !== 1 ? 's' : ''} near you</>}
            </span>
          </div>
          <p className={`text-xs pl-4 ${lowAcc ? 'text-amber-700' : 'text-teal-700'}`}>
            GPS accuracy: ±{Math.round(gps?.accuracy || 0)}m
            {lowAcc && <span className="ml-1 font-medium">— move to open sky for better results</span>}
          </p>
        </div>

        {isOffline && (
          <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
            Offline mode: using the last cached project list.
            {cachedProjectsMeta?.updatedAt && (
              <span className="ml-1">Last synced {new Date(cachedProjectsMeta.updatedAt).toLocaleString()}.</span>
            )}
          </div>
        )}

        {/* Search + status filter: only needed once the list is "all projects" --
            the nearby list is already short and local, filtering it would be noise. */}
        {browseAll && (
          <div className="space-y-2.5">
            <div className="relative">
              <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                placeholder="Search by road name or municipality..."
                aria-label="Search projects"
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 outline-none"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    statusFilter === s
                      ? 'bg-teal-600 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Zero results state */}
        {!browseAll && displayList.length === 0 && (
          <div className="text-center py-8 px-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
            <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                No projects found within {widerSearch ? '1km' : '250m'} of your location
              </p>
              <p className="text-xs text-slate-500 mt-0.5">GPS accuracy: ±{Math.round(gps?.accuracy || 0)}m</p>
            </div>
            {!widerSearch && (
              <button type="button" onClick={() => setWiderSearch(true)}
                className="inline-flex items-center gap-2 bg-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 transition">
                Search a wider area (1km)
              </button>
            )}
            <button type="button" onClick={() => setBrowseAll(true)}
              className="block mx-auto text-sm text-slate-500 hover:text-teal-600 underline">
              Browse all projects
            </button>
          </div>
        )}

        {browseAll && browseFiltered.length === 0 && (
          <div className="text-center py-8 px-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <p className="text-sm font-semibold text-slate-800">No projects match "{query}"</p>
            <p className="text-xs text-slate-500">Try a different road name or municipality, or clear the status filter.</p>
            {(query || statusFilter !== 'All') && (
              <button type="button" onClick={() => { setQuery(''); setStatusFilter('All'); setVisibleCount(BROWSE_PAGE_SIZE); }}
                className="inline-flex items-center gap-2 bg-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 transition">
                Clear search and filter
              </button>
            )}
          </div>
        )}

        {/* Project cards */}
        {displayList.length > 0 && (
          <div className="space-y-3">
            {displayList.map((p) => {
              const dist     = gps ? distToProject(gps.lat, gps.lng, p) : null;
              const isOngoing = /progress|going|ongoing/i.test(p.status || '');
              return (
                <button type="button" key={p.id}
                  onClick={() => { setSelProject(p); setStep('classify'); }}
                  className="w-full text-left p-5 rounded-2xl border-2 border-slate-200 bg-white hover:border-teal-400 hover:bg-teal-50/30 transition-all active:scale-[0.98] shadow-sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-slate-900 leading-tight">{p.project_name}</p>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${statusCls(p.status)}`}>
                      {p.status || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap mb-2">
                    {dist !== null && <span className="text-teal-600 font-semibold">{fmtDist(dist)}</span>}
                    {p.municipality && <span><MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{p.municipality}</span>}
                    {p.project_length_km > 0 && <span>{p.project_length_km} km road</span>}
                  </div>
                  {isOngoing && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                        <span>Implementation in progress</span>
                        <span>On-Going</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full w-3/5" />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {browseAll && browseFiltered.length > visibleCount && (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + BROWSE_PAGE_SIZE)}
            className="block w-full text-center py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Show {Math.min(BROWSE_PAGE_SIZE, browseFiltered.length - visibleCount)} more
          </button>
        )}

        {/* Escape hatch */}
        <div className="text-center pt-1">
          {!browseAll ? (
            <button type="button" onClick={() => setBrowseAll(true)}
              className="text-xs text-slate-500 hover:text-teal-600 underline">
              Not near a project? Browse all
            </button>
          ) : (
            <button type="button" onClick={() => { setBrowseAll(false); setWiderSearch(false); setQuery(''); setStatusFilter('All'); }}
              className="text-xs text-slate-500 hover:text-teal-600 underline">
              ← Back to nearby projects
            </button>
          )}
        </div>
      </div>
  );
}
