import { describe, it, expect } from 'vitest';
import { reportReference, parseReferenceQuery, matchReportsByReference } from '../reportReference';

const reports = [
  { id: '64c1324e-ee96-4c85-8021-ec8c8668bc7c' },
  { id: '799f7658-1111-4c85-8021-ec8c8668bc7c' },
  { id: '64c19999-2222-4c85-8021-ec8c8668bc7c' },
];

describe('reportReference', () => {
  it('matches what citizens are shown', () => {
    expect(reportReference(reports[0].id)).toBe('64C1324E');
  });

  it('accepts a reference with #, any case, or partly typed', () => {
    expect(parseReferenceQuery('#64C1324E')).toBe('64c1324e');
    expect(parseReferenceQuery(' 64c1 ')).toBe('64c1');
    expect(parseReferenceQuery('64c')).toBeNull();
    expect(parseReferenceQuery('Leon')).toBeNull();
  });

  it('finds the exact report, or all reports sharing a prefix', () => {
    expect(matchReportsByReference(reports, '64C1324E').map((r) => r.id)).toEqual([reports[0].id]);
    expect(matchReportsByReference(reports, '64c1')).toHaveLength(2);
    expect(matchReportsByReference(reports, 'abcd')).toEqual([]);
  });
});
