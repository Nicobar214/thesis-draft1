/* ProjectDeadlinesView.jsx — Project Management -> Deadlines.
 * Every unfinished project in the current filters, most urgent first, with
 * whether it will make its target date. Rules: lib/projectDeadlines.js.
 * Replaced the hand-entered Timeline (tasks/milestones), which had no data.
 */
import { useMemo, useState } from 'react';
import { CalendarClockIcon } from 'lucide-react';
import Pagination, { usePagination } from '../ui/Pagination';
import { DEADLINE_STATES, buildDeadlineRows, countDeadlineStates } from '../../lib/projectDeadlines';

const FILTERS = ['all', 'overdue', 'at_risk', 'on_track', 'no_target'];

function fmtDate(d) {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

function TimeLeft({ row }) {
  if (row.daysLeft == null) return <span className="text-slate-400">—</span>;
  if (row.daysLeft < 0) return <span className="font-semibold text-red-700">{Math.abs(row.daysLeft)} days late</span>;
  if (row.daysLeft === 0) return <span className="font-semibold text-amber-700">Due today</span>;
  return <span className={row.state === 'at_risk' ? 'font-semibold text-amber-700' : 'text-slate-700'}>{row.daysLeft} days left</span>;
}

export default function ProjectDeadlinesView({ projects, progressUpdates, onOpenProject }) {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => buildDeadlineRows(projects, progressUpdates), [projects, progressUpdates]);
  const counts = useMemo(() => countDeadlineStates(rows), [rows]);
  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.state === filter)), [rows, filter]);
  const pager = usePagination(shown, `${filter}|${rows.length}`);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-xs" aria-label="Project deadlines">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by deadline status">
          {FILTERS.map((key) => {
            const meta = DEADLINE_STATES[key];
            const count = key === 'all' ? rows.length : counts[key];
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={active}
                className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors ${
                  active ? 'border-teal-600 bg-teal-600 text-white' : count === 0 ? 'border-slate-200 text-slate-400 hover:bg-slate-50' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {meta && <span className={`size-2 rounded-full ${active ? 'bg-white' : count === 0 ? 'bg-slate-300' : meta.dot}`} aria-hidden="true" />}
                {meta ? meta.label : 'All'}
                <span className={`grid h-5 min-w-5 place-items-center rounded-md px-1.5 text-xs font-semibold ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          At risk: ≤30 days left and under 70% done, or ≤90 days and under 40%.
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <CalendarClockIcon className="size-8 text-slate-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-900">{rows.length === 0 ? 'No unfinished projects in these filters' : 'No projects in this group'}</p>
          <p className="mt-1 text-sm text-slate-500">{rows.length === 0 ? 'Completed projects are not listed here.' : 'Pick another group above.'}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3">Project</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Target date</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Last update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pager.pageItems.map((row) => {
                  const meta = DEADLINE_STATES[row.state];
                  const stale = row.daysSinceUpdate != null && row.daysSinceUpdate > 30;
                  return (
                    <tr
                      key={row.project.id}
                      onClick={() => onOpenProject?.(row.project)}
                      className="cursor-pointer transition-colors hover:bg-slate-50/70"
                    >
                      <td className="max-w-[22rem] px-5 py-3">
                        <p className="truncate font-medium text-slate-900" title={row.project.project_name}>{row.project.project_name}</p>
                        <p className="truncate text-xs text-slate-500">{[row.project.barangay, row.project.municipality].filter(Boolean).join(', ') || '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.pill}`}>
                          <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{fmtDate(row.target)}</td>
                      <td className="px-4 py-3 tabular-nums"><TimeLeft row={row} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${meta.dot}`} style={{ width: `${row.accomplishment}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-slate-700 tabular-nums">{Math.round(row.accomplishment)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {row.lastUpdateAt ? (
                          <span className={stale ? 'font-medium text-amber-700' : 'text-slate-600'}>
                            {row.daysSinceUpdate === 0 ? 'Today' : `${row.daysSinceUpdate}d ago`}
                          </span>
                        ) : (
                          <span className="text-slate-400">None yet</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-4 py-3">
            <Pagination pager={pager} noun="project" />
          </div>
        </>
      )}
    </section>
  );
}
