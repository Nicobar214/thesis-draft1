// FMR road prioritization - a transparent weighted formula (no ML).

import { resolveCategory } from './publicReportStatus';
import { buildRoutePoints, normalizeRouteStatus, parsePointList } from './mapRouteUtils';
import { haversineMeters, nearestPointOnRoute, toPoint } from '../components/publicReports/routeGeometry';
import { findRouteOverlaps, OVERLAP_METERS } from './routeOverlap';

// Keyed by issue type (publicReportStatus.js); old rows are mapped onto these.
const SEVERITY_WEIGHTS = {
  structural: 1.0,
  obstruction: 0.9,
  road_damage: 0.6,
  roadside: 0.4,
};

// Municipality-level crop scores used ONLY by the LGU proposal triage below
// (computeProposalPriorityScores). FMR prioritization uses the real farmer
// registry instead (topCommoditiesByMunicipality).
const SIMULATED_CROP_DATA = {
  "pototan": { score: 88, primary_crop: "Sugarcane", hectares: 4200 },
  "barotac viejo": { score: 82, primary_crop: "Rice", hectares: 3800 },
  "barotac nuevo": { score: 79, primary_crop: "Rice", hectares: 3500 },
  "dingle": { score: 75, primary_crop: "Corn", hectares: 2900 },
  "duenas": { score: 72, primary_crop: "Sugarcane", hectares: 2700 },
  "passi": { score: 70, primary_crop: "Sugarcane", hectares: 5100 },
  "leon": { score: 68, primary_crop: "Rice", hectares: 2400 },
  "cabatuan": { score: 66, primary_crop: "Rice", hectares: 2200 },
  "maasin": { score: 63, primary_crop: "Vegetables", hectares: 1800 },
  "calinog": { score: 60, primary_crop: "Sugarcane", hectares: 3100 },
  "lambunao": { score: 58, primary_crop: "Corn", hectares: 2600 },
  "janiuay": { score: 55, primary_crop: "Rice", hectares: 2100 },
  "guimbal": { score: 52, primary_crop: "Rice", hectares: 1600 },
  "tubungan": { score: 50, primary_crop: "Vegetables", hectares: 1400 },
  "igbaras": { score: 48, primary_crop: "Corn", hectares: 1700 },
  "miagao": { score: 45, primary_crop: "Rice", hectares: 1900 },
  "san joaquin": { score: 43, primary_crop: "Rice", hectares: 1500 },
  "tigbauan": { score: 42, primary_crop: "Vegetables", hectares: 1300 },
  "alimodian": { score: 40, primary_crop: "Corn", hectares: 1100 },
  "new lucena": { score: 38, primary_crop: "Rice", hectares: 900 },
};

export function getCropData(municipality = '') {
  const key = String(municipality).trim().toLowerCase();
  return SIMULATED_CROP_DATA[key] ?? { score: 40, primary_crop: "Mixed", hectares: 0 };
}

export function classifyReportSeverity(reportOrDescription = '') {
  if (typeof reportOrDescription === 'object' && reportOrDescription !== null) {
    return resolveCategory(reportOrDescription);
  }
  return resolveCategory({ description: reportOrDescription });
}

function getRecencyMultiplier(createdAt) {
  if (!createdAt) return 0.2;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1.0;
  if (ageDays <= 90) return 0.5;
  return 0.2;
}

// Shared score/rank/factor-bar tone helpers -- used by PriorityTab.jsx (real
// projects) and the LGU proposal priority view below, so both look consistent.
export function scoreTone(score) {
  if (score >= 70) return 'text-red-600';
  if (score >= 40) return 'text-amber-600';
  return 'text-emerald-600';
}

export function rankTone(rank) {
  if (rank === 1) return 'bg-amber-100 text-amber-800 border border-amber-300';
  if (rank === 2) return 'bg-slate-200 text-slate-700 border border-slate-300';
  if (rank === 3) return 'bg-orange-100 text-orange-700 border border-orange-300';
  return 'bg-slate-100 text-slate-600 border border-slate-200';
}

export function factorBarTone(key) {
  if (key === 'U' || key === 'G') return 'bg-blue-500';
  if (key === 'B' || key === 'R') return 'bg-red-500';
  if (key === 'M') return 'bg-emerald-500';
  if (key === 'F') return 'bg-violet-500';
  return 'bg-amber-500';
}

// ---------------------------------------------------------------------------
// FMR prioritization: one module, five criteria, two groups
// ---------------------------------------------------------------------------
//
// Candidates are ranked in two groups that are never mixed:
//   - New road suggestions: the surveyed unpaved gaps (road_network_gaps)
//   - Ongoing projects:     FMR projects still being built (status On-Going)
// Completed and proposed projects are not candidates.
//
// Every distance is measured to the nearest point on the candidate's line
// (nearestPointOnRoute), the same rule used for report locations elsewhere.

/** Published weights (sum to 1). */
export const PRIORITY_WEIGHTS = { G: 0.25, M: 0.20, R: 0.20, C: 0.20, F: 0.15 };

/** One definition of the criteria, used by the scorer, the UI and the write-up. */
export const PRIORITY_CRITERIA = [
  { key: 'G', label: 'Gap length' },
  { key: 'M', label: 'Market access' },
  { key: 'R', label: 'Citizen reports' },
  { key: 'C', label: 'Top commodities' },
  { key: 'F', label: 'Farmer density' },
];

export const REPORT_RADIUS_M = 500;    // citizen reports counted around the road
export const FARMER_RADIUS_M = 2000;   // farms counted as served by the road
export const TOP_COMMODITY_COUNT = 5;  // the municipality's top crops that count
/** A gap whose length is this much on an existing project's road already has
 * a project: it leaves the New group. Lower would hide real gaps that only meet
 * a project where they join the network; higher would keep gaps whose project
 * was simply drawn a little differently. */
export const COVERED_SHARE = 0.6;
const NEUTRAL = 50;                     // a criterion with no data sits mid-range
const MIN_LENGTH_KM = 0.5;              // floor for "per km" so short roads don't explode

/**
 * Market-access direction. true: a road NEARER the market scores higher (it
 * carries produce from more of the network to the consolidation point).
 * false: FARTHER scores higher (remoteness is the access problem). The one
 * judgement call in the formula, kept as a named switch.
 */
export const MARKET_PROXIMITY_SCORES_HIGHER = true;

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const farmerPoint = (f) => toPoint(
  f.farm_latitude ?? f.farmLatitude ?? f.gps?.lat,
  f.farm_longitude ?? f.farmLongitude ?? f.gps?.lng,
);
const farmerArea = (f) => Math.max(num(f.farm_area_ha ?? f.farmAreaHa) || 0, 0.5);
const farmerCrop = (f) => String(f.crop || '').trim();
const farmerMunicipality = (f) => String(f.municipality || '').trim().toLowerCase();

function lineLengthKm(points) {
  let m = 0;
  for (let i = 1; i < points.length; i += 1) m += haversineMeters(points[i - 1], points[i]);
  return m / 1000;
}

function distanceToLine(points, point) {
  if (!point || points.length === 0) return Infinity;
  if (points.length === 1) return haversineMeters(points[0], point);
  return nearestPointOnRoute(points, point)?.distanceMeters ?? Infinity;
}

/**
 * Each municipality's top crops by number of registered farmers (the LGU's
 * farmer registry), rank 1 = most farmers. Same counting as the LGU commodity
 * breakdown (one main crop per farmer).
 */
export function topCommoditiesByMunicipality(farmers, count = TOP_COMMODITY_COUNT) {
  const byMuni = new Map();
  (farmers || []).forEach((f) => {
    const crop = farmerCrop(f);
    if (!crop) return;
    const muni = farmerMunicipality(f);
    if (!byMuni.has(muni)) byMuni.set(muni, new Map());
    const counts = byMuni.get(muni);
    counts.set(crop, (counts.get(crop) || 0) + 1);
  });
  const out = {};
  byMuni.forEach((counts, muni) => {
    out[muni] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, count)
      .map(([crop, farmers], i) => ({ crop, farmers, rank: i + 1 }));
  });
  return out;
}

// Reports that should not count as evidence of a problem on this road.
function reportCounts(report) {
  const status = String(report.status || '').toLowerCase();
  if (status === 'dismissed') return false;
  if (report.verification === 'Location Mismatch') return false;
  return Boolean(toPoint(report.latitude, report.longitude));
}

/** Gaps and ongoing projects as candidates with a line to measure against. */
function buildCandidates({ gaps, projects, routesByProjectId }) {
  const newRoads = (gaps || []).map((gap) => {
    let points = parsePointList(gap.gap_points);
    if (points.length < 2) {
      points = [toPoint(gap.start_latitude, gap.start_longitude), toPoint(gap.end_latitude, gap.end_longitude)].filter(Boolean);
    }
    return {
      kind: 'gap',
      id: gap.id,
      gap,
      title: gap.source_road_name || gap.gap_code || 'Road network gap',
      municipality: gap.municipality || 'Leon',
      points,
      lengthKm: num(gap.gap_km),
      marketKm: num(gap.market_distance_km),
    };
  });

  const ongoing = (projects || [])
    .filter((p) => normalizeRouteStatus(p.status) === 'On-Going')
    .map((project) => {
      const points = buildRoutePoints(project, routesByProjectId?.[project.id] || null).points;
      const totalKm = num(project.project_length_km) || (points.length >= 2 ? lineLengthKm(points) : NaN);
      const done = Math.min(100, Math.max(0, num(project.accomplishment) || 0));
      return {
        kind: 'project',
        id: project.id,
        project,
        title: project.project_name,
        municipality: project.municipality || 'Leon',
        points,
        totalKm,
        accomplishment: done,
        // What is still to be built.
        lengthKm: Number.isFinite(totalKm) ? totalKm * (1 - done / 100) : NaN,
        marketKm: NaN, // measured below from market_locations
      };
    });

  return { newRoads, ongoing };
}

/** Raw (un-normalized) values of the five criteria for one candidate. */
function measure(candidate, { reports, farmers, markets, topCommodities }) {
  const { points } = candidate;
  const hasLine = points.length > 0;

  // M: road distance to market for gaps (surveyed); straight distance to the
  // nearest market point for ongoing projects.
  let marketKm = candidate.marketKm;
  if (!Number.isFinite(marketKm) && hasLine && markets?.length) {
    const nearest = Math.min(...markets.map((m) => distanceToLine(points, toPoint(m.latitude, m.longitude))));
    if (Number.isFinite(nearest)) marketKm = nearest / 1000;
  }

  // R: citizen reports near the road, weighted by issue type and recency.
  let reportWeight = 0;
  let reportCount = 0;
  const bySeverity = { structural: 0, obstruction: 0, road_damage: 0, roadside: 0 };
  if (hasLine) {
    (reports || []).filter(reportCounts).forEach((r) => {
      if (distanceToLine(points, toPoint(r.latitude, r.longitude)) > REPORT_RADIUS_M) return;
      const type = classifyReportSeverity(r);
      bySeverity[type] = (bySeverity[type] || 0) + 1;
      reportWeight += (SEVERITY_WEIGHTS[type] ?? 0.5) * getRecencyMultiplier(r.created_at);
      reportCount += 1;
    });
  }

  // C and F: registered farms within reach of the road.
  const top = topCommodities[String(candidate.municipality).trim().toLowerCase()] || [];
  const rankOf = new Map(top.map((t) => [t.crop, t.rank]));
  let commodityWeight = 0;
  let farmersNear = 0;
  let topCropFarmers = 0;
  if (hasLine) {
    (farmers || []).forEach((f) => {
      if (distanceToLine(points, farmerPoint(f)) > FARMER_RADIUS_M) return;
      farmersNear += 1;
      const rank = rankOf.get(farmerCrop(f));
      if (rank) {
        topCropFarmers += 1;
        commodityWeight += (TOP_COMMODITY_COUNT + 1 - rank) * farmerArea(f);
      }
    });
  }
  const lengthForDensity = Math.max(
    Number.isFinite(candidate.totalKm) ? candidate.totalKm : (Number.isFinite(candidate.lengthKm) ? candidate.lengthKm : (hasLine ? lineLengthKm(points) : 0)),
    MIN_LENGTH_KM,
  );

  // No farmer registry for this municipality yet: "no data", not "no farmers".
  const hasRegistry = top.length > 0;

  return {
    hasLine,
    hasRegistry,
    marketKm: Number.isFinite(marketKm) ? marketKm : null,
    reportCount,
    reportWeight,
    bySeverity,
    farmersNear,
    topCropFarmers,
    commodityWeight,
    farmerDensity: hasLine && hasRegistry ? farmersNear / lengthForDensity : null,
    topCrops: top.map((t) => t.crop),
  };
}

const pctOfMax = (value, max) => (max > 0 ? (value / max) * 100 : 0);
const distinctCount = (values) => new Set(values.filter(Number.isFinite).map((v) => v.toFixed(4))).size;

function shortCrops(crops) {
  return crops.slice(0, 2).map((c) => c.replace(/\s*\(.*\)$/, '').toLowerCase()).join('/');
}

function buildReason(row, rank) {
  const parts = [];
  if (Number.isFinite(row.lengthKm)) {
    parts.push(row.kind === 'gap' ? `${row.lengthKm.toFixed(2)} km unpaved` : `${row.lengthKm.toFixed(2)} km still to build`);
  }
  if (row.marketKm != null) parts.push(`${row.marketKm.toFixed(1)} km to market`);
  parts.push(`${row.reportCount} citizen report${row.reportCount === 1 ? '' : 's'} nearby`);
  if (row.topCropFarmers > 0) parts.push(`${row.topCropFarmers} ${shortCrops(row.topCrops)} farmers within ${FARMER_RADIUS_M / 1000} km`);
  else parts.push(`${row.farmersNear} registered farmers within ${FARMER_RADIUS_M / 1000} km`);
  return `Rank #${rank} — ${parts.join(', ')}.`;
}

/** Normalize the five criteria within one group, score, rank. */
function scoreGroup(rows) {
  const max = (pick) => Math.max(0, ...rows.map(pick).filter(Number.isFinite));
  const maxLen = max((r) => r.lengthKm);
  const maxMarket = max((r) => (r.marketKm == null ? NaN : r.marketKm));
  const maxReports = max((r) => r.reportWeight);
  const maxCommodity = max((r) => (r.hasLine && r.hasRegistry ? r.commodityWeight : NaN));
  const maxDensity = max((r) => (r.farmerDensity == null ? NaN : r.farmerDensity));

  const scored = rows.map((r) => {
    const G = Number.isFinite(r.lengthKm) ? pctOfMax(r.lengthKm, maxLen) : NEUTRAL;
    let M = NEUTRAL;
    if (r.marketKm != null && maxMarket > 0) {
      const proximity = 1 - Math.min(1, r.marketKm / maxMarket);
      M = (MARKET_PROXIMITY_SCORES_HIGHER ? proximity : 1 - proximity) * 100;
    }
    const R = r.hasLine ? pctOfMax(r.reportWeight, maxReports) : NEUTRAL;
    const C = r.hasLine && r.hasRegistry ? pctOfMax(r.commodityWeight, maxCommodity) : NEUTRAL;
    const F = r.farmerDensity != null ? pctOfMax(r.farmerDensity, maxDensity) : NEUTRAL;
    const score = G * PRIORITY_WEIGHTS.G + M * PRIORITY_WEIGHTS.M + R * PRIORITY_WEIGHTS.R
      + C * PRIORITY_WEIGHTS.C + F * PRIORITY_WEIGHTS.F;
    return {
      ...r,
      score: Math.round(score),
      G: Math.round(G), M: Math.round(M), R: Math.round(R), C: Math.round(C), F: Math.round(F),
    };
  });

  // A criterion with one value across the group cannot change the order,
  // whatever its weight: say so instead of letting it hide.
  if (scored.length > 1) {
    const inert = PRIORITY_CRITERIA.map((c) => c.key).filter((k) => distinctCount(scored.map((r) => r[k])) < 2);
    if (inert.length) {
      console.warn(`[priorityScoring] ${inert.join(', ')} constant across ${scored.length} candidates; their weight has no effect on this group's order.`);
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .map((r, i) => ({ ...r, rank: i + 1, reason: buildReason(r, i + 1) }));
}

function boundsOf(points, padM) {
  const pad = padM / 111320;
  let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
  points.forEach(([lat, lng]) => {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  });
  return { minLat: minLat - pad, maxLat: maxLat + pad, minLng: minLng - pad, maxLng: maxLng + pad };
}
const boxesMeet = (a, b) => a.minLat <= b.maxLat && b.minLat <= a.maxLat && a.minLng <= b.maxLng && b.minLng <= a.maxLng;

/**
 * Gaps that an FMR project already covers (COVERED_SHARE of the gap's length
 * runs on the project's road), whatever screen created that project.
 * Returns Map gapId -> { id, name, share }.
 */
export function coveredGaps(gapCandidates, projects, routesByProjectId) {
  const lines = (projects || [])
    .filter((p) => !/cancel/i.test(String(p.status || '')))
    .map((p) => {
      const line = buildRoutePoints(p, routesByProjectId?.[p.id] || null).points;
      return line.length >= 2 ? { id: p.id, name: p.project_name, line, box: boundsOf(line, OVERLAP_METERS) } : null;
    })
    .filter(Boolean);
  const out = new Map();
  gapCandidates.forEach((c) => {
    if (c.points.length < 2) return;
    const box = boundsOf(c.points, OVERLAP_METERS);
    const nearby = lines.filter((l) => boxesMeet(box, l.box));
    if (!nearby.length) return;
    const best = findRouteOverlaps(c.points, nearby).overlaps[0];
    if (best && best.share >= COVERED_SHARE) out.set(String(c.id), best);
  });
  return out;
}

/**
 * Rank both groups.
 * @returns {{ newRoads: Row[], ongoing: Row[], covered: Object[], topCommodities: Object }}
 * Row: { kind: 'gap'|'project', id, gap?, project, title, municipality, points,
 *        score, rank, reason, G, M, R, C, F, lengthKm, marketKm, reportCount,
 *        bySeverity, farmersNear, topCropFarmers, accomplishment? }
 */
export function computePriority({ gaps = [], projects = [], routesByProjectId = {}, reports = [], farmers = [], markets = [], excludeGapIds = [] } = {}) {
  const topCommodities = topCommoditiesByMunicipality(farmers);
  const ctx = { reports, farmers, markets, topCommodities };
  const skip = new Set(excludeGapIds.map(String));
  const { newRoads, ongoing } = buildCandidates({ gaps, projects, routesByProjectId });
  // A road that already has a project is not a new suggestion any more.
  const covered = coveredGaps(newRoads.filter((c) => !skip.has(String(c.id))), projects, routesByProjectId);

  const withMeasures = (list) => list.map((c) => {
    const m = measure(c, ctx);
    // Keep the shape the cards use: a `project` to open, even for a gap.
    const project = c.project || {
      id: c.gap?.from_project_id ?? null,
      project_name: c.title,
      municipality: c.municipality,
      barangay: c.gap?.barangay,
      barangay_end: c.gap?.barangay_end,
    };
    return { ...c, ...m, project };
  });

  return {
    newRoads: scoreGroup(withMeasures(newRoads.filter((c) => !skip.has(String(c.id)) && !covered.has(String(c.id))))),
    ongoing: scoreGroup(withMeasures(ongoing)),
    // Shown under the New list so it is clear why these gaps are not ranked.
    covered: newRoads
      .filter((c) => covered.has(String(c.id)))
      .map((c) => ({ id: c.id, gap: c.gap, title: c.title, coveredBy: covered.get(String(c.id)) })),
    topCommodities,
  };
}

// ---------------------------------------------------------------------------
// LGU proposal triage (LguProposalsTab), separate from the module above
// ---------------------------------------------------------------------------

function proposalPendingDays(proposal) {
  const submitted = new Date(proposal.submitted_at);
  if (Number.isNaN(submitted.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - submitted.getTime()) / 86400000));
}

function buildProposalPriorityReason(proposal, pendingDays, beneficiaryTotal, cropData, rank) {
  const parts = [`pending ${pendingDays} day${pendingDays === 1 ? '' : 's'}`];
  if (beneficiaryTotal > 0) parts.push(`serves ${beneficiaryTotal} beneficiaries`);
  if (cropData.score >= 70) parts.push(`high-value ${cropData.primary_crop} area (${cropData.hectares.toLocaleString()} ha)`);
  else if (cropData.score >= 50) parts.push(`moderate crop area (${cropData.primary_crop})`);
  return `Rank #${rank} — ${proposal.municipality || 'area'}: ${parts.join(', ')}.`;
}

/**
 * Priority scoring for LGU project proposals still awaiting DA action.
 * Only proposals in 'Submitted' / 'Under Validation' status are scored/ranked
 * -- decided proposals (Approved/Rejected/Needs Revision) aren't triage
 * candidates and come back with score/rank set to null.
 *
 * Factors (normalized 0-100 within the pending batch):
 *  - U (Urgency / days pending)      40% -- how long DA has sat on it
 *  - B (Beneficiary reach)           35% -- farmers + households claimed served
 *  - C (Crop value, via getCropData) 25% -- same signal/weight as project scoring
 */
export function computeProposalPriorityScores(proposals) {
  const safe = Array.isArray(proposals) ? proposals : [];

  const raw = safe.map((proposal) => {
    const isPending = proposal.status === 'Submitted' || proposal.status === 'Under Validation';
    const pendingDays = isPending ? proposalPendingDays(proposal) : 0;
    const beneficiaryTotal = (Number(proposal.beneficiary_farmers_count) || 0)
      + (Number(proposal.beneficiary_households_count) || 0);
    const cropData = getCropData(proposal.municipality);
    return { proposal, isPending, pendingDays, beneficiaryTotal, cropData };
  });

  const pendingRaw = raw.filter((r) => r.isPending);
  const maxPendingDays = Math.max(...pendingRaw.map((r) => r.pendingDays), 1);
  const maxBeneficiaries = Math.max(...pendingRaw.map((r) => r.beneficiaryTotal), 1);

  const scoredPending = pendingRaw.map((r) => {
    const U = (r.pendingDays / maxPendingDays) * 100;
    const B = (r.beneficiaryTotal / maxBeneficiaries) * 100;
    const C = r.cropData.score;
    const score = Math.round(U * 0.4 + B * 0.35 + C * 0.25);
    return { ...r, score, U: Math.round(U), B: Math.round(B), C: Math.round(C) };
  });

  const ranked = scoredPending
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      reason: buildProposalPriorityReason(r.proposal, r.pendingDays, r.beneficiaryTotal, r.cropData, i + 1),
    }));

  const rankedById = new Map(ranked.map((r) => [r.proposal.id, r]));
  return raw.map((r) => rankedById.get(r.proposal.id) || { ...r, score: null, rank: null, reason: null, U: null, B: null, C: null });
}
