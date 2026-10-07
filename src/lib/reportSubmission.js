/**
 * The rules behind the public report form, kept out of the component so they can be
 * tested on their own: how close is "nearby", whether a GPS fix counts as on-site,
 * what makes a submission valid, and exactly what gets sent to the database.
 */

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

/** Every project, nearest first (the "browse all" list). */
export function sortProjectsByDistance(projects, gps) {
  return [...projects].sort((a, b) => distToProject(gps.lat, gps.lng, a) - distToProject(gps.lat, gps.lng, b));
}

/** Does the GPS fix back up that the reporter is actually at the project? */
export function computeVerification(userLat, userLng, accuracy, projLat, projLng) {
  if (!projLat || !projLng || !userLat) return 'Needs Review';
  const d = haversineMeters(userLat, userLng, projLat, projLng);
  if (d <= 100) return 'Verified On-Site';
  if (accuracy && accuracy > 50) return 'Needs Review';
  return 'Location Mismatch';
}

/** The first problem that blocks submission, or null when the report is complete. */
export function validateReportInput({ severityCategory, specificProblem, description, photoBlob, selProject, gps }) {
  if (!severityCategory || !specificProblem) return 'Please classify the report before submitting.';
  if (!String(description || '').trim()) return 'Please enter a description.';
  if (!photoBlob) return 'A site photo is required.';
  if (!selProject) return 'No project selected.';
  if (!gps) return 'GPS coordinates are required.';
  return null;
}

/**
 * The row stored in public_reports (minus photo_url, which is added after upload).
 * One builder for the online and offline paths so they can never drift apart.
 */
export function buildReportPayload({
  fullName, contact, selProject, gps, photoTs, description,
  severityCategory, category, specificProblem, userId, now = new Date(),
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
    verification: computeVerification(gps.lat, gps.lng, gps.accuracy, selProject.start_latitude, selProject.start_longitude),
    description: String(description || '').trim(),
    category: severityCategory || category,
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
  if (message.includes("Could not find the 'category' column")) {
    return 'The database schema is outdated. Run supabase_fix_public_reports_schema.sql in Supabase SQL Editor, then submit again.';
  }
  if (message.toLowerCase().includes('project_id') && message.toLowerCase().includes('integer')) {
    return 'The database schema is outdated. Run supabase_fix_public_reports_schema.sql in Supabase SQL Editor to update public_reports.project_id, then submit again.';
  }
  return message || 'Something went wrong. Please try again.';
}
