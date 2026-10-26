/* delayCases.js — the overdue-project delay follow-up (supabase_project_delay_cases.sql),
 * on the client. The database enforces every rule; this file only mirrors them so the
 * screens can show the right buttons, labels and messages before anything is sent.
 *
 * One case per overdue episode, always ending in exactly one outcome:
 *   extended / completed_late / suspended / terminated.
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

/* The 8 states (Part B of the spec). `who` = whose move it is. */
export const CASE_STATES = {
  awaiting_request: { label: 'New: ask the contractor', who: 'admin', tone: 'bg-red-50 text-red-700 border-red-200' },
  awaiting_explanation: { label: 'Waiting for the contractor', who: 'contractor', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  revision_requested: { label: 'Revision asked', who: 'contractor', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  final_notice: { label: 'Final notice sent', who: 'contractor', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  no_response: { label: 'No reply: decide', who: 'admin', tone: 'bg-red-50 text-red-700 border-red-200' },
  awaiting_verification: { label: 'Field check', who: 'field_engineer', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  awaiting_decision: { label: 'Ready to decide', who: 'admin', tone: 'bg-teal-50 text-teal-700 border-teal-200' },
  closed: { label: 'Closed', who: null, tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const OUTCOMES = {
  extended: { label: 'Extended', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed_late: { label: 'Completed late', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  suspended: { label: 'Suspended', tone: HALTED_STATUS_STYLES.Suspended.border },
  terminated: { label: 'Terminated', tone: HALTED_STATUS_STYLES.Terminated.border },
};

export const DELAY_CAUSES = [
  { value: 'weather', label: 'Weather' },
  { value: 'right_of_way', label: 'Right-of-way' },
  { value: 'materials', label: 'Materials' },
  { value: 'fund_release', label: 'Fund release' },
  { value: 'design_change', label: 'Design change' },
  { value: 'other', label: 'Other' },
];

export const causeLabel = (value) => DELAY_CAUSES.find((c) => c.value === value)?.label || value || '—';

export const MAX_EXTENSIONS = 2;
export const MAX_SUSPENSION_EXTENSIONS = 2;
export const MIN_REASON = 10;
export const DEFAULT_REPLY_DAYS = 7;
export const MAX_REPLY_DAYS = 30;

export const reasonOk = (text) => String(text || '').trim().length >= MIN_REASON;

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

/**
 * Which admin buttons are allowed now. Mirrors the database rules exactly; the
 * database still checks everything. `project` is the fmr_projects row.
 */
export function adminActions(c, project, extensionsUsed = 0) {
  const none = { ask: false, verify: false, revise: false, finalNotice: false, extend: false, completedLate: false, suspend: false, terminate: false };
  if (!c || c.status === 'closed') return { ...none, reasons: {} };
  const s = c.status;
  const missed = Boolean(c.final_notice_missed);
  const hasContractor = Boolean(project?.contractor_id);
  const reasons = {};
  const a = {
    ask: s === 'awaiting_request' && hasContractor,
    verify: s === 'awaiting_decision' && !missed,
    revise: s === 'awaiting_decision' && !missed && Number(c.revision_count || 0) < 1,
    finalNotice: ['awaiting_decision', 'no_response'].includes(s) && !c.final_notice_issued && hasContractor,
    extend: s === 'awaiting_decision' && !missed && extensionsUsed < MAX_EXTENSIONS,
    completedLate: ['awaiting_request', 'awaiting_decision', 'no_response'].includes(s) && !missed,
    suspend: ['awaiting_request', 'awaiting_decision', 'no_response'].includes(s),
    terminate: ['awaiting_request', 'awaiting_decision', 'no_response'].includes(s),
  };
  if (s === 'awaiting_request' && !hasContractor) reasons.ask = 'Assign a contractor first';
  if (missed) reasons.extend = 'Final notice was not answered: only Suspend or Terminate';
  else if (s === 'awaiting_decision' && extensionsUsed >= MAX_EXTENSIONS) reasons.extend = `Already ${MAX_EXTENSIONS} extensions`;
  if (s === 'awaiting_decision' && Number(c.revision_count || 0) >= 1) reasons.revise = 'One revision per case';
  if (c.final_notice_issued) reasons.finalNotice = 'Final notice already sent';
  return { ...a, reasons };
}

/* Rough "who's waiting" bucket for the panel's filter chips. */
export function caseBucket(c, today = manilaToday()) {
  if (!c) return 'none';
  if (c.status === 'closed') return 'closed';
  const due = caseDue(c, today);
  if (CASE_STATES[c.status]?.who === 'admin') return due?.overdue ? 'overdue_action' : 'needs_you';
  return 'waiting';
}

/* Database messages -> plain sentences for toasts. */
export function friendlyDelayError(error) {
  const msg = String(error?.message || error || '').trim();
  if (/open delay case/i.test(msg)) return 'This project has an open delay follow-up. Change its target date with Grant extension in Project Management > Overdue.';
  if (/been through a delay follow-up/i.test(msg)) return 'This project has been through a delay follow-up, so its target date cannot be set to a past date here. Use a future date, or Project Management > Overdue.';
  if (/permission denied|not allowed to|JWT/i.test(msg)) return 'You do not have permission to do this.';
  return msg || 'Something went wrong. Please try again.';
}
