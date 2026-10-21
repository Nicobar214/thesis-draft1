/* publicReportStatus.js — presentation layer for Citizen Reporting.
 *
 * The database is the source of truth for workflow state. `public_reports`
 * carries two coupled columns (status + engineer_status) and the citizen-facing
 * view `public_reports_citizen_view` already collapses them into a single
 * human-readable `citizen_status`. This module translates those backend values
 * into labels, helper text and badge tones for the UI — it never decides
 * workflow, and it must stay in sync with the view rather than re-deriving it.
 *
 * Citizen-safe by construction: nothing here references admin-only columns
 * (assigned_engineer_*, reviewed_by, dismissed_by, rejection_reason).
 */

import { QUEUE_ACTIVE_RING, QUEUE_TONES } from './reviewQueueTones';

// Admin queue buckets declare a `tone`; the shared palette supplies the colors,
// so the cards, list badges and grid view can't drift from the other pages.
function withQueueTone(bucket) {
  const tone = QUEUE_TONES[bucket.tone] || QUEUE_TONES.waiting;
  return { ...bucket, bar: tone.bar, value: tone.value, activeRing: QUEUE_ACTIVE_RING };
}

// ── Issue types ─────────────────────────────────────────────
/* Shared by the submission form and every report list so they can never drift
 * apart. Each type names who fixes it once the DA has checked the report:
 * the project contractor for real road and structure work, the municipal LGU
 * for quick community jobs (clearing a fallen tree, putting up a sign).
 *
 * Problem values are unique across all types, so a problem alone identifies
 * its type. Values from the old taxonomy are reused where the meaning is the
 * same, which keeps stored reports valid. The SQL trigger in
 * supabase_report_handlers.sql repeats this mapping: keep the two in sync. */
export const SEVERITY_TAXONOMY = {
  road_damage: {
    label: 'Road Surface Damage',
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    description: 'Potholes, cracks and broken pavement',
    handler: 'contractor',
    problems: [
      { value: 'pothole', label: 'Potholes / lubak' },
      { value: 'crack', label: 'Surface cracks' },
      { value: 'uneven_surface', label: 'Sunken, rutted or uneven section' },
      { value: 'missing_pavement', label: 'Washed-out or missing pavement' },
      { value: 'broken_curb', label: 'Broken road edge or shoulder' },
    ],
  },
  structural: {
    label: 'Structural & Drainage Failure',
    color: 'bg-red-100 text-red-700 border-red-200',
    description: 'Collapse, bridges, culverts and canals',
    handler: 'contractor',
    problems: [
      { value: 'collapsed_road', label: 'Road collapse / sinkhole' },
      { value: 'unsafe_bridge', label: 'Damaged bridge, culvert or spillway' },
      { value: 'blocked_drainage', label: 'Broken or clogged road canal' },
      { value: 'erosion', label: 'Erosion eating into the road' },
      { value: 'missing_guardrail', label: 'Missing or broken guardrail' },
      { value: 'quality_concern', label: 'Poor construction or stalled work' },
    ],
  },
  obstruction: {
    label: 'Road Obstruction',
    color: 'bg-sky-100 text-sky-700 border-sky-200',
    description: 'Fallen trees, landslide soil, debris, flood water',
    handler: 'lgu',
    problems: [
      { value: 'fallen_tree', label: 'Fallen tree blocking road' },
      { value: 'landslide', label: 'Landslide soil or rocks on road' },
      { value: 'sharp_debris', label: 'Debris, garbage or sharp objects' },
      { value: 'vegetation', label: 'Overgrown grass or branches' },
      { value: 'road_flooded', label: 'Flood water over the road' },
    ],
  },
  roadside: {
    label: 'Road Safety & Signs',
    color: 'bg-violet-100 text-violet-700 border-violet-200',
    description: 'Signs, lights and things left on the road',
    handler: 'lgu',
    problems: [
      { value: 'no_signage', label: 'Missing or damaged road signs' },
      { value: 'poor_lighting', label: 'No or broken street lights' },
      { value: 'items_on_road', label: 'Vehicles or materials left on the road' },
      { value: 'accident_site', label: 'Accident site needing traffic control' },
      { value: 'other', label: 'Other minor concern' },
    ],
  },
};

/* Who fixes the problem after the DA check. */
export const HANDLER_LABELS = {
  lgu: 'Municipal LGU',
  contractor: 'Project contractor',
};

export const HANDLER_NOTES = {
  lgu: 'Your LGU acts on this after the DA checks it.',
  contractor: 'The project contractor repairs this after the DA checks it.',
};

export function handlerLabel(value) {
  return HANDLER_LABELS[String(value || '').toLowerCase()] || null;
}

// Old problem values that no longer appear in the form, with their new type.
const LEGACY_PROBLEMS = {
  dust_gravel: { type: 'road_damage', label: 'Excessive dust / loose gravel' },
  partial_flood: { type: 'obstruction', label: 'Partial flooding — passable with care' },
  project_delay: { type: 'structural', label: 'Project seems delayed / stalled' },
};

// Old type keys (rows saved before the types changed, without a problem).
const LEGACY_TYPES = { safety: 'obstruction', flood: 'obstruction', issue: 'road_damage', general: 'roadside' };

const TYPE_BY_PROBLEM = Object.fromEntries([
  ...Object.entries(SEVERITY_TAXONOMY).flatMap(([type, meta]) => meta.problems.map((p) => [p.value, type])),
  ...Object.entries(LEGACY_PROBLEMS).map(([value, meta]) => [value, meta.type]),
]);

/* Rows with no type at all: keyword match on the description (English +
 * Hiligaynon/Tagalog terms citizens actually use). */
export function classifyReport(desc = '') {
  const d = String(desc).toLowerCase();
  if (/kahoy|tree|landslide|debris|basura|garbage|baha|flood|tubig/.test(d)) return 'obstruction';
  if (/collapse|sinkhole|bridge|tulay|culvert|kanal|canal|drainage|erosion|guardrail/.test(d)) return 'structural';
  if (/lubak|pothole|crack|sira|damage|broken|pavement|daan|road/.test(d)) return 'road_damage';
  return 'roadside';
}

export function resolveCategory(report) {
  const saved = String(report?.severity_category || '').toLowerCase();
  if (SEVERITY_TAXONOMY[saved]) return saved;
  const byProblem = TYPE_BY_PROBLEM[String(report?.specific_problem || '').toLowerCase()];
  if (byProblem) return byProblem;
  return LEGACY_TYPES[saved] || classifyReport(report?.description);
}

export function resolveSpecificProblem(report) {
  const value = String(report?.specific_problem || '').toLowerCase();
  if (!value) return null;
  const type = TYPE_BY_PROBLEM[value];
  const found = SEVERITY_TAXONOMY[type]?.problems.find((p) => p.value === value);
  if (found) return found;
  return LEGACY_PROBLEMS[value] ? { value, label: LEGACY_PROBLEMS[value].label } : null;
}

/* Who handles a report: what the admin set on the row, else what its type says. */
export function handlerFor(report) {
  const saved = String(report?.handled_by || '').toLowerCase();
  if (HANDLER_LABELS[saved]) return saved;
  return SEVERITY_TAXONOMY[resolveCategory(report)].handler;
}

/* Hazard types a field engineer should visit first. */
export const URGENT_TYPES = ['structural', 'obstruction'];

/* Resolution outcomes. The server validates this exact set in
 * resolve_public_report; public_report_resolutions_citizen_view exposes
 * resolution_type to citizens, so these labels are citizen-facing. */
export const RESOLUTION_TYPE_LABELS = {
  repaired: 'Repaired',
  scheduled_for_repair: 'Scheduled for repair',
  referred_to_contractor: 'Referred to contractor',
  monitoring_required: 'Monitoring required',
  no_action_required: 'No action required',
  outside_project_scope: 'Outside project scope',
  duplicate_case: 'Duplicate case',
  other: 'Other',
};

export function resolutionTypeLabel(value) {
  return RESOLUTION_TYPE_LABELS[String(value || '').toLowerCase()] || null;
}

/* What each outcome means to the person who filed the report. Wording is kept
 * to what is true of the system today — it records the decision, not repair
 * progress — so it can stay accurate if repair tracking is added later.
 *
 * `followUp` marks outcomes where physical work is still expected after the
 * decision. Nothing reads it yet; it is the hook for repair tracking. */
export const RESOLUTION_TYPE_INFO = {
  repaired: {
    meaning: 'Staff recorded that the problem has been repaired.',
    followUp: false,
  },
  scheduled_for_repair: {
    meaning: 'Repair work has been scheduled by the responsible office.',
    followUp: true,
  },
  referred_to_contractor: {
    meaning: 'The issue was referred to the project contractor for correction.',
    followUp: true,
  },
  monitoring_required: {
    meaning: 'The condition will be monitored, and staff may revisit the site.',
    followUp: true,
  },
  no_action_required: {
    meaning: 'After inspection, staff found no action is needed. If the condition worsens, you can submit a new report.',
    followUp: false,
  },
  outside_project_scope: {
    meaning: 'This issue falls outside the scope of the project it was reported against.',
    followUp: false,
  },
  duplicate_case: {
    meaning: 'This matches another report that is already being handled.',
    followUp: false,
  },
  other: {
    meaning: null,
    followUp: false,
  },
};

export function resolutionTypeMeaning(value) {
  return RESOLUTION_TYPE_INFO[String(value || '').toLowerCase()]?.meaning || null;
}

// ── Repair tracking ─────────────────────────────────────────
/* Outcomes plan_public_report_repair accepts. 'repaired' is included: it is a
 * claim, so it still gets an independent verification. */
export const REPAIR_ELIGIBLE_TYPES = [
  'repaired',
  'scheduled_for_repair',
  'referred_to_contractor',
  'monitoring_required',
];

export function resolutionAllowsRepairFollowUp(value) {
  return REPAIR_ELIGIBLE_TYPES.includes(String(value || '').toLowerCase());
}

export const RESPONSIBLE_PARTY_LABELS = {
  da: 'DA Region VI',
  lgu: 'Local government (LGU)',
  contractor: 'Project contractor',
};

export function responsiblePartyLabel(value) {
  return RESPONSIBLE_PARTY_LABELS[String(value || '').toLowerCase()] || null;
}

/* `citizen` is the plain-language line shown to the person who filed the
 * report; `staff` is the neutral label for admin and engineer screens. */
export const REPAIR_STATUS = {
  planned: {
    staff: 'Scheduled',
    citizen: 'Follow-up work is scheduled.',
    tone: 'bg-sky-100 text-sky-800 border-sky-200',
  },
  completed: {
    staff: 'Awaiting verification',
    citizen: 'The work has been recorded as done. An engineer will confirm it on site.',
    tone: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  verified: {
    staff: 'Verified on site',
    citizen: 'An engineer visited the location and confirmed the work.',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  cancelled: {
    staff: 'Cancelled',
    citizen: 'The follow-up was cancelled.',
    tone: 'bg-slate-200 text-slate-700 border-slate-300',
  },
};

export function repairStatusInfo(status) {
  return REPAIR_STATUS[String(status || '').toLowerCase()] || null;
}

/* The citizen's line for the repair, naming who is doing it. */
export function repairCitizenLine(action) {
  const stage = workOrderStage(action);
  const who = String(action?.responsible_party || '').toLowerCase() === 'lgu' ? 'Your LGU' : 'The project contractor';
  switch (stage) {
    case 'assigned': return `${who} has been asked to fix this.`;
    case 'accepted': return `${who} accepted the job${action.work_date ? ` and plans to work on it on ${new Date(`${action.work_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.`;
    case 'in_progress': return `${who} is working on it.`;
    case 'done': return `${who} sent a photo of the finished work. The DA is checking it.`;
    case 'closed': return `${who} fixed it and the DA confirmed the after-photo.`;
    default: return repairStatusInfo(action?.status)?.citizen || null;
  }
}

/* Where the LGU's or contractor's job is: assigned -> accepted (work date) ->
 * in_progress -> done (after-photo sent) -> closed (accepted at resolution or
 * confirmed by an engineer). `returned` = the handler sent it back to the DA. */
export const WORK_STAGES = {
  assigned: { label: 'Assigned', staff: 'Waiting for them to accept' },
  accepted: { label: 'Accepted', staff: 'Accepted, work date set' },
  in_progress: { label: 'Work started', staff: 'Work in progress' },
  done: { label: 'After-photo sent', staff: 'Work done — review the after-photo' },
  closed: { label: 'Closed', staff: 'Accepted' },
  returned: { label: 'Returned', staff: 'Returned to the DA' },
  cancelled: { label: 'Cancelled', staff: 'Cancelled' },
};

export function workOrderStage(action) {
  if (!action) return null;
  const status = String(action.status || '').toLowerCase();
  if (status === 'cancelled') return action.returned_at ? 'returned' : 'cancelled';
  if (status === 'verified') return 'closed';
  if (status === 'completed') return 'done';
  if (action.started_at) return 'in_progress';
  if (action.accepted_at) return 'accepted';
  return 'assigned';
}

/* An open job (not cancelled or returned). */
export function activeWorkOrder(action) {
  return action && String(action.status || '').toLowerCase() !== 'cancelled' ? action : null;
}

export function isRepairOverdue(action, today = new Date()) {
  if (!action?.target_date || action.status !== 'planned') return false;
  const target = new Date(`${action.target_date}T23:59:59`);
  return !Number.isNaN(target.getTime()) && target < today;
}

/* Repair follow-up queue. These are not report statuses: a resolved report stays
 * in "Closed". They are extra views, keyed off the repair action, that surface
 * work an admin still has to chase. A planned repair counts as "due" once it is
 * overdue or within REPAIR_DUE_SOON_DAYS of its target date. */
export const REPAIR_DUE_SOON_DAYS = 7;

export const REPAIR_QUEUE_BUCKETS = [
  {
    key: 'repairs_due',
    label: 'Repairs Due',
    hint: 'LGU or contractor jobs that are overdue or due within a week',
    tone: 'problem',
  },
].map(withQueueTone);

export function getRepairQueueKey(action, today = new Date()) {
  if (!action) return null;
  if (action.status === 'planned' && action.target_date) {
    if (isRepairOverdue(action, today)) return 'repairs_due';
    const target = new Date(`${action.target_date}T23:59:59`);
    const horizon = new Date(today.getTime() + REPAIR_DUE_SOON_DAYS * 86400000);
    if (!Number.isNaN(target.getTime()) && target <= horizon) return 'repairs_due';
  }
  return null;
}

export function countRepairQueue(actionsByReport = {}, today = new Date()) {
  const counts = { repairs_due: 0 };
  Object.values(actionsByReport).forEach((a) => {
    const key = getRepairQueueKey(a, today);
    if (key) counts[key] += 1;
  });
  return counts;
}

/* The engineer's 1-5 site condition rating, exposed to citizens via
 * public_report_field_findings_citizen_view. */
export const SITE_RATING_LABELS = ['Defective', 'Substandard', 'Fair', 'Good', 'Excellent'];

export function siteRatingLabel(rating) {
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return SITE_RATING_LABELS[n - 1];
}

// ── Citizen status ──────────────────────────────────────────
/* These keys mirror the `citizen_status` CASE expression in
 * public_reports_citizen_view (supabase_public_report_workflow_rls_hardening.sql).
 * If that view changes, change this map — not the components. */
export const CITIZEN_STATUS = {
  submitted: {
    key: 'submitted',
    label: 'Submitted',
    helper: 'Your report has been received and is waiting for review.',
    tone: 'bg-amber-100 text-amber-800 border-amber-200',
    dotTone: 'bg-amber-500',
    order: 0,
  },
  under_review: {
    key: 'under_review',
    label: 'Under Review',
    helper: 'Staff are reviewing your report and deciding on next steps.',
    tone: 'bg-sky-100 text-sky-800 border-sky-200',
    dotTone: 'bg-sky-500',
    order: 1,
  },
  inspection_scheduled: {
    key: 'inspection_scheduled',
    label: 'Site Inspection Scheduled',
    helper: 'A field engineer has been assigned to inspect this location.',
    tone: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    dotTone: 'bg-indigo-500',
    order: 2,
  },
  under_verification: {
    key: 'under_verification',
    label: 'Under Verification',
    helper: 'The site inspection is complete and the findings are being verified.',
    tone: 'bg-violet-100 text-violet-800 border-violet-200',
    dotTone: 'bg-violet-500',
    order: 3,
  },
  repair_assigned: {
    key: 'repair_assigned',
    label: 'Assigned for Repair',
    helper: 'The DA sent your report to the LGU or contractor who will fix it.',
    tone: 'bg-orange-100 text-orange-800 border-orange-200',
    dotTone: 'bg-orange-500',
    order: 2,
  },
  repair_in_progress: {
    key: 'repair_in_progress',
    label: 'Repair in Progress',
    helper: 'Work on the problem has started.',
    tone: 'bg-orange-100 text-orange-800 border-orange-200',
    dotTone: 'bg-orange-500',
    order: 3,
  },
  resolved: {
    key: 'resolved',
    label: 'Resolved',
    helper: 'This report has been acted on and officially closed.',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dotTone: 'bg-emerald-600',
    order: 4,
  },
  closed: {
    key: 'closed',
    label: 'Closed',
    helper: 'This report was closed without a site inspection.',
    tone: 'bg-slate-200 text-slate-700 border-slate-300',
    dotTone: 'bg-slate-500',
    order: 4,
    terminal: true,
  },
};

/* The view hands us citizen_status as a display string. Match on it first, and
 * only fall back to raw `status` for rows read outside the view. */
const CITIZEN_STATUS_BY_VIEW_LABEL = {
  'submitted': CITIZEN_STATUS.submitted,
  'under review': CITIZEN_STATUS.under_review,
  'site inspection scheduled': CITIZEN_STATUS.inspection_scheduled,
  'under verification': CITIZEN_STATUS.under_verification,
  'assigned for repair': CITIZEN_STATUS.repair_assigned,
  'repair in progress': CITIZEN_STATUS.repair_in_progress,
  'resolved': CITIZEN_STATUS.resolved,
  'closed': CITIZEN_STATUS.closed,
};

const CITIZEN_STATUS_BY_RAW_STATUS = {
  pending: CITIZEN_STATUS.submitted,
  reviewed: CITIZEN_STATUS.under_review,
  resolved: CITIZEN_STATUS.resolved,
  dismissed: CITIZEN_STATUS.closed,
};

export function getCitizenStatus(report) {
  if (!report) return CITIZEN_STATUS.submitted;

  const fromView = CITIZEN_STATUS_BY_VIEW_LABEL[
    String(report.citizen_status || '').trim().toLowerCase()
  ];
  if (fromView) return fromView;

  return (
    CITIZEN_STATUS_BY_RAW_STATUS[String(report.status || '').trim().toLowerCase()]
    || CITIZEN_STATUS.submitted
  );
}

/* Filter buckets for the citizen's own list. Keyed on the derived status so a
 * dismissed report is reachable instead of masquerading as pending. */
export const CITIZEN_STATUS_FILTERS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'inspection_scheduled', label: 'Inspection Scheduled' },
  { value: 'repair_assigned', label: 'Assigned for Repair' },
  { value: 'repair_in_progress', label: 'Repair in Progress' },
  { value: 'under_verification', label: 'Under Verification' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

/* Progress track shown to citizens. It follows who fixes the report:
 *   LGU (minor):  Submitted -> Under Review -> Assigned to LGU -> Repair in
 *                 Progress -> Work Checked -> Resolved (no site inspection);
 *   contractor:   Submitted -> Under Review -> Site Inspection -> Findings
 *                 Verified -> Repair by Contractor -> Work Checked -> Resolved.
 * Each step lists the citizen_workflow_stage values (public_reports_citizen_view)
 * that place the report on it. A report resolved without any repair (e.g. "no
 * action required") skips the repair steps. A closed report never reached
 * inspection (dismiss_public_report refuses once findings exist), so its track
 * is just Submitted -> Closed. */
const TRACK_STEPS = {
  submitted: { label: 'Submitted', blurb: 'We received your report.', stages: ['submitted'] },
  under_review: { label: 'Under Review', blurb: 'The DA is checking the report.', stages: ['under_review'] },
  inspection: { label: 'Site Inspection', blurb: 'A DA field engineer visits the site.', stages: ['field_engineer_dispatched', 'inspection_in_progress', 'reinspection_needed'] },
  findings: { label: 'Findings Verified', blurb: 'The DA confirms what the engineer found.', stages: ['assessment_submitted', 'validated'] },
  repair_lgu: { label: 'Assigned to LGU', blurb: 'Your LGU accepts the job and sets a work date.', stages: ['repair_assigned'] },
  repair_lgu_work: { label: 'Repair in Progress', blurb: 'Your LGU is fixing the problem.', stages: ['repair_in_progress'] },
  repair_contractor: { label: 'Repair by Contractor', blurb: 'The project contractor repairs the road.', stages: ['repair_assigned', 'repair_in_progress'] },
  work_checked: { label: 'Work Checked', blurb: 'The DA checks the photo of the finished work.', stages: ['repair_done'] },
  resolved: { label: 'Resolved', blurb: 'Outcome recorded and published.', stages: ['resolved'] },
};

const LGU_TRACK = ['submitted', 'under_review', 'repair_lgu', 'repair_lgu_work', 'work_checked', 'resolved'];
const INSPECTION_TRACK = ['submitted', 'under_review', 'inspection', 'findings', 'repair_contractor', 'work_checked', 'resolved'];
const REPAIR_STEPS = ['repair_lgu', 'repair_lgu_work', 'repair_contractor', 'work_checked'];

// Older views have no citizen_workflow_stage: derive it from the status.
const STAGE_FROM_STATUS = {
  submitted: 'submitted',
  under_review: 'under_review',
  inspection_scheduled: 'field_engineer_dispatched',
  under_verification: 'assessment_submitted',
  repair_assigned: 'repair_assigned',
  repair_in_progress: 'repair_in_progress',
  resolved: 'resolved',
};

/* The default (inspection) track's labels, for callers that only need those. */
export const CITIZEN_TRACK = INSPECTION_TRACK.map((key) => ({ key, label: TRACK_STEPS[key].label, blurb: TRACK_STEPS[key].blurb }));

/**
 * Build the citizen progress track.
 *
 * Timestamps come from public_reports_citizen_view's citizen-safe milestone
 * columns. `finding` and `resolution` are fallbacks for deployments whose view
 * predates those columns, so the track degrades to "Completed" without a date
 * rather than breaking.
 */
export function buildCitizenTrack(report, { finding = null, resolution = null } = {}) {
  const current = getCitizenStatus(report);
  const stage = String(report?.citizen_workflow_stage || '').toLowerCase() || STAGE_FROM_STATUS[current.key] || 'submitted';
  const needsReinspection = stage === 'reinspection_needed';

  if (current.key === 'closed') {
    return {
      current,
      closed: true,
      needsReinspection: false,
      steps: [
        { key: 'submitted', label: 'Submitted', blurb: 'We received your report.', done: true, timestamp: report?.created_at || null, isLast: false },
        { key: 'closed', label: 'Closed', blurb: 'Reviewed and closed without a site inspection.', done: true, timestamp: report?.dismissed_at || null, isLast: true },
      ],
    };
  }

  const handler = String(report?.citizen_handled_by || report?.handled_by || '').toLowerCase() || handlerFor(report);
  // A minor LGU job skips the engineer unless the DA chose to send one.
  const inspected = Boolean(report?.citizen_field_dispatched_at || report?.citizen_assessment_submitted_at || finding);
  let keys = handler === 'lgu' && !inspected ? LGU_TRACK : INSPECTION_TRACK;
  const repaired = Boolean(report?.citizen_repair_started_at || report?.citizen_repair_done_at);
  if (stage === 'resolved' && !repaired) keys = keys.filter((k) => !REPAIR_STEPS.includes(k));

  const timestamps = {
    submitted: report?.created_at || null,
    under_review: report?.citizen_reviewed_at || null,
    inspection: report?.citizen_inspection_started_at || report?.citizen_field_dispatched_at || null,
    findings: report?.citizen_assessment_submitted_at || finding?.submitted_at || null,
    repair_lgu: null,
    repair_lgu_work: report?.citizen_repair_started_at || null,
    repair_contractor: report?.citizen_repair_started_at || null,
    work_checked: report?.citizen_repair_done_at || null,
    resolved: resolution?.resolved_at || report?.resolved_at || null,
  };

  const currentIndex = Math.max(0, keys.findIndex((k) => TRACK_STEPS[k].stages.includes(stage)));
  const steps = keys.map((key, index) => {
    const meta = TRACK_STEPS[key];
    const byLgu = key === 'repair_contractor' && handler === 'lgu';
    const done = index <= currentIndex;
    return {
      key,
      label: byLgu ? 'Repair by LGU' : meta.label,
      blurb: byLgu ? 'Your LGU fixes the problem.' : meta.blurb,
      done,
      active: index === currentIndex,
      timestamp: done ? timestamps[key] : null,
      isLast: index === keys.length - 1,
    };
  });

  return { current, closed: false, needsReinspection, steps };
}

// ── Admin workload buckets ──────────────────────────────────
/* `status` alone cannot answer "what needs me?" — a single 'reviewed' value
 * covers five different situations, from nobody-assigned-yet to
 * ready-to-resolve. These buckets split on (status, engineer_status) so the
 * admin list can group reports by WHO owes the next action.
 *
 * Derived from the same column pair the workflow RPCs guard on, so a bucket
 * can never disagree with the action panel inside the case file.
 *
 * `owner` says who is expected to act next, and drives the emphasis the UI
 * puts on the admin's own queue. */
/* Each bucket carries a design token set rather than a loose colour string.
 * Hue is assigned by meaning, not decoration:
 *
 *   amber  -> new and unexamined        (warm = needs attention)
 *   orange -> triaged but still stalled (warmer = ageing)
 *   blue   -> active work, elsewhere    (cool = informational, not yours)
 *   violet -> a decision is back with you, and must stand out from the
 *             "in motion" blues
 *   emerald-> positive terminal step    (go)
 *   slate  -> archived and inert
 *
 * Tailwind needs literal class names, so each token is written out in full
 * rather than composed at runtime. */
export const ADMIN_BUCKETS = [
  {
    // Also holds reports sent back to the admin (engineer removed, job
    // returned by the LGU/contractor): the next step is the same, send it out.
    key: 'needs_review',
    label: 'Needs Review',
    hint: 'Send minor issues to the LGU; send an engineer for major ones',
    owner: 'admin',
    tone: 'action',
  },
  {
    key: 'in_field',
    label: 'In the Field',
    hint: 'With the field engineer for inspection or a repair check',
    owner: 'engineer',
    tone: 'waiting',
  },
  {
    key: 'needs_validation',
    label: 'Needs Validation',
    hint: 'Inspection submitted and waiting on your review',
    owner: 'admin',
    tone: 'action',
  },
  {
    key: 'ready_to_resolve',
    label: 'Ready for Repair Order',
    hint: 'Findings validated: send it to the contractor, or resolve if no repair is needed',
    owner: 'admin',
    tone: 'action',
  },
  {
    key: 'with_handler',
    label: 'With LGU / Contractor',
    hint: 'They accept the job, fix it and send an after-photo',
    owner: 'handler',
    tone: 'waiting',
  },
  {
    key: 'work_done',
    label: 'Work Done — Review',
    hint: 'After-photo received: resolve the report or send it back',
    owner: 'admin',
    tone: 'action',
  },
  {
    key: 'closed',
    label: 'Closed',
    hint: 'Resolved, or closed without inspection',
    owner: null,
    tone: 'done',
  },
].map(withQueueTone);

export const ADMIN_BUCKET_BY_KEY = Object.fromEntries(ADMIN_BUCKETS.map((b) => [b.key, b]));

/* Buckets where the admin personally owes the next action. */
export const ADMIN_ACTION_BUCKETS = ADMIN_BUCKETS
  .filter((b) => b.owner === 'admin')
  .map((b) => b.key);

/* `action` is the report's work order (public_report_repair_actions), if any. */
export function getAdminBucket(report, action = null) {
  const status = String(report?.status || '').trim().toLowerCase();
  const engineerStatus = String(report?.engineer_status || '').trim().toLowerCase();

  if (status === 'resolved' || status === 'dismissed') return 'closed';
  if (status === 'pending') return 'needs_review';

  const work = activeWorkOrder(action);
  if (status === 'reviewed' && work) {
    const workStatus = String(work.status || '').toLowerCase();
    if (workStatus === 'planned') return 'with_handler';
    // Contractor work the admin asked the engineer to confirm on site.
    if (workStatus === 'completed' && work.engineer_check_requested_at) return 'in_field';
    return 'work_done';
  }

  if (status === 'reviewed') {
    if (engineerStatus === 'inspected') return 'needs_validation';
    if (engineerStatus === 'validated') return 'ready_to_resolve';
    // 'rejected' means the admin sent it back — the engineer owes the re-visit.
    if (['assigned', 'in_progress', 'rejected'].includes(engineerStatus)) return 'in_field';
    // Reviewed but not with anyone (engineer removed, job returned): back to the admin.
    return 'needs_review';
  }

  // Unknown/legacy status: surface it rather than hiding it from every bucket.
  return 'needs_review';
}

export function countAdminBuckets(reports = [], actionsByReport = {}) {
  const counts = Object.fromEntries(ADMIN_BUCKETS.map((b) => [b.key, 0]));
  reports.forEach((r) => {
    const key = getAdminBucket(r, actionsByReport[r.id]);
    counts[key] = (counts[key] || 0) + 1;
  });
  counts.all = reports.length;
  counts.actionNeeded = ADMIN_ACTION_BUCKETS.reduce((sum, k) => sum + (counts[k] || 0), 0);
  return counts;
}

// ── Error presentation ──────────────────────────────────────
/* Workflow RPCs raise plain-text exceptions intended for developers. Surface a
 * useful sentence to the user and keep the technical text for the console. */
const RPC_MESSAGE_PATTERNS = [
  // Repair tracking. A function value receives the regex match, so the message
  // can carry the distance the server measured.
  [/verification location is (\d+) m from the reported site/i, (m) => `Your location is ${m[1]} m from the reported site. Move within 500 m and try again.`],
  [/GPS accuracy is too low \((\d+) m/i, (m) => `Your GPS accuracy is only ±${m[1]} m. Move to open sky, check your location again and retake the photo.`],
  [/photo was taken more than 48 hours ago/i, 'This photo is more than 48 hours old. Retake it on site.'],
  [/photo was taken before the work was recorded/i, 'This photo was taken before the work was recorded as done. Retake it on site.'],
  [/photo capture time is in the future/i, 'Your device clock looks wrong. Fix the date and time, then retake the photo.'],
  [/time the photo was taken is required|accuracy reading is required/i, 'The photo is missing its location details. Retake it with the camera.'],
  // Reopening a resolved report.
  [/say what is still not fixed/i, 'Say what is still not fixed.'],
  [/only a resolved report can be reopened/i, 'Only a resolved report can be reopened.'],
  [/could not find the function public\.reopen_resolved_public_report/i, 'This needs a database update. Run supabase_report_reopen.sql.'],
  // LGU / contractor job steps.
  [/job was already accepted or is no longer open/i, 'This job was already accepted. Refresh the page.'],
  [/choose the date the work will be done/i, 'Choose the date the work will be done.'],
  [/work date cannot be in the past/i, 'The work date cannot be in the past.'],
  [/accept the job before starting work/i, 'Accept the job first.'],
  [/work on this job has already started/i, 'Work on this job has already started.'],
  [/start the work before sending the after-photo/i, 'Mark the work as started first.'],
  [/photo was taken before the work started/i, 'This photo was taken before the work started. Retake it on site.'],
  [/only a job that has not started can be returned/i, 'Work has already started, so this job can no longer be returned. Contact the DA.'],
  [/say why the job is being returned/i, 'Say why you are returning this job.'],
  [/only the assigned lgu or contractor can update this job/i, 'This job is assigned to someone else.'],
  [/contractor job needs a validated field inspection/i, 'Send a field engineer and validate the findings before sending this to the contractor.'],
  [/finish or remove the field inspection before sending/i, 'Finish or remove the field inspection before sending this to the LGU.'],
  [/job is already open for this report/i, 'A job is already open for this report.'],
  [/lgu or contractor has not sent the after-photo yet/i, 'The LGU or contractor has not sent the after-photo yet.'],
  [/handler cannot change while a job is open/i, 'Cancel the open job before changing who fixes this report.'],
  [/only finished contractor work can be checked/i, 'Only finished contractor work can be checked by an engineer.'],
  [/report has no assigned field engineer/i, 'This report has no assigned field engineer to send.'],
  [/report is already closed/i, 'This report is already closed.'],
  [/could not find the function public\.((assign|accept|start|return)_public_report_work|request_public_report_work_check)/i, 'This needs a database update. Ask the admin to run supabase_report_handlers.sql.'],
  // Handler (LGU / contractor) follow-up.
  [/only a planned repair can be sent as done/i, 'This job was already sent or is no longer open. Refresh the page.'],
  [/only work sent by the lgu or contractor can be reopened/i, 'Only work sent by the LGU or contractor can be reopened.'],
  [/reason for reopening is required/i, 'Say why the job is being sent back.'],
  [/could not find the function public\.(submit_public_report_repair_work|reopen_public_report_repair|set_public_report_handler)/i, 'This needs a database update. Ask the admin to run supabase_report_handlers.sql.'],
  [/repair can only be planned for a resolved report/i, 'Resolve the report first, then plan the repair.'],
  [/resolution record is required before planning/i, 'This report has no resolution record, so a repair cannot be planned for it.'],
  [/repair action does not exist/i, 'This follow-up could not be found. Refresh the page and try again.'],
  [/only a field engineer or admin can verify/i, 'You do not have permission to verify repairs.'],
  [/follow-up already exists/i, 'A follow-up has already been planned for this report.'],
  [/does not call for follow-up work/i, 'This outcome does not need a follow-up.'],
  [/must be assigned to the contractor/i, 'A report referred to a contractor has to be assigned to the contractor.'],
  [/target date is required/i, 'Choose a target date.'],
  [/target date cannot be in the past/i, 'The target date cannot be in the past.'],
  [/only a planned repair can be marked completed/i, 'This repair is not in a state where it can be marked completed.'],
  [/note describing the work/i, 'Describe the work that was done.'],
  [/cannot also verify/i, 'Someone other than the person who recorded the work has to verify it.'],
  [/only the engineer assigned to this report can verify/i, 'Only the engineer assigned to this report can verify its repair.'],
  [/only a completed repair can be verified/i, 'This repair is not ready to be verified yet.'],
  [/after-photo is required/i, 'Take an after-photo first.'],
  [/gps coordinates are required/i, 'Your location could not be read. Turn on location and try again.'],
  [/cancellation reason is required/i, 'Give a reason for cancelling.'],
  [/only a planned or completed repair can be cancelled/i, 'This follow-up can no longer be cancelled.'],
  [/not pending or already has an active engineer workflow/i, 'This report has already been reviewed.'],
  [/not in a reviewable assignment state/i, 'This report must be reviewed before an engineer can be assigned.'],
  [/not in an assignable unassignment state/i, 'There is no engineer assignment to remove right now.'],
  [/not ready for field inspection/i, 'This report is not ready for a site inspection yet.'],
  [/an active inspection already exists/i, 'An inspection is already in progress for this report.'],
  [/not in inspection progress state/i, 'Start the on-site inspection before submitting findings.'],
  [/no active inspection exists/i, 'Start the on-site inspection before submitting findings.'],
  [/only the assigned field engineer/i, 'Only the engineer assigned to this report can do that.'],
  [/does not have submitted inspection awaiting/i, 'There is no submitted inspection to act on right now.'],
  [/only the latest .* inspection can be/i, 'Only the most recent inspection can be acted on.'],
  [/cannot validate their own inspection/i, 'An inspection must be validated by someone other than the engineer who submitted it.'],
  [/cannot be dismissed/i, 'This report can no longer be closed because its inspection has already started.'],
  [/cannot be resolved before inspection validation/i, 'Validate the inspection findings before resolving this report.'],
  [/admin role required/i, 'You do not have permission to perform this action.'],
  [/field engineer role required/i, 'You do not have permission to perform this action.'],
  [/authentication required/i, 'Your session has expired. Please sign in again.'],
  [/report does not exist/i, 'This report could not be found. It may have been removed.'],
  [/failed to fetch|networkerror/i, 'Could not reach the server. Check your connection and try again.'],
];

export function friendlyReportError(error, fallback = 'Something went wrong. Please try again.') {
  const raw = typeof error === 'string' ? error : error?.message || '';
  if (!raw) return fallback;
  for (const [pattern, message] of RPC_MESSAGE_PATTERNS) {
    const m = raw.match(pattern);
    if (m) return typeof message === 'function' ? message(m) : message;
  }
  return fallback;
}
