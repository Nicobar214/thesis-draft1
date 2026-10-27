/* delayCases.js — the overdue-project delay follow-up (supabase_project_delay_cases.sql),
 * on the client. The database enforces every rule; this file only mirrors them so the
 * screens can show the right buttons, labels and messages before anything is sent.
 *
 * One case per overdue episode, ending in one outcome:
 *   extended (approved) / no_reply (offense) / completed_late / terminated (& reassigned).
 */

/* Status values written only by the delay follow-up. Projects with these statuses are
 * not "overdue": their deadline is on hold (Suspended) or no longer applies (Terminated). */
export const HALTED_STATUSES = ['Suspended', 'Terminated'];

export function isHaltedStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'suspended' || s === 'terminated';
}

/* Same colours everywhere a project status is shown. */
export const HALTED_STATUS_STYLES = {
  Suspended: { badge: 'bg-violet-100 text-violet-700', border: 'bg-violet-50 text-violet-700 border-violet-200', bar: 'bg-violet-500', dot: 'bg-violet-500', fill: '#8b5cf6', stroke: '#7c3aed' },
  Terminated: { badge: 'bg-slate-200 text-slate-700', border: 'bg-slate-100 text-slate-700 border-slate-300', bar: 'bg-slate-500', dot: 'bg-slate-500', fill: '#64748b', stroke: '#475569' },
};

/** 'Suspended' / 'Terminated' (any case or spacing), else null. */
export function haltedStatusLabel(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'suspended') return 'Suspended';
  if (s === 'terminated') return 'Terminated';
  return null;
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function makeDay(y, m, d) {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * The same target-date reader as the database (_delay_parse_date):
 * 'YYYY-MM-DD' or 'Month DD, YYYY' (full or short month, with or without a period:
 * 'Sep', 'Sept.', 'Aug.'), extra spaces allowed. Empty, unreadable or impossible -> null.
 */
export function parseTargetDate(value) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim().replace(/ ,/g, ',');
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return makeDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(v);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  return month ? makeDay(Number(m[3]), month, Number(m[2])) : null;
}

/** Today in Asia/Manila as a local midnight Date (the database's "today"). */
export function manilaToday(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(date) {
  if (!date) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const DAY = 86400000;
export function daysBetween(from, to) {
  return Math.round((to - from) / DAY);
}

export function fmtDay(value) {
  const d = value instanceof Date ? value : parseTargetDate(value);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

/* ── Overdue process v2 (supabase_overdue_v2.sql) ──────────────────────────────
 *
 *   DA asks -> contractor picks a cause + commits a new finish date
 *     Act of nature: proof + field check; days = days work stopped (max 30); NOT an offense.
 *     Manpower: an offense. 1: up to 60 days, 2: up to 45, 3 (final, field check): up to 30.
 *     Offense 4: Terminate & reassign. No reply by the reply-by date counts as an offense.
 */

/* Case states. `who` = whose move it is. */
export const CASE_STATES = {
  awaiting_request: { label: 'New: ask the contractor', who: 'admin', tone: 'bg-red-50 text-red-700 border-red-200' },
  awaiting_explanation: { label: 'Waiting for the commitment', who: 'contractor', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  revision_requested: { label: 'Sent back to the contractor', who: 'contractor', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  final_notice: { label: 'Final notice sent', who: 'contractor', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  no_response: { label: 'Offense 4: terminate & reassign', who: 'admin', tone: 'bg-red-50 text-red-700 border-red-200' },
  awaiting_verification: { label: 'Field check', who: 'field_engineer', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  awaiting_decision: { label: 'Ready to decide', who: 'admin', tone: 'bg-teal-50 text-teal-700 border-teal-200' },
  closed: { label: 'Closed', who: null, tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const OUTCOMES = {
  extended: { label: 'Approved', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  no_reply: { label: 'No reply: offense', tone: 'bg-red-50 text-red-700 border-red-200' },
  completed_late: { label: 'Completed late', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  suspended: { label: 'Suspended', tone: HALTED_STATUS_STYLES.Suspended.border },
  terminated: { label: 'Terminated & reassigned', tone: HALTED_STATUS_STYLES.Terminated.border },
};

/* The two causes. Old values stay readable for history. */
export const DELAY_CAUSES = [
  { value: 'act_of_nature', label: 'Act of nature', offense: false, hint: 'Typhoon, flood, earthquake, landslide or volcanic activity that stopped the work. Needs proof and a field check. Not counted as an offense.' },
  { value: 'manpower', label: 'Manpower', offense: true, hint: 'Lack of workers or slow work. Counts as an offense.' },
];
const OLD_CAUSES = { weather: 'Weather', right_of_way: 'Right-of-way', materials: 'Materials', fund_release: 'Fund release', design_change: 'Design change', other: 'Other' };
export const causeLabel = (value) => DELAY_CAUSES.find((c) => c.value === value)?.label || OLD_CAUSES[value] || value || '—';

/* The numbers (same as _delay_window / _delay_nature_cap). */
export const OFFENSE_WINDOWS = { 1: 60, 2: 45, 3: 30 };
export const MAX_OFFENSES = 3;
export const NATURE_CAP_DAYS = 30;
export const MIN_REASON = 10;
export const DEFAULT_REPLY_DAYS = 7;
export const MAX_REPLY_DAYS = 30;
export const REASSIGN_START_MAX_DAYS = 30;

export const reasonOk = (text) => String(text || '').trim().length >= MIN_REASON;

/** Days allowed for an offense (0 = no more chances). */
export const offenseWindow = (n) => OFFENSE_WINDOWS[Number(n) || 1] || 0;

/** "Offense 2 of 3", or "Act of nature" once the cause says so. */
export function offenseLabel(c) {
  if (c?.kind === 'act_of_nature') return 'Act of nature';
  const n = Number(c?.offense_no) || 1;
  return n > MAX_OFFENSES ? 'Offense 4: no chances left' : `Offense ${n} of ${MAX_OFFENSES}`;
}

/**
 * The dates a contractor may commit to (and the DA may approve), as
 * { min, max, days } (Dates), or null when no date can be accepted.
 * Act of nature: tomorrow .. today + days work stopped (max 30).
 * Manpower: tomorrow .. today + the offense's window.
 */
export function commitWindow(c, cause, stoppedDays, today = manilaToday()) {
  const days = cause === 'act_of_nature'
    ? Math.min(Math.max(0, Math.floor(Number(stoppedDays) || 0)), NATURE_CAP_DAYS)
    : offenseWindow(c?.offense_no);
  if (!days) return null;
  return { min: addDays(today, 1), max: addDays(today, days), days };
}

/** Act of nature and the final offense need the field engineer's check before approval. */
export const needsFieldCheck = (c) => c?.kind === 'act_of_nature' || Number(c?.offense_no) === MAX_OFFENSES;

/**
 * Which admin buttons are allowed now. Mirrors the database rules; the database
 * still checks everything. `project` is the fmr_projects row.
 */
export function adminActions(c, project) {
  const none = { ask: false, verify: false, approve: false, sendBack: false, rejectNature: false, completedLate: false, reassign: false };
  if (!c || c.status === 'closed') return { ...none, reasons: {} };
  const s = c.status;
  const n = Number(c.offense_no) || 1;
  const nature = c.kind === 'act_of_nature';
  const committed = s === 'awaiting_decision' && Boolean(c.proposed_date);
  const checked = c.verdict === 'agree';
  const hasContractor = Boolean(project?.contractor_id);
  const reasons = {};
  const a = {
    ask: s === 'awaiting_request' && hasContractor,
    verify: committed && (nature || n <= MAX_OFFENSES),
    approve: committed && (nature || n <= MAX_OFFENSES) && (!needsFieldCheck(c) || checked),
    sendBack: committed && !nature && n <= MAX_OFFENSES && Number(c.revision_count || 0) < 1,
    rejectNature: committed && nature,
    completedLate: ['awaiting_request', 'awaiting_decision', 'no_response'].includes(s),
    reassign: n > MAX_OFFENSES && (['awaiting_request', 'no_response'].includes(s) || (s === 'awaiting_decision' && !nature)),
  };
  if (s === 'awaiting_request' && !hasContractor) reasons.ask = 'Assign a contractor first';
  if (committed && needsFieldCheck(c) && !checked) {
    reasons.approve = c.verdict === 'disagree'
      ? 'The field engineer did not confirm it'
      : 'The field engineer must confirm this on site first';
  }
  if (committed && Number(c.revision_count || 0) >= 1) reasons.sendBack = 'Already sent back once';
  return { ...a, reasons };
}

/** The current due date of the case and whether it has passed ("Action overdue" / "Decision overdue"). */
export function caseDue(c, today = manilaToday()) {
  if (!c || c.status === 'closed') return null;
  const pick = {
    awaiting_request: ['request_due', 'Ask by', 'Action overdue'],
    awaiting_explanation: ['reply_by', 'Reply by', 'Reply overdue'],
    revision_requested: ['reply_by', 'Reply by', 'Reply overdue'],
    final_notice: ['reply_by', 'Reply by', 'Reply overdue'],
    awaiting_verification: ['verification_due', 'Check by', 'Check overdue'],
    awaiting_decision: ['decision_due', 'Decide by', 'Decision overdue'],
    no_response: ['decision_due', 'Decide by', 'Decision overdue'],
  }[c.status];
  if (!pick) return null;
  const date = parseTargetDate(c[pick[0]]);
  if (!date) return null;
  const overdue = date < today;
  return { date, label: overdue ? pick[2] : pick[1], overdue, daysLeft: daysBetween(today, date) };
}

/* Rough "who's waiting" bucket for the panel's filter chips. */
export function caseBucket(c, today = manilaToday()) {
  if (!c) return 'none';
  if (c.status === 'closed') return 'closed';
  const due = caseDue(c, today);
  if (CASE_STATES[c.status]?.who === 'admin') return due?.overdue ? 'overdue_action' : 'needs_you';
  return 'waiting';
}

/* ── Contractor side ─────────────────────────────────────────────────────── */

/* States where the contractor must commit. */
export const CONTRACTOR_TURN = {
  awaiting_explanation: { round: 'first', title: 'Commit a new finish date', button: 'Send commitment' },
  revision_requested: { round: 'revision', title: 'Commit again', button: 'Send new commitment' },
};

/* What the contractor sees while someone else has the case. */
export const CONTRACTOR_WAITING = {
  awaiting_request: 'Your project passed its target date. The DA will ask you to commit a new finish date.',
  awaiting_decision: 'Your commitment is with the DA for a decision.',
  awaiting_verification: 'A DA field engineer is checking your project on site.',
  no_response: 'Your 3 chances are used. The DA is deciding on termination and reassignment.',
};

/* The event whose note belongs to each contractor round (shown as the DA's message). */
export const REQUEST_EVENT = {
  awaiting_explanation: 'explanation_requested',
  revision_requested: 'revision_requested',
};

/**
 * Same checks as delay_submit_commitment, before anything is sent. Returns plain sentences.
 * `hasProof` = at least one evidence file is attached (act of nature).
 */
export function commitmentProblems(c, { cause, explanation, newDate, eventName, stoppedDays, hasProof }, today = manilaToday()) {
  const out = [];
  const n = Number(c?.offense_no) || 1;
  if (!DELAY_CAUSES.some((x) => x.value === cause)) out.push('Choose the cause: Act of nature or Manpower.');
  if (c?.kind === 'offense' && cause === 'act_of_nature') out.push('The act-of-nature claim was not accepted, so this delay counts as manpower.');
  if (cause === 'manpower' && n > MAX_OFFENSES) out.push('Your 3 chances are used. Only an act of nature can still be accepted.');
  if (!reasonOk(explanation)) out.push(`Explain what happened in at least ${MIN_REASON} characters.`);
  if (cause === 'act_of_nature') {
    if (String(eventName || '').trim().length < 3) out.push('Name the event, for example "Typhoon Kristine".');
    const s = Number(stoppedDays);
    if (!Number.isInteger(s) || s < 1 || s > NATURE_CAP_DAYS) out.push(`Days work stopped must be from 1 to ${NATURE_CAP_DAYS}.`);
    if (!hasProof) out.push('Attach proof: a PAGASA/NDRRMC advisory, an LGU notice or photos of the damage.');
  }
  const win = cause ? commitWindow(c, cause, stoppedDays, today) : null;
  const d = parseTargetDate(newDate);
  if (win && (!d || d < win.min || d > win.max)) {
    out.push(`The new finish date must be from ${fmtDay(win.min)} to ${fmtDay(win.max)} (${win.days} days max).`);
  }
  return out;
}

/* Database messages -> plain sentences for toasts. */
export function friendlyDelayError(error) {
  const msg = String(error?.message || error || '').trim();
  if (/open delay case/i.test(msg)) return 'This project has an open delay follow-up. Its target date changes only through Project Management > Overdue.';
  if (/been through a delay follow-up/i.test(msg) && /target date/i.test(msg)) return 'This project has been through a delay follow-up, so its target date cannot be set to a past date here. Use a future date, or Project Management > Overdue.';
  if (/Change its contractor with Terminate/i.test(msg)) return 'This project has been through a delay follow-up. Its contractor can only be changed with Terminate & reassign (Project Management > Overdue).';
  if (/Could not find the function public\.(delay_submit_commitment|delay_approve|delay_send_back|delay_reject_nature_claim|delay_terminate_and_reassign|project_contractor_history)/i.test(msg)) return 'The new overdue process is not set up yet: run supabase_overdue_v2.sql.';
  if (/permission denied|not allowed to|JWT/i.test(msg)) return 'You do not have permission to do this.';
  return msg || 'Something went wrong. Please try again.';
}
