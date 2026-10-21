import { useMemo, useState } from 'react';
import {
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  HammerIcon,
  HourglassIcon,
  MapPinIcon,
  SearchCheckIcon,
} from 'lucide-react';

import SeverityIcon from '../SeverityIcon';
import RepairWorkSubmit from './RepairWorkSubmit';
import { buttonClass } from '../ui/Button';
import FilterToolbar from '../ui/FilterToolbar';
import Pagination, { usePagination } from '../ui/Pagination';
import { HANDLER_STAGES, countHandlerStages } from '../../lib/handlerFollowUps';
import { acceptPublicReportWork, returnPublicReportWork, startPublicReportWork } from '../../services/publicReportWorkflow';
import {
  SEVERITY_TAXONOMY,
  friendlyReportError,
  resolveCategory,
  resolveSpecificProblem,
  siteRatingLabel,
  workOrderStage,
} from '../../lib/publicReportStatus';
import ZoomablePhoto from '../ui/ZoomablePhoto';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const STAGE_ICONS = {
  todo: ClipboardCheckIcon,
  in_progress: HammerIcon,
  waiting: HourglassIcon,
  checking: SearchCheckIcon,
  done: CircleCheckIcon,
};

// Icon chips: one neutral style, so the counts and the red "overdue" note
// carry the meaning, not the icon colors.
const NEUTRAL_CHIP = 'bg-slate-100 text-slate-600';
const STAGE_CHIPS = {
  todo: NEUTRAL_CHIP,
  in_progress: NEUTRAL_CHIP,
  waiting: NEUTRAL_CHIP,
  checking: NEUTRAL_CHIP,
  done: NEUTRAL_CHIP,
};



/* One row of the 3-step checklist. */
function Step({ number, title, done, active, doneText, children }) {
  return (
    <li className={`rounded-xl border p-3 ${active ? 'border-teal-300 bg-teal-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-3">
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? 'bg-emerald-600 text-white' : active ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-500'
        }`}>
          {done ? <CheckIcon className="size-3.5" aria-hidden="true" /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${done || active ? 'text-slate-900' : 'text-slate-400'}`}>{title}</p>
          {done && doneText && <p className="mt-0.5 text-xs text-slate-500">{doneText}</p>}
          {active && <div className="mt-2">{children}</div>}
        </div>
      </div>
    </li>
  );
}

/**
 * Accept (work date) -> Start work -> Send after-photo. Only the next step is
 * active; the server enforces the same order.
 */
function JobSteps({ action, report, party, client, onChanged }) {
  const stage = workOrderStage(action);
  const [workDate, setWorkDate] = useState(() => {
    const target = action?.target_date;
    return target && target >= todayIso() ? target : todayIso();
  });
  const [startNote, setStartNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      onChanged?.(message);
    } catch (err) {
      onChanged?.(friendlyReportError(err, 'That did not work. Please try again.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ol className="space-y-2">
      <Step
        number={1}
        title="Accept the job and set a work date"
        done={stage !== 'assigned'}
        active={stage === 'assigned'}
        doneText={`Accepted ${fmtDate(action.accepted_at)} · work date ${fmtDate(action.work_date)}`}
      >
        {!returning ? (
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-slate-600">
              When will the work be done?
              <input
                type="date"
                value={workDate}
                min={todayIso()}
                onChange={(e) => setWorkDate(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:w-56"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || !workDate}
                onClick={() => run(() => acceptPublicReportWork(client, { actionId: action.id, workDate }), 'Job accepted. The DA and the citizen can see your work date.')}
                className={buttonClass('primary', 'sm')}
              >
                {busy ? 'Saving...' : 'Accept job'}
              </button>
              <button type="button" onClick={() => setReturning(true)} className="text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-800">
                Not ours? Return to DA
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-slate-600">
              Why are you returning this job? <span className="text-red-600">*</span>
              <textarea
                rows={2}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder={party === 'lgu' ? 'e.g. This needs heavy equipment; it is a road collapse, not debris' : 'e.g. This road section is outside our contract'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setReturning(false)} disabled={busy} className={buttonClass('secondary', 'sm')}>Back</button>
              <button
                type="button"
                disabled={busy || !returnReason.trim()}
                onClick={() => run(() => returnPublicReportWork(client, { actionId: action.id, reason: returnReason.trim() }), 'Returned to the DA.')}
                className={buttonClass('warning', 'sm')}
              >
                {busy ? 'Sending...' : 'Return job'}
              </button>
            </div>
          </div>
        )}
      </Step>

      <Step
        number={2}
        title="Start the work"
        done={['in_progress', 'done', 'closed'].includes(stage)}
        active={stage === 'accepted'}
        doneText={`Started ${fmtDate(action.started_at)}${action.start_note ? ` · ${action.start_note}` : ''}`}
      >
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-slate-600">
            Crew or note <span className="font-normal text-slate-400">(optional)</span>
            <input
              value={startNote}
              onChange={(e) => setStartNote(e.target.value)}
              placeholder={party === 'lgu' ? 'e.g. Barangay crew of 4 with chainsaw' : 'e.g. Patching crew and roller on site'}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => startPublicReportWork(client, { actionId: action.id, note: startNote.trim() || null }), 'Work started. The citizen was told.')}
            className={buttonClass('primary', 'sm')}
          >
            {busy ? 'Saving...' : 'Start work'}
          </button>
        </div>
      </Step>

      <Step
        number={3}
        title="Send the on-site after-photo"
        done={['done', 'closed'].includes(stage)}
        active={stage === 'in_progress'}
        doneText={`Sent ${fmtDate(action.work_submitted_at)}`}
      >
        <RepairWorkSubmit action={action} report={report} client={client} party={party} onDone={onChanged} />
      </Step>
    </ol>
  );
}

function ReportCard({ item, finding, party, client, onChanged }) {
  const { report, action, stage, overdue } = item;
  const [open, setOpen] = useState(stage === 'todo' || stage === 'in_progress');
  const category = resolveCategory(report);
  const meta = SEVERITY_TAXONOMY[category];
  const problem = resolveSpecificProblem(report)?.label || meta?.label;
  const mapUrl = report.latitude != null && report.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${report.latitude},${report.longitude}`
    : null;
  const afterPhoto = action?.work_photo_url || action?.verification_photo_url;
  const workStage = workOrderStage(action);
  const sentBack = workStage === 'in_progress' && Boolean(action?.sent_back_at);

  return (
    <article className={`rounded-2xl border bg-white shadow-sm ${overdue ? 'border-red-300' : 'border-slate-200'}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        {report.photo_url ? (
          <img src={report.photo_url} alt="" className="size-16 shrink-0 rounded-xl border border-slate-200 object-cover" />
        ) : (
          <span className={`flex size-16 shrink-0 items-center justify-center rounded-xl border ${meta?.color || ''}`}>
            <SeverityIcon category={category} className="size-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta?.color || ''}`}>
              <SeverityIcon category={category} /> {problem}
            </span>
            {overdue && <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">Overdue</span>}
          </span>
          <span className="mt-1 block truncate text-sm font-semibold text-slate-900">{report.project_name || 'Unlinked road'}</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {[report.barangay, report.municipality].filter(Boolean).join(', ')} · Reported {fmtDate(report.created_at)}
          </span>
          {(stage === 'todo' || stage === 'in_progress') && action?.target_date && (
            <span className={`mt-1 flex items-center gap-1 text-xs font-semibold ${overdue ? 'text-red-700' : 'text-slate-700'}`}>
              <CalendarClockIcon className="size-3.5" aria-hidden="true" /> DA target: {fmtDate(action.target_date)}
            </span>
          )}
        </span>
        <ChevronDownIcon className={`mt-1 size-5 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          {report.description && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Citizen&rsquo;s report</p>
              <p className="mt-1 text-sm text-slate-700">{report.description}</p>
            </div>
          )}

          {finding && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">DA engineer&rsquo;s findings</p>
              <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Condition:</span> {finding.condition_observed || '—'}</p>
              <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Recommended:</span> {finding.recommended_action || '—'}</p>
              {finding.estimated_cost_range && (
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-medium">Estimated repair cost:</span> {finding.estimated_cost_range}
                  <span className="ml-1 text-xs text-slate-400">(estimate only, not a payment)</span>
                </p>
              )}
              {siteRatingLabel(finding.site_rating) && (
                <p className="mt-1 text-xs text-slate-500">Site rating: {siteRatingLabel(finding.site_rating)}</p>
              )}
              {finding.field_photo_url && (
                <ZoomablePhoto
                  src={finding.field_photo_url}
                  alt="Engineer's site photo"
                  label="Engineer's on-site photo"
                  wrapperClassName="mt-2 w-full sm:w-64"
                  className="h-36 w-full rounded-lg border border-slate-200 object-cover"
                />
              )}
            </div>
          )}

          {action?.planning_note && (
            <div className={`rounded-xl border p-3 ${sentBack ? 'border-orange-200 bg-orange-50' : 'border-teal-200 bg-teal-50'}`}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${sentBack ? 'text-orange-700' : 'text-teal-700'}`}>
                {sentBack ? 'Sent back by the DA' : 'Note from the DA'}
              </p>
              <p className="mt-1 text-sm text-slate-800">{action.planning_note}</p>
            </div>
          )}

          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:underline">
              <MapPinIcon className="size-3.5" aria-hidden="true" /> Open the location in Maps
            </a>
          )}

          {stage === 'checking' && (
            <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              The DA is still checking this report.
            </p>
          )}

          {(stage === 'todo' || stage === 'in_progress') && action && (
            <JobSteps action={action} report={report} party={party} client={client} onChanged={onChanged} />
          )}

          {stage === 'waiting' && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Photo sent {fmtDate(action?.work_submitted_at)}. The DA is reviewing it and will resolve the report or send it back
              {party === 'contractor' && action?.engineer_check_requested_at ? '. A DA field engineer will also check the repair on site.' : '.'}
            </p>
          )}

          {stage === 'done' && (
            <p className="text-sm text-slate-700">
              {String(report.status).toLowerCase() === 'resolved'
                ? `Resolved ${fmtDate(report.resolved_at)}.`
                : workStage === 'returned'
                  ? `You returned this job: ${action?.cancel_reason || ''}`
                  : 'Closed by the DA.'}
            </p>
          )}

          {(stage === 'waiting' || stage === 'done') && afterPhoto && report.photo_url && (
            <div className="grid grid-cols-2 gap-2">
              <figure className="space-y-1">
                <figcaption className="text-xs font-semibold text-slate-600">Before</figcaption>
                <ZoomablePhoto
                  src={report.photo_url}
                  alt="Reported condition"
                  photos={[{ src: report.photo_url, label: 'Before' }, { src: afterPhoto, label: 'After' }]}
                  index={0}
                  wrapperClassName="w-full"
                  className="h-32 w-full rounded-lg border border-slate-200 object-cover"
                />
              </figure>
              <figure className="space-y-1">
                <figcaption className="text-xs font-semibold text-emerald-800">After</figcaption>
                <ZoomablePhoto
                  src={afterPhoto}
                  alt="After the work"
                  photos={[{ src: report.photo_url, label: 'Before' }, { src: afterPhoto, label: 'After' }]}
                  index={1}
                  wrapperClassName="w-full"
                  className="h-32 w-full rounded-lg border border-emerald-200 object-cover"
                />
              </figure>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const STAGE_ORDER = ['todo', 'in_progress', 'waiting', 'checking', 'done'];

/**
 * Citizen reports handled by the signed-in LGU or contractor: what the DA is
 * still checking, the jobs assigned to them, and what is closed.
 */
export default function HandlerReportsPanel({ queue = [], findings = {}, loading = false, party, client, onChanged, intro }) {
  const [stage, setStage] = useState('todo');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [townFilter, setTownFilter] = useState('All');
  const [barangayFilter, setBarangayFilter] = useState('All');
  const [roadFilter, setRoadFilter] = useState('All');
  const [sortBy, setSortBy] = useState('due');

  const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const typeOptions = useMemo(() => uniqueSorted(queue.map((item) => resolveCategory(item.report)))
    .map((key) => ({ value: key, label: SEVERITY_TAXONOMY[key]?.label || key })), [queue]);
  const townOptions = useMemo(() => uniqueSorted(queue.map((item) => item.report.municipality))
    .map((m) => ({ value: m, label: m })), [queue]);
  const barangayOptions = useMemo(() => uniqueSorted(queue
    .filter((item) => townFilter === 'All' || item.report.municipality === townFilter)
    .map((item) => item.report.barangay))
    .map((b) => ({ value: b, label: b })), [queue, townFilter]);
  const roadOptions = useMemo(() => uniqueSorted(queue.map((item) => item.report.project_name))
    .map((r) => ({ value: r, label: r })), [queue]);

  // Search and filters narrow both the stage cards and the list, so the counts
  // always match what is shown.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue.filter(({ report }) => {
      if (typeFilter !== 'All' && resolveCategory(report) !== typeFilter) return false;
      if (townFilter !== 'All' && report.municipality !== townFilter) return false;
      if (barangayFilter !== 'All' && report.barangay !== barangayFilter) return false;
      if (roadFilter !== 'All' && report.project_name !== roadFilter) return false;
      if (!q) return true;
      const hay = [
        report.project_name, report.barangay, report.municipality, report.description,
        resolveSpecificProblem(report)?.label, SEVERITY_TAXONOMY[resolveCategory(report)]?.label,
        String(report.id || '').slice(0, 8),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [queue, search, typeFilter, townFilter, barangayFilter, roadFilter]);

  const counts = useMemo(() => countHandlerStages(filtered), [filtered]);
  const rows = useMemo(() => {
    const list = filtered.filter((item) => item.stage === stage);
    const byDate = (x, y) => String(x.report.created_at).localeCompare(String(y.report.created_at));
    if (sortBy === 'newest') return list.sort((x, y) => byDate(y, x));
    if (sortBy === 'oldest') return list.sort(byDate);
    // Due first: overdue, then nearest target date, then newest report.
    return list.sort((x, y) => (y.overdue - x.overdue)
      || String(x.action?.target_date || '9999').localeCompare(String(y.action?.target_date || '9999'))
      || byDate(y, x));
  }, [filtered, stage, sortBy]);
  const pager = usePagination(rows, [stage, search, typeFilter, townFilter, barangayFilter, roadFilter, sortBy].join('|'));

  return (
    <section className="space-y-4">
      {intro && <p className="text-sm text-slate-600">{intro}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="tablist" aria-label="Job stage" data-tour="handler-stages">
        {STAGE_ORDER.map((key) => {
          const Icon = STAGE_ICONS[key];
          const active = stage === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStage(key)}
              className={`flex min-w-0 flex-col rounded-2xl border p-4 text-left shadow-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                active ? 'border-teal-500 bg-teal-50/50 ring-2 ring-teal-500/30' : 'border-slate-200/60 bg-white hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${STAGE_CHIPS[key]}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="truncate text-xs font-medium text-slate-500">{HANDLER_STAGES[key].label}</span>
              </span>
              <span className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{counts[key]}</span>
              {/* Only what needs attention gets a second line. */}
              {key === 'todo' && counts.overdue > 0 && (
                <span className="mt-0.5 truncate text-[11px] font-semibold text-red-600">{counts.overdue} overdue</span>
              )}
            </button>
          );
        })}
      </div>

      <div data-tour="handler-filters">
      <FilterToolbar
        ariaLabel="Filter citizen reports"
        noun="report"
        shown={rows.length}
        total={queue.filter((item) => item.stage === stage).length}
        search={{ value: search, onChange: setSearch, placeholder: 'Search road, barangay, problem or reference #' }}
        selects={[
          ...(typeOptions.length > 1 ? [{ key: 'type', label: 'Issue type', value: typeFilter, onChange: setTypeFilter, allLabel: 'All issue types', options: typeOptions }] : []),
          ...(townOptions.length > 1 ? [{ key: 'town', label: 'Municipality', value: townFilter, onChange: (v) => { setTownFilter(v); setBarangayFilter('All'); }, allLabel: 'All municipalities', options: townOptions }] : []),
          ...(barangayOptions.length > 1 ? [{ key: 'brgy', label: 'Barangay', value: barangayFilter, onChange: setBarangayFilter, allLabel: 'All barangays', options: barangayOptions, chipLabel: (v) => `Brgy. ${v}` }] : []),
          ...(roadOptions.length > 1 ? [{ key: 'road', label: 'Road', value: roadFilter, onChange: setRoadFilter, allLabel: 'All roads', options: roadOptions }] : []),
          {
            key: 'sort', label: 'Sort', value: sortBy, onChange: setSortBy, allValue: 'due', allLabel: 'Due first', chip: false,
            options: [{ value: 'newest', label: 'Newest report' }, { value: 'oldest', label: 'Oldest report' }],
          },
        ]}
      />
      </div>

      {loading && queue.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading reports...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {filtered.length < queue.length ? 'No reports match these filters.' : 'No reports here.'}
        </div>
      ) : (
        <div className="space-y-3" data-tour="handler-list">
          {pager.pageItems.map((item) => (
            <ReportCard
              key={item.report.id}
              item={item}
              finding={findings[item.report.id]}
              party={party}
              client={client}
              onChanged={onChanged}
            />
          ))}
          <Pagination pager={pager} noun="report" />
        </div>
      )}
    </section>
  );
}
