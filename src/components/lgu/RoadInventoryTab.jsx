import { useMemo, useState, useEffect } from 'react';

import roadInventory from '../../data/leonRoadInventory.json';
import { getPaginationRange } from '../../lib/paginationUtils';

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '') return 'N/A';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function getSurfaceBadgeTone(surfaceType) {
  if (surfaceType === 'Concrete') return 'bg-sky-50 border-sky-200 text-sky-700';
  if (surfaceType === 'Asphalt') return 'bg-violet-50 border-violet-200 text-violet-700';
  if (surfaceType === 'Gravel') return 'bg-amber-50 border-amber-200 text-amber-700';
  if (surfaceType === 'Earth') return 'bg-stone-50 border-stone-200 text-stone-700';
  return 'bg-slate-50 border-slate-200 text-slate-700';
}

function getConditionBadgeTone(condition) {
  const cond = String(condition || '').toLowerCase();
  if (cond === 'excellent' || cond === 'good') return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  if (cond === 'fair') return 'bg-amber-50 border-amber-200 text-amber-700';
  if (cond === 'poor' || cond === 'critical') return 'bg-rose-50 border-rose-200 text-rose-700';
  return 'bg-slate-50 border-slate-200 text-slate-700';
}

export default function RoadInventoryTab() {
  const [query, setQuery] = useState('');
  const [barangayFilter, setBarangayFilter] = useState('all');
  const [surfaceFilter, setSurfaceFilter] = useState('all');
  const [conditionFilter, setConditionFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  const inventory = useMemo(() => (Array.isArray(roadInventory) ? roadInventory : []), []);

  const barangays = useMemo(() => {
    return ['all', ...Array.from(new Set(inventory.map((row) => row.barangay).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
  }, [inventory]);

  const surfaceTypes = useMemo(() => {
    return ['all', ...Array.from(new Set(inventory.map((row) => row.surfaceType).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
  }, [inventory]);

  const conditions = useMemo(() => {
    return ['all', ...Array.from(new Set(inventory.map((row) => row.condition).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
  }, [inventory]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return inventory.filter((row) => {
      if (barangayFilter !== 'all' && row.barangay !== barangayFilter) return false;
      if (surfaceFilter !== 'all' && row.surfaceType !== surfaceFilter) return false;
      if (conditionFilter !== 'all' && row.condition !== conditionFilter) return false;

      if (!normalizedQuery) return true;

      const haystack = [
        row.roadName,
        row.barangay,
        row.surfaceType,
        row.condition,
        row.classification,
        String(row.yearConstructed || ''),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [inventory, query, barangayFilter, surfaceFilter, conditionFilter]);

  const summary = useMemo(() => {
    const totalKm = filteredRows.reduce((sum, row) => sum + (Number(row.lengthKm) || 0), 0);

    return {
      totalRoads: filteredRows.length,
      totalKm,
      concrete: filteredRows.filter((row) => row.surfaceType === 'Concrete').length,
      poor: filteredRows.filter((row) => String(row.condition || '').toLowerCase() === 'poor' || String(row.condition || '').toLowerCase() === 'critical').length,
    };
  }, [filteredRows]);

  const hasFilters = query || barangayFilter !== 'all' || surfaceFilter !== 'all' || conditionFilter !== 'all';

  useEffect(() => {
    setCurrentPage(1);
  }, [query, barangayFilter, surfaceFilter, conditionFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    return filteredRows.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);
  }, [filteredRows, safePage]);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.24em] text-emerald-700 font-semibold">Road Inventory</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Leon barangay roads inventory</h2>
            <p className="mt-2 text-sm text-slate-600">
              Browse the road records provided in the CSV. Surface type and condition are summarized from the dominant surfaced segment so LGU staff can scan the inventory quickly.
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
              <p className="text-xs uppercase tracking-wide text-slate-500">Concrete</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.concrete}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 backdrop-blur p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Needs Attention</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.poor}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search road name, barangay, condition..."
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
            value={surfaceFilter}
            onChange={(e) => setSurfaceFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            {surfaceTypes.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All Surface Types' : value}
              </option>
            ))}
          </select>
          <select
            value={conditionFilter}
            onChange={(e) => setConditionFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            {conditions.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All Conditions' : value}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <p>Showing {filteredRows.length} of {inventory.length} roads.</p>
          {hasFilters && (
            <button
              onClick={() => {
                setQuery('');
                setBarangayFilter('all');
                setSurfaceFilter('all');
                setConditionFilter('all');
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
            >
              Clear Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedRows.map((row) => (
            <div
              key={`${row.roadName}-${row.yearConstructed}-${row.lengthKm}`}
              className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-slate-300 hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors duration-200 line-clamp-2">
                    {row.roadName || 'N/A'}
                  </h3>
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold shrink-0 capitalize ${getConditionBadgeTone(row.condition)}`}>
                    {row.condition || 'N/A'}
                  </span>
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
                    <p className="text-slate-500 font-medium">Surface Type</p>
                    <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold border ${getSurfaceBadgeTone(row.surfaceType)}`}>
                      {row.surfaceType || 'Unknown'}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2.5">
                    <p className="text-slate-500 font-medium">Right of Way</p>
                    <p className="mt-0.5 font-bold text-slate-800">{formatNumber(row.row, 2)} m</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2.5">
                    <p className="text-slate-500 font-medium">Year Built</p>
                    <p className="mt-0.5 font-bold text-slate-800">{row.yearConstructed || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {row.surfaceSummary && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Surface Breakdown</p>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed line-clamp-3">
                    {row.surfaceSummary}
                  </p>
                </div>
              )}
            </div>
          ))}
          {filteredRows.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              No roads match the current filters.
            </div>
          )}
        </div>

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
    </div>
  );
}