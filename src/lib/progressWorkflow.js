/* progressWorkflow.js — single source of truth for the progress-update
 * workflow as the UI should describe it.
 *
 *   contractor claim  ->  engineer certification  ->  admin approval  ->  official
 *
 * Two different values live on every progress update and they must never be
 * conflated in the UI:
 *
 *   reported_accomplishment   what the CONTRACTOR claims
 *   certified_accomplishment  what the ENGINEER measured on site
 *
 * Only a certified figure that an admin has approved becomes the project's
 * official accomplishment (see supabase_progress_workflow_integrity_migration.sql).
 *
 * Every label here answers one question for the reader: who has to act next?
 *
 * Pure module — no React, no side effects.
 */

export const WORKFLOW_STAGES = {
  PENDING_ENGINEER: 'pending_engineer',
  PENDING_ADMIN: 'pending_admin',
  DISPUTED: 'disputed',
  APPROVED: 'approved',
  RETURNED: 'returned',
  UNKNOWN: 'unknown',
};

const STAGE_META = {
  [WORKFLOW_STAGES.PENDING_ENGINEER]: {
    label: 'Pending Engineer Review',
    short: 'Awaiting engineer',
    actor: 'Supervising engineer',
    hint: 'Waiting for the supervising engineer to measure and certify this accomplishment on site.',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
  [WORKFLOW_STAGES.PENDING_ADMIN]: {
    label: 'Pending Admin Approval',
    short: 'Awaiting admin',
    actor: 'DA administrator',
    hint: 'Certified by the engineer. Waiting for the DA administrator to approve it as official.',
    tone: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-500',
  },
  [WORKFLOW_STAGES.DISPUTED]: {
    label: 'Disputed by Engineer',
    short: 'Disputed',
    actor: 'Contractor',
    hint: 'The engineer disputed this figure. Submit a corrected update — the disputed record is kept.',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
  },
  [WORKFLOW_STAGES.RETURNED]: {
    label: 'Returned by Admin',
    short: 'Returned',
    actor: 'Contractor',
    hint: 'The administrator returned this submission. You may submit a corrected update.',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
  },
  [WORKFLOW_STAGES.APPROVED]: {
    label: 'Approved',
    short: 'Approved',
    actor: null,
    hint: 'Approved by the DA administrator. This is now the official project accomplishment.',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  [WORKFLOW_STAGES.UNKNOWN]: {
    label: 'Unknown',
    short: 'Unknown',
    actor: null,
    hint: '',
    tone: 'bg-slate-50 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
};

/**
 * Work out which stage a progress update is at.
 * @param {{status?: string, certification_status?: string}} update
 */
export function getWorkflowStage(update) {
  if (!update) return WORKFLOW_STAGES.UNKNOWN;

  const status = String(update.status || '').toLowerCase();
  const cert = String(update.certification_status || '').toLowerCase();

  if (status === 'approved') return WORKFLOW_STAGES.APPROVED;

  if (status === 'rejected') {
    // A dispute closes the record too, so distinguish the two by who closed it.
    return cert === 'disputed' ? WORKFLOW_STAGES.DISPUTED : WORKFLOW_STAGES.RETURNED;
  }

  if (status === 'pending') {
    if (cert === 'disputed') return WORKFLOW_STAGES.DISPUTED;
    return cert === 'certified'
      ? WORKFLOW_STAGES.PENDING_ADMIN
      : WORKFLOW_STAGES.PENDING_ENGINEER;
  }

  return WORKFLOW_STAGES.UNKNOWN;
}

/** Display metadata (label, tone, who acts next) for an update. */
export function getWorkflowMeta(update) {
  return STAGE_META[getWorkflowStage(update)] || STAGE_META[WORKFLOW_STAGES.UNKNOWN];
}

/** True only when an admin is allowed to approve — mirrors the database gate. */
export function canAdminApprove(update) {
  return getWorkflowStage(update) === WORKFLOW_STAGES.PENDING_ADMIN;
}

/** Why the approve action is unavailable, for display next to a disabled button. */
export function approvalBlockedReason(update) {
  const stage = getWorkflowStage(update);
  if (stage === WORKFLOW_STAGES.PENDING_ADMIN) return null;
  if (stage === WORKFLOW_STAGES.PENDING_ENGINEER) {
    return 'Cannot approve yet — the supervising engineer has not certified this accomplishment.';
  }
  if (stage === WORKFLOW_STAGES.DISPUTED) {
    return 'Cannot approve — the supervising engineer disputed this accomplishment.';
  }
  if (stage === WORKFLOW_STAGES.APPROVED) return 'Already approved.';
  if (stage === WORKFLOW_STAGES.RETURNED) return 'This submission was already returned.';
  return 'This submission is not eligible for approval.';
}

/**
 * The figure that counts as official for an APPROVED update.
 *
 * Always the engineer-certified value. The reported fallback exists only for
 * rows approved before certification was introduced — without it those legacy
 * updates would read as having no accomplishment at all.
 */
export function officialAccomplishmentOf(update) {
  if (!update) return null;
  // Explicit null/''/undefined guard: Number(null) and Number('') are both 0,
  // so a bare Number() check would turn an uncertified row into a real 0%.
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const certified = num(update.certified_accomplishment);
  return certified !== null ? certified : num(update.reported_accomplishment);
}

/** True when the official figure came from the legacy fallback, not a real
 *  certification — callers should label it so nobody reads it as verified. */
export function isLegacyUncertified(update) {
  if (!update) return false;
  return (
    String(update.status || '').toLowerCase() === 'approved' &&
    update.certified_accomplishment === null
  );
}
