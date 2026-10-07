import { describe, expect, it } from 'vitest';
import { getStatusStyle, normalizeUserProjectStatus } from '../projectStatus';

describe('normalizeUserProjectStatus', () => {
  it('recognises the many spellings of ongoing', () => {
    ['On-Going', 'ongoing', 'On Going', 'ONGOING'].forEach((s) => {
      expect(normalizeUserProjectStatus(s)).toBe('On-Going');
    });
  });

  it('treats pending as proposed and recognises completed', () => {
    expect(normalizeUserProjectStatus('Pending')).toBe('Proposed');
    expect(normalizeUserProjectStatus('proposed')).toBe('Proposed');
    expect(normalizeUserProjectStatus('COMPLETED')).toBe('Completed');
  });

  it('defaults a missing status to proposed and keeps an unknown one visible', () => {
    expect(normalizeUserProjectStatus(null)).toBe('Proposed');
    expect(normalizeUserProjectStatus('Suspended')).toBe('Suspended');
  });
});

describe('getStatusStyle', () => {
  it('gives each status its own colour', () => {
    expect(getStatusStyle('Completed').badge).toMatch(/emerald/);
    expect(getStatusStyle('On-Going').badge).toMatch(/amber/);
    expect(getStatusStyle('Proposed').badge).toMatch(/sky/);
  });

  it('falls back to the proposed style for an unknown status', () => {
    expect(getStatusStyle('Suspended')).toEqual(getStatusStyle('Proposed'));
  });
});
