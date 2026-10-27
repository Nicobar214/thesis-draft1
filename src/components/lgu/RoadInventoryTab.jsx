import { useMemo, useState, useEffect } from 'react';

import roadInventory from '../../data/leonRoadInventory.json';
import { getPaginationRange } from '../../lib/paginationUtils';
import ViewToggle, { useViewMode } from '../ui/ViewToggle';
import { useIsPhone } from '../../lib/useIsPhone';
import FmrProjectDetailDialog from '../FmrProjectDetailDialog';
import RoadInventoryDetailDialog from './RoadInventoryDetailDialog';
import { SortableTh, PlainTh } from '../fmrProjects/FmrProjectListParts';

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '') return 'N/A';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Same sort keys as the admin projects table: '<field>-asc' | '<field>-desc'.
const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Road name A-Z' },
  { value: 'name-desc', label: 'Road name Z-A' },
  { value: 'barangay-asc', label: 'Barangay A-Z' },
  { value: 'length-desc', label: 'Longest first' },
  { value: 'length-asc', label: 'Shortest first' },
  { value: 'year-desc', label: 'Newest built first' },
  { value: 'year-asc', label: 'Oldest built first' },
];
const SORT_VALUE = {
  name: (r) => String(r.roadName || '').toLowerCase(),
  barangay: (r) => String(r.barangay || '').toLowerCase(),
  length: (r) => Number(r.lengthKm) || 0,
  year: (r) => Number(r.yearConstructed) || 0,
};

export default function RoadInventoryTab({ projects = [], tranchesByProjectId = {} }) {
  const [query, setQuery] = useState('');
  const [selectedRoad, setSelectedRoad] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  // fmr_projects.inventory_road_name holds the surveyed road name a project
  // was built on (set by supabase_leon_realistic_routes.sql).
  const projectsByRoad = useMemo(() => {
    const map = new Map();
    projects.forEach((p) => {
      const name = String(p.inventory_road_name || '').trim();
      if (!name) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(p);
    });
    return map;
  }, [projects]);
  const linkedProjectsFor = (road) => projectsByRoad.get(String(road?.roadName || '').trim()) || [];
  const [barangayFilter, setBarangayFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all'); // all | with | without
  const [sortBy, setSortBy] = useState('name-asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [savedViewMode, setViewMode] = useViewMode('lgu-road-inventory-view');
  // A 7-column table cannot fit a phone: phones always get the cards.
  const isPhone = useIsPhone();
  const viewMode = isPhone ? 'cards' : savedViewMode;
  const itemsPerPage = viewMode === 'table' ? 10 : 6;

  const inventory = useMemo(() => (Array.isArray(roadInventory) ? roadInventory : []), []);

  const barangays = useMemo(() => {
    return ['all', ...Array.from(new Set(inventory.map((row) => row.barangay).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
  }, [inventory]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return inventory.filter((row) => {
      if (barangayFilter !== 'all' && row.barangay !== barangayFilter) return false;
      if (projectFilter !== 'all') {
        const hasProject = projectsByRoad.has(String(row.roadName || '').trim());
        if ((projectFilter === 'with') !== hasProject) return false;
      }

      if (!normalizedQuery) return true;

      const haystack = [
        row.roadName,
        row.barangay,
        row.classification,
        String(row.yearConstructed || ''),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [inventory, query, barangayFilter, projectFilter, projectsByRoad]);

  const sortedRows = useMemo(() => {
    const [field, dir] = sortBy.split('-');
    const value = SORT_VALUE[field] || SORT_VALUE.name;
    const sign = dir === 'desc' ? -1 : 1;
    return [...filteredRows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return cmp * sign || String(a.roadName || '').localeCompare(String(b.roadName || ''));
    });
  }, [filteredRows, sortBy]);

  const summary = useMemo(() => {
    const totalKm = filteredRows.reduce((sum, row) => sum + (Number(row.lengthKm) || 0), 0);

    return {
      totalRoads: filteredRows.length,
      totalKm,
      withProject: filteredRows.filter((row) => projectsByRoad.has(String(row.roadName || '').trim())).length,
      withoutProject: filteredRows.filter((row) => !projectsByRoad.has(String(row.roadName || '').trim())).length,
    };
  }, [filteredRows, projectsByRoad]);

  const hasFilters = query || barangayFilter !== 'all' || projectFilter !== 'all';

  useEffect(() => {
    setCurrentPage(1);
  }, [query, barangayFilter, projectFilter, sortBy, viewMode]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    return sortedRows.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);
  }, [sortedRows, safePage, itemsPerPage]);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.24em] text-emerald-700 font-semibold">Road Inventory</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Leon barangay roads inventory</h2>
            <p className="mt-2 text-sm text-slate-600">
              Every barangay road in the inventory, with its length, year built and whether it already has an FMR project. Filter and sort to find the roads that need one.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[46rem]">
            <div className="rounded-2xl border border-white/70 bg-white/80 backdrop-blur p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Roads</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.totalRoads}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 backdrop-blur p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Km</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.totalKm.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 backdrop-blur p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">With FMR project</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.withProject}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 backdrop-blur p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">No FMR project yet</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.withoutProject}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search road name, barangay, year..."
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          />
          <select
            value={barangayFilter}
            onChange={(e) => setBarangayFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            {barangays.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All Barangays' : value}
              </option>
            ))}
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="FMR project"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            <option value="all">FMR project: All</option>
            <option value="with">With FMR project</option>
            <option value="without">No FMR project yet</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <p>Showing {filteredRows.length} of {inventory.length} roads.</p>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <button
                onClick={() => {
                  setQuery('');
                  setBarangayFilter('all');
                  setProjectFilter('all');
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
              >
                Clear Filters
              </button>
            )}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort roads"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-emerald-400 focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
            </select>
            {!isPhone && <ViewToggle mode={viewMode} onChange={setViewMode} />}
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="py-12 text-center text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            No roads match the current filters.
          </div>
        ) : viewMode === 'table' ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  {/* Click a header to sort, as in the admin projects table. */}
                  <SortableTh label="Road Name" asc="name-asc" desc="name-desc" defaultDir="asc" sortBy={sortBy} onSortChange={setSortBy} />
                  <SortableTh label="Barangay" asc="barangay-asc" desc="barangay-desc" defaultDir="asc" sortBy={sortBy} onSortChange={setSortBy} />
                  <SortableTh label="Length (km)" asc="length-asc" desc="length-desc" defaultDir="desc" sortBy={sortBy} onSortChange={setSortBy} />
                  <SortableTh label="Year Built" asc="year-asc" desc="year-desc" defaultDir="desc" sortBy={sortBy} onSortChange={setSortBy} />
                  <PlainTh label="FMR project" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map((row) => (
                  <tr
                    key={`${row.roadName}-${row.yearConstructed}-${row.lengthKm}`}
                    onClick={() => setSelectedRoad(row)}
                    className="cursor-pointer align-top transition-colors hover:bg-emerald-50/40"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedRoad(row); }}
                        className="text-left font-semibold text-slate-900 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 rounded"
                      >
                        {row.roadName || 'N/A'}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.barangay || 'N/A'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatNumber(row.lengthKm)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.yearConstructed || 'N/A'}</td>
                    <td className="px-4 py-3">
                      {linkedProjectsFor(row).length > 0 ? (
                        <span className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                          {linkedProjectsFor(row).length === 1 ? 'Has project' : `${linkedProjectsFor(row).length} projects`}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">None yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedRows.map((row) => (
            <button
              type="button"
              key={`${row.roadName}-${row.yearConstructed}-${row.lengthKm}`}
              onClick={() => setSelectedRoad(row)}
              className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors duration-200 line-clamp-2">
                    {row.roadName || 'N/A'}
                  </h3>
                </div>

                <p className="mt-1.5 text-xs font-semibold text-slate-500 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {row.barangay || 'N/A'}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2.5">
                    <p className="text-slate-500 font-medium">Length</p>
                    <p className="mt-0.5 font-bold text-slate-800">{formatNumber(row.lengthKm)} km</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2.5">
                    <p className="text-slate-500 font-medium">FMR project</p>
                    <p className={`mt-0.5 font-bold ${linkedProjectsFor(row).length ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {linkedProjectsFor(row).length ? `${linkedProjectsFor(row).length} on this road` : 'None yet'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2.5">
                    <p className="text-slate-500 font-medium">Year Built</p>
                    <p className="mt-0.5 font-bold text-slate-800">{row.yearConstructed || 'N/A'}</p>
                  </div>
                </div>
              </div>

            </button>
          ))}
        </div>
        )}

        {filteredRows.length > 0 && (
          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5 flex-wrap gap-4">
            <p className="text-xs text-slate-500 font-semibold">
              Showing <span className="text-slate-800">{((safePage - 1) * itemsPerPage) + 1}</span> to{' '}
              <span className="text-slate-800">{Math.min(safePage * itemsPerPage, filteredRows.length)}</span> of{' '}
              <span className="text-slate-800">{filteredRows.length}</span> roads
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Previous
              </button>
              {getPaginationRange(safePage, totalPages).map((page, idx) =>
                page === '...' ? (
                  <span key={`dots-${idx}`} className="px-1 text-[11px] text-slate-400 select-none">…</span>
                ) : (
                  <button
                    type="button"
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg text-[11px] font-extrabold transition ${
                      safePage === page
                        ? 'bg-emerald-600 text-white shadow shadow-emerald-500/20'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {page}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {selectedRoad && (
        <RoadInventoryDetailDialog
          road={selectedRoad}
          linkedProjects={linkedProjectsFor(selectedRoad)}
          onSelectProject={(project) => {
            setSelectedRoad(null);
            setSelectedProject(project);
          }}
          onClose={() => setSelectedRoad(null)}
        />
      )}
      {selectedProject && (
        <FmrProjectDetailDialog
          project={selectedProject}
          tranches={tranchesByProjectId[selectedProject.id] || []}
          onClose={() => setSelectedProject(null)}
        />
      )}
    </div>
  );
}