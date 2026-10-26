/* What the DA does after the prioritization ranks a road (priority_decisions,
 * supabase_priority_decisions.sql). Kept deliberately short, with one end point
 * per group:
 *
 *   New road suggestion (a surveyed gap):
 *     ranked -> shortlisted -> for_validation -> endorsed -> converted (END:
 *     an FMR project was created; Work Plan -> Finalize -> Published follows)
 *   Ongoing project:
 *     ranked -> flagged -> action_recorded -> closed (END)
 *
 * Any open step can be deferred (with a reason) and resumed later.
 * "ranked" is the starting point and has no saved row. */

import { uploadGeotagPhotos } from './geotagPhoto';

export const DECISION_FLOW = {
  gap: ['ranked', 'shortlisted', 'for_validation', 'endorsed', 'converted'],
  project: ['ranked', 'flagged', 'action_recorded', 'closed'],
};

export const DECISION_LABELS = {
  ranked: 'Ranked',
  shortlisted: 'Shortlisted',
  for_validation: 'For site validation',
  endorsed: 'Endorsed for funding',
  converted: 'Converted to FMR project',
  flagged: 'Flagged for action',
  action_recorded: 'Action recorded',
  closed: 'Closed',
  deferred: 'Deferred',
};

/** Button text for moving INTO each status. */
export const STEP_ACTIONS = {
  shortlisted: 'Shortlist',
  for_validation: 'Send for site validation',
  endorsed: 'Endorse for funding',
  converted: 'Create FMR project',
  flagged: 'Flag for action',
  action_recorded: 'Record action',
  closed: 'Close',
};

/** What the DA can decide for an ongoing project at the "Record action" step. */
export const ONGOING_ACTIONS = ['Expedite contractor', 'Schedule site inspection', 'Prioritize fund release'];

/** Who has to reply to an ongoing-project action (supabase_priority_roles.sql). */
export const actionOwner = (action) => (action === 'Schedule site inspection' ? 'site_engineer' : 'contractor');

/** A gap is endorsed only after the field engineer confirmed it on site. */
export const canEndorse = (decision) => decision?.validation_result === 'confirmed';

export const isFinal = (kind, status) => {
  const flow = DECISION_FLOW[kind] || [];
  return status === flow[flow.length - 1];
};

/** The next status in the flow, or null at the end / when deferred. */
export function nextStatus(kind, status = 'ranked') {
  const flow = DECISION_FLOW[kind];
  if (!flow || status === 'deferred') return null;
  const i = flow.indexOf(status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}

/**
 * A project that finished (left On-Going) while its follow-up was still open
 * can be closed from where it stands: there is nothing left to act on.
 */
export const canCloseFinished = (kind, from) => kind === 'project' && (from === 'flagged' || from === 'action_recorded');

/** Open follow-ups whose project is no longer being built. */
export function finishedFollowUps(decisions, projects = [], isOngoing = () => true) {
  const byId = new Map((projects || []).map((p) => [String(p.id), p]));
  return [...(decisions?.values() || [])]
    .filter((d) => d.candidate_kind === 'project' && (d.status === 'flagged' || d.status === 'action_recorded'))
    .map((d) => ({ decision: d, project: byId.get(String(d.candidate_id)) || null }))
    .filter(({ project }) => project && !isOngoing(project));
}

/** Where a deferred candidate resumes. */
export const resumeStatus = (kind) => DECISION_FLOW[kind]?.[1] || null;

/** Is moving from `from` to `to` allowed? */
export function canMove(kind, from = 'ranked', to) {
  if (!DECISION_FLOW[kind]) return false;
  if (to === 'deferred') return from !== 'deferred' && !isFinal(kind, from);
  if (from === 'deferred') return to === resumeStatus(kind);
  return nextStatus(kind, from) === to;
}

const keyOf = (kind, id) => `${kind}:${id}`;

/** Every saved decision, keyed "gap:<id>" / "project:<id>". */
export async function loadDecisions(client) {
  const { data, error } = await client.from('priority_decisions').select('*');
  if (error) throw error;
  return new Map((data || []).map((row) => [keyOf(row.candidate_kind, row.candidate_id), row]));
}

export const decisionFor = (decisions, row) => decisions?.get(keyOf(row.kind, row.id)) || null;

/* Acting out of rank order. The top PRIORITY_TOP_TIER of a group can be taken
 * in any order; below that, starting on a candidate while a higher-ranked one
 * in the same group has not been acted on yet asks for a reason, which is
 * saved with the decision. */
export const PRIORITY_TOP_TIER = 3;

/**
 * Higher-ranked candidates of the same group still waiting (no decision yet),
 * when `entry` is below the top tier and is about to take its first step.
 * Returns [{ id, rank, title, score }], best rank first; empty means no warning.
 */
export function skippedAhead(entry, groupRows = [], decisions = null) {
  if (!entry || !(entry.rank > PRIORITY_TOP_TIER)) return [];
  const status = decisionFor(decisions, entry)?.status || 'ranked';
  if (status !== 'ranked') return [];
  return groupRows
    .filter((row) => row.kind === entry.kind && row.rank < entry.rank)
    .filter((row) => (decisionFor(decisions, row)?.status || 'ranked') === 'ranked')
    .sort((a, b) => a.rank - b.rank)
    .map((row) => ({ id: row.id, rank: row.rank, title: row.title, score: row.score }));
}

/**
 * Record one step. `snapshot` keeps the rank, score and the five criteria at
 * the time of the decision, so later re-scoring never rewrites history.
 */
export async function saveDecision(client, { kind, id, from = 'ranked', to, note = null, action = null, snapshot = null, fmrProjectId = null, assignedEngineerId = null, dueDate = null, replyDueDate = null, finishedClose = false }) {
  const allowed = canMove(kind, from, to) || (finishedClose && to === 'closed' && canCloseFinished(kind, from));
  if (!allowed) throw new Error(`Cannot move from ${DECISION_LABELS[from] || from} to ${DECISION_LABELS[to] || to}.`);
  if (to === 'action_recorded') {
    if (!replyDueDate) throw new Error('Set the date the reply is due.');
    if (replyDueDate < localDateISO()) throw new Error('The reply date cannot be in the past.');
  }
  if (kind === 'gap' && to === 'for_validation') {
    if (!assignedEngineerId) throw new Error('Choose the field engineer who will validate this road.');
    if (!dueDate) throw new Error('Set the date the field engineer should visit the road by.');
    if (dueDate < localDateISO()) throw new Error('The validation deadline cannot be in the past.');
  }
  const { data: auth } = await client.auth.getUser();
  const row = {
    candidate_kind: kind,
    candidate_id: String(id),
    status: to,
    note: note?.trim() || null,
    action,
    decided_by: auth?.user?.id || null,
    ...(snapshot ? { score_snapshot: snapshot } : {}),
    ...(fmrProjectId ? { fmr_project_id: fmrProjectId } : {}),
    ...(assignedEngineerId ? { assigned_engineer_id: assignedEngineerId } : {}),
    ...(dueDate ? { due_date: dueDate } : {}),
    ...(replyDueDate ? { reply_due_date: replyDueDate } : {}),
  };
  const { data, error } = await client
    .from('priority_decisions')
    .upsert(row, { onConflict: 'candidate_kind,candidate_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* Site-validation deadline. Dates are plain calendar days ('YYYY-MM-DD',
 * the due_date column), compared in local time so "today" is the user's day. */
export const DEFAULT_VALIDATION_DAYS = 7;
export const DEFAULT_REPLY_DAYS = 7;

export function localDateISO(date = new Date(), addDays = 0) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How the deadline reads on a card: { text, tone } with tone 'ok' | 'soon' | 'overdue', or null. */
export function deadlineStatus(dueDate, today = new Date()) {
  if (!dueDate) return null;
  const [y, m, d] = String(dueDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due - start) / 86400000);
  const date = due.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? '' : 's'} (was due ${date})`, tone: 'overdue', days };
  if (days === 0) return { text: `Due today (${date})`, tone: 'soon', days };
  if (days === 1) return { text: `Due tomorrow (${date})`, tone: 'soon', days };
  return { text: `Due in ${days} days (${date})`, tone: days <= 2 ? 'soon' : 'ok', days };
}

export const DEADLINE_TONES = {
  ok: 'bg-sky-50 text-sky-800 ring-sky-200',
  soon: 'bg-amber-50 text-amber-800 ring-amber-200',
  overdue: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/** The criteria and rank at the moment of a decision (for the audit trail). */
export function snapshotOf(row) {
  return {
    rank: row.rank,
    score: row.score,
    G: row.G, M: row.M, R: row.R, C: row.C, F: row.F,
    taken_at: new Date().toISOString(),
  };
}

/* Upload the KalsaTrack-camera photos, then call the RPC; if the RPC refuses
 * them (too far, weak GPS), the uploads are removed again. */
async function withPhotos(client, decisionId, photos, call) {
  const uploaded = photos?.length
    ? await uploadGeotagPhotos(client, { bucket: 'progress-photos', folder: 'priority', recordId: decisionId, photos })
    : [];
  const { error } = await call(uploaded);
  if (error) {
    if (uploaded.length) await client.storage.from('progress-photos').remove(uploaded.map((p) => p.path));
    throw error;
  }
}

/** Field engineer: answer a site validation ('confirmed' | 'not_confirmed') with 1-3 photos. */
export async function submitValidation(client, decisionId, result, note, photos = []) {
  await withPhotos(client, decisionId, photos, (p_photos) => client.rpc('submit_priority_validation', {
    p_decision_id: decisionId, p_result: result, p_note: note, p_photos,
  }));
}

/** Contractor or site engineer: reply to a recorded action (the site engineer's inspection needs photos). */
export async function respondToAction(client, decisionId, note, photos = []) {
  await withPhotos(client, decisionId, photos, (p_photos) => client.rpc('respond_priority_action', {
    p_decision_id: decisionId, p_note: note, p_photos,
  }));
}

/** Photos a role has to attach to its answer. */
export const MAX_PRIORITY_PHOTOS = 3;
export const needsPhotos = (taskKind, role) => taskKind === 'validation' || (taskKind === 'reply' && role === 'field_engineer');
