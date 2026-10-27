/* OverdueProjectsPanel.jsx — Project Management -> Overdue.
 * The admin side of the delay follow-up (supabase_project_delay_cases.sql): every
 * overdue On-Going project with a contractor has one case that ends in exactly one
 * outcome (extended / completed late / suspended / terminated). Every button calls a
 * database function that checks the rules again; this screen only shows what is allowed.
 * Rules mirrored in lib/delayCases.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, BellRingIcon, CalendarCheckIcon, CalendarClockIcon, ChevronDownIcon, ChevronUpIcon, CircleAlertIcon, RotateCwIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { Modal } from '../ui/Modal';
import EvidenceGallery from '../evidence/EvidenceGallery';
import {
  addDays, adminActions, CASE_STATES, caseBucket, caseDue, causeLabel, daysBetween, fmtDay, friendlyDelayError,
  HALTED_STATUS_STYLES, manilaToday, MAX_EXTENSIONS, MAX_REPLY_DAYS, MAX_SUSPENSION_EXTENSIONS,
  MIN_REASON, OUTCOMES, parseTargetDate, reasonOk, toISODate, DEFAULT_REPLY_DAYS,
} from '../../lib/delayCases';

const FILTERS = [
  { key: 'needs_you', label: 'Needs you' },
  { key: 'overdue_action', label: 'Action overdue' },
  { key: 'waiting', label: 'Waiting on others' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

const EVENT_LABELS = {
  case_opened: 'Follow-up opened',
  explanation_requested: 'Contractor asked to explain',
  explanation_submitted: 'Contractor explained',
  verification_requested: 'Field check requested',
  verification_submitted: 'Field check submitted',
  verification_timed_out: 'Field check not received in time',
  revision_requested: 'Revision asked',
  final_notice_issued: 'Final notice sent',
  final_notice_missed: 'Final notice not answered',
  no_response: 'No reply by the deadline',
  reminder: 'Reminder sent',
  closed: 'Closed',
  project_resumed: 'Project resumed',
  suspension_extended: 'Suspension extended',
  suspension_terminated: 'Terminated while suspended',
};

/* Which form each action opens, and which database function it calls. */
const ACTIONS = {
  ask: { title: 'Ask the contractor to explain', button: 'Send request', fields: ['replyBy', 'noteOptional'] },
  verify: { title: 'Ask a field engineer to check', button: 'Send to engineer', fields: ['verifier', 'noteOptional'] },
  revise: { title: 'Ask for a revised explanation', button: 'Ask for revision', fields: ['replyBy', 'note'], hint: 'Allowed once per follow-up.' },
  finalNotice: { title: 'Send a final notice', button: 'Send final notice', fields: ['replyBy', 'note'], hint: 'Allowed once. If it is not answered by the date, only Suspend or Terminate remain.', danger: true },
  extend: { title: 'Grant an extension', button: 'Grant extension', fields: ['newTarget', 'reason'], hint: `At most ${MAX_EXTENSIONS} extensions per project. Saves the new target date, records the extension and closes this follow-up.` },
  completedLate: { title: 'Close as completed late', button: 'Close as completed late', fields: ['reason'], hint: 'Marks the project Completed and records how many days late it finished.' },
  suspend: { title: 'Suspend the project', button: 'Suspend project', fields: ['resumeDate', 'reason'], hint: 'The deadline is put on hold. You will be reminded when the expected resume date passes.', danger: true },
  terminate: { title: 'Terminate the project', button: 'Terminate project', fields: ['reason'], hint: 'This cannot be undone from this screen.', danger: true },
  resume: { title: 'Resume the project', button: 'Resume project', fields: ['newTarget', 'reason'], hint: 'Back to On-Going with a new target date. Does not count toward the extension limit.' },
  extendSuspension: { title: 'Extend the suspension', button: 'Extend suspension', fields: ['resumeDate', 'reason'], hint: `At most ${MAX_SUSPENSION_EXTENSIONS} per project, counting every suspension it has had.` },
  terminateSuspended: { title: 'Terminate the suspended project', button: 'Terminate project', fields: ['reason'], hint: 'This cannot be undone from this screen.', danger: true },
};

/* "What happens next" for the actions that set a reply-by date. */
const REPLY_NEXT = {
  ask: (due) => `The contractor is notified right away and reminded on ${due}. If no explanation comes in by the end of that day, the follow-up is marked "No reply" and you decide within 5 days.`,
  revise: (due) => `The contractor sees your note and must send a revised explanation by ${due}. A revision can be asked only once per follow-up.`,
  finalNotice: (due) => `This is the last request. If it is not answered by the end of ${due}, only Suspend or Terminate remain.`,
};
const QUICK_REPLY_DAYS = [3, 7, 14, 30];
/* The reply-by rule (the database checks it again in _delay_check_reply_by):
 * from tomorrow up to MAX_REPLY_DAYS ahead, so yesterday or today can never be set. */
function replyByProblem(value, today) {
  const d = parseTargetDate(value);
  const tomorrow = addDays(today, 1);
  if (!d) return 'Choose the date the reply is due.';
  if (d < tomorrow) return `${d < today ? 'That date has already passed' : 'Today is too soon'}. The earliest reply date is tomorrow, ${fmtDay(tomorrow)}.`;
  if (d > addDays(today, MAX_REPLY_DAYS)) return `The reply date can be at most ${MAX_REPLY_DAYS} days from today (${fmtDay(addDays(today, MAX_REPLY_DAYS))}).`;
  return null;
}
const longDay = (d) => (d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—');

function Pill({ tone, children }) {
  return <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-semibold ${tone}`}>{children}</span>;
}

function Fact({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

/* `scopeIds` (a Set of project ids, or null for all) is the municipality/search
 * scope of the Project Management cards above, so the lists and counts here
 * match the Overdue card; `onShowAll` widens it. */
export default function OverdueProjectsPanel({ client, projects = [], contractors = [], fieldEngineers = [], showNotification, onOpenProject, onDataChanged, scopeIds = null, scopeLabel = '', onShowAll }) {
  const [cases, setCases] = useState([]);
  const [suspensions, setSuspensions] = useState([]);
  const [evidenceByCase, setEvidenceByCase] = useState({}); // case id -> evidence the contractor sent
  const [suspensionExtensions, setSuspensionExtensions] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('needs_you');
  const [openHistory, setOpenHistory] = useState(null);
  const [history, setHistory] = useState({});
  const [running, setRunning] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  // 'form' -> 'review' (the confirmation) -> sent
  const [step, setStep] = useState('form');
  const today = manilaToday();

  const notify = useCallback((msg, type) => showNotification?.(msg, type), [showNotification]);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const [casesRes, suspRes, extRes] = await Promise.all([
        client.from('project_delay_cases').select('*').order('opened_at', { ascending: false }),
        client.from('project_suspensions').select('id, project_id, suspension_start, suspension_end, expected_resume_date, reason').is('suspension_end', null),
        client.from('project_delay_case_events').select('case_id').eq('event_type', 'suspension_extended'),
      ]);
      if (casesRes.error) throw casesRes.error;
      setCases(casesRes.data || []);
      // Evidence is optional (supabase_delay_evidence_and_extensions.sql): skip quietly if not set up.
      const ev = await client.from('project_delay_evidence').select('*').order('created_at', { ascending: true });
      const byCase = {};
      (ev.error ? [] : ev.data || []).forEach((r) => { (byCase[r.case_id] = byCase[r.case_id] || []).push(r); });
      setEvidenceByCase(byCase);
      setSuspensions(suspRes.error ? [] : suspRes.data || []);
      // Suspension extensions per PROJECT, across all its suspensions (the limit
      // is per project: supabase_suspension_extension_limit.sql).
      const projectOfCase = new Map((casesRes.data || []).map((c) => [c.id, String(c.project_id)]));
      const counts = {};
      (extRes.data || []).forEach((e) => { const id = projectOfCase.get(e.case_id); if (id) counts[id] = (counts[id] || 0) + 1; });
      setSuspensionExtensions(counts);
      setLoadError('');
    } catch (err) {
      setLoadError(/project_delay_cases/.test(err?.message || '')
        ? 'The delay follow-up is not set up yet: run supabase_project_delay_cases.sql.'
        : 'Could not load the overdue follow-ups.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  // Live: contractor replies, field checks and the daily check appear without a reload.
  useEffect(() => {
    if (!client?.channel) return undefined;
    const channel = client
      .channel('admin-delay-cases')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_delay_cases' }, () => { load(); onDataChanged?.(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_delay_case_events' }, (payload) => {
        const caseId = payload.new?.case_id;
        if (caseId) setHistory((h) => (h[caseId] ? { ...h, [caseId]: [...h[caseId], payload.new] } : h));
        if (payload.new?.event_type === 'suspension_extended') load();
      })
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, load, onDataChanged]);

  const projectById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects]);
  const inScope = useCallback((projectId) => !scopeIds || scopeIds.has(String(projectId)), [scopeIds]);
  const scopedCases = useMemo(() => cases.filter((c) => inScope(c.project_id)), [cases, inScope]);
  const scopedProjects = useMemo(() => projects.filter((p) => inScope(p.id)), [projects, inScope]);
  // Open follow-ups and suspended projects the scope hides, for the "show all" note.
  const hiddenCount = useMemo(() => (scopeIds
    ? cases.filter((c) => c.status !== 'closed' && !inScope(c.project_id)).length
      + projects.filter((p) => String(p.status || '').trim().toLowerCase() === 'suspended' && !inScope(p.id)).length
    : 0), [cases, projects, inScope, scopeIds]);
  const nameOf = useCallback((list, id) => {
    const p = list.find((x) => x.id === id);
    return p ? (p.full_name || p.email || 'Unnamed') : null;
  }, []);

  const extensionsUsed = useCallback(
    (projectId) => cases.filter((c) => String(c.project_id) === String(projectId) && c.outcome === 'extended').length,
    [cases],
  );

  // Suspended projects: their latest suspended case + open suspension row.
  const suspendedRows = useMemo(() => scopedProjects
    .filter((p) => String(p.status || '').trim().toLowerCase() === 'suspended')
    .map((p) => {
      const susp = suspensions.find((s) => String(s.project_id) === String(p.id)) || null;
      const lastCase = cases.find((c) => String(c.project_id) === String(p.id) && c.outcome === 'suspended') || null;
      const resumeBy = parseTargetDate(susp?.expected_resume_date || lastCase?.resume_date);
      return { project: p, suspension: susp, lastCase, resumeBy, extensions: suspensionExtensions[String(p.id)] || 0 };
    }), [scopedProjects, suspensions, cases, suspensionExtensions]);

  // The same summary the daily check sends: overdue without contractor, unreadable and blank dates.
  const summary = useMemo(() => {
    const ongoing = scopedProjects.filter((p) => String(p.status || '').trim().toLowerCase().replace(/\s/g, '') === 'on-going');
    const unassigned = [];
    const unreadable = [];
    let blank = 0;
    ongoing.forEach((p) => {
      const raw = String(p.target_completion_date ?? '').trim();
      if (!raw) { blank += 1; return; }
      const t = parseTargetDate(raw);
      if (!t) { unreadable.push(p); return; }
      if (t < today && !p.contractor_id) unassigned.push({ p, daysLate: daysBetween(t, today) });
    });
    unassigned.sort((a, b) => b.daysLate - a.daysLate);
    return { unassigned, unreadable, blank };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedProjects, today.getTime()]);

  // A project can have several follow-ups over time (suspended, resumed, late
  // again). Each list shows ONE card per project, its latest follow-up there;
  // the earlier ones are listed on that card (earlierCases).
  const onePerProject = (list) => {
    const seen = new Set();
    return list.filter((c) => (seen.has(String(c.project_id)) ? false : seen.add(String(c.project_id))));
  };
  const earlierCases = useCallback(
    (c) => cases.filter((k) => String(k.project_id) === String(c.project_id) && k.id !== c.id && k.status === 'closed'),
    [cases],
  );
  const byFilter = useCallback((key) => {
    if (key === 'all') return onePerProject(scopedCases);
    if (key === 'suspended') return [];
    if (key === 'needs_you') return onePerProject(scopedCases.filter((c) => ['needs_you', 'overdue_action'].includes(caseBucket(c, today))));
    return onePerProject(scopedCases.filter((c) => caseBucket(c, today) === key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedCases, today.getTime()]);

  const counts = useMemo(() => {
    const c = { suspended: suspendedRows.length };
    FILTERS.forEach((f) => { if (f.key !== 'suspended') c[f.key] = byFilter(f.key).length; });
    return c;
  }, [byFilter, suspendedRows]);

  const shown = useMemo(() => byFilter(filter), [byFilter, filter]);

  const runCheck = async () => {
    setRunning(true);
    try {
      const { data, error } = await client.rpc('delay_run_check_now');
      if (error) throw error;
      const r = data || {};
      notify(`Check done: ${r.cases_opened || 0} follow-up(s) opened, ${r.moved || 0} moved on, ${r.reminders_sent || 0} reminder(s) sent${r.summary_sent ? ', summary sent' : ''}${r.failed ? `, ${r.failed} skipped (see logs)` : ''}.`, r.failed ? 'error' : 'success');
      await load();
      onDataChanged?.();
    } catch (err) {
      notify(`Check failed: ${friendlyDelayError(err)}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  const toggleHistory = async (caseId) => {
    if (openHistory === caseId) { setOpenHistory(null); return; }
    setOpenHistory(caseId);
    if (history[caseId]) return;
    const { data } = await client.from('project_delay_case_events').select('*').eq('case_id', caseId).order('created_at', { ascending: true });
    setHistory((h) => ({ ...h, [caseId]: data || [] }));
  };

  // ── action dialog ─────────────────────────────────────────────────────
  const openAction = (kind, { c = null, row = null } = {}) => {
    const project = projectById.get(String(c?.project_id ?? row?.project?.id)) || row?.project || null;
    const current = parseTargetDate(project?.target_completion_date);
    const floor = current && current > today ? current : today;
    const defaults = { replyBy: toISODate(addDays(today, DEFAULT_REPLY_DAYS)), note: '', reason: '', verifier: project?.site_engineer_id || '' };
    if (kind === 'extend') {
      const proposed = parseTargetDate(c?.proposed_date);
      defaults.newTarget = toISODate(proposed && proposed > floor ? proposed : addDays(floor, 30));
    }
    if (kind === 'suspend') defaults.resumeDate = toISODate(addDays(today, 30));
    if (kind === 'extendSuspension') defaults.resumeDate = toISODate(addDays(row?.resumeBy && row.resumeBy > today ? row.resumeBy : today, 30));
    if (kind === 'resume') {
      // Default: old target + the days the project was suspended.
      const start = parseTargetDate(row?.suspension?.suspension_start);
      const pushed = current && start ? addDays(current, Math.max(0, daysBetween(start, today))) : null;
      defaults.newTarget = toISODate(pushed && pushed > floor ? pushed : addDays(floor, 30));
    }
    setForm(defaults);
    setStep('form');
    setDialog({ kind, c, row, project });
  };

  const problems = useMemo(() => {
    if (!dialog) return [];
    const spec = ACTIONS[dialog.kind];
    const out = [];
    const current = parseTargetDate(dialog.project?.target_completion_date);
    if (spec.fields.includes('replyBy')) {
      const problem = replyByProblem(form.replyBy, today);
      if (problem) out.push(problem);
    }
    if (spec.fields.includes('note') && !reasonOk(form.note)) out.push(`Write a note of at least ${MIN_REASON} characters.`);
    if (spec.fields.includes('reason') && !reasonOk(form.reason)) out.push(`Write a reason of at least ${MIN_REASON} characters.`);
    if (spec.fields.includes('verifier') && !form.verifier) out.push('Choose a field engineer.');
    if (spec.fields.includes('newTarget')) {
      const d = parseTargetDate(form.newTarget);
      if (!d || d <= today || (current && d <= current)) out.push(`The new target date must be after today${current ? ` and after ${fmtDay(current)}` : ''}.`);
    }
    if (spec.fields.includes('resumeDate')) {
      const d = parseTargetDate(form.resumeDate);
      const prev = dialog.kind === 'extendSuspension' ? dialog.row?.resumeBy : null;
      if (!d || d <= today || (prev && d <= prev)) out.push(`The expected resume date must be after today${prev ? ` and after ${fmtDay(prev)}` : ''}.`);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, form, today.getTime()]);

  const submit = async () => {
    if (!dialog || problems.length) return;
    // The review step is the confirmation: nothing is sent from the form itself.
    if (step === 'form') { setStep('review'); return; }
    const { kind, c, project } = dialog;
    const spec = ACTIONS[kind];
    const note = form.note?.trim() || null;
    const reason = form.reason?.trim();
    const calls = {
      ask: ['delay_request_explanation', { p_case: c?.id, p_reply_by: form.replyBy, p_note: note }],
      verify: ['delay_request_verification', { p_case: c?.id, p_verifier: form.verifier, p_note: note }],
      revise: ['delay_request_revision', { p_case: c?.id, p_note: note, p_reply_by: form.replyBy }],
      finalNotice: ['delay_issue_final_notice', { p_case: c?.id, p_note: note, p_reply_by: form.replyBy }],
      extend: ['delay_grant_extension', { p_case: c?.id, p_new_target_date: form.newTarget, p_reason: reason }],
      completedLate: ['delay_close_completed_late', { p_case: c?.id, p_reason: reason }],
      suspend: ['delay_suspend', { p_case: c?.id, p_reason: reason, p_resume_date: form.resumeDate }],
      terminate: ['delay_terminate', { p_case: c?.id, p_reason: reason }],
      resume: ['delay_resume_project', { p_project: project?.id, p_new_target_date: form.newTarget, p_reason: reason }],
      extendSuspension: ['delay_end_suspension', { p_project: project?.id, p_action: 'extend', p_new_resume_date: form.resumeDate, p_reason: reason }],
      terminateSuspended: ['delay_end_suspension', { p_project: project?.id, p_action: 'terminate', p_new_resume_date: null, p_reason: reason }],
    };
    const [fn, args] = calls[kind];
    setSaving(true);
    try {
      const { error } = await client.rpc(fn, args);
      if (error) throw error;
      notify(`${spec.button}: done.`, 'success');
      setDialog(null);
      setHistory((h) => { const next = { ...h }; if (c?.id) delete next[c.id]; return next; });
      await load();
      onDataChanged?.();
    } catch (err) {
      notify(friendlyDelayError(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────
  const ActionButton = ({ kind, allowed, reason, c, row, tone = 'default' }) => {
    const styles = {
      default: 'border-slate-200 text-slate-700 hover:bg-slate-50',
      primary: 'border-teal-600 bg-teal-600 text-white hover:bg-teal-700',
      danger: 'border-red-200 text-red-700 hover:bg-red-50',
    };
    return (
      <button
        type="button"
        disabled={!allowed}
        title={!allowed ? reason || 'Not available in this step' : undefined}
        onClick={() => openAction(kind, { c, row })}
        className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles[tone]}`}
      >
        {ACTIONS[kind].button}
      </button>
    );
  };

  const renderCase = (c) => {
    const project = projectById.get(String(c.project_id));
    const state = CASE_STATES[c.status] || CASE_STATES.closed;
    const due = caseDue(c, today);
    const used = extensionsUsed(c.project_id);
    const a = adminActions(c, project, used);
    const contractor = nameOf(contractors, project?.contractor_id);
    const verifier = nameOf(fieldEngineers, c.verifier_id);
    const daysLate = daysBetween(parseTargetDate(c.target_date_at_open), c.status === 'closed' ? parseTargetDate(c.closed_at?.slice(0, 10)) || today : today);
    const events = history[c.id];
    const earlier = earlierCases(c);
    const anyAction = Object.entries(a).some(([k, v]) => k !== 'reasons' && v);
    return (
      <article key={c.id} className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <button type="button" onClick={() => project && onOpenProject?.(project)} className="text-left text-base font-semibold text-slate-900 hover:text-teal-700">
              {project?.project_name || `Project #${c.project_id}`}
            </button>
            <p className="mt-0.5 text-sm text-slate-500">
              Target {fmtDay(c.target_date_at_open)} · <span className="font-semibold text-red-700">{Math.max(0, daysLate)} day(s) late</span>
              {' · '}Contractor: {contractor || <span className="text-amber-700">none assigned</span>}
              {' · '}Extensions {used}/{MAX_EXTENSIONS}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.status === 'closed'
              ? <Pill tone={OUTCOMES[c.outcome]?.tone || state.tone}>{OUTCOMES[c.outcome]?.label || 'Closed'}</Pill>
              : <Pill tone={state.tone}>{state.label}</Pill>}
            {due && (
              <Pill tone={due.overdue ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-200'}>
                {due.label} {fmtDay(due.date)}
              </Pill>
            )}
            {c.final_notice_missed && <Pill tone="bg-red-50 text-red-700 border-red-200">Final notice missed</Pill>}
          </div>
        </div>

        {(c.cause || c.verdict || c.status === 'closed') && (
          <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
            {c.cause && (
              <Fact label="Contractor's explanation">
                <p><span className="font-semibold">{causeLabel(c.cause)}</span>{c.explanation ? `: ${c.explanation}` : ''}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Proposed new date {fmtDay(c.proposed_date)}
                  {project?.accomplishment != null ? ` (on record: ${Number(project.accomplishment)}%)` : ''}
                </p>
              </Fact>
            )}
            {c.verdict && (
              <Fact label={`Field check${verifier ? ` by ${verifier}` : ''}`}>
                <p><span className={`font-semibold ${c.verdict === 'agree' ? 'text-emerald-700' : 'text-red-700'}`}>{c.verdict === 'agree' ? 'Agrees' : 'Disagrees'}</span>{c.verification_note ? `: ${c.verification_note}` : ''}</p>
                {c.verification_photo_url && <a href={c.verification_photo_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-teal-700 hover:underline">View site photo</a>}
              </Fact>
            )}
            {c.status === 'awaiting_verification' && verifier && <Fact label="Field check">Waiting for {verifier}</Fact>}
            {c.status === 'closed' && (
              <Fact label="Outcome">
                <p>{OUTCOMES[c.outcome]?.label}{c.new_target_date ? ` to ${fmtDay(c.new_target_date)}` : ''}{c.resume_date ? ` (resume by ${fmtDay(c.resume_date)})` : ''}{c.days_late != null ? ` · ${c.days_late} day(s) late` : ''}</p>
                {c.outcome_reason && <p className="mt-1 text-xs text-slate-500">{c.outcome_reason}</p>}
              </Fact>
            )}
          </div>
        )}

        {evidenceByCase[c.id]?.length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <EvidenceGallery client={client} bucket="delay-evidence" items={evidenceByCase[c.id]} title="Contractor's supporting evidence" />
          </div>
        )}

        {c.status !== 'closed' && (
          <div className="mt-3 flex flex-wrap gap-2">
            {!anyAction && <p className="text-sm text-slate-500">Waiting for the {state.who === 'field_engineer' ? 'field engineer' : 'contractor'}. Nothing to do yet.</p>}
            {(a.ask || a.reasons.ask) && <ActionButton kind="ask" allowed={a.ask} reason={a.reasons.ask} c={c} tone="primary" />}
            {c.status === 'awaiting_decision' && (
              <>
                <ActionButton kind="extend" allowed={a.extend} reason={a.reasons.extend} c={c} tone="primary" />
                <ActionButton kind="verify" allowed={a.verify} c={c} />
                <ActionButton kind="revise" allowed={a.revise} reason={a.reasons.revise} c={c} />
              </>
            )}
            {['awaiting_decision', 'no_response'].includes(c.status) && <ActionButton kind="finalNotice" allowed={a.finalNotice} reason={a.reasons.finalNotice} c={c} />}
            {anyAction && <ActionButton kind="completedLate" allowed={a.completedLate} c={c} />}
            {anyAction && <ActionButton kind="suspend" allowed={a.suspend} c={c} tone="danger" />}
            {anyAction && <ActionButton kind="terminate" allowed={a.terminate} c={c} tone="danger" />}
          </div>
        )}

        {earlier.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Earlier follow-up{earlier.length === 1 ? '' : 's'}:</span>{' '}
            {earlier.map((k, i) => (
              <span key={k.id}>
                {i > 0 && '; '}
                {OUTCOMES[k.outcome]?.label || 'Closed'}{k.closed_at ? ` (${fmtDay(k.closed_at.slice(0, 10))})` : ''}
              </span>
            ))}
          </p>
        )}

        <button type="button" onClick={() => toggleHistory(c.id)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
          {openHistory === c.id ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />} History
        </button>
        {openHistory === c.id && (
          <ol className="mt-2 space-y-1.5 border-l-2 border-slate-100 pl-3">
            {!events && <li className="text-xs text-slate-400">Loading…</li>}
            {events?.map((e) => (
              <li key={e.id} className="text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{EVENT_LABELS[e.event_type] || e.event_type}</span>
                {' · '}{new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {' · '}{e.actor_role || 'system'}
                {(e.payload?.reason || e.payload?.note) && <span className="block text-slate-500">{e.payload.reason || e.payload.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </article>
    );
  };

  const renderSuspended = (row) => {
    const { project, resumeBy, extensions, suspension } = row;
    const passed = resumeBy && resumeBy < today;
    return (
      <article key={project.id} className="rounded-2xl border border-violet-200/70 bg-white p-4 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <button type="button" onClick={() => onOpenProject?.(project)} className="text-left text-base font-semibold text-slate-900 hover:text-teal-700">{project.project_name}</button>
            <p className="mt-0.5 text-sm text-slate-500">
              Suspended since {fmtDay(suspension?.suspension_start)} · Suspension extensions {extensions}/{MAX_SUSPENSION_EXTENSIONS}
            </p>
            {suspension?.reason && <p className="mt-1 text-xs text-slate-500">{suspension.reason}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill tone={HALTED_STATUS_STYLES.Suspended.border}>Suspended</Pill>
            {resumeBy && <Pill tone={passed ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-200'}>{passed ? 'Resume date passed' : 'Resume by'} {fmtDay(resumeBy)}</Pill>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton kind="resume" allowed={Boolean(suspension)} reason="No open suspension record" row={row} tone="primary" />
          <ActionButton kind="extendSuspension" allowed={Boolean(suspension && row.lastCase) && extensions < MAX_SUSPENSION_EXTENSIONS} reason={extensions >= MAX_SUSPENSION_EXTENSIONS ? `Already extended ${MAX_SUSPENSION_EXTENSIONS} times for this project. Resume or terminate it.` : 'Not suspended through the delay follow-up'} row={row} />
          <ActionButton kind="terminateSuspended" allowed={Boolean(suspension && row.lastCase)} reason="Not suspended through the delay follow-up" row={row} tone="danger" />
        </div>
      </article>
    );
  };

  const spec = dialog ? ACTIONS[dialog.kind] : null;
  // The reply date error shows under its field; the rest show in a list.
  const replyError = spec?.fields.includes('replyBy') ? replyByProblem(form.replyBy, today) : null;
  const otherProblems = problems.filter((p) => p !== replyError);
  const engineers = fieldEngineers.filter((f) => !f.role || String(f.role).toLowerCase().replace(/[\s-]+/g, '_') === 'field_engineer');

  return (
    <section className="space-y-4" aria-label="Overdue projects follow-up">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/60 bg-white p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter follow-ups">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const n = counts[f.key] ?? 0;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.key)}
                className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors ${active ? 'border-teal-600 bg-teal-600 text-white' : n === 0 ? 'border-slate-200 text-slate-400 hover:bg-slate-50' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                {f.label}
                <span className={`grid h-5 min-w-5 place-items-center rounded-md px-1.5 text-xs font-semibold ${active ? 'bg-white/20 text-white' : f.key === 'overdue_action' && n > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{n}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={running || !client}
          className="inline-flex h-9 items-center gap-2 self-start rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 lg:self-auto"
        >
          <RotateCwIcon className={`size-4 ${running ? 'animate-spin' : ''}`} aria-hidden="true" />
          {running ? 'Checking…' : 'Run check now'}
        </button>
      </div>

      {scopeIds && hiddenCount > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between" role="status">
          <p>
            Showing <span className="font-semibold">{scopeLabel || 'the current filter'}</span> only.{' '}
            {hiddenCount} more follow-up{hiddenCount === 1 ? '' : 's'} {hiddenCount === 1 ? 'is' : 'are'} outside this filter.
          </p>
          {onShowAll && (
            <button type="button" onClick={onShowAll} className="shrink-0 self-start rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 sm:self-auto">
              Show all municipalities
            </button>
          )}
        </div>
      )}

      {(summary.unassigned.length > 0 || summary.unreadable.length > 0 || summary.blank > 0) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold"><TriangleAlertIcon className="size-4" aria-hidden="true" /> Not followed up automatically</p>
          {summary.unassigned.length > 0 && (
            <p className="mt-1.5">
              {summary.unassigned.length} overdue On-Going project(s) have no contractor, so no follow-up was opened. Assign a contractor to start one:{' '}
              {summary.unassigned.map(({ p, daysLate }, i) => (
                <span key={p.id}>{i > 0 && '; '}<button type="button" onClick={() => onOpenProject?.(p)} className="font-medium underline-offset-2 hover:underline">{p.project_name}</button> ({daysLate} day(s) late)</span>
              ))}
            </p>
          )}
          {summary.unreadable.length > 0 && (
            <p className="mt-1.5">Target dates that could not be read: {summary.unreadable.map((p) => `${p.project_name} ("${p.target_completion_date}")`).join('; ')}.</p>
          )}
          {summary.blank > 0 && <p className="mt-1.5">{summary.blank} On-Going project(s) have no target date.</p>}
        </div>
      )}

      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
      {loading && <p className="text-sm text-slate-500">Loading follow-ups…</p>}

      {!loading && !loadError && (
        filter === 'suspended'
          ? (suspendedRows.length ? suspendedRows.map(renderSuspended) : <EmptyState text="No suspended projects." />)
          : (shown.length ? shown.map(renderCase) : <EmptyState text={filter === 'needs_you' ? 'Nothing needs your decision right now.' : 'No follow-ups here.'} />)
      )}

      {dialog && spec && (
        <Modal
          onClose={() => !saving && setDialog(null)}
          title={spec.title}
          description={dialog.project?.project_name}
          size="md"
          footer={(
            <div className="flex items-center justify-between gap-2">
              <p className="hidden text-xs text-slate-400 sm:block">Step {step === 'form' ? 1 : 2} of 2 · {step === 'form' ? 'Details' : 'Confirm'}</p>
              <div className="ml-auto flex gap-2">
                {step === 'form' ? (
                  <button type="button" onClick={() => setDialog(null)} disabled={saving} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                ) : (
                  <button type="button" onClick={() => setStep('form')} disabled={saving} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <ArrowLeftIcon className="size-4" aria-hidden="true" /> Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving || problems.length > 0}
                  className={`h-10 rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${spec.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
                >
                  {saving ? 'Sending…' : step === 'form' ? 'Review' : `Confirm & ${spec.button.charAt(0).toLowerCase()}${spec.button.slice(1)}`}
                </button>
              </div>
            </div>
          )}
        >
          {step === 'review' ? (
            <ReviewStep
              spec={spec}
              kind={dialog.kind}
              form={form}
              today={today}
              contractor={nameOf(contractors, dialog.project?.contractor_id)}
              engineer={nameOf(fieldEngineers, form.verifier)}
            />
          ) : (
          <div className="space-y-5">
            <CaseContext
              project={dialog.project}
              targetAtOpen={dialog.c?.target_date_at_open}
              contractor={nameOf(contractors, dialog.project?.contractor_id)}
              today={today}
            />
            {spec.hint && (
              <p className={`flex gap-2 rounded-xl border px-3 py-2.5 text-sm ${spec.danger ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{spec.hint}</span>
              </p>
            )}
            {spec.fields.includes('verifier') && (
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Field engineer</span>
                <select value={form.verifier} onChange={(e) => setForm((f) => ({ ...f, verifier: e.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3">
                  <option value="">Choose…</option>
                  {engineers.map((f) => (
                    <option key={f.id} value={f.id}>{f.full_name || f.email}{f.id === dialog.project?.site_engineer_id ? ' (site engineer)' : ''}</option>
                  ))}
                </select>
              </label>
            )}
            {spec.fields.includes('replyBy') && (
              <ReplyByField
                value={form.replyBy}
                today={today}
                error={replyError}
                next={REPLY_NEXT[dialog.kind]}
                onChange={(v) => setForm((f) => ({ ...f, replyBy: v }))}
              />
            )}
            {spec.fields.includes('newTarget') && (
              <DateField
                label={`New target date${dialog.project?.target_completion_date ? ` (now ${fmtDay(dialog.project.target_completion_date)})` : ''}`}
                value={form.newTarget}
                min={toISODate(addDays(today, 1))}
                onChange={(v) => setForm((f) => ({ ...f, newTarget: v }))}
              />
            )}
            {spec.fields.includes('resumeDate') && (
              <DateField label="Expected resume date" value={form.resumeDate} min={toISODate(addDays(today, 1))} onChange={(v) => setForm((f) => ({ ...f, resumeDate: v }))} />
            )}
            {(spec.fields.includes('note') || spec.fields.includes('noteOptional')) && (
              <TextField
                label={spec.fields.includes('note') ? 'Note to the contractor' : 'Note to the contractor (optional)'}
                placeholder={dialog.kind === 'verify' ? 'What should the engineer check on site?' : 'e.g. Please explain the delay and attach your revised schedule.'}
                value={form.note}
                required={spec.fields.includes('note')}
                onChange={(v) => setForm((f) => ({ ...f, note: v }))}
              />
            )}
            {spec.fields.includes('reason') && (
              <TextField label="Reason (saved in the history)" placeholder="Why are you taking this action?" value={form.reason} required onChange={(v) => setForm((f) => ({ ...f, reason: v }))} />
            )}
            {otherProblems.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {otherProblems.map((p) => <li key={p}>• {p}</li>)}
              </ul>
            )}
          </div>
          )}
        </Modal>
      )}
    </section>
  );
}

function EmptyState({ text }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
      <CalendarClockIcon className="size-6 text-slate-300" aria-hidden="true" />
      {text}
    </div>
  );
}

const FIELD_CLS = 'mt-1.5 w-full rounded-xl border bg-white px-3 text-sm text-slate-800 shadow-xs outline-none transition focus:ring-2';
const fieldTone = (error) => (error ? 'border-red-300 focus:border-red-400 focus:ring-red-500/20' : 'border-slate-200 focus:border-teal-500 focus:ring-teal-500/20');

/* The project the action is about, so the admin does not act on the wrong one. */
function CaseContext({ project, targetAtOpen, contractor, today }) {
  const target = parseTargetDate(targetAtOpen || project?.target_completion_date);
  const late = target ? Math.max(0, daysBetween(target, today)) : null;
  return (
    <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
      <Fact label="Contractor"><span className="font-medium">{contractor || '—'}</span></Fact>
      <Fact label="Target date">{fmtDay(target)}</Fact>
      <Fact label="Delay">{late == null ? '—' : <span className="font-semibold text-red-700">{late} day{late === 1 ? '' : 's'} late</span>}</Fact>
    </div>
  );
}

function ReplyByField({ value, today, error, next, onChange }) {
  const picked = parseTargetDate(value);
  const daysAway = picked ? daysBetween(today, picked) : null;
  const due = longDay(picked);
  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="reply-by" className="font-medium text-slate-700">Reply by</label>
        <span className="text-xs text-slate-400">Tomorrow up to {MAX_REPLY_DAYS} days</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick reply periods">
        {QUICK_REPLY_DAYS.filter((n) => n <= MAX_REPLY_DAYS).map((n) => {
          const iso = toISODate(addDays(today, n));
          const active = iso === value;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(iso)}
              aria-pressed={active}
              className={`h-8 rounded-lg border px-3 text-xs font-semibold transition ${active ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700'}`}
            >
              {n} days
            </button>
          );
        })}
      </div>
      <input
        id="reply-by"
        type="date"
        value={value || ''}
        min={toISODate(addDays(today, 1))}
        max={toISODate(addDays(today, MAX_REPLY_DAYS))}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby="reply-by-help"
        className={`${FIELD_CLS} h-11 ${fieldTone(error)}`}
      />
      <div id="reply-by-help" className="mt-2">
        {error ? (
          <p className="flex items-start gap-1.5 text-xs font-medium text-red-700">
            <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" /> {error}
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-teal-800">
            <CalendarCheckIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>Due <span className="font-semibold">{due}</span> · {daysAway} day{daysAway === 1 ? '' : 's'} to reply</span>
          </p>
        )}
      </div>
      {next && !error && (
        <div className="mt-3 flex gap-2.5 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2.5 text-xs leading-relaxed text-teal-900">
          <BellRingIcon className="mt-0.5 size-4 shrink-0 text-teal-600" aria-hidden="true" />
          <p><span className="font-semibold">What happens next. </span>{next(due)}</p>
        </div>
      )}
    </div>
  );
}

/* Step 2: everything that will be sent, read back before it is final. */
function ReviewStep({ spec, kind, form, today, contractor, engineer }) {
  const replyBy = parseTargetDate(form.replyBy);
  const rows = [
    spec.fields.includes('replyBy') && { label: 'Send to', value: contractor ? `${contractor} (contractor)` : 'The assigned contractor' },
    spec.fields.includes('verifier') && { label: 'Send to', value: engineer ? `${engineer} (field engineer)` : '—' },
    spec.fields.includes('replyBy') && { label: 'Reply by', value: <><span className="font-semibold">{longDay(replyBy)}</span><span className="text-slate-500"> · in {daysBetween(today, replyBy)} days</span></> },
    spec.fields.includes('newTarget') && { label: 'New target date', value: <span className="font-semibold">{longDay(parseTargetDate(form.newTarget))}</span> },
    spec.fields.includes('resumeDate') && { label: 'Expected resume', value: <span className="font-semibold">{longDay(parseTargetDate(form.resumeDate))}</span> },
    (spec.fields.includes('note') || spec.fields.includes('noteOptional')) && { label: 'Note', value: form.note?.trim() ? <span className="whitespace-pre-line">{form.note.trim()}</span> : <span className="italic text-slate-400">No note</span> },
    spec.fields.includes('reason') && { label: 'Reason', value: <span className="whitespace-pre-line">{form.reason?.trim()}</span> },
  ].filter(Boolean);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full ${spec.danger ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-700'}`}>
          {spec.danger ? <TriangleAlertIcon className="size-5" aria-hidden="true" /> : <ShieldCheckIcon className="size-5" aria-hidden="true" />}
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">Please confirm before sending</p>
          <p className="mt-0.5 text-sm text-slate-500">This is saved in the project&rsquo;s follow-up history and cannot be edited afterwards.</p>
        </div>
      </div>
      <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5 text-sm">
            <dt className="text-slate-500">{r.label}</dt>
            <dd className="min-w-0 break-words text-slate-800">{r.value}</dd>
          </div>
        ))}
      </dl>
      {REPLY_NEXT[kind] && replyBy && <p className="text-xs leading-relaxed text-slate-500">{REPLY_NEXT[kind](longDay(replyBy))}</p>}
      {spec.danger && spec.hint && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{spec.hint}</p>}
    </div>
  );
}

function DateField({ label, value, min, max, onChange }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input type="date" value={value || ''} min={min} max={max} onChange={(e) => onChange(e.target.value)} className={`${FIELD_CLS} h-11 ${fieldTone(false)}`} />
    </label>
  );
}

function TextField({ label, value, required, placeholder, onChange }) {
  const n = String(value || '').trim().length;
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder} className={`${FIELD_CLS} resize-y py-2.5 placeholder:text-slate-400 ${fieldTone(false)}`} />
      {required && <span className={`mt-1 block text-right text-xs ${n >= MIN_REASON ? 'text-emerald-700' : 'text-slate-400'}`}>{n}/{MIN_REASON} characters minimum</span>}
    </label>
  );
}
