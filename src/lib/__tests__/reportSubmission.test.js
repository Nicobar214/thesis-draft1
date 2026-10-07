import { describe, expect, it } from 'vitest';
import {
  buildReportPayload,
  computeVerification,
  distToProject,
  findNearbyProjects,
  friendlySubmitError,
  fmtDist,
  haversineMeters,
  isNetworkFailure,
  isProjectNearby,
  makePhotoPath,
  sortProjectsByDistance,
  validateReportInput,
} from '../reportSubmission';

// 0.001 degrees of latitude is about 111 m.
const project = (id, lat, lng, extra = {}) => ({
  id,
  project_name: `Road ${id}`,
  start_latitude: lat,
  start_longitude: lng,
  ...extra,
});

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(10, 122, 10, 122)).toBe(0);
  });

  it('measures about 111 m per 0.001 degrees of latitude', () => {
    expect(haversineMeters(10, 122, 10.001, 122)).toBeGreaterThan(105);
    expect(haversineMeters(10, 122, 10.001, 122)).toBeLessThan(117);
  });
});

describe('isProjectNearby', () => {
  const me = { lat: 10, lng: 122 };

  it('accepts a project whose start point is within 150 m', () => {
    expect(isProjectNearby(me.lat, me.lng, project(1, 10.001, 122))).toBe(true); // ~111 m
  });

  it('rejects a project beyond the normal radius', () => {
    expect(isProjectNearby(me.lat, me.lng, project(1, 10.01, 122))).toBe(false); // ~1.1 km
  });

  it('accepts a long road when the user is near its midpoint', () => {
    // 2 km road centred on the user: both ends are far, the midpoint is on top of them.
    const road = project(1, 10.009, 122, { end_latitude: 9.991, end_longitude: 122 });
    expect(isProjectNearby(me.lat, me.lng, road)).toBe(true);
  });

  it('ignores a project with no coordinates', () => {
    expect(isProjectNearby(me.lat, me.lng, { id: 1 })).toBe(false);
  });
});

describe('findNearbyProjects', () => {
  const gps = { lat: 10, lng: 122 };
  const near = project(1, 10.001, 122);   // ~111 m
  const closer = project(2, 10.0005, 122); // ~55 m
  const far = project(3, 10.005, 122);    // ~555 m

  it('returns only nearby projects, nearest first', () => {
    expect(findNearbyProjects([near, far, closer], gps).map((p) => p.id)).toEqual([2, 1]);
  });

  it('widens the radius to 1 km on request', () => {
    expect(findNearbyProjects([near, far, closer], gps, true).map((p) => p.id)).toEqual([2, 1, 3]);
  });
});

describe('sortProjectsByDistance', () => {
  it('orders every project by distance and does not mutate the input', () => {
    const gps = { lat: 10, lng: 122 };
    const input = [project(1, 10.01, 122), project(2, 10.001, 122)];
    expect(sortProjectsByDistance(input, gps).map((p) => p.id)).toEqual([2, 1]);
    expect(input.map((p) => p.id)).toEqual([1, 2]);
  });

  it('puts projects without coordinates last', () => {
    expect(distToProject(10, 122, { id: 9 })).toBe(Infinity);
  });
});

describe('fmtDist', () => {
  it('uses metres under 1 km and kilometres above', () => {
    expect(fmtDist(120.4)).toBe('~120m away');
    expect(fmtDist(1500)).toBe('~1.5km away');
  });
});

describe('computeVerification', () => {
  it('verifies a reporter within 100 m of the project', () => {
    expect(computeVerification(10, 122, 10, 10.0005, 122)).toBe('Verified On-Site'); // ~55 m
  });

  it('asks for review when the fix is imprecise and the reporter is not clearly there', () => {
    expect(computeVerification(10, 122, 80, 10.01, 122)).toBe('Needs Review');
  });

  it('flags a mismatch when the fix is precise but far from the project', () => {
    expect(computeVerification(10, 122, 10, 10.01, 122)).toBe('Location Mismatch');
  });

  it('asks for review when the project has no coordinates', () => {
    expect(computeVerification(10, 122, 10, null, null)).toBe('Needs Review');
  });
});

describe('validateReportInput', () => {
  const valid = {
    severityCategory: 'critical',
    specificProblem: 'pothole',
    description: 'Big hole',
    photoBlob: {},
    selProject: { id: 1 },
    gps: { lat: 10, lng: 122 },
  };

  it('accepts a complete report', () => {
    expect(validateReportInput(valid)).toBeNull();
  });

  it('reports the first missing piece, in the order the form asks for it', () => {
    expect(validateReportInput({ ...valid, specificProblem: '' })).toMatch(/classify/i);
    expect(validateReportInput({ ...valid, description: '   ' })).toMatch(/description/i);
    expect(validateReportInput({ ...valid, photoBlob: null })).toMatch(/photo/i);
    expect(validateReportInput({ ...valid, selProject: null })).toMatch(/project/i);
    expect(validateReportInput({ ...valid, gps: null })).toMatch(/GPS/);
  });
});

describe('buildReportPayload', () => {
  const base = {
    fullName: '  Juan  ',
    contact: ' 0917 ',
    selProject: { id: 7, project_name: 'Road 7', municipality: 'Leon', location: 'Brgy. X', start_latitude: 10.0005, start_longitude: 122 },
    gps: { lat: 10, lng: 122, accuracy: 10 },
    photoTs: '2026-01-01T00:00:00.000Z',
    description: '  Cracked  ',
    severityCategory: 'critical',
    category: 'general',
    specificProblem: 'pothole',
    userId: 'user-1',
  };

  it('builds the stored row with trimmed text and the project reference', () => {
    const payload = buildReportPayload(base);
    expect(payload).toMatchObject({
      full_name: 'Juan',
      contact_info: '0917',
      project_id: 'fmr-7',
      project_name: 'Road 7',
      municipality: 'Leon',
      barangay: 'Brgy. X',
      description: 'Cracked',
      category: 'critical',
      severity_category: 'critical',
      specific_problem: 'pothole',
      source: 'Public Report',
      verification: 'Verified On-Site',
      photo_timestamp: '2026-01-01T00:00:00.000Z',
      user_id: 'user-1',
    });
  });

  it('marks an unnamed reporter as anonymous and omits user_id for signed-out users', () => {
    const payload = buildReportPayload({ ...base, fullName: '', userId: null });
    expect(payload.full_name).toBe('Anonymous');
    expect(payload.source).toBe('Anonymous Public Report');
    expect(payload).not.toHaveProperty('user_id');
  });

  it('stamps the photo time itself when the camera did not provide one', () => {
    const payload = buildReportPayload({ ...base, photoTs: null, now: new Date('2026-02-02T00:00:00.000Z') });
    expect(payload.photo_timestamp).toBe('2026-02-02T00:00:00.000Z');
  });
});

describe('makePhotoPath', () => {
  it('is unique per call and lives under reports/', () => {
    const a = makePhotoPath(1, () => 0.123456);
    const b = makePhotoPath(2, () => 0.654321);
    expect(a).toMatch(/^reports\/1_.+\.jpg$/);
    expect(a).not.toBe(b);
  });
});

describe('isNetworkFailure', () => {
  it('treats being offline or a failed fetch as a network problem', () => {
    expect(isNetworkFailure(new Error('x'), false)).toBe(true);
    expect(isNetworkFailure(new Error('TypeError: Failed to fetch'), true)).toBe(true);
  });

  it('does not queue genuine server rejections', () => {
    expect(isNetworkFailure(new Error('permission denied'), true)).toBe(false);
    expect(isNetworkFailure(null, true)).toBe(false);
  });
});

describe('friendlySubmitError', () => {
  it('points at the migration for a known outdated schema', () => {
    expect(friendlySubmitError({ message: "Could not find the 'category' column of 'public_reports'" })).toMatch(/supabase_fix_public_reports_schema/);
    expect(friendlySubmitError({ message: 'invalid input syntax for type integer: project_id' })).toMatch(/project_id/);
  });

  it('passes other messages through and has a fallback', () => {
    expect(friendlySubmitError({ message: 'row violates policy' })).toBe('row violates policy');
    expect(friendlySubmitError({})).toMatch(/try again/i);
  });
});
