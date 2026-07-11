import { useMemo, useState } from 'react';

import roadInventory from '../../data/leonRoadInventory.json';

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

export default function RoadInventoryTab() {
  const [query, setQuery] = useState('');
  const [barangayFilter, setBarangayFilter] = useState('all');
  const [surfaceFilter, setSurfaceFilter] = useState('all');
  const [conditionFilter, setConditionFilter] = useState('all');

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

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">Road Name</th>
                <th className="px-4 py-3">Barangay</th>
                <th className="px-4 py-3">Length</th>
                <th className="px-4 py-3">Surface Type</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">ROW</th>
                <th className="px-4 py-3">Year Constructed</th>
                <th className="px-4 py-3">Surface Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={`${row.roadName}-${row.yearConstructed}-${row.lengthKm}`} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-medium text-slate-900">{row.roadName || 'N/A'}</td>
                  <td className="px-4 py-3 text-slate-700">{row.barangay || 'N/A'}</td>
                  <td className="px-4 py-3 text-slate-700">{formatNumber(row.lengthKm)} km</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getSurfaceBadgeTone(row.surfaceType)}`}>
                      {row.surfaceType || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{row.condition || 'N/A'}</td>
                  <td className="px-4 py-3 text-slate-700">{formatNumber(row.row, 2)} m</td>
                  <td className="px-4 py-3 text-slate-700">{row.yearConstructed || 'N/A'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="max-w-[28rem] text-xs leading-5">{row.surfaceSummary || 'N/A'}</div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td className="px-4 py-5 text-slate-500" colSpan={8}>
                    No roads match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}