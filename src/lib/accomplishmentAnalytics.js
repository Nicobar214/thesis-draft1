/* accomplishmentAnalytics.js — physical vs financial accomplishment, S-curve.
 *
 * Implements DA Region VI's stated monitoring process (WVSU-CICT Questionnaire):
 *
 *   "DA compares the verified physical accomplishment (%) with the financial
 *    disbursement/payment (%) through progress reports, billing documents,
 *    S-curves, and site validation. Any significant variance is subject to
 *    review."
 *
 * IMPORTANT — why the financial curve reads project_tranches and NOT
 * fmr_projects.accomplishment:
 *
 * Tranche release is gated on physical progress (release_project_tranche
 * refuses unless accomplishment >= required_progress), and budgetEstimate.js
 * derives `released` from accomplishment. So if the financial curve were
 * computed from accomplishment it would be the *same number* as the physical
 * curve and the variance would always be exactly zero -- structurally
 * unrepresentable. The independent signal is the admin-entered
 * released_amount / released_date on project_tranches: an admin controls when
 * money actually moves and how much, so it can legitimately lag or lead the
 * physical work. That is the variance DA asks about.
 *
 * Every function is pure and side-effect free.
 */
import { officialAccomplishmentOf } from './progressWorkflow.js';

/* Percentage-point gap between physical and financial accomplishment beyond
 * which DA treats the variance as significant enough to review. */
export const VARIANCE_REVIEW_THRESHOLD = 10;

/* Gap beyond which it stops being a watch item and becomes a finding. */
export const VARIANCE_CRITICAL_THRESHOLD = 20;

/* ── date helpers ───────────────────────────────────────────────────────── */

/* Parse a DATE / ISO string without the UTC shift that `new Date('2026-01-31')`
 * introduces (it parses as midnight UTC, which is the previous day in PH). */
export function parseDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (date) => date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

/* Note the explicit null/undefined/'' guard: Number(null) and Number('') are
 * both 0, so without it a NULL column (an uncertified figure, an unset
 * contract amount) would silently read as a real zero. */
const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const clampPct = (value) => Math.max(0, Math.min(100, value));

/* Inclusive list of month buckets spanning two dates. Capped so a project with
 * a stray far-future date cannot generate thousands of points. */
export function buildMonthAxis(from, to, maxMonths = 120) {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end || end < start) return [];
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end && months.length < maxMonths) {
    months.push({ key: monthKey(cursor), label: monthLabel(cursor), end: endOfMonth(cursor) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/* ── planned curve ──────────────────────────────────────────────────────── */

/* Cumulative planned physical % at a given instant.
 *
 * Each task contributes planned_weight_pct, earned linearly across its
 * planned_start..planned_end window (the standard straight-line assumption for
 * a task with no internal cost loading). Tasks without a weight contribute
 * nothing -- a project whose tasks are unweighted simply has no planned curve,
 * and the UI says so rather than inventing one.
 */
export function plannedPctAt(tasks, instant) {
  const at = parseDateOnly(instant);
  if (!at || !Array.isArray(tasks)) return null;

  let anyWeight = false;
  let earned = 0;

  for (const task of tasks) {
    const weight = toFiniteNumber(task?.planned_weight_pct);
    if (weight === null || weight <= 0) continue;
    anyWeight = true;

    const start = parseDateOnly(task.planned_start);
    const end = parseDateOnly(task.planned_end);
    if (!start) continue;

    if (at < start) continue;
    if (!end || end <= start) {
      // Zero-length or missing end: treat as earned in full once started.
      earned += weight;
      continue;
    }
    if (at >= end) {
      earned += weight;
      continue;
    }
    const fraction = (at - start) / (end - start);
    earned += weight * fraction;
  }

  if (!anyWeight) return null;
  return clampPct(earned);
}

/* ── actual physical curve ──────────────────────────────────────────────── */

/* The OFFICIAL physical curve.
 *
 * Accomplishment is cumulative, so the value at a point in time is the latest
 * qualifying update on or before it -- a step function carried forward.
 *
 * Two rules make this the authoritative series rather than a contractor claim:
 *
 *   1. Only APPROVED updates count. A pending, disputed or returned submission
 *      never moves the official curve.
 *   2. The value taken is the ENGINEER-CERTIFIED one, via
 *      officialAccomplishmentOf() -- the same helper the rest of the UI uses,
 *      so the S-curve can never disagree with the project page.
 *
 * Pass source: 'reported' to plot the contractor's claims instead. That series
 * is for comparison only and must never be presented as official progress.
 */
export function physicalPctAt(progressUpdates, instant, { source = 'official' } = {}) {
  const at = parseDateOnly(instant);
  if (!at || !Array.isArray(progressUpdates)) return null;

  const wantReported = source === 'reported';

  let best = null;
  let bestTime = -Infinity;

  for (const update of progressUpdates) {
    // The reported series shows claims as they were made, so it does not
    // require approval; the official series always does.
    if (!wantReported && update?.status !== 'approved') continue;

    // period_end is the reporting period this work belongs to; fall back to
    // submitted_at for legacy rows recorded before periods existed.
    const when = parseDateOnly(update.period_end) || parseDateOnly(update.submitted_at);
    if (!when || when > at) continue;
    if (when.getTime() < bestTime) continue;

    const value = wantReported
      ? toFiniteNumber(update.reported_accomplishment)
      : toFiniteNumber(officialAccomplishmentOf(update));
    if (value === null) continue;

    bestTime = when.getTime();
    best = value;
  }

  return best === null ? null : clampPct(best);
}

/* ── actual financial curve ─────────────────────────────────────────────── */

/* Cumulative released pesos on or before an instant, as a % of the contract.
 * Reads the admin-entered tranche ledger -- see the header note. */
export function financialPctAt(tranches, instant, contractAmount) {
  const at = parseDateOnly(instant);
  const denominator = toFiniteNumber(contractAmount);
  if (!at || !denominator || denominator <= 0 || !Array.isArray(tranches)) return null;

  let released = 0;
  let sawAny = false;

  for (const tranche of tranches) {
    if (tranche?.status !== 'Released') continue;
    const when = parseDateOnly(tranche.released_date);
    if (!when || when > at) continue;
    const amount = toFiniteNumber(tranche.released_amount);
    if (amount === null) continue;
    released += amount;
    sawAny = true;
  }

  if (!sawAny) return 0;
  return clampPct((released / denominator) * 100);
}

/* ── combined series ────────────────────────────────────────────────────── */

/* Build the month-by-month S-curve series for one project.
 *
 * Returns { series, hasPlanned, hasPhysical, hasFinancial, latest }.
 * `series` entries are { key, label, planned, physical, financial } with null
 * for any series that has no data -- Recharts renders null as a gap, which is
 * the honest representation of "not reported" (as opposed to 0%).
 */
export function buildSCurveSeries({
  project,
  tasks = [],
  progressUpdates = [],
  tranches = [],
  physicalSource = 'official',
} = {}) {
  const contractAmount =
    toFiniteNumber(project?.contract_amount) ?? toFiniteNumber(project?.total_budget);

  /* Time axis: earliest known baseline date through the latest activity. */
  const candidateStarts = [
    parseDateOnly(project?.date_started),
    ...tasks.map((t) => parseDateOnly(t?.planned_start)),
    ...progressUpdates.map((u) => parseDateOnly(u?.period_start) || parseDateOnly(u?.submitted_at)),
    ...tranches.map((t) => parseDateOnly(t?.released_date)),
    parseDateOnly(project?.created_at),
  ].filter(Boolean);

  const candidateEnds = [
    ...tasks.map((t) => parseDateOnly(t?.planned_end)),
    ...progressUpdates.map((u) => parseDateOnly(u?.period_end) || parseDateOnly(u?.submitted_at)),
    ...tranches.map((t) => parseDateOnly(t?.released_date)),
    parseDateOnly(project?.target_completion_date),
    new Date(),
  ].filter(Boolean);

  if (!candidateStarts.length || !candidateEnds.length) {
    return { series: [], hasPlanned: false, hasPhysical: false, hasFinancial: false, latest: null };
  }

  const axisStart = new Date(Math.min(...candidateStarts.map((d) => d.getTime())));
  const axisEnd = new Date(Math.max(...candidateEnds.map((d) => d.getTime())));
  const months = buildMonthAxis(axisStart, axisEnd);

  const series = months.map((month) => ({
    key: month.key,
    label: month.label,
    planned: plannedPctAt(tasks, month.end),
    physical: physicalPctAt(progressUpdates, month.end, { source: physicalSource }),
    financial: financialPctAt(tranches, month.end, contractAmount),
  }));

  const hasPlanned = series.some((p) => p.planned !== null);
  const hasPhysical = series.some((p) => p.physical !== null);
  const hasFinancial = contractAmount > 0 && series.some((p) => p.financial !== null);

  const latest = series.length ? series[series.length - 1] : null;

  return { series, hasPlanned, hasPhysical, hasFinancial, latest, contractAmount };
}

/* ── variance ───────────────────────────────────────────────────────────── */

/* Physical minus financial, in percentage points.
 *
 *   positive  -> work is ahead of money (contractor is effectively financing;
 *                billings may be pending or under-released)
 *   negative  -> money is ahead of work (over-disbursement risk -- the case
 *                DA cares most about)
 */
export function computeVariance(physicalPct, financialPct) {
  const physical = toFiniteNumber(physicalPct);
  const financial = toFiniteNumber(financialPct);
  if (physical === null || financial === null) return null;
  return Number((physical - financial).toFixed(2));
}

/* Classify a variance for display. Tones match the app's existing status
 * palette (emerald / amber / rose) used by getFmrStatusStyle. */
export function classifyVariance(variance) {
  if (variance === null || variance === undefined || !Number.isFinite(Number(variance))) {
    return {
      level: 'unknown',
      tone: 'bg-slate-50 text-slate-600 border-slate-200',
      dot: 'bg-slate-400',
      label: 'Not enough data',
      detail: 'Physical or financial accomplishment has not been recorded yet.',
    };
  }

  const value = Number(variance);
  const magnitude = Math.abs(value);
  const aheadOfMoney = value >= 0;

  if (magnitude <= VARIANCE_REVIEW_THRESHOLD) {
    return {
      level: 'normal',
      tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dot: 'bg-emerald-500',
      label: 'Within tolerance',
      detail: `Physical and financial accomplishment differ by ${magnitude.toFixed(1)} points.`,
    };
  }

  const severe = magnitude > VARIANCE_CRITICAL_THRESHOLD;
  return {
    level: severe ? 'review' : 'watch',
    tone: severe
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-amber-50 text-amber-700 border-amber-200',
    dot: severe ? 'bg-rose-500' : 'bg-amber-500',
    label: severe ? 'Subject to review' : 'Watch',
    detail: aheadOfMoney
      ? `Work is ${magnitude.toFixed(1)} points ahead of disbursement — billings may be outstanding.`
      : `Disbursement is ${magnitude.toFixed(1)} points ahead of verified work — possible over-release.`,
  };
}

/* Schedule slippage: actual physical progress minus the planned curve.
 * Negative means behind schedule. Complements the financial variance and
 * answers the adviser's "on-time and on-budget" ask. */
export function computeSlippage(physicalPct, plannedPct) {
  const physical = toFiniteNumber(physicalPct);
  const planned = toFiniteNumber(plannedPct);
  if (physical === null || planned === null) return null;
  return Number((physical - planned).toFixed(2));
}
