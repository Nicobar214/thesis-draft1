import { describe, expect, it } from 'vitest';
import { SUPPORTABLE_STATUSES, supportCountLabel } from '../reportSupport';

describe('supportCountLabel', () => {
  it('says nothing when no one has backed the report', () => {
    expect(supportCountLabel(0)).toBeNull();
    expect(supportCountLabel(undefined)).toBeNull();
  });

  it('uses singular and plural correctly', () => {
    expect(supportCountLabel(1)).toBe('1 resident sees this too');
    expect(supportCountLabel(4)).toBe('4 residents see this too');
  });
});

describe('SUPPORTABLE_STATUSES', () => {
  it('matches the database rule: only open reports can be backed', () => {
    expect(SUPPORTABLE_STATUSES).toEqual(['pending', 'reviewed']);
    expect(SUPPORTABLE_STATUSES).not.toContain('resolved');
    expect(SUPPORTABLE_STATUSES).not.toContain('dismissed');
  });
});
