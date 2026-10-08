const selectClass =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 sm:w-44';

/*
 * Only Year and Barangay: both can be applied correctly to every section.
 * A Project filter was left out on purpose -- farmers and harvest have no
 * real link to a specific project, so it could only narrow the project
 * figures to a single row while the rest of the page silently ignored it.
 */
export default function LguAnalyticsFilters({ years, barangays, filters, onChange, onClear }) {
  const active = filters.year !== 'all' || filters.barangay !== 'all';
  if (years.length === 0 && barangays.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        {years.length > 0 && (
          <label className="flex w-full flex-col gap-1 text-xs font-medium text-slate-600 sm:w-auto">
            Year
            <select value={filters.year} onChange={(e) => onChange({ year: e.target.value })} className={selectClass}>
              <option value="all">All years</option>
              {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </label>
        )}
        {barangays.length > 0 && (
          <label className="flex w-full flex-col gap-1 text-xs font-medium text-slate-600 sm:w-auto">
            Barangay
            <select value={filters.barangay} onChange={(e) => onChange({ barangay: e.target.value })} className={selectClass}>
              <option value="all">All barangays</option>
              {barangays.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
            </select>
          </label>
        )}
        {active && (
          <button
            type="button"
            onClick={onClear}
            className="h-9 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            Clear filters
          </button>
        )}
      </div>
      {filters.year !== 'all' && (
        <p className="mt-2 text-[11px] text-slate-500">
          Year applies to each project&rsquo;s funding year and each harvest&rsquo;s date. The farmer count reflects the current registry and isn&rsquo;t filtered by year.
        </p>
      )}
    </div>
  );
}
