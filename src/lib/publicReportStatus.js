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

// ── Severity taxonomy ───────────────────────────────────────
// Shared by the submission form and the citizen report list so the two can
// never drift apart.
export const SEVERITY_TAXONOMY = {
  safety: {
    label: 'Safety Hazard',
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: '🔴',
    description: 'Risk to life or physical harm',
    problems: [
      { value: 'fallen_tree', label: 'Fallen tree blocking road' },
      { value: 'collapsed_road', label: 'Road collapse / sinkhole' },
      { value: 'missing_guardrail', label: 'Missing or broken guardrail' },
      { value: 'accident_site', label: 'Active accident site' },
      { value: 'sharp_debris', label: 'Sharp debris / broken glass on road' },
      { value: 'unsafe_bridge', label: 'Unsafe or damaged bridge' },
    ],
  },
  flood: {
    label: 'Flood / Drainage',
    color: 'bg-sky-100 text-sky-700 border-sky-200',
    icon: '🌊',
    description: 'Water-related road obstruction',
    problems: [
      { value: 'road_flooded', label: 'Road completely flooded' },
      { value: 'partial_flood', label: 'Partial flooding — passable with care' },
      { value: 'blocked_drainage', label: 'Blocked or clogged drainage' },
      { value: 'erosion', label: 'Soil erosion along road edge' },
      { value: 'landslide', label: 'Landslide / mudflow on road' },
    ],
  },
  issue: {
    label: 'Road Condition Issue',
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    icon: '🔧',
    description: 'Physical damage to road surface',
    problems: [
      { value: 'pothole', label: 'Potholes / lubak' },
      { value: 'crack', label: 'Surface cracks' },
      { value: 'missing_pavement', label: 'Missing pavement / unpaved section' },
      { value: 'broken_curb', label: 'Broken curb or road edge' },
      { value: 'uneven_surface', label: 'Severely uneven / bumpy surface' },
      { value: 'dust_gravel', label: 'Excessive dust / loose gravel' },
    ],
  },
  general: {
    label: 'General Concern',
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: '💬',
    description: 'Other observations or suggestions',
    problems: [
      { value: 'no_signage', label: 'Missing road signs' },
      { value: 'poor_lighting', label: 'No or poor streetlighting' },
      { value: 'vegetation', label: 'Overgrown vegetation blocking view' },
      { value: 'project_delay', label: 'Project seems delayed / stalled' },
      { value: 'quality_concern', label: 'Construction quality concern' },
      { value: 'other', label: 'Other concern' },
    ],
  },
};

/* Legacy rows predate severity_category, so fall back to keyword matching on
 * the description (English + Hiligaynon/Tagalog terms citizens actually use). */
export function classifyReport(desc = '') {
  const d = String(desc).toLowerCase();
  if (/safety|aksidente|peligro|danger|hazard/.test(d)) return 'safety';
  if (/flood|baha|tubig|drainage|water|inundated/.test(d)) return 'flood';
  if (/lubak|sira|pothole|road|daan|crack|damage|broken/.test(d)) return 'issue';
  return 'general';
}

export function resolveCategory(report) {
  return report?.severity_category || classifyReport(report?.description);
}

export function resolveSpecificProblem(report) {
  if (!report?.specific_problem || !report?.severity_category) return null;
  const cat = SEVERITY_TAXONOMY[report.severity_category];
  if (!cat) return null;
  return cat.problems.find((p) => p.value === report.specific_problem) || null;
}

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
  { value: 'under_verification', label: 'Under Verification' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

/* Ordered progress track shown to citizens. A closed report never reached
 * inspection (dismiss_public_report refuses once findings exist), so its track
 * is truncated rather than left showing three stages stuck on "Waiting". */
export const CITIZEN_TRACK = [
  { key: 'submitted', label: 'Submitted', blurb: 'We received your report.' },
  { key: 'under_review', label: 'Under Review', blurb: 'Staff are assessing the issue.' },
  { key: 'inspection_scheduled', label: 'Site Inspection', blurb: 'A field engineer visits the site.' },
  { key: 'under_verification', label: 'Verification', blurb: 'Findings are checked and confirmed.' },
  { key: 'resolved', label: 'Resolved', blurb: 'Outcome recorded and published.' },
];

/**
 * Build the citizen progress track.
 *
 * Timestamps come from public_reports_citizen_view, which exposes a
 * citizen-safe milestone for each stage (citizen_reviewed_at,
 * citizen_field_dispatched_at, citizen_inspection_started_at,
 * citizen_assessment_submitted_at). `finding` and `resolution` are fallbacks
 * for deployments whose view predates those columns, so the track degrades to
 * "Completed" without a date rather than breaking.
 */
export function buildCitizenTrack(report, { finding = null, resolution = null } = {}) {
  const current = getCitizenStatus(report);
  const needsReinspection =
    String(report?.citizen_workflow_stage || '').toLowerCase() === 'reinspection_needed';

  if (current.key === 'closed') {
    return {
      current,
      closed: true,
      needsReinspection: false,
      steps: [
        {
          key: 'submitted',
          label: 'Submitted',
          blurb: 'We received your report.',
          done: true,
          timestamp: report?.created_at || null,
          isLast: false,
        },
        {
          key: 'closed',
          label: 'Closed',
          blurb: 'Reviewed and closed without a site inspection.',
          done: true,
          timestamp: report?.dismissed_at || null,
          isLast: true,
        },
      ],
    };
  }

  const timestamps = {
    submitted: report?.created_at || null,
    under_review: report?.citizen_reviewed_at || null,
    inspection_scheduled:
      report?.citizen_inspection_started_at || report?.citizen_field_dispatched_at || null,
    under_verification:
      report?.citizen_assessment_submitted_at || finding?.submitted_at || null,
    resolved: resolution?.resolved_at || report?.resolved_at || null,
  };

  const steps = CITIZEN_TRACK.map((step, index) => {
    const stage = CITIZEN_STATUS[step.key];
    const done = stage.order <= current.order;
    return {
      ...step,
      done,
      active: stage.order === current.order,
      timestamp: done ? timestamps[step.key] : null,
      isLast: index === CITIZEN_TRACK.length - 1,
    };
  });

  return { current, closed: false, needsReinspection, steps };
}

// ── Error presentation ──────────────────────────────────────
/* Workflow RPCs raise plain-text exceptions intended for developers. Surface a
 * useful sentence to the user and keep the technical text for the console. */
const RPC_MESSAGE_PATTERNS = [
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
  const match = RPC_MESSAGE_PATTERNS.find(([pattern]) => pattern.test(raw));
  return match ? match[1] : fallback;
}
