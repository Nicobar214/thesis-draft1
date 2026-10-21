import { describe, it, expect } from 'vitest';
import { budgetHeadroom, maxQuantityFor, maxUnitCostFor, summarizeWorkPlanCosts } from '../workPlanCost';

const basis = { amount: 1000000, label: 'Contract Amount' };
const items = [
  { clientKey: 'a', planned_quantity: 100, unit_cost: 5000 }, // 500,000
  { clientKey: 'b', planned_quantity: 200, unit_cost: 1500 }, // 300,000
];

describe('budgetHeadroom', () => {
  it('shows what is left while under the budget', () => {
    expect(budgetHeadroom(items, basis)).toEqual({ remaining: 200000, overBy: 0 });
  });

  it('shows how far over once past it', () => {
    const over = [...items, { clientKey: 'c', planned_quantity: 10, unit_cost: 30000 }]; // +300,000
    expect(budgetHeadroom(over, basis)).toEqual({ remaining: 0, overBy: 100000 });
  });

  it('has nothing to compare without a cost basis', () => {
    expect(budgetHeadroom(items, { amount: null })).toEqual({ remaining: null, overBy: null });
  });
});

describe('per-activity limits', () => {
  it('gives the highest unit cost that keeps the plan within budget', () => {
    // others use 300,000; 700,000 left for 100 units
    expect(maxUnitCostFor(items, 'a', basis)).toBe(7000);
  });

  it('gives the largest quantity at the current unit cost', () => {
    // others use 500,000; 500,000 left at 1,500 each
    expect(maxQuantityFor(items, 'b', basis)).toBeCloseTo(333.3333, 4);
  });

  it('is zero when the other activities already use the whole budget', () => {
    const full = [{ clientKey: 'x', planned_quantity: 1, unit_cost: 1000000 }, { clientKey: 'y', planned_quantity: 5, unit_cost: 10 }];
    expect(maxUnitCostFor(full, 'y', basis)).toBe(0);
  });

  it('is unknown without a quantity, a unit cost or a basis', () => {
    expect(maxUnitCostFor([{ clientKey: 'z', planned_quantity: '' }], 'z', basis)).toBeNull();
    expect(maxQuantityFor([{ clientKey: 'z', unit_cost: '' }], 'z', basis)).toBeNull();
    expect(maxUnitCostFor(items, 'a', { amount: null })).toBeNull();
  });
});

describe('summarizeWorkPlanCosts', () => {
  it('still reports the over state', () => {
    const over = [...items, { clientKey: 'c', planned_quantity: 10, unit_cost: 30000 }];
    expect(summarizeWorkPlanCosts(over, basis).state).toBe('over');
    expect(summarizeWorkPlanCosts(items, basis).state).toBe('below');
  });
});
