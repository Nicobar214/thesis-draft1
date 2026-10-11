import { describe, it, expect } from 'vitest';
import { summarizeBeneficiaries, groupCommodities, dedupeFarmers, NOT_RECORDED } from '../beneficiaryAnalytics';

const farmer = (id, over = {}) => ({
  id,
  crop: 'Rice',
  municipality: 'Leon',
  farmAreaHa: 1,
  validationStatus: 'Validated',
  submittedDate: new Date('2026-08-15T00:00:00'),
  ...over,
});

describe('beneficiaryAnalytics', () => {
  it('counts each farmer once even when rows repeat', () => {
    const rows = [farmer(1), farmer(1), farmer(2)];
    expect(dedupeFarmers(rows)).toHaveLength(2);
    expect(summarizeBeneficiaries(rows).total).toBe(2);
  });

  it('sums only recorded farm areas and counts the missing ones', () => {
    const s = summarizeBeneficiaries([farmer(1, { farmAreaHa: 2.5 }), farmer(2, { farmAreaHa: 0 }), farmer(3, { farmAreaHa: null })]);
    expect(s.hectares).toBe(2.5);
    expect(s.areaRecorded).toBe(1);
    expect(s.areaMissing).toBe(2);
  });

  it('ranks commodities with shares over all farmers and keeps blanks visible', () => {
    const s = summarizeBeneficiaries([farmer(1), farmer(2), farmer(3, { crop: 'Corn' }), farmer(4, { crop: '  ' })]);
    expect(s.commodities.map((c) => [c.name, c.count])).toEqual([['Rice', 2], ['Corn', 1], [NOT_RECORDED, 1]]);
    expect(s.commodities[0].share).toBe(0.5);
    expect(s.leadingCommodity).toEqual({ names: ['Rice'], count: 2, share: 0.5 });
    expect(s.missing.crop).toBe(1);
  });

  it('reports a tie for leading commodity instead of picking one', () => {
    const s = summarizeBeneficiaries([farmer(1), farmer(2, { crop: 'Corn' })]);
    expect(s.leadingCommodity.names).toEqual(['Corn', 'Rice']);
  });

  it('has no leading commodity when none is recorded', () => {
    expect(summarizeBeneficiaries([farmer(1, { crop: '' })]).leadingCommodity).toBeNull();
  });

  it('groups the long tail but never hides missing data', () => {
    const ranked = ['A', 'B', 'C', 'D'].map((name, i) => ({ name, count: 10 - i, share: 0 }))
      .concat({ name: NOT_RECORDED, count: 1, share: 0 });
    const grouped = groupCommodities(ranked, 2);
    expect(grouped.map((g) => g.name)).toEqual(['A', 'B', 'All other crops (2)', NOT_RECORDED]);
    expect(grouped[2].count).toBe(8 + 7);
  });

  it('measures coverage against the municipality master list', () => {
    const s = summarizeBeneficiaries([farmer(1), farmer(2, { municipality: 'Alimodian' })], { municipalityMaster: ['Leon', 'Alimodian', 'Tubungan'] });
    expect(s.coverage).toMatchObject({ withFarmers: 2, masterTotal: 3, withoutFarmers: 1, outsideMaster: [] });
  });

  it('builds yearly new + cumulative registrations from the registration date', () => {
    const s = summarizeBeneficiaries([
      farmer(1, { submittedDate: new Date('2025-03-01T00:00:00') }),
      farmer(2, { submittedDate: new Date('2026-01-01T00:00:00') }),
      farmer(3, { submittedDate: new Date('2026-05-01T00:00:00') }),
      farmer(4, { submittedDate: null }),
    ]);
    expect(s.years.map((y) => [y.year, y.registered, y.cumulative])).toEqual([[2025, 1, 1], [2026, 2, 3]]);
    expect(s.undated).toBe(1);
    expect(s.yearOverYear).toMatchObject({ from: 2025, to: 2026, change: 1 });
  });

  it('ranks barangays', () => {
    const s = summarizeBeneficiaries([farmer(1, { barangay: 'Tagsing' }), farmer(2, { barangay: 'Tagsing' }), farmer(3, { barangay: 'Bobon' })]);
    expect(s.barangays.map((b) => [b.name, b.count])).toEqual([['Tagsing', 2], ['Bobon', 1]]);
  });

  it('measures road access by link and distance band, keeping missing distances apart', () => {
    const s = summarizeBeneficiaries([
      farmer(1, { linkedProjectId: 'p1', distanceToFmrKm: 0.4 }),
      farmer(2, { linkedProject: 'FMR A', distanceToFmrKm: 1 }),
      farmer(3, { distanceToFmrKm: 4.2 }),
      farmer(4, { distanceToFmrKm: 0 }),
    ]);
    expect(s.roadAccess.linked).toBe(2);
    expect(s.roadAccess.unlinked).toBe(2);
    expect(s.roadAccess.bands.map((b) => b.count)).toEqual([1, 1, 0, 1]);
    expect(s.roadAccess.distanceMissing).toBe(1);
  });

  it('counts sex case-insensitively without inventing values', () => {
    const s = summarizeBeneficiaries([farmer(1, { gender: 'MALE' }), farmer(2, { gender: 'Male' }), farmer(3, { gender: 'FEMALE' }), farmer(4, { gender: '' })]);
    expect(s.sex).toEqual({ Male: 2, Female: 1, [NOT_RECORDED]: 1 });
  });

  it('fills months between the first and last registration with real zeros', () => {
    const s = summarizeBeneficiaries([
      farmer(1, { submittedDate: new Date('2026-07-10T00:00:00') }),
      farmer(2, { submittedDate: new Date('2026-09-02T00:00:00') }),
    ]);
    expect(s.months.map((m) => [m.label, m.registered, m.cumulative])).toEqual([
      ['Jul 2026', 1, 1], ['Aug 2026', 0, 1], ['Sep 2026', 1, 2],
    ]);
  });
});
