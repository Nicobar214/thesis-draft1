/* publicReportTriage.js — automated credibility triage for citizen reports.
 *
 * Purpose: tell an admin, at a glance, whether a report is worth dispatching a
 * field engineer for. The dominant signal is how far the reported pin sits from
 * the actual project road.
 *
 * Distance is measured to the *nearest point on the route polyline*, not to the
 * route midpoint. On a 4km road a legitimate report at the far end is >2km from
 * the midpoint but ~0m from the road, so midpoint distance produces false
 * rejections. nearestPointOnRoute() is the only correct metric here.
 *
 * This module decides nothing on its own — it returns a recommendation. The
 * actual state change always goes through dismiss_public_report, which enforces
 * admin role and the legal state transitions.
 */

import { buildRoutePoints } from './mapRouteUtils';
import { nearestPointOnRoute, haversineMeters, toPoint } from '../components/publicReports/routeGeometry';

/* The submission form only offers projects within 250m (midpoint) / 150m
 * (endpoint), widening to 1km on explicit "wider search". A pin beyond that
 * radius cannot correspond to the project it was filed against. */
export const AUTO_REJECT_DISTANCE_M = 1000;
export const SUSPECT_DISTANCE_M = 500;
export const LOW_SCORE_THRESHOLD = 40;

export const TRIAGE = {
  REJECT: 'reject',
  REVIEW: 'review',
  PROCEED: 'proceed',
};

/* Mirrors the weighting used in the admin case file so the triage verdict and
 * the displayed credibility bar can never disagree. */
export function scoreCredibility({ accuracy, distanceMeters, isVerifiedUser, photoGpsMatch }) {
  let accuracyScore = 5;
  if (Number.isFinite(accuracy)) {
    if (accuracy <= 10) accuracyScore = 30;
    else if (accuracy <= 25) accuracyScore = 26;
    else if (accuracy <= 50) accuracyScore = 22;
    else if (accuracy <= 100) accuracyScore = 14;
    else accuracyScore = 8;
  }

  let distanceScore = 8;
  if (Number.isFinite(distanceMeters)) {
    if (distanceMeters <= 50) distanceScore = 35;
    else if (distanceMeters <= 200) distanceScore = 22;
    else if (distanceMeters <= SUSPECT_DISTANCE_M) distanceScore = 14;
    else distanceScore = 4;
  }

  const identityScore = isVerifiedUser ? 20 : 10;
  const photoMatchScore = photoGpsMatch ? 15 : 3;

  const score = Math.max(0, Math.min(100, accuracyScore + distanceScore + identityScore + photoMatchScore));
  if (score >= 70) return { score, label: 'High', tone: 'bg-emerald-500' };
  if (score >= LOW_SCORE_THRESHOLD) return { score, label: 'Medium', tone: 'bg-amber-500' };
  return { score, label: 'Low', tone: 'bg-red-500' };
}

export function formatTriageDistance(meters) {
  if (!Number.isFinite(meters)) return 'unknown distance';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Distance from the report pin to the project road.
 * Returns { meters, basis } where basis explains what we measured against, so
 * the UI can be honest about confidence.
 */
export function distanceToProjectRoute(report, project, routeRecord) {
  const reportPoint = toPoint(report?.latitude, report?.longitude);
  if (!reportPoint) return { meters: NaN, basis: 'no-report-gps' };
  if (!project && !routeRecord) return { meters: NaN, basis: 'no-project' };

  const { points, hasPolyline, startPoint } = buildRoutePoints(project, routeRecord);

  if (hasPolyline) {
    const nearest = nearestPointOnRoute(points, reportPoint);
    if (nearest && Number.isFinite(nearest.distanceMeters)) {
      return { meters: nearest.distanceMeters, basis: 'route-polyline' };
    }
  }

  if (startPoint) {
    const meters = haversineMeters(reportPoint, startPoint);
    if (Number.isFinite(meters)) return { meters, basis: 'project-start-point' };
  }

  return { meters: NaN, basis: 'no-route-geometry' };
}

/**
 * Full triage assessment for one report.
 *
 * `recommendation` is advisory. Auto-rejection is never applied to a report
 * whose distance we could not measure — missing route geometry is our data gap,
 * not the citizen's fault.
 */
export function assessReport({ report, project, routeRecord, photoGpsMatch = false }) {
  const { meters, basis } = distanceToProjectRoute(report, project, routeRecord);
  const credibility = scoreCredibility({
    accuracy: Number(report?.geo_accuracy),
    distanceMeters: meters,
    isVerifiedUser: Boolean(report?.user_id),
    photoGpsMatch,
  });

  const reasons = [];
  const measurable = Number.isFinite(meters);

  if (!measurable) {
    reasons.push(
      basis === 'no-report-gps'
        ? 'The report has no GPS coordinates.'
        : 'This project has no mapped route, so distance could not be verified.'
    );
  } else if (meters > AUTO_REJECT_DISTANCE_M) {
    reasons.push(`Reported ${formatTriageDistance(meters)} from the project road — beyond the 1 km maximum reporting range.`);
  } else if (meters > SUSPECT_DISTANCE_M) {
    reasons.push(`Reported ${formatTriageDistance(meters)} from the project road.`);
  }

  if (Number.isFinite(Number(report?.geo_accuracy)) && Number(report.geo_accuracy) > 100) {
    reasons.push(`Weak GPS signal when submitted (±${Math.round(Number(report.geo_accuracy))} m).`);
  }
  if (!report?.user_id) {
    reasons.push('Submitted anonymously, so the reporter cannot be contacted.');
  }

  let recommendation = TRIAGE.PROCEED;
  if (measurable && meters > AUTO_REJECT_DISTANCE_M) {
    recommendation = TRIAGE.REJECT;
  } else if (measurable && meters > SUSPECT_DISTANCE_M && credibility.score < LOW_SCORE_THRESHOLD) {
    recommendation = TRIAGE.REJECT;
  } else if (!measurable || meters > 200 || credibility.score < LOW_SCORE_THRESHOLD) {
    recommendation = TRIAGE.REVIEW;
  }

  /* Pre-written, specific, and auditable — this text lands in
   * public_reports.dismissal_reason and the immutable activity log. */
  const suggestedDismissalReason = measurable
    ? `Automated location check: the reported position is ${formatTriageDistance(meters)} from the ${report?.project_name || 'project'} road alignment, outside the 1 km reporting range. Closed as not matching this project.`
    : 'Automated location check could not verify this report against the project route.';

  return {
    distanceMeters: meters,
    distanceBasis: basis,
    distanceLabel: formatTriageDistance(meters),
    credibility,
    recommendation,
    reasons,
    suggestedDismissalReason,
    isAutoReject: recommendation === TRIAGE.REJECT,
  };
}

/* An admin can only close a report before the engineer workflow starts —
 * dismiss_public_report refuses once engineer_status is set or any inspection
 * record exists. Mirror that here so the UI never offers an action the RPC
 * will reject. */
export function canDismissReport(report) {
  const status = String(report?.status || '').toLowerCase();
  return ['pending', 'reviewed'].includes(status) && !report?.engineer_status;
}

/**
 * Next realistic inspection date. Priority was removed from the admin UI, so
 * this is driven by the engineer's live workload plus issue severity: safety
 * and flood hazards are queued ahead of cosmetic road wear.
 */
export function recommendInspectionDate(workloadCount = 0, severityCategory = null) {
  const urgent = ['safety', 'flood'].includes(String(severityCategory || '').toLowerCase());
  const daysOut = urgent ? 1 : Math.max(1, Math.min(Number(workloadCount) || 0, 5) + 1);
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

export function formatRecommendedDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
