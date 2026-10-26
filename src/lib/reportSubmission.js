/**
 * The rules behind the public report form, kept out of the component so they can be
 * tested on their own: how close is "nearby", whether a GPS fix counts as on-site,
 * what makes a submission valid, and exactly what gets sent to the database.
 */
import { SEVERITY_TAXONOMY } from './publicReportStatus';
import { distanceToProjectRoute, locationVerdict, VERIFICATION } from './publicReportTriage';
import { nearestPointOnPolyline } from './mapRouteUtils';

export const REGION = 'Region VI – Western Visayas';
export const PROVINCE = 'Iloilo';
export const RADIUS_MIDPOINT = 250; // metres - midpoint check
export const RADIUS_ENDPOINT = 150; // metres - start / end point check
export const RADIUS_WIDER = 1000;   // metres - "wider search" fallback

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function projectMidpoint(p) {
  if (!p.start_latitude || !p.end_latitude) return null;
  return {
    lat: (p.start_latitude + p.end_latitude) / 2,
    lng: (p.start_longitude + p.end_longitude) / 2,
  };
}

export function isProjectNearby(userLat, userLng, p, midR = RADIUS_MIDPOINT, endR = RADIUS_ENDPOINT) {
  if (!p.start_latitude) return false;
  const mid = projectMidpoint(p);
  const nearMid = mid && haversineMeters(userLat, userLng, mid.lat, mid.lng) <= midR;
  const nearStart = haversineMeters(userLat, userLng, p.start_latitude, p.start_longitude) <= endR;
  const nearEnd = p.end_latitude &&
    haversineMeters(userLat, userLng, p.end_latitude, p.end_longitude) <= endR;
  return !!(nearMid || nearStart || nearEnd);
}

export function distToProject(userLat, userLng, p) {
  const mid = projectMidpoint(p);
  if (mid) return haversineMeters(userLat, userLng, mid.lat, mid.lng);
  if (p.start_latitude) return haversineMeters(userLat, userLng, p.start_latitude, p.start_longitude);
  return Infinity;
}

export function fmtDist(m) {
  return m < 1000 ? `~${Math.round(m)}m away` : `~${(m / 1000).toFixed(1)}km away`;
}

/** Projects within reach of the user's position, nearest first. */
export function findNearbyProjects(projects, gps, wider = false) {
  const midR = wider ? RADIUS_WIDER : RADIUS_MIDPOINT;
  const endR = wider ? RADIUS_WIDER : RADIUS_ENDPOINT;
  return projects
    .filter((p) => isProjectNearby(gps.lat, gps.lng, p, midR, endR))
    .sort((a, b) => distToProject(gps.lat, gps.lng, a) - distToProject(gps.lat, gps.lng, b));
}

/* Map-first picking and directions (reportForm/NearbyProjectsMap, NavigateStep).
 * Distances here are to the road LINE (its mapped route, or start-to-end), so a
 * long road passing right beside the reporter counts as near. */
export const ARRIVAL_M = 150;          // metres - "you've arrived" at the picked road
export const ARRIVAL_ACCURACY_CAP_M = 100; // a rough fix gets at most this much benefit of the doubt

/** Metres from the GPS fix to the nearest point of a road line ([[lat, lng]]). */
export function distanceToLine(gps, points) {
  if (!gps || !Array.isArray(points) || points.length === 0) return Infinity;
  const hit = nearestPointOnPolyline([gps.lat, gps.lng], points);
  return hit ? hit.distanceMeters : Infinity;
}

/**
 * Road lines near the reporter, nearest first: [{ project, points, distance, point }],
 * `point` being the closest spot on the road ([lat, lng]).
 * `lines` is [{ project, points }] for every project with a drawable line.
 */
export function findNearbyRoads(lines, gps, wider = false) {
  if (!gps) return [];
  const radius = wider ? RADIUS_WIDER : RADIUS_MIDPOINT;
  return (lines || [])
    .map((line) => {
      const hit = nearestPointOnPolyline([gps.lat, gps.lng], line.points);
      return hit ? { ...line, distance: hit.distanceMeters, point: hit.point } : null;
    })
    // A rough fix gets the same capped benefit of the doubt as arrival.
    .filter((line) => line && line.distance - accuracySlack(gps.accuracy) <= radius)
    .sort((a, b) => a.distance - b.distance);
}

function accuracySlack(accuracy) {
  return Math.min(Math.max(Number(accuracy) || 0, 0), ARRIVAL_ACCURACY_CAP_M);
}

/** Has the reporter reached the road? GPS accuracy (capped) counts in their favour. */
export function hasArrived(distanceM, accuracy) {
  if (!Number.isFinite(distanceM)) return false;
  return distanceM - accuracySlack(accuracy) <= ARRIVAL_M;
}

/** Every project, nearest first (the "browse all" list). */
export function sortProjectsByDistance(projects, gps) {
  return [...projects].sort((a, b) => distToProject(gps.lat, gps.lng, a) - distToProject(gps.lat, gps.lng, b));
}

/**
 * Does the GPS fix back up that the reporter is actually at the project?
 * Measured to the nearest point on the road (its mapped route when there is
 * one), not to its start point: on a long road a reporter standing on it can
 * be far from where it starts.
 */
export function computeVerification(gps, project, routeRecord = null) {
  if (!gps || !project) return VERIFICATION.REVIEW;
  const { meters } = distanceToProjectRoute({ latitude: gps.lat, longitude: gps.lng }, project, routeRecord);
  return locationVerdict({ meters, accuracy: gps.accuracy });
}

/* TEMPORARY (testing): lets a report be sent from up to this many metres from
 * the road, so it can be tested away from the actual roads. Matches
 * _report_location_max_m() in supabase_report_location_required.sql. Set to
 * null to go back to the real rule (at the road, ARRIVAL_M). The automatic
 * "you've arrived" opening is not changed by this. */
export const REPORT_LOCATION_TEST_LIMIT_M = 50000;

/** May a report be sent from here? At the road (hasArrived), or within the test limit. */
export function canReportFrom(distanceM, accuracy) {
  if (hasArrived(distanceM, accuracy)) return true;
  return REPORT_LOCATION_TEST_LIMIT_M != null && Number.isFinite(distanceM) && distanceM <= REPORT_LOCATION_TEST_LIMIT_M;
}

/**
 * Why the reporter may not report on this road from where they are, or null.
 * A report can only be made at the road: the same rule as "you've arrived"
 * (hasArrived), measured to the same line the directions use. The database
 * refuses anything over 1 km from the road as well (supabase_report_location_required.sql).
 */
export function reportLocationProblem(gps, roadPoints) {
  if (!gps) return 'Your location is needed to send a report. Turn on location and try again.';
  if (!Array.isArray(roadPoints) || roadPoints.length < 2) return 'This road has no location on the map yet, so a report on it cannot be checked. Please pick another road.';
  const distance = distanceToLine(gps, roadPoints);
  if (canReportFrom(distance, gps.accuracy)) return null;
  const away = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
  return `You are about ${away} from this road. Reports can only be sent from the road itself (within ${ARRIVAL_M} m), so go to the road first.`;
}

/** The first problem that blocks submission, or null when the report is complete. */
export function validateReportInput({ severityCategory, specificProblem, description, photoBlob, selProject, gps, roadPoints }) {
  if (!severityCategory || !specificProblem) return 'Please classify the report before submitting.';
  if (!String(description || '').trim()) return 'Please enter a description.';
  if (!photoBlob) return 'A site photo is required.';
  if (!selProject) return 'No project selected.';
  if (!gps) return 'GPS coordinates are required.';
  return reportLocationProblem(gps, roadPoints);
}

/**
 * The row stored in public_reports (minus photo_url, which is added after upload).
 * One builder for the online and offline paths so they can never drift apart.
 */
// New issue type -> closest value the old `category` column accepts.
const LEGACY_CATEGORY = { road_damage: 'issue', structural: 'issue', obstruction: 'safety', roadside: 'general' };

export function buildReportPayload({
  fullName, contact, selProject, gps, photoTs, description,
  severityCategory, category, specificProblem, userId, routeRecord = null, now = new Date(),
}) {
  const name = String(fullName || '').trim();
  const payload = {
    full_name: name || 'Anonymous',
    contact_info: String(contact || '').trim(),
    region: REGION,
    province: PROVINCE,
    municipality: selProject.municipality || '',
    barangay: selProject.location || '',
    street: '',
    project_id: `fmr-${selProject.id}`,
    project_name: selProject.project_name,
    latitude: gps.lat,
    longitude: gps.lng,
    geo_accuracy: gps.accuracy,
    photo_timestamp: photoTs || now.toISOString(),
    verification: computeVerification(gps, selProject, routeRecord),
    description: String(description || '').trim(),
    // The old column only allows the old 4 values until supabase_report_handlers.sql runs.
    category: LEGACY_CATEGORY[severityCategory] || LEGACY_CATEGORY[category] || category,
    severity_category: severityCategory || null,
    specific_problem: specificProblem || null,
    source: name ? 'Public Report' : 'Anonymous Public Report',
  };
  if (userId) payload.user_id = userId;
  return payload;
}

export function makePhotoPath(now = Date.now(), random = Math.random) {
  return `reports/${now}_${random().toString(36).slice(2)}.jpg`;
}

/** A failure that means "no connection", so the report should be queued instead of lost. */
export function isNetworkFailure(err, online = true) {
  return !online || Boolean(err?.message?.toLowerCase().includes('failed to fetch'));
}

/** Turn a submit error into something a person (or an admin) can act on. */
export function friendlySubmitError(err) {
  const message = err?.message || '';
  if (message.includes('REPORT_TOO_FAR')) {
    return 'This report was not accepted: your location is too far from the road. Reports can only be sent from the road itself.';
  }
  if (message.includes("Could not find the 'category' column")) {
    return 'The database schema is outdated. Run supabase_fix_public_reports_schema.sql in Supabase SQL Editor, then submit again.';
  }
  if (message.toLowerCase().includes('project_id') && message.toLowerCase().includes('integer')) {
    return 'The database schema is outdated. Run supabase_fix_public_reports_schema.sql in Supabase SQL Editor to update public_reports.project_id, then submit again.';
  }
  return message || 'Something went wrong. Please try again.';
}

/**
 * The description printed on a report photo's stamp and shown on /verify/<code>:
 * what the problem is and which road it is on, e.g.
 * "Road report · Pothole · Brgy. Road 1, Leon". Only public project details;
 * never the reporter's name or contact.
 */
export function buildReportPhotoLabel({ severityCategory, specificProblem, selProject } = {}) {
  const category = SEVERITY_TAXONOMY[severityCategory];
  const problem = category?.problems?.find((item) => item.value === specificProblem)?.label || category?.label || '';
  const road = String(selProject?.project_name || '').trim();
  const town = String(selProject?.municipality || '').trim();
  const where = [road, town && town.toLowerCase() !== road.toLowerCase() ? town : ''].filter(Boolean).join(', ');
  return ['Road report', problem, where].filter(Boolean).join(' · ').slice(0, 200);
}
