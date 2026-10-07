import { describe, expect, it } from 'vitest';
import { buildProgressEntries, formatProgressDelta, formatProgressPeriod } from '../projectProgress';

const row = (id, accomplishment, approved_at, extra = {}) => ({
  id,
  accomplishment,
  approved_at,
  is_certified: true,
  photo_url: null,
  period_start: null,
  period_end: null,
  ...extra,
});

describe('formatProgressPeriod', () => {
  it('names a whole month by month and year', () => {
    expect(formatProgressPeriod('2026-09-01', '2026-09-30')).toBe('Sep 2026');
  });

  it('shows a range inside one year compactly', () => {
    expect(formatProgressPeriod('2026-09-01', '2026-10-15')).toBe('Sep 1 – Oct 15, 2026');
  });

  it('shows both years when the range crosses a year', () => {
    expect(formatProgressPeriod('2026-12-10', '2027-01-20')).toBe('Dec 10, 2026 – Jan 20, 2027');
  });

  it('does not let the time zone shift a date-only value to the previous day', () => {
    expect(formatProgressPeriod('2026-10-01', '2026-10-31')).toBe('Oct 2026');
  });

  it('falls back to the approval date, then to a plain message', () => {
    expect(formatProgressPeriod(null, null, '2026-10-06T12:00:00Z')).toMatch(/^Oct \d{1,2}, 2026$/);
    expect(formatProgressPeriod(null, null, null)).toBe('Date not recorded');
  });
});

describe('formatProgressDelta', () => {
  it('shows gains and losses with a clear sign', () => {
    expect(formatProgressDelta(12.44)).toBe('+12.4 pts');
    expect(formatProgressDelta(-3)).toBe('−3.0 pts');
  });

  it('says "no change" instead of showing +0.0', () => {
    expect(formatProgressDelta(0)).toBe('no change');
    expect(formatProgressDelta(0.04)).toBe('no change');
  });

  it('shows nothing when there is nothing to compare with', () => {
    expect(formatProgressDelta(null)).toBeNull();
    expect(formatProgressDelta(undefined)).toBeNull();
    expect(formatProgressDelta(NaN)).toBeNull();
  });
});

describe('buildProgressEntries', () => {
  it('orders newest first and measures each step against the update before it', () => {
    const entries = buildProgressEntries([
      row('a', '18.8', '2026-08-19T00:00:00Z'),
      row('c', '40', '2026-10-06T00:00:00Z'),
      row('b', '30', '2026-09-07T00:00:00Z'),
    ]);

    expect(entries.map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect(entries[0].delta).toBeCloseTo(10);
    expect(entries[1].delta).toBeCloseTo(11.2);
    expect(entries[2].delta).toBeNull(); // the first update has nothing before it
  });

  it('keeps percentages within 0-100', () => {
    const [high, low] = buildProgressEntries([
      row('a', '140', '2026-10-01T00:00:00Z'),
      row('b', '-5', '2026-09-01T00:00:00Z'),
    ]);
    expect(high.pct).toBe(100);
    expect(low.pct).toBe(0);
  });

  it('skips rows without a usable figure', () => {
    const entries = buildProgressEntries([
      row('a', null, '2026-10-01T00:00:00Z'),
      row('b', 'abc', '2026-09-01T00:00:00Z'),
      row('c', '25', '2026-08-01T00:00:00Z'),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['c']);
  });

  it('carries the verification flag and photo through', () => {
    const [entry] = buildProgressEntries([
      row('a', '10', '2026-10-01T00:00:00Z', { is_certified: false, photo_url: 'https://cdn.test/p.jpg' }),
    ]);
    expect(entry.isCertified).toBe(false);
    expect(entry.photoUrl).toBe('https://cdn.test/p.jpg');
  });

  it('copes with no data at all', () => {
    expect(buildProgressEntries(undefined)).toEqual([]);
    expect(buildProgressEntries([])).toEqual([]);
  });
});
