import { useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, SearchIcon } from 'lucide-react';
import Pagination, { usePagination } from '../ui/Pagination';
import { Panel, EmptyState, UnavailableState } from './analyticsParts';
import { fmtInt, fmtPct } from '../../lib/lguAnalytics';

const COLUMNS = [
  { key: 'name', label: 'Barangay', align: 'left' },
  { key: 'projects', label: 'Projects', align: 'right' },
  { key: 'avgAccomplishment', label: 'Avg. accomplishment', align: 'right' },
  { key: 'farmers', label: 'Farmers', align: 'right' },
  { key: 'harvestKg', label: 'Reported harvest (kg)', align: 'right' },
];

const SEARCH_THRESHOLD = 8;
const PAGE_THRESHOLD = 10;

// The visible mark plus a screen-reader/tooltip reason, so "—" never has to
// be guessed at and is never read as a zero.
function Missing({ reason, mark = '—' }) {
  return (
    <span className="text-slate-300" title={reason}>
      <span aria-hidden="true">{mark}</span>
      <span className="sr-only">{reason}</span>
    </span>
  );
}

function compareRows(a, b, { key, dir }) {
  // The "no recorded barangay" row always sits at the bottom.
  if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
  const va = a[key];
  const vb = b[key];
  if (key === 'name') {
    const r = String(va || '').localeCompare(String(vb || ''));
    return dir === 'asc' ? r : -r;
  }
  // Missing values sort last in either direction rather than posing as 0.
  const missingA = va === null || va === undefined;
  const missingB = vb === null || vb === undefined;
  if (missingA !== missingB) return missingA ? 1 : -1;
  if (missingA) return 0;
  return dir === 'asc' ? va - vb : vb - va;
}

function SortHeader({ column, sort, onSort }) {
  const active = sort.key === column.key;
  const Icon = !active ? ArrowUpDownIcon : sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`whitespace-nowrap px-3 py-2.5 text-xs font-medium first:pl-5 last:pr-5 ${column.align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 rounded transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${active ? 'text-slate-900' : 'text-slate-500'}`}
      >
        {column.label}
        <Icon className={`size-3 ${active ? '' : 'opacity-40'}`} aria-hidden="true" />
      </button>
    </th>
  );
}

export default function LguBarangayBreakdown({ rows, unavailable }) {
  const [sort, setSort] = useState({ key: 'projects', dir: 'desc' });
  const [search, setSearch] = useState('');

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? rows.filter((r) => (r.unassigned ? 'barangay not recorded' : String(r.name || '').toLowerCase()).includes(q))
      : rows;
    return [...matched].sort((a, b) => compareRows(a, b, sort));
  }, [rows, search, sort]);

  const pager = usePagination(visibleRows, `${search}|${sort.key}|${sort.dir}|${rows.length}`, 10);

  const onSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  };

  const searchBox = rows.length > SEARCH_THRESHOLD && (
    <label className="relative block w-full sm:w-56">
      <span className="sr-only">Search barangays</span>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search barangay"
        className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-xs text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />
    </label>
  );

  return (
    <Panel
      title="Barangay Breakdown"
      subtitle="Projects, validated farmer beneficiaries, and farmer-reported harvest, by barangay"
      action={!unavailable && searchBox}
    >
      {unavailable ? (
        <UnavailableState>Some of the records this table needs could not be loaded.</UnavailableState>
      ) : rows.length === 0 ? (
        <EmptyState>No barangay data available for the selected filters.</EmptyState>
      ) : visibleRows.length === 0 ? (
        <EmptyState>No barangay matches “{search}”.</EmptyState>
      ) : (
        <>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-y border-slate-200 bg-slate-50/70">
                <tr>
                  {COLUMNS.map((c) => <SortHeader key={c.key} column={c} sort={sort} onSort={onSort} />)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pager.pageItems.map((r) => (
                  <tr key={r.key} className="transition-colors hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-3 py-2.5 pl-5 text-slate-800">
                      {r.unassigned ? <span className="italic text-slate-500">Barangay not recorded</span> : r.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {r.projects > 0 ? fmtInt(r.projects) : <Missing reason="No FMR projects recorded in this barangay" />}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {r.projects === 0 ? (
                        <Missing reason="No FMR projects recorded in this barangay" />
                      ) : r.avgAccomplishment === null ? (
                        <Missing mark="N/A" reason="No on-going or completed project with a certified accomplishment yet" />
                      ) : (
                        fmtPct(r.avgAccomplishment)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {r.unassigned ? (
                        <Missing mark="n/a" reason="Farmers are tracked by barangay, so they can't be attributed to projects without one" />
                      ) : r.farmers > 0 ? fmtInt(r.farmers) : (
                        <Missing reason="No validated farmer beneficiaries in this barangay" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 pr-5 text-right tabular-nums text-slate-700">
                      {r.unassigned ? (
                        <Missing mark="n/a" reason="Harvest is tracked by barangay, so it can't be attributed to projects without one" />
                      ) : r.harvestRecords > 0 ? fmtInt(Math.round(r.harvestKg)) : (
                        <Missing reason="No harvest reported in this barangay" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">—</span> none recorded ·{' '}
            <span className="font-medium text-slate-600">N/A</span> no certified accomplishment yet (proposed projects aren&rsquo;t averaged) ·{' '}
            <span className="font-medium text-slate-600">n/a</span> can&rsquo;t be attributed without a barangay
          </p>

          {visibleRows.length > PAGE_THRESHOLD && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <Pagination pager={pager} noun="barangay" />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
