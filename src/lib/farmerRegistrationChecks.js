/*
 * farmerRegistrationChecks.js — rules and suggestions before an LGU registers a farmer.
 *
 *   findDuplicateFarmer(form, registry, editingId)  the farmer is already registered
 *                                                  (blocks saving)
 *   registrationSuggestions({...})                 small things worth fixing first
 *                                                  (shown in the confirmation)
 *   projectsAlongRoute(route, projects)            every FMR road the farm-to-market
 *                                                  route actually runs along
 */
import { haversineMeters } from './reportSubmission';
import { nearestPointOnPolyline } from './mapRouteUtils';

const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^63/, '0');

/**
 * The registered farmer this form duplicates, or null. Same person when:
 *   - same first + last name (and extension, when both have one) and the same
 *     birthday, or, when a birthday is missing, the same barangay; or
 *   - the same contact number (10+ digits).
 * registry rows use the app's beneficiary shape (firstName, lastName, extName,
 * birthday, barangay, municipality, contactNumber, id).
 */
export function findDuplicateFarmer(form, registry = [], editingId = null) {
  const first = norm(form.firstName);
  const last = norm(form.lastName);
  const ext = norm(form.extName);
  const phone = digits(form.contactNumber);
  if (!first && !last && phone.length < 10) return null;

  for (const row of registry) {
    if (editingId && String(row.id) === String(editingId)) continue;
    if (phone.length >= 10 && digits(row.contactNumber) === phone) return { row, reason: 'contact' };
    if (!first || !last || norm(row.firstName) !== first || norm(row.lastName) !== last) continue;
    if (ext && norm(row.extName) && norm(row.extName) !== ext) continue; // Jr. vs Sr.
    if (form.birthday && row.birthday) {
      if (String(row.birthday).slice(0, 10) === String(form.birthday).slice(0, 10)) return { row, reason: 'name_birthday' };
      continue;
    }
    if (norm(row.barangay) === norm(form.barangay) && norm(row.municipality) === norm(form.municipality || row.municipality)) {
      return { row, reason: 'name_barangay' };
    }
  }
  return null;
}

/** Things worth fixing before registering; none of them blocks saving. */
export function registrationSuggestions({ form = {}, farmAccess = null, pinCheck = null, linkedProjectId = '', marketChosen = false, routeProjectCount = 0 } = {}) {
  const tips = [];
  if (!String(form.contactNumber || '').trim()) tips.push('Add a contact number so the LGU and DA can reach the farmer.');
  else if (digits(form.contactNumber).length < 11) tips.push('The contact number looks incomplete (11 digits, e.g. 09XXXXXXXXX).');
  if (!form.birthday) tips.push('Add the birthday; it helps avoid registering the same farmer twice.');
  const area = Number(form.farmAreaHa);
  if (area > 0 && area < 0.05) tips.push(`Farm area is only ${area} ha. Check it is in hectares, not square meters.`);
  if (area > 50) tips.push(`Farm area is ${area} ha, unusually large for one farmer. Check the figure.`);
  if (!linkedProjectId) tips.push('No FMR road is linked to this farmer.');
  if (!marketChosen) tips.push('The nearest market will be saved. Choose one if the farmer sells elsewhere.');
  if (pinCheck?.nearBorder) tips.push('The pin is right at the barangay boundary. Confirm the farm is in the chosen barangay.');
  if (farmAccess?.crossesWater) tips.push('Every mapped road near the farm is across water. Confirm how the harvest crosses.');
  else if (farmAccess?.carryMeters > 1000) tips.push(`The harvest is carried about ${(farmAccess.carryMeters / 1000).toFixed(1)} km to the nearest vehicle road.`);
  if (linkedProjectId && routeProjectCount === 0) tips.push('The route to the market could not be matched to any FMR road yet.');
  return tips;
}

/**
 * FMR projects the route runs along, in route order. A project counts when at
 * least `minMeters` of the route lies within `toleranceMeters` of its line.
 * projects: [{ id, name, line }]; route: [[lat, lng], ...].
 */
export function projectsAlongRoute(route, projects, { toleranceMeters = 40, minMeters = 150 } = {}) {
  const pts = (route || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (pts.length < 2) return [];
  const found = [];
  (projects || []).forEach((proj) => {
    if (!Array.isArray(proj.line) || proj.line.length < 2) return;
    const near = pts.map((p) => (nearestPointOnPolyline(p, proj.line)?.distanceMeters ?? Infinity) <= toleranceMeters);
    let overlap = 0;
    let firstIndex = -1;
    for (let i = 1; i < pts.length; i += 1) {
      if (near[i - 1] && near[i]) {
        overlap += haversineMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        if (firstIndex < 0) firstIndex = i - 1;
      }
    }
    if (overlap >= minMeters) found.push({ id: proj.id, name: proj.name, overlapMeters: Math.round(overlap), order: firstIndex });
  });
  return found.sort((a, b) => a.order - b.order);
}
