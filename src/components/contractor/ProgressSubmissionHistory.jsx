import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDownIcon, HistoryIcon } from 'lucide-react';

import FilterToolbar from '../ui/FilterToolbar';
import Pagination, { usePagination } from '../ui/Pagination';
import { PhotoViewButton } from '../ui/ZoomablePhoto';
import { pipelineStage, STAGES } from '../../lib/contractorPipeline';
import { formatPercentage } from '../../lib/percentageFormat';

const PERIODS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
];

const fmtDateTime = (d) =>
  (d ? new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function inPeriod(iso, period) {
  if (period === 'All' || !iso) return true;
  const t = new Date(iso).getTime();
  if (period === 'year') return new Date(iso).getFullYear() === new Date().getFullYear();
  return Date.now() - t <= Number(period) * 86400000;
}

/**
 * The contractor's progress submissions and where each is in review. Lives on
 * My Projects, collapsed by default so the page stays on the projects; it
 * opens on its own when a notification or link points at an update
 * (?update=<id>) or asks for it (?history=1).
 */
export default function ProgressSubmissionHistory({ client, userId }) {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('update');
  const [open, setOpen] = useState(Boolean(highlightId || searchParams.get('history')));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [periodFilter, setPeriodFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await client
      .from('progress_updates')
      .select('id, fmr_project_id, reported_accomplishment, remarks, photo_url, status, certification_status, certification_remarks, certified_accomplishment, approval_remarks, submitted_at, reviewed_at, certified_at, fmr_projects(project_name, municipality, accomplishment, status)')
      .eq('contractor_id', userId)
      .order('submitted_at', { ascending: false });
    if (!error) setRows(data || []);
    setLoading(false);
  }, [client, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    queueMicrotask(load);
    const channel = client
      .channel(`contractor-progress-history-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_updates' }, load)
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, userId, load]);

  // Scroll to the update a notification pointed at, or to the section when a
  // link asked for the history (?history=1).
  const wantsHistory = Boolean(searchParams.get('history'));
  useEffect(() => {
    if (!open || loading) return;
    if (highlightId) document.getElementById(`update-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (wantsHistory) document.getElementById('progress-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [open, highlightId, wantsHistory, loading, rows]);

  const counts = useMemo(() => {
    const c = { approved: 0, awaiting_engineer: 0, awaiting_admin: 0, needsFix: 0 };
    rows.forEach((r) => {
      const st = pipelineStage(r);
      if (c[st.key] !== undefined) c[st.key] += 1;
      if (st.needsFix) c.needsFix += 1;
    });
    return c;
  }, [rows]);

  const projectOptions = useMemo(
    () => [...new Set(rows.map((r) => r.fmr_projects?.project_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (stageFilter !== 'All' && pipelineStage(r).key !== stageFilter) return false;
      if (projectFilter !== 'All' && (r.fmr_projects?.project_name || '') !== projectFilter) return false;
      if (!inPeriod(r.submitted_at, periodFilter)) return false;
      if (q && !`${r.fmr_projects?.project_name || ''} ${r.remarks || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortBy === 'oldest' ? [...list].reverse() : list;
  }, [rows, search, stageFilter, projectFilter, periodFilter, sortBy]);
  const pager = usePagination(filtered, [search, stageFilter, projectFilter, periodFilter, sortBy].join('|'));

  const clearAll = () => { setSearch(''); setStageFilter('All'); setProjectFilter('All'); setPeriodFilter('All'); };

  return (
    <section id="progress-history" className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50/60"
      >
        <span className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-600">
            <HistoryIcon className="size-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-base font-bold text-slate-900">Progress Submission History</span>
            <span className="block text-sm text-slate-500">
              {rows.length} submission{rows.length === 1 ? '' : 's'} · {counts.approved} approved
              {counts.awaiting_engineer + counts.awaiting_admin > 0 ? ` · ${counts.awaiting_engineer + counts.awaiting_admin} in review` : ''}
              {counts.needsFix > 0 ? ` · ${counts.needsFix} need correction` : ''}
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
          {open ? 'Hide history' : 'Show history'}
          <ChevronDownIcon className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200/60">
          <FilterToolbar
            embedded
            ariaLabel="Filter submissions"
            noun="submission"
            shown={filtered.length}
            total={rows.length}
            search={{ value: search, onChange: setSearch, placeholder: 'Search project or remarks', ariaLabel: 'Search submissions' }}
            selects={[
              {
                key: 'stage', label: 'Stage', value: stageFilter, onChange: setStageFilter, allLabel: 'All stages',
                options: Object.values(STAGES).map((st) => ({ value: st.key, label: st.label })),
              },
              ...(projectOptions.length > 1 ? [{
                key: 'project', label: 'Project', value: projectFilter, onChange: setProjectFilter, allLabel: 'All projects',
                options: projectOptions.map((n) => ({ value: n, label: n })),
              }] : []),
              { key: 'period', label: 'Submitted', value: periodFilter, onChange: setPeriodFilter, allLabel: 'Any time', options: PERIODS },
              {
                key: 'sort', label: 'Sort', value: sortBy, onChange: setSortBy, allValue: 'newest', allLabel: 'Newest first', chip: false,
                options: [{ value: 'oldest', label: 'Oldest first' }],
              },
            ]}
          />

          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Loading submissions...</p>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-base font-bold text-slate-900">No submission history yet</p>
              <p className="mt-1 text-sm text-slate-500">Your approved, pending and returned progress updates will appear here.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-base font-bold text-slate-900">No submissions match these filters</p>
              <button onClick={clearAll} className="mt-2 text-sm font-semibold text-teal-700 hover:underline">Clear filters</button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/60">
                      {['Project', 'Submitted %', 'Current Project %', 'Stage', 'Submitted At', 'Reviewed At', 'Remarks', 'Photo'].map((h) => (
                        <th key={h} className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pager.pageItems.map((item) => {
                      const stage = pipelineStage(item);
                      return (
                        <tr key={item.id} id={`update-${item.id}`} className={`align-top transition-colors ${item.id === highlightId ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : 'hover:bg-slate-50/60'}`}>
                          <td className="max-w-xs px-5 py-4">
                            <p className="line-clamp-2 text-sm font-semibold text-slate-900">{item.fmr_projects?.project_name || `Project ${item.fmr_project_id}`}</p>
                            {item.fmr_projects?.municipality && <p className="mt-0.5 text-xs text-slate-500">{item.fmr_projects.municipality}</p>}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 font-mono text-sm font-bold text-slate-900">{formatPercentage(item.reported_accomplishment)}</td>
                          <td className="whitespace-nowrap px-5 py-4 font-mono text-sm font-semibold text-slate-700">{formatPercentage(item.fmr_projects?.accomplishment ?? 0)}</td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold ${stage.badge}`}>{stage.label}</span>
                            <p className="mt-1.5 max-w-[14rem] text-[11px] leading-snug text-slate-500">{stage.helper}</p>
                            {stage.needsFix && (item.certification_remarks || item.approval_remarks) && (
                              <p className="mt-1.5 max-w-[14rem] rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">{item.certification_remarks || item.approval_remarks}</p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">{fmtDateTime(item.submitted_at)}</td>
                          <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">{item.status === 'pending' ? 'Awaiting review' : fmtDateTime(item.reviewed_at)}</td>
                          <td className="max-w-xs px-5 py-4"><p className="line-clamp-3 text-xs text-slate-600">{item.remarks || '—'}</p></td>
                          <td className="whitespace-nowrap px-5 py-4">
                            {item.photo_url ? (
                              <PhotoViewButton src={item.photo_url} label="Progress photo" className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700">View</PhotoViewButton>
                            ) : <span className="text-xs text-slate-400">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-6 py-4">
                <Pagination pager={pager} noun="record" />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
