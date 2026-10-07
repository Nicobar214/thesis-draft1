import { describe, expect, it } from 'vitest';
import { TRIAGE, assessReport, canDismissReport, scoreCredibility } from '../publicReportTriage';

describe('scoreCredibility', () => {
  it('scores a precise, close, verified, photo-matched report as High', () => {
    const result = scoreCredibility({ accuracy: 5, distanceMeters: 30, isVerifiedUser: true, photoGpsMatch: true });
    expect(result.score).toBe(100);
    expect(result.label).toBe('High');
  });

  it('scores a vague, distant, anonymous report as Low', () => {
    const result = scoreCredibility({ accuracy: 500, distanceMeters: 2000, isVerifiedUser: false, photoGpsMatch: false });
    expect(result.score).toBe(25);
    expect(result.label).toBe('Low');
  });

  it('does not reward missing data', () => {
    const result = scoreCredibility({});
    expect(result.label).toBe('Low');
  });
});

describe('canDismissReport', () => {
  it('allows closing only before the engineer workflow starts', () => {
    expect(canDismissReport({ status: 'pending' })).toBe(true);
    expect(canDismissReport({ status: 'reviewed' })).toBe(true);
    expect(canDismissReport({ status: 'pending', engineer_status: 'assigned' })).toBe(false);
    expect(canDismissReport({ status: 'resolved' })).toBe(false);
    expect(canDismissReport(null)).toBe(false);
  });
});

describe('assessReport', () => {
  it('never auto-rejects a report whose distance could not be measured', () => {
    const result = assessReport({ report: { user_id: 'u1' }, project: null, routeRecord: null });
    expect(result.isAutoReject).toBe(false);
    expect(result.recommendation).toBe(TRIAGE.REVIEW);
    expect(result.reasons.join(' ')).toMatch(/GPS/i);
  });

  it('flags an anonymous submission', () => {
    const result = assessReport({ report: {}, project: null, routeRecord: null });
    expect(result.reasons.join(' ')).toMatch(/anonymous/i);
  });

  it('recommends rejecting a pin far outside the 1 km reporting range', () => {
    const report = { user_id: 'u1', latitude: 10.0, longitude: 122.0, geo_accuracy: 10 };
    const project = { start_latitude: 10.03, start_longitude: 122.0 }; // about 3.3 km away
    const result = assessReport({ report, project, routeRecord: null });
    expect(result.distanceMeters).toBeGreaterThan(1000);
    expect(result.recommendation).toBe(TRIAGE.REJECT);
    expect(result.isAutoReject).toBe(true);
  });

  it('lets a report right on the road proceed', () => {
    const report = { user_id: 'u1', latitude: 10.0, longitude: 122.0, geo_accuracy: 10 };
    const project = { start_latitude: 10.0001, start_longitude: 122.0 }; // about 11 m away
    const result = assessReport({ report, project, routeRecord: null, photoGpsMatch: true });
    expect(result.recommendation).toBe(TRIAGE.PROCEED);
  });
});
