const PESO_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function positiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function getProjectCostBasis(project) {
  const contractAmount = positiveNumber(project?.contract_amount);
  if (contractAmount !== null) {
    return { amount: contractAmount, source: 'contract_amount', label: 'Contract Amount' };
  }

  const recordedBudget = positiveNumber(project?.total_budget);
  if (recordedBudget !== null) {
    return { amount: recordedBudget, source: 'total_budget', label: 'Recorded Project Budget' };
  }

  return { amount: null, source: null, label: 'Project Cost Basis' };
}

export function calculatePlannedCost(item) {
  const quantity = positiveNumber(item?.planned_quantity);
  const unitCost = positiveNumber(item?.unit_cost);
  return quantity === null || unitCost === null ? null : quantity * unitCost;
}

export function summarizeWorkPlanCosts(items, costBasis, { historical = false } = {}) {
  const plannedCosts = items.map(calculatePlannedCost);
  const completeCosts = plannedCosts.filter((value) => value !== null);
  const missingCostCount = plannedCosts.length - completeCosts.length;
  const enteredTotal = completeCosts.reduce((sum, value) => sum + value, 0);
  const hasRecordedCosts = completeCosts.length > 0;
  const total = historical && !hasRecordedCosts ? null : enteredTotal;
  const basisAmount = positiveNumber(costBasis?.amount);
  const difference = basisAmount === null || total === null ? null : basisAmount - total;
  const allocationPercent = basisAmount === null || total === null
    ? null
    : (total / basisAmount) * 100;

  let state = 'below';
  if (basisAmount === null || total === null) state = 'unavailable';
  else if (total > basisAmount) state = 'over';
  else if (missingCostCount > 0) state = 'incomplete';
  else if (Math.abs(total - basisAmount) <= Number.EPSILON * Math.max(1, Math.abs(basisAmount)) * 4) {
    state = 'matched';
  }

  return { total, difference, allocationPercent, missingCostCount, state, plannedCosts };
}

export function formatPesoAmount(value) {
  if (value === null || value === undefined || value === '') return '\u2014';
  const number = Number(value);
  return Number.isFinite(number) ? PESO_FORMATTER.format(number).replace('PHP', '\u20b1') : '\u2014';
}
