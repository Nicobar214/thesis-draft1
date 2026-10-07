import { describe, expect, it } from 'vitest';
import { CITIZEN_STATUS, getCitizenStatus } from '../publicReportStatus';

describe('getCitizenStatus', () => {
  it('defaults to submitted when there is no report', () => {
    expect(getCitizenStatus(null)).toBe(CITIZEN_STATUS.submitted);
    expect(getCitizenStatus(undefined)).toBe(CITIZEN_STATUS.submitted);
  });

  it('trusts the citizen view label over the raw status', () => {
    const report = { citizen_status: 'Site Inspection Scheduled', status: 'pending' };
    expect(getCitizenStatus(report)).toBe(CITIZEN_STATUS.inspection_scheduled);
  });

  it('matches the view label regardless of case and spacing', () => {
    expect(getCitizenStatus({ citizen_status: '  UNDER VERIFICATION ' })).toBe(CITIZEN_STATUS.under_verification);
  });

  it('falls back to the raw status for rows read outside the view', () => {
    expect(getCitizenStatus({ status: 'pending' })).toBe(CITIZEN_STATUS.submitted);
    expect(getCitizenStatus({ status: 'reviewed' })).toBe(CITIZEN_STATUS.under_review);
    expect(getCitizenStatus({ status: 'resolved' })).toBe(CITIZEN_STATUS.resolved);
  });

  it('shows a dismissed report as closed, never as pending', () => {
    expect(getCitizenStatus({ status: 'dismissed' })).toBe(CITIZEN_STATUS.closed);
    expect(getCitizenStatus({ citizen_status: 'Closed' })).toBe(CITIZEN_STATUS.closed);
  });

  it('falls back to submitted for an unknown status instead of throwing', () => {
    expect(getCitizenStatus({ status: 'something-new' })).toBe(CITIZEN_STATUS.submitted);
  });
});
