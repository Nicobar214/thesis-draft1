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

/* How the plan stands against its cost basis: what is left, or how far over.
 * Both null when there is no basis to compare with. */
export function budgetHeadroom(items, costBasis) {
  const basis = positiveNumber(costBasis?.amount);
  if (basis === null) return { remaining: null, overBy: null };
  const total = (items || []).reduce((sum, item) => sum + (calculatePlannedCost(item) || 0), 0);
  return { remaining: Math.max(0, basis - total), overBy: Math.max(0, total - basis) };
}

/* What every other activity already uses, so one activity's limit can be found. */
function budgetLeftFor(items, clientKey, costBasis) {
  const basis = positiveNumber(costBasis?.amount);
  if (basis === null) return null;
  const others = (items || [])
    .filter((item) => item.clientKey !== clientKey)
    .reduce((sum, item) => sum + (calculatePlannedCost(item) || 0), 0);
  return Math.max(0, basis - others);
}

/* The highest unit cost this activity can have and keep the plan within the
 * budget, given its quantity. null without a quantity or a basis. */
export function maxUnitCostFor(items, clientKey, costBasis) {
  const item = (items || []).find((entry) => entry.clientKey === clientKey);
  const quantity = positiveNumber(item?.planned_quantity);
  const left = budgetLeftFor(items, clientKey, costBasis);
  if (quantity === null || left === null) return null;
  return Math.floor((left / quantity) * 100) / 100;
}

/* The largest quantity this activity can have at its unit cost and keep the
 * plan within the budget. null without a unit cost or a basis. */
export function maxQuantityFor(items, clientKey, costBasis) {
  const item = (items || []).find((entry) => entry.clientKey === clientKey);
  const unitCost = positiveNumber(item?.unit_cost);
  const left = budgetLeftFor(items, clientKey, costBasis);
  if (unitCost === null || left === null) return null;
  return Math.floor((left / unitCost) * 10000) / 10000;
}

export function formatPesoAmount(value) {
  if (value === null || value === undefined || value === '') return '\u2014';
  const number = Number(value);
  return Number.isFinite(number) ? PESO_FORMATTER.format(number).replace('PHP', '\u20b1') : '\u2014';
}
