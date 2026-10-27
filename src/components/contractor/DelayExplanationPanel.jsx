/* DelayExplanationPanel.jsx — the contractor's side of the overdue process
 * (supabase_overdue_v2.sql), shown on Delay Follow-ups (/contractor/delays).
 * When one of their projects passes its target date, the DA asks; the contractor
 * picks the cause (Act of nature: not counted, needs proof / Manpower: an offense)
 * and commits a new finish date inside the allowed window (60 / 45 / 30 days by
 * offense, or the days work stopped). delay_submit_commitment checks it all again.
 *
 * Layout: a list (To answer / Waiting on the DA / Decided, most urgent first) and
 * the selected project beside it, so many late projects stay one short list
 * instead of a column of forms. Drafts are kept per project while switching.
 * `focusProjectId` (from a notification link, /contractor/delays?project=<id>)
 * opens that project.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClockIcon, CheckCircle2Icon, ChevronRightIcon, HourglassIcon, SearchIcon, SendIcon, TriangleAlertIcon } from 'lucide-react';
import { notify } from '../../lib/toast';
import { Modal } from '../ui/Modal';
import { EvidenceActions, EvidenceGrid } from '../evidence/EvidencePicker';
import EvidenceGallery from '../evidence/EvidenceGallery';
import { evidenceSummary, uploadEvidence } from '../../lib/evidence';

const EVIDENCE_BUCKET = 'delay-evidence';
import {
  addDays, caseDue, causeLabel, commitmentProblems, commitWindow, CONTRACTOR_TURN, CONTRACTOR_WAITING, DELAY_CAUSES, daysBetween,
  fmtDay, friendlyDelayError, manilaToday, MAX_OFFENSES, MIN_REASON, NATURE_CAP_DAYS, offenseLabel, offenseWindow, OUTCOMES,
  parseTargetDate, REQUEST_EVENT, toISODate,
} from '../../lib/delayCases';

const RECENT_CLOSED_DAYS = 30;
const SEARCH_FROM = 7; // show a search box once a list is this long

/** Loads this contractor's follow-ups (RLS: only their projects), the projects, and the DA's notes. */
async function loadContractorCases(client) {
  const { data: cases, error } = await client.from('project_delay_cases').select('*').order('opened_at', { ascending: false });
  if (error) throw error;
  const list = cases || [];
  if (!list.length) return { cases: [], projects: new Map(), notes: new Map() };
  const projectIds = [...new Set(list.map((c) => c.project_id))];
  const caseIds = list.map((c) => c.id);
  const [p, e] = await Promise.all([
    client.from('fmr_projects').select('id, project_name, barangay, municipality, accomplishment, target_completion_date, status').in('id', projectIds),
    client.from('project_delay_case_events').select('case_id, event_type, payload, created_at')
      .in('case_id', caseIds).in('event_type', Object.values(REQUEST_EVENT)).order('created_at', { ascending: true }),
  ]);
  const projects = new Map((p.data || []).map((x) => [String(x.id), x]));
  // Latest DA note per case and request type.
  const notes = new Map();
  (e.data || []).forEach((ev) => notes.set(`${ev.case_id}:${ev.event_type}`, ev.payload?.note || ''));
  return { cases: list, projects, notes };
}

const TABS = [
  { key: 'answer', label: 'To answer' },
  { key: 'waiting', label: 'Waiting on DA' },
  { key: 'decided', label: 'Decided' },
];

export default function DelayExplanationPanel({ client, userId, focusProjectId = null }) {
  const [data, setData] = useState({ cases: [], projects: new Map(), notes: new Map() });
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [tab, setTab] = useState(null);         // null = pick the first tab that has something
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({});      // case id -> form, kept while switching projects
  const today = manilaToday();

  const load = useCallback(async () => {
    if (!client || !userId) return;
    try {
      setData(await loadContractorCases(client));
      setUnavailable(false);
    } catch {
      setUnavailable(true);   // not set up yet, or offline
    } finally {
      setLoading(false);
    }
  }, [client, userId]);

  useEffect(() => { load(); }, [load]);

  // Live: a new request, a decision or a closure shows up without a reload.
  useEffect(() => {
    if (!client?.channel || !userId) return undefined;
    const channel = client
      .channel(`contractor-delay-cases-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_delay_cases' }, () => load())
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, userId, load]);

  const groups = useMemo(() => {
    const cutoff = addDays(today, -RECENT_CLOSED_DAYS);
    const closedAt = (c) => parseTargetDate(String(c.closed_at || '').slice(0, 10));
    const dueTime = (c) => caseDue(c, today)?.date?.getTime() ?? Infinity;
    return {
      // Most urgent first: the earliest reply-by date on top.
      answer: data.cases.filter((c) => CONTRACTOR_TURN[c.status]).sort((a, b) => dueTime(a) - dueTime(b)),
      waiting: data.cases.filter((c) => CONTRACTOR_WAITING[c.status]),
      decided: data.cases.filter((c) => c.status === 'closed' && closedAt(c) && closedAt(c) >= cutoff),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, today.getTime()]);

  // Which tab and project to show: the notification's project, else the first with something.
  const focusKey = focusProjectId != null ? String(focusProjectId) : '';
  useEffect(() => {
    if (!focusKey) return;
    setSelectedId(null);
    setTab(null);
    setSearch('');
  }, [focusKey]);
  const focusCase = focusKey ? data.cases.find((c) => String(c.project_id) === focusKey && c.status !== 'closed')
    || data.cases.find((c) => String(c.project_id) === focusKey) : null;
  const focusTab = focusCase ? TABS.find((t) => groups[t.key].includes(focusCase))?.key : null;
  const activeTab = tab || focusTab || TABS.find((t) => groups[t.key].length)?.key || 'answer';

  const nameOf = (c) => data.projects.get(String(c.project_id))?.project_name || `Project #${c.project_id}`;
  const q = search.trim().toLowerCase();
  const list = groups[activeTab].filter((c) => !q || nameOf(c).toLowerCase().includes(q)
    || String(data.projects.get(String(c.project_id))?.municipality || '').toLowerCase().includes(q));
  const selected = list.find((c) => c.id === selectedId)
    || (focusCase && list.includes(focusCase) && !selectedId ? focusCase : null)
    || list[0] || null;

  useEffect(() => {
    if (!focusCase || loading) return;
    document.getElementById('delay-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCase?.id, loading]);

  if (loading) return <div className="h-64 animate-pulse rounded-2xl bg-slate-100" aria-hidden="true" />;
  if (unavailable) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Delay follow-ups could not be loaded. Check your connection and try again.</p>;
  }
  if (!data.cases.length || !TABS.some((t) => groups[t.key].length)) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
        <CheckCircle2Icon className="size-8 text-emerald-500" aria-hidden="true" />
        <p className="font-semibold text-slate-800">None of your projects is late</p>
        <p className="max-w-sm text-sm text-slate-500">If a project passes its target date, the DA&rsquo;s request to commit a new finish date will appear here.</p>
      </div>
    );
  }

  const pick = (c) => {
    setSelectedId(c.id);
    // On a phone the detail is below the list: bring it into view.
    if (window.matchMedia?.('(max-width: 1023px)').matches) {
      setTimeout(() => document.getElementById('delay-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }
  };

  return (
    <section className="grid items-start gap-5 lg:grid-cols-[minmax(18rem,24rem)_1fr]" aria-label="Delay follow-ups">
      {/* ── The list ─────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:sticky lg:top-4">
        <div className="border-b border-slate-100 p-3">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Follow-up lists">
            {TABS.map((t) => {
              const n = groups[t.key].length;
              const on = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => { setTab(t.key); setSelectedId(null); setSearch(''); }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {t.label}
                  <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] ${t.key === 'answer' && n > 0 ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{n}</span>
                </button>
              );
            })}
          </div>
          {groups[activeTab].length >= SEARCH_FROM && (
            <label className="relative mt-2 block">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search project or town"
                aria-label="Search follow-ups"
                className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </label>
          )}
        </div>

        {list.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            {q ? 'No project matches your search.' : activeTab === 'answer' ? 'Nothing to answer right now.' : activeTab === 'waiting' ? 'Nothing is waiting on the DA.' : 'No decisions in the last 30 days.'}
          </p>
        ) : (
          <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
            {list.map((c) => (
              <li key={c.id}>
                <CaseRow c={c} project={data.projects.get(String(c.project_id))} today={today} active={selected?.id === c.id} onPick={() => pick(c)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── The selected project ─────────────────────────────────── */}
      <div id="delay-detail" className="scroll-mt-24">
        {selected && (
          CONTRACTOR_TURN[selected.status] ? (
            <ReplyCard
              key={selected.id}
              c={selected}
              project={data.projects.get(String(selected.project_id))}
              note={data.notes.get(`${selected.id}:${REQUEST_EVENT[selected.status]}`)}
              today={today}
              client={client}
              draft={drafts[selected.id]}
              onDraft={(form) => setDrafts((d) => ({ ...d, [selected.id]: form }))}
              onSent={async () => { setDrafts((d) => { const next = { ...d }; delete next[selected.id]; return next; }); setSelectedId(null); await load(); }}
            />
          ) : (
            <StatusCard c={selected} project={data.projects.get(String(selected.project_id))} today={today} client={client} />
          )
        )}
      </div>
    </section>
  );
}

/* ── List row ─────────────────────────────────────────────────────── */

function lateDays(c, today) {
  const target = parseTargetDate(c.target_date_at_open);
  return target ? Math.max(0, daysBetween(target, today)) : null;
}

function DueChip({ c, today }) {
  const due = caseDue(c, today);
  if (!due) return null;
  const tone = due.overdue ? 'bg-red-600 text-white' : due.daysLeft <= 1 ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200';
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {due.overdue ? 'Reply overdue' : due.daysLeft === 0 ? 'Reply due today' : `Reply by ${fmtDay(due.date)}`}
    </span>
  );
}

function CaseRow({ c, project, today, active, onPick }) {
  const late = lateDays(c, today);
  const turn = CONTRACTOR_TURN[c.status];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${active ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
    >
      <span className={`h-9 w-1 shrink-0 rounded-full ${turn && Number(c.offense_no) >= MAX_OFFENSES && c.kind !== 'act_of_nature' ? 'bg-red-600' : turn ? 'bg-amber-400' : c.status === 'closed' ? 'bg-slate-300' : 'bg-sky-400'}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{project?.project_name || `Project #${c.project_id}`}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {project?.municipality && <span>{project.municipality}</span>}
          {c.status !== 'closed' && late != null && <span className="font-medium text-red-700">{late} day{late === 1 ? '' : 's'} late</span>}
          {c.status !== 'closed' && <span className="font-semibold text-slate-600">{offenseLabel(c)}</span>}
          {turn ? <DueChip c={c} today={today} /> : c.status === 'closed' ? (
            <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${OUTCOMES[c.outcome]?.tone || ''}`}>{OUTCOMES[c.outcome]?.label || 'Closed'}</span>
          ) : <span>With the DA</span>}
        </span>
      </span>
      <ChevronRightIcon className={`size-4 shrink-0 ${active ? 'text-teal-600' : 'text-slate-300'}`} aria-hidden="true" />
    </button>
  );
}

/* ── Detail ───────────────────────────────────────────────────────── */

function DetailHead({ c, project, today, right }) {
  const target = parseTargetDate(c.target_date_at_open);
  const late = lateDays(c, today);
  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-900">{project?.project_name || `Project #${c.project_id}`}</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          {[project?.barangay, project?.municipality].filter(Boolean).join(', ')}
          {target && <> · Target was {fmtDay(target)}{c.status !== 'closed' && late != null ? ` · ${late} day(s) late` : ''}</>}
        </p>
      </div>
      {right}
    </div>
  );
}

function Sent({ c }) {
  if (!c.explanation) return null;
  return (
    <dl className="mt-4 grid gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-[9rem_1fr]">
      <dt className="text-slate-500">Your cause</dt>
      <dd className="text-slate-800">
        {causeLabel(c.cause)}
        {c.kind === 'act_of_nature' && c.event_name && <span className="text-slate-500"> · {c.event_name}, {c.stopped_days} day(s) stopped</span>}
      </dd>
      <dt className="text-slate-500">What you said</dt><dd className="whitespace-pre-line text-slate-800">{c.explanation}</dd>
      {c.proposed_date && <><dt className="text-slate-500">New finish date</dt><dd className="text-slate-800">{fmtDay(c.proposed_date)}</dd></>}
    </dl>
  );
}

/** The evidence sent with a follow-up. */
function useCaseEvidence(client, caseId) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!client || !caseId) return undefined;
    let alive = true;
    client.from('project_delay_evidence').select('*').eq('case_id', caseId).order('created_at', { ascending: true })
      .then(({ data, error }) => { if (alive && !error) setRows(data || []); });
    return () => { alive = false; };
  }, [client, caseId]);
  return rows;
}

function StatusCard({ c, project, today, client }) {
  const closed = c.status === 'closed';
  const evidence = useCaseEvidence(client, c.id);
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <DetailHead c={c} project={project} today={today} right={<OffenseChip c={c} />} />
      {closed ? (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm">
          <span className={`inline-flex rounded-lg border px-2 py-0.5 text-xs font-semibold ${OUTCOMES[c.outcome]?.tone || ''}`}>{OUTCOMES[c.outcome]?.label || 'Closed'}</span>
          <p className="mt-2 text-slate-700">
            {c.outcome === 'extended' && c.new_target_date && <>New finish date: <span className="font-semibold">{fmtDay(c.new_target_date)}</span>{c.kind === 'act_of_nature' ? ' (act of nature, not counted as an offense)' : ` (${offenseLabel(c)})`}. </>}
            {c.outcome === 'no_reply' && <>No commitment was sent by the reply date, so it was counted as Offense {c.offense_no} of {MAX_OFFENSES}. </>}
            {c.outcome === 'terminated' && <>Your contract on this project was terminated after 3 offenses. </>}
            {c.outcome_reason}
          </p>
        </div>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">
          <HourglassIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {CONTRACTOR_WAITING[c.status]}
        </p>
      )}
      <Sent c={c} />
      {evidence.length > 0 && <div className="mt-4"><EvidenceGallery client={client} bucket={EVIDENCE_BUCKET} items={evidence} title="Evidence you sent" /></div>}
    </article>
  );
}

function OffenseChip({ c }) {
  const nature = c.kind === 'act_of_nature';
  const n = Number(c.offense_no) || 1;
  const tone = nature ? 'border-sky-200 bg-sky-50 text-sky-800'
    : n >= MAX_OFFENSES ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-800';
  return <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tone}`}>{offenseLabel(c)}</span>;
}

/* What each offense round means, in one line. */
function roundRule(c) {
  const n = Number(c.offense_no) || 1;
  if (c.kind === 'offense') return `Your act-of-nature claim was not accepted, so this counts as Offense ${n} of ${MAX_OFFENSES} (manpower). Choose a finish date within ${offenseWindow(n)} days.`;
  if (n > MAX_OFFENSES) return 'Your 3 chances are used. Only an act of nature (with proof and a field check) can still be accepted; otherwise the DA terminates and reassigns the project.';
  if (n === MAX_OFFENSES) return `FINAL CHANCE. If the cause is manpower, this is Offense 3 of 3: finish within ${offenseWindow(n)} days, and a field engineer checks first. A 4th delay ends your contract on this project.`;
  return `If the cause is manpower, this is Offense ${n} of ${MAX_OFFENSES}: finish within ${offenseWindow(n)} days. An act of nature is not counted.`;
}

function ReplyCard({ c, project, note, today, client, draft, onDraft, onSent }) {
  const turn = CONTRACTOR_TURN[c.status];
  const n = Number(c.offense_no) || 1;
  const strict = c.kind !== 'act_of_nature' && n >= MAX_OFFENSES;
  const lockedManpower = c.kind === 'offense';
  const form = draft || {
    // A send-back starts from what was sent before.
    cause: lockedManpower ? 'manpower' : (c.cause === 'act_of_nature' || c.cause === 'manpower' ? c.cause : ''),
    explanation: c.explanation || '',
    newDate: c.proposed_date || '',
    eventName: c.event_name || '',
    stoppedDays: c.stopped_days ? String(c.stopped_days) : '',
    evidence: [],
  };
  const [touched, setTouched] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const nature = form.cause === 'act_of_nature';
  const win = form.cause ? commitWindow(c, form.cause, form.stoppedDays, today) : null;
  const problems = commitmentProblems(c, { ...form, hasProof: form.evidence.length > 0 }, today);
  const set = (key) => (e) => onDraft({ ...form, [key]: e.target.value });
  const causes = DELAY_CAUSES.filter((x) => (lockedManpower ? x.value === 'manpower' : n > MAX_OFFENSES ? x.value === 'act_of_nature' : true));

  const review = () => {
    setTouched(true);
    if (!problems.length) setReviewing(true);
  };

  const send = async () => {
    setSending(true);
    try {
      // Evidence first (it can only be added while it is the contractor's turn),
      // then the commitment the DA reviews with it.
      if (form.evidence.length) {
        let rows;
        try {
          rows = await uploadEvidence(client, { bucket: EVIDENCE_BUCKET, prefix: c.id, items: form.evidence });
        } catch (err) {
          throw new Error(`The evidence could not be uploaded (${err?.message || 'network error'}). Nothing was sent; please try again.`);
        }
        const { error: evErr } = await client.from('project_delay_evidence')
          .insert(rows.map((r) => ({ ...r, case_id: c.id, project_id: c.project_id })));
        if (evErr) throw evErr;
      }
      const { error } = await client.rpc('delay_submit_commitment', {
        p_case: c.id,
        p_cause: form.cause,
        p_explanation: form.explanation.trim(),
        p_new_date: form.newDate,
        p_event_name: nature ? form.eventName.trim() : null,
        p_stopped_days: nature ? Number(form.stoppedDays) : null,
      });
      if (error) throw error;
      notify('Your commitment was sent to the DA.', 'success');
      setReviewing(false);
      await onSent?.();
    } catch (err) {
      notify(friendlyDelayError(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const chars = form.explanation.trim().length;
  const inputCls = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-xs ${strict ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'}`}>
      <DetailHead
        c={c}
        project={project}
        today={today}
        right={(
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap gap-1.5"><OffenseChip c={c} /><DueChip c={c} today={today} /></div>
            <EvidenceActions
              items={form.evidence}
              onChange={(evidence) => onDraft({ ...form, evidence })}
              kind="delay_evidence"
              label={`Delay evidence · ${project?.project_name || 'project'}`}
            />
          </div>
        )}
      />

      <div className={`mt-4 rounded-xl p-4 text-sm ${strict ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
        <p className="flex items-center gap-1.5 font-semibold">
          {strict ? <TriangleAlertIcon className="size-4" aria-hidden="true" /> : <CalendarClockIcon className="size-4" aria-hidden="true" />}
          {turn.title}
        </p>
        <p className="mt-1">{roundRule(c)}</p>
        {c.status === 'revision_requested' && <p className="mt-1">The DA sent your commitment back. This is the only time.</p>}
        {note && <p className="mt-2 border-l-2 border-current/30 pl-2 italic">DA: “{note}”</p>}
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-700">Cause of the delay</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {causes.map((x) => {
            const on = form.cause === x.value;
            return (
              <label
                key={x.value}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition ${on ? 'border-teal-500 bg-teal-50/60 ring-2 ring-teal-500/20' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <input type="radio" name={`cause-${c.id}`} value={x.value} checked={on} onChange={set('cause')} className="mt-1 accent-teal-600" />
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    {x.label}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${x.offense ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
                      {x.offense ? `Offense ${Math.min(n, MAX_OFFENSES)} · up to ${offenseWindow(n)} days` : 'Not counted'}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">{x.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {nature && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem]">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Event</span>
            <input type="text" value={form.eventName} onChange={set('eventName')} placeholder='e.g. "Typhoon Kristine"' className={`${inputCls} h-11`} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Days work stopped</span>
            <input type="number" inputMode="numeric" min={1} max={NATURE_CAP_DAYS} value={form.stoppedDays} onChange={set('stoppedDays')} placeholder={`1–${NATURE_CAP_DAYS}`} className={`${inputCls} h-11`} />
          </label>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">New finish date</span>
          <input
            type="date"
            value={form.newDate}
            min={win ? toISODate(win.min) : undefined}
            max={win ? toISODate(win.max) : undefined}
            disabled={!win}
            onChange={set('newDate')}
            className={`${inputCls} h-11 disabled:bg-slate-50 disabled:text-slate-400`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            {win
              ? <>Allowed: <span className="font-semibold text-slate-700">{fmtDay(win.min)} – {fmtDay(win.max)}</span> ({win.days} days max). Later dates cannot be chosen.</>
              : form.cause ? 'Enter the days work stopped first.' : 'Choose the cause first.'}
          </span>
        </label>
        <label className="block text-sm sm:row-span-2">
          <span className="font-medium text-slate-700">What happened and your plan</span>
          <textarea value={form.explanation} onChange={set('explanation')} rows={4} placeholder={nature ? 'e.g. The typhoon flooded the site for 5 days; work restarts Monday.' : 'e.g. Short of 6 workers; a second crew starts Monday.'} className={`${inputCls} resize-y py-2.5`} />
          <span className={`mt-1 block text-right text-xs ${chars >= MIN_REASON ? 'text-emerald-700' : 'text-slate-400'}`}>{chars}/{MIN_REASON} characters minimum</span>
        </label>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-sm font-medium text-slate-700">
          {nature ? 'Proof' : 'Supporting evidence'}{' '}
          <span className="font-normal text-slate-400">
            {nature ? '(required · PAGASA/NDRRMC advisory, LGU notice or photos of the damage)' : '(optional · photos or PDFs, up to 8)'}
          </span>
        </p>
        <EvidenceGrid items={form.evidence} onChange={(evidence) => onDraft({ ...form, evidence })} />
      </div>

      {touched && problems.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {problems.map((p) => <li key={p}>• {p}</li>)}
        </ul>
      )}

      <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={review}
          className={`inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white shadow-sm ${strict ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
        >
          <SendIcon className="size-4" aria-hidden="true" />
          {turn.button}
        </button>
      </div>

      {reviewing && (
        <Modal
          onClose={() => !sending && setReviewing(false)}
          title="Send this commitment to the DA?"
          description={project?.project_name}
          size="md"
          footer={(
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setReviewing(false)} disabled={sending} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Go back and edit
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending}
                data-autofocus
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70 ${strict ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
              >
                <SendIcon className="size-4" aria-hidden="true" />
                {sending ? 'Sending…' : 'Yes, send it'}
              </button>
            </div>
          )}
        >
          <div className="space-y-4">
            <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 text-sm">
              {[
                ['Cause', nature ? `Act of nature · ${form.eventName.trim()}, ${form.stoppedDays} day(s) stopped` : `Manpower · Offense ${n} of ${MAX_OFFENSES}`],
                ['New finish date', fmtDay(form.newDate)],
                ['What happened', form.explanation.trim()],
                [nature ? 'Proof' : 'Evidence', evidenceSummary(form.evidence)],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="min-w-0 whitespace-pre-line break-words text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
            {form.evidence.length > 0 && <EvidenceGrid items={form.evidence} />}
            <p className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed ${strict ? 'bg-red-50 text-red-800' : 'bg-slate-50 text-slate-600'}`}>
              {nature
                ? 'A field engineer checks the damage on site before the DA approves. If the claim is not accepted, it counts as an offense.'
                : n >= MAX_OFFENSES
                  ? 'This is your final chance. A field engineer checks first. Once approved, the date is locked; missing it ends your contract on this project.'
                  : 'Once the DA approves it, the date is locked. Missing it becomes the next offense, with less time.'}
              {' '}You cannot change it after sending.
            </p>
          </div>
        </Modal>
      )}
    </article>
  );
}
