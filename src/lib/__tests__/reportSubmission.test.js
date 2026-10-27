import { describe, expect, it } from 'vitest';
import {
  buildReportPayload,
  ARRIVAL_M,
  buildReportPhotoLabel,
  computeVerification,
  distanceToLine,
  distToProject,
  findNearbyProjects,
  findNearbyRoads,
  isSuspectLine,
  distanceToLine,
  friendlySubmitError,
  fmtDist,
  hasArrived,
  haversineMeters,
  isNetworkFailure,
  isProjectNearby,
  makePhotoPath,
  sortProjectsByDistance,
  validateReportInput,
  REPORT_LOCATION_TEST_LIMIT_M,
} from '../reportSubmission';
import { SEVERITY_TAXONOMY } from '../publicReportStatus';

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
  const project = { start_latitude: 10, start_longitude: 122, end_latitude: 10.02, end_longitude: 122 };
  const along = { points: [[10, 122], [10.01, 122], [10.02, 122]] };
  const route = { route_points: along.points.map(([lat, lng]) => ({ lat, lng })) };

  it('is on site when the reporter stands on the road, even far from its start', () => {
    // ~1.1 km from the start point, but on the road itself
    expect(computeVerification({ lat: 10.01, lng: 122.0003, accuracy: 10 }, project, route)).toBe('Verified On-Site');
  });

  it('needs review when near but not on the road, or with a weak fix', () => {
    expect(computeVerification({ lat: 10.01, lng: 122.004, accuracy: 10 }, project, route)).toBe('Needs Review');
    expect(computeVerification({ lat: 10.01, lng: 122.0003, accuracy: 300 }, project, route)).toBe('Needs Review');
  });

  it('is a mismatch more than 1 km from the road', () => {
    expect(computeVerification({ lat: 10.01, lng: 122.02, accuracy: 10 }, project, route)).toBe('Location Mismatch');
  });

  it('needs review when the project has no location', () => {
    expect(computeVerification({ lat: 10, lng: 122, accuracy: 10 }, {}, null)).toBe('Needs Review');
  });
});

describe('validateReportInput', () => {
  const valid = {
    severityCategory: 'critical',
    specificProblem: 'pothole',
    description: 'Big hole',
    photoBlob: {},
    selProject: { id: 1 },
    gps: { lat: 10, lng: 122, accuracy: 8 },
    // A road running north from the reporter's position.
    roadPoints: [[10, 122], [10.005, 122]],
  };

  it('accepts a complete report made at the road', () => {
    expect(validateReportInput(valid)).toBeNull();
  });

  it('reports the first missing piece, in the order the form asks for it', () => {
    expect(validateReportInput({ ...valid, specificProblem: '' })).toMatch(/classify/i);
    expect(validateReportInput({ ...valid, description: '   ' })).toMatch(/description/i);
    expect(validateReportInput({ ...valid, photoBlob: null })).toMatch(/photo/i);
    expect(validateReportInput({ ...valid, selProject: null })).toMatch(/project/i);
    expect(validateReportInput({ ...valid, gps: null })).toMatch(/GPS/);
  });

  // While the TEMPORARY testing limit is on, reports from away are allowed up to it.
  it.runIf(REPORT_LOCATION_TEST_LIMIT_M != null)('testing mode: allows a report from away, up to the test limit', () => {
    expect(validateReportInput({ ...valid, gps: { lat: 10.002, lng: 122.01, accuracy: 8 } })).toBeNull();
    expect(validateReportInput({ ...valid, gps: { lat: 10.002, lng: 125, accuracy: 8 } })).toMatch(/from this road/);
  });

  it.runIf(REPORT_LOCATION_TEST_LIMIT_M == null)('refuses a report made away from the road', () => {
    // ~1.1 km east of the road.
    expect(validateReportInput({ ...valid, gps: { lat: 10.002, lng: 122.01, accuracy: 8 } })).toMatch(/1\.1 km from this road/);
    // 400 m off with a rough ±300 m fix: the benefit of the doubt is capped at 100 m.
    expect(validateReportInput({ ...valid, gps: { lat: 10.002, lng: 122.00365, accuracy: 300 } })).toMatch(/400 m from this road/);
  });

  it('allows a rough GPS fix its capped benefit of the doubt', () => {
    // ~220 m off, ±100 m: 220 - 100 <= 150.
    expect(validateReportInput({ ...valid, gps: { lat: 10.002, lng: 122.002, accuracy: 100 } })).toBeNull();
  });

  it('refuses a road with no line to check against', () => {
    expect(validateReportInput({ ...valid, roadPoints: undefined })).toMatch(/no location on the map/);
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
    severityCategory: 'road_damage',
    category: 'road_damage',
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
      // The old column gets the closest old value until the SQL widens it.
      category: 'issue',
      severity_category: 'road_damage',
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

describe('buildReportPhotoLabel', () => {
  const [cat, meta] = Object.entries(SEVERITY_TAXONOMY)[0];
  const problem = meta.problems[0];

  it('names the problem, the road and the town', () => {
    expect(buildReportPhotoLabel({ severityCategory: cat, specificProblem: problem.value, selProject: { project_name: 'Brgy. Road 1', municipality: 'Leon' } }))
      .toBe(`Road report · ${problem.label} · Brgy. Road 1, Leon`);
  });

  it('still reads well with details missing', () => {
    expect(buildReportPhotoLabel({})).toBe('Road report');
    expect(buildReportPhotoLabel({ selProject: { project_name: 'Leon', municipality: 'Leon' } })).toBe('Road report · Leon');
  });
});

describe('map-first picking: distance to the road line', () => {
  // A road running east, 0.01 deg (~1.1 km) long, at lat 10.
  const road = { project: { id: 1, project_name: 'Road' }, points: [[10, 122], [10, 122.01]] };
  const far = { project: { id: 2, project_name: 'Far road' }, points: [[10.05, 122], [10.05, 122.01]] };
  const north = (m) => m / 111320;

  it('counts a long road passing beside the reporter as near, even far from its middle', () => {
    const gps = { lat: 10 + north(40), lng: 122.0001, accuracy: 10 }; // 40 m off, near the start
    expect(distanceToLine(gps, road.points)).toBeGreaterThan(35);
    expect(distanceToLine(gps, road.points)).toBeLessThan(45);
    const [near] = findNearbyRoads([far, road], gps);
    expect(near.project.id).toBe(1);
    expect(near.point[0]).toBeCloseTo(10, 5); // the closest spot on the road, for the map badge
    expect(findNearbyRoads([far, road], gps)).toHaveLength(1);
  });

  it('widens to 1 km on request, nearest first', () => {
    const gps = { lat: 10 + north(600), lng: 122.005, accuracy: 10 };
    expect(findNearbyRoads([road], gps)).toHaveLength(0);
    expect(findNearbyRoads([far, road], gps, true).map((r) => r.project.id)).toEqual([1]);
  });

  it('arrives within ARRIVAL_M, giving a rough fix limited benefit of the doubt', () => {
    expect(hasArrived(ARRIVAL_M, 5)).toBe(true);
    expect(hasArrived(ARRIVAL_M + 80, 100)).toBe(true);
    expect(hasArrived(ARRIVAL_M + 80, 20)).toBe(false);
    expect(hasArrived(ARRIVAL_M + 500, 2000)).toBe(false); // a ±2 km Wi-Fi guess is not arrival
    expect(hasArrived(Infinity, 5)).toBe(false);
  });
});

describe('roads whose pins are wrong (much further apart than the road is long)', () => {
  // Like project 16: 0.72 km declared, pins ~11 km apart (north-south).
  const project = { id: 16, project_name: 'Brgy. Jamog FMR', project_length_km: 0.72 };
  const pins = [[10.755, 122.3555], [10.857, 122.352]];
  const midway = { lat: 10.806, lng: 122.354, accuracy: 8 }; // on the line, ~5 km from either pin

  it('is recognised, while a normal two-pin road is not', () => {
    expect(isSuspectLine(project, pins)).toBe(true);
    expect(isSuspectLine({ project_length_km: 0.9 }, [[10.75, 122.3], [10.757, 122.3]])).toBe(false);
    expect(isSuspectLine({ project_length_km: null }, pins)).toBe(false); // no declared length: cannot tell
  });

  it('counts as near only at its pins, not along the line between them', () => {
    const line = { project, points: pins, pinsOnly: true };
    expect(findNearbyRoads([line], midway)).toHaveLength(0);
    expect(findNearbyRoads([{ ...line, pinsOnly: false }], midway)).toHaveLength(1); // the old behaviour
    expect(findNearbyRoads([line], { lat: 10.7555, lng: 122.3555, accuracy: 8 })).toHaveLength(1); // at a pin
    expect(distanceToLine(midway, pins, true)).toBeGreaterThan(5000);
  });
});
