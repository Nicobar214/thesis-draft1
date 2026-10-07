import { describe, expect, it } from 'vitest';
import {
  DA_FMR_RATE_PER_KM,
  estimateProjectBudget,
  formatPeso,
  getProjectBudgetSummary,
} from '../budgetEstimate';

describe('estimateProjectBudget', () => {
  it('uses the real budget when one is on file', () => {
    expect(estimateProjectBudget({ total_budget: 5_000_000, project_length_km: 9 })).toEqual({
      amount: 5_000_000,
      isEstimated: false,
    });
  });

  it('estimates from road length at the DA rate when there is no real budget', () => {
    expect(estimateProjectBudget({ project_length_km: 2 })).toEqual({
      amount: 2 * DA_FMR_RATE_PER_KM,
      isEstimated: true,
    });
  });

  it('never throws on a missing project', () => {
    expect(estimateProjectBudget(null)).toEqual({ amount: 0, isEstimated: true });
  });
});

describe('getProjectBudgetSummary', () => {
  const project = { total_budget: 10_000_000, funding_source: 'GAA' };

  it('prefers real released tranches and marks them official', () => {
    const tranches = [
      { status: 'Released', released_amount: 2_000_000, amount: 1_500_000 },
      { status: 'Pending', amount: 3_000_000 },
    ];
    const summary = getProjectBudgetSummary(project, tranches);
    expect(summary.released).toBe(2_000_000);
    expect(summary.remaining).toBe(8_000_000);
    expect(summary.utilizationIsEstimated).toBe(false);
    expect(summary.fundingSource).toBe('GAA');
  });

  it('counts a released tranche at its planned amount when no released amount was recorded', () => {
    const summary = getProjectBudgetSummary(project, [{ status: 'Released', released_amount: null, amount: 1_500_000 }]);
    expect(summary.released).toBe(1_500_000);
  });

  it('uses the recorded funds_released when there are no tranches', () => {
    const summary = getProjectBudgetSummary({ ...project, funds_released: 4_000_000 }, []);
    expect(summary.released).toBe(4_000_000);
    expect(summary.remaining).toBe(6_000_000);
    expect(summary.utilizationIsEstimated).toBe(false);
  });

  it('estimates utilisation from progress when nothing is recorded', () => {
    // 50% done: mobilization (15%) and 1st progress release (35%) are due.
    const summary = getProjectBudgetSummary({ ...project, accomplishment: 50 }, []);
    expect(summary.released).toBe(5_000_000);
    expect(summary.utilizationIsEstimated).toBe(true);
  });

  it('never reports negative remaining funds', () => {
    const summary = getProjectBudgetSummary({ ...project, funds_released: 99_000_000 }, []);
    expect(summary.remaining).toBe(0);
  });

  it('treats a missing funds_released (null) as "not recorded", not as zero', () => {
    const summary = getProjectBudgetSummary({ ...project, funds_released: null, accomplishment: 50 }, []);
    expect(summary.utilizationIsEstimated).toBe(true);
    expect(summary.released).toBe(5_000_000);
  });
});

describe('formatPeso', () => {
  it('abbreviates millions and thousands', () => {
    expect(formatPeso(15_000_000)).toBe('₱15.00M');
    expect(formatPeso(15_000)).toBe('₱15K');
    expect(formatPeso(500)).toBe('₱500');
  });

  it('treats bad input as zero', () => {
    expect(formatPeso(undefined)).toBe('₱0');
    expect(formatPeso('abc')).toBe('₱0');
  });
});
