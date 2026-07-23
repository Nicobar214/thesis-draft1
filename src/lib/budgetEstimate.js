/**
 * DA-BAFE (Bureau of Agricultural and Fisheries Engineering) 2026 indicative
 * unit cost for Farm-to-Market Road construction: ~₱15,000,000/km. Real
 * project costs range roughly ₱10M-₱20M/km depending on terrain, materials,
 * and labor (DA statements reported by Manila Times/BusinessMirror, 2026).
 * Used only as a fallback estimate when a project has no confirmed real budget.
 */
export const DA_FMR_RATE_PER_KM = 15_000_000;

// Standard PH government procurement disbursement schedule (RA 9184 IRR):
// up to 15% mobilization advance, staged progress payments, ~10% retention
// held until final acceptance. Used only to ESTIMATE likely fund utilization
// from physical progress when no real `funds_released` figure is on file —
// this is an estimate, not an audited disbursement record.
const TRANCHE_SCHEDULE = [
  { id: 1, name: 'Mobilization Advance', share: 0.15, releaseAtProgress: 0, liquidateAfterProgress: 15, dayOffset: 15 },
  { id: 2, name: '1st Progress Release', share: 0.35, releaseAtProgress: 30, liquidateAfterProgress: 50, dayOffset: 60 },
  { id: 3, name: '2nd Progress Release', share: 0.40, releaseAtProgress: 70, liquidateAfterProgress: 90, dayOffset: 120 },
  { id: 4, name: 'Retention Release', share: 0.10, releaseAtProgress: 100, liquidateAfterProgress: 99, dayOffset: null },
];

export function estimateProjectBudget(project) {
  const real = Number(project?.total_budget);
  if (Number.isFinite(real) && real > 0) {
    return { amount: real, isEstimated: false };
  }
  const length = Number(project?.project_length_km) || 0;
  return { amount: Math.round(length * DA_FMR_RATE_PER_KM), isEstimated: true };
}

export function buildDisbursementTranches(totalBudget, project) {
  const progress = Number(project?.accomplishment) || 0;
  const dayMs = 24 * 60 * 60 * 1000;
  const baseDate = project?.created_at ? new Date(project.created_at) : new Date();

  return TRANCHE_SCHEDULE.map((t) => ({
    id: t.id,
    name: t.name,
    percentage: t.share * 100,
    amount: totalBudget * t.share,
    requiredProgress: t.releaseAtProgress,
    released: progress >= t.releaseAtProgress,
    liquidated: t.id === 4 ? progress === 100 : progress > t.liquidateAfterProgress,
    date: t.dayOffset === null
      ? (project?.date_completed ? new Date(project.date_completed) : project?.target_completion_date ? new Date(project.target_completion_date) : new Date())
      : new Date(baseDate.getTime() + t.dayOffset * dayMs),
  }));
}

/**
 * Adapts real `project_tranches` DB rows into the same shape
 * buildDisbursementTranches() produces, so summarizeTranches() and any
 * rendering code work unchanged whether the schedule is real (persisted,
 * admin-released) or estimated (computed from progress %, never saved).
 */
export function realTranchesToScheduleShape(tranches) {
  return (tranches || [])
    .slice()
    .sort((a, b) => a.tranche_order - b.tranche_order)
    .map((t) => ({
      id: t.id,
      name: t.tranche_name,
      percentage: Number(t.percentage),
      amount: Number(t.status === 'Released' ? t.released_amount ?? t.amount : t.amount),
      requiredProgress: Number(t.required_progress),
      released: t.status === 'Released',
      liquidated: t.status === 'Released',
      date: t.released_date ? new Date(t.released_date) : null,
      releasedByName: t.released_by_name || null,
      notes: t.notes || null,
      isReal: true,
    }));
}

export function summarizeTranches(tranches, totalBudget) {
  const totalReleased = tranches.reduce((sum, t) => sum + (t.released ? t.amount : 0), 0);
  const totalLiquidated = tranches.reduce((sum, t) => sum + (t.liquidated ? t.amount : 0), 0);
  return {
    totalReleased,
    totalLiquidated,
    remainingToRelease: totalBudget - totalReleased,
    remainingToLiquidate: totalReleased - totalLiquidated,
    liquidationRate: totalReleased > 0 ? (totalLiquidated / totalReleased) * 100 : 0,
  };
}

export function estimateFundsUtilized(project, totalBudget) {
  const realReleased = Number(project?.funds_released);
  if (Number.isFinite(realReleased) && realReleased >= 0) {
    return {
      released: realReleased,
      remaining: Math.max(totalBudget - realReleased, 0),
      isEstimated: false,
    };
  }

  const tranches = buildDisbursementTranches(totalBudget, project);
  const { totalReleased } = summarizeTranches(tranches, totalBudget);
  return {
    released: totalReleased,
    remaining: Math.max(totalBudget - totalReleased, 0),
    isEstimated: true,
  };
}

/**
 * Single entry point for citizen-facing views: total, released, remaining,
 * and where each figure came from. Pass `tranches` (real project_tranches
 * rows for this project, if any) to prefer the real, admin-released
 * figures over the RA-9184 progress-based estimate.
 */
export function getProjectBudgetSummary(project, tranches = []) {
  const { amount: totalBudget, isEstimated: budgetIsEstimated } = estimateProjectBudget(project);

  if (tranches && tranches.length > 0) {
    const released = tranches.reduce((sum, t) => sum + (t.status === 'Released' ? Number(t.released_amount ?? t.amount) : 0), 0);
    return {
      totalBudget,
      budgetIsEstimated,
      released,
      remaining: Math.max(totalBudget - released, 0),
      utilizationIsEstimated: false,
      fundingSource: project?.funding_source || null,
    };
  }

  const { released, remaining, isEstimated: utilizationIsEstimated } = estimateFundsUtilized(project, totalBudget);
  return {
    totalBudget,
    budgetIsEstimated,
    released,
    remaining,
    utilizationIsEstimated,
    fundingSource: project?.funding_source || null,
  };
}

export function formatPeso(amount) {
  const n = Number(amount) || 0;
  if (Math.abs(n) >= 1_000_000) return `₱${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `₱${(n / 1_000).toFixed(0)}K`;
  return `₱${n.toLocaleString()}`;
}
