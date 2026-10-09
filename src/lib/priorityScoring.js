// FMR Road Priority Scoring - No ML required. Pure weighted formula.

const SEVERITY_WEIGHTS = {
  safety: 1.0,
  flood: 0.8,
  issue: 0.5,
  general: 0.2,
};

const ESCALATION_BONUS = 1.25; // Applied to severity raw sum if project has active escalation.

// Simulated crop data (replace with Supabase query when fmr_crop_data table is ready).
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
    if (reportOrDescription.severity_category) {
      return reportOrDescription.severity_category;
    }
    return classifyByKeywords(reportOrDescription.description || '');
  }
  return classifyByKeywords(reportOrDescription);
}

function classifyByKeywords(description = '') {
  const d = String(description).toLowerCase();
  if (/safety|aksidente|peligro|danger|hazard/.test(d)) return 'safety';
  if (/flood|baha|tubig|drainage|water|inundated/.test(d)) return 'flood';
  if (/lubak|sira|pothole|road|daan|crack|damage|broken/.test(d)) return 'issue';
  return 'general';
}

function getRecencyMultiplier(createdAt) {
  if (!createdAt) return 0.2;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1.0;
  if (ageDays <= 90) return 0.5;
  return 0.2;
}

export function buildPlainReason(project, reportCount, bySeverity, cropData, rank) {
  const parts = [];
  if (reportCount > 0) parts.push(`${reportCount} report${reportCount > 1 ? 's' : ''}`);
  if (bySeverity.safety > 0) parts.push(`${bySeverity.safety} safety`);
  if (bySeverity.flood > 0) parts.push(`${bySeverity.flood} flood`);
  if (bySeverity.issue > 0) parts.push(`${bySeverity.issue} road issue`);
  if (cropData.score >= 70) {
    parts.push(`high-value ${cropData.primary_crop} area (${cropData.hectares.toLocaleString()} ha)`);
  } else if (cropData.score >= 50) {
    parts.push(`moderate crop area (${cropData.primary_crop})`);
  }

  const summary = parts.length
    ? parts.join(', ')
    : 'no recent reports and low agricultural impact';

  return `Ranks #${rank} - serves ${project.municipality || 'area'}: ${summary}.`;
}

/**
 * Main scoring function.
 * @param {Array} projects - fmr_projects rows
 * @param {Array} reports - public_reports rows
 * @param {Array} escalations - public_report_lgu_escalations rows
 * @returns {Array} Sorted priority results, rank 1 = highest priority
 */
export function computePriorityScores(projects, reports, escalations) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeReports = Array.isArray(reports) ? reports : [];
  const safeEscalations = Array.isArray(escalations) ? escalations : [];

  // Build a Set of report_ids that have an active escalation.
  const escalatedReportIds = new Set(
    safeEscalations
      .filter((e) => ['for_action', 'endorsed'].includes(e.escalation_status))
      .map((e) => e.report_id)
  );

  const raw = safeProjects.map((project) => {
    const projectReports = safeReports.filter(
      (r) =>
        String(r.project_name || '').trim().toLowerCase() ===
        String(project.project_name || '').trim().toLowerCase()
    );

    const bySeverity = { safety: 0, flood: 0, issue: 0, general: 0 };

    let severityRaw = projectReports.reduce((sum, r) => {
      const cat = classifyReportSeverity(r);
      bySeverity[cat] += 1;
      return sum + SEVERITY_WEIGHTS[cat] * getRecencyMultiplier(r.created_at);
    }, 0);

    const hasEscalation = projectReports.some((r) => escalatedReportIds.has(r.id));
    if (hasEscalation) severityRaw *= ESCALATION_BONUS;

    const cropData = getCropData(project.municipality);

    return {
      project,
      reportCount: projectReports.length,
      volumeRaw: projectReports.length,
      severityRaw,
      cropScore: cropData.score,
      cropData,
      bySeverity,
      hasEscalation,
    };
  });

  const maxVolume = Math.max(...raw.map((r) => r.volumeRaw), 1);
  const maxSeverity = Math.max(...raw.map((r) => r.severityRaw), 1);

  const scored = raw.map((r) => {
    const V = (r.volumeRaw / maxVolume) * 100;
    const S = (r.severityRaw / maxSeverity) * 100;
    const C = r.cropScore;

    const score = Math.round(V * 0.4 + S * 0.35 + C * 0.25);

    return {
      ...r,
      score,
      V: Math.round(V),
      S: Math.round(S),
      C: Math.round(C),
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      reason: buildPlainReason(r.project, r.reportCount, r.bySeverity, r.cropData, i + 1),
    }));
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
  if (key === 'V' || key === 'U' || key === 'G') return 'bg-blue-500';
  if (key === 'S' || key === 'B' || key === 'E') return 'bg-red-500';
  if (key === 'M') return 'bg-emerald-500';
  return 'bg-amber-500';
}

/**
 * SUPERSEDED by computeRoadGapPriorityScores below. Kept only so the write-up can
 * show the before/after; it is no longer wired into the UI.
 *
 * Two defects, both confirmed against the live data:
 *
 *  - E collapses. `connectivityIndex` is 85 when the project name contains '-',
 *    'rd' or 'road' and 60 otherwise. Every Leon FMR name contains "Rd" or
 *    "Road", so the value is 85 for essentially every row and, after dividing by
 *    the batch maximum, E = 100 for every row.
 *  - M barely varies. `marketAccessScore` is 95 when the name contains
 *    'poblacion' and 75 otherwise, plus a fixed 10 for a severity keyword.
 *
 * A factor with no variance cannot change an ordering, so the documented
 * 40/35/25 weighting silently reduces to a plain sort on gap km: 60% of the
 * stated weight does nothing. It also reads `project.barangay`, a column that did
 * not exist, so every generated reason string printed the literal word
 * "Barangay".
 *
 * Original factors:
 *  - G (Gap Distance / Unpaved Length) 40%
 *  - E (Edge-to-Edge Connectivity)      35%
 *  - M (Market Access Impact)           25%
 */
export function computeRoadGapPriorityScoresLegacy(projects, roadInventory = [], reports = []) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeInventory = Array.isArray(roadInventory) ? roadInventory : [];

  const raw = safeProjects.map((project) => {
    const projName = String(project.project_name || '').toLowerCase();
    const barangay = String(project.barangay || project.location || '').toLowerCase();

    // Match inventory entry if available
    const invMatch = safeInventory.find((inv) => 
      projName.includes(String(inv.roadName || '').toLowerCase()) ||
      String(inv.roadName || '').toLowerCase().includes(projName) ||
      (inv.barangay && barangay.includes(String(inv.barangay).toLowerCase()))
    );

    // Explicit road gap fields win over inferred inventory matches.
    let gapKm = Number(project.road_gap_km || project.project_length_km || project.length_km || 1.2);
    let gapType = project.road_gap_type || 'Barangay Road Gap';
    let gapReason = project.road_gap_reason || '';

    if (!project.road_gap_km && invMatch) {
      const earthSurfaces = (invMatch.surfaces || []).find((s) => s.type === 'Earth');
      const gravelSurfaces = (invMatch.surfaces || []).find((s) => s.type === 'Gravel');
      const earthLen = Number(earthSurfaces?.length || 0);
      const gravelLen = Number(gravelSurfaces?.length || 0);
      
      if (earthLen > 0 || gravelLen > 0) {
        gapKm = earthLen + gravelLen;
        gapType = earthLen > 0 ? 'Earth Surface Gap' : 'Gravel Surface Gap';
      } else {
        gapKm = Number(invMatch.lengthKm || gapKm);
        gapType = invMatch.surfaceType || 'Barangay Road Gap';
      }
    }

    const isConnectingRoad = projName.includes('-') || projName.includes('rd') || projName.includes('road');
    const connectivityIndex = isConnectingRoad ? 85 : 60;
    const gapSeverityBoost = /critical|earth|poor/i.test(`${gapType} ${gapReason}`) ? 10 : 0;
    const marketAccessScore = Math.min(100, (projName.includes('poblacion') || barangay.includes('poblacion') ? 95 : 75) + gapSeverityBoost);

    const projectReports = (reports || []).filter(
      (r) => String(r.project_name || '').trim().toLowerCase() === projName
    );

    return {
      project,
      gapKm: Number(gapKm.toFixed(2)),
      gapType,
      connectivityIndex,
      marketAccessScore,
      reportCount: projectReports.length,
      invMatch: Boolean(invMatch),
      gapReason,
    };
  });

  const maxGapKm = Math.max(...raw.map((r) => r.gapKm), 1);
  const maxConn = Math.max(...raw.map((r) => r.connectivityIndex), 1);
  const maxMarket = Math.max(...raw.map((r) => r.marketAccessScore), 1);

  const scored = raw.map((r) => {
    const G = Math.round((r.gapKm / maxGapKm) * 100);
    const E = Math.round((r.connectivityIndex / maxConn) * 100);
    const M = Math.round((r.marketAccessScore / maxMarket) * 100);

    const score = Math.round(G * 0.40 + E * 0.35 + M * 0.25);

    return {
      ...r,
      score,
      G,
      E,
      M,
      cropData: { score: 0, primary_crop: 'N/A (Disregarded)', hectares: 0 },
      bySeverity: { safety: 0, flood: 0, issue: 0, general: 0 },
      hasEscalation: false,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      reason: `Rank #${i + 1} — ${r.project.municipality || 'Leon'} (${r.project.barangay || 'Barangay'}): ${r.gapKm} km ${r.gapType} connecting to market network.`,
    }));
}

// ---------------------------------------------------------------------------
// Module 1: Road Network Gap Prioritization
// ---------------------------------------------------------------------------

/**
 * Published weights.
 *
 *  - G (40%) gap length: the surveyed unpaved km
 *  - A (35%) access: connectivity and market access, merged. Both asked how well
 *            closing the gap ties the road network to the market, so scoring them
 *            as two factors counted that one idea twice. A keeps their previous
 *            relative balance (35:25) via ACCESS_MIX.
 *  - C (25%) surface condition: how bad the existing surface is, from the survey
 *            (Earth worse than Gravel; Poor worse than Fair). Replaces the weight
 *            freed by the merge with a factor that measures something different.
 */
export const GAP_WEIGHTS = { G: 0.40, A: 0.35, C: 0.25 };

/** Inside A: connectivity vs market access, in their previous 35:25 proportion. */
export const ACCESS_MIX = { connectivity: 35 / 60, market: 25 / 60 };

/**
 * Surface severity points (0-100 after adding both parts). An Earth surface is
 * worse than Gravel regardless of condition, so surface type carries the larger
 * share. A missing value takes the midpoint of its range rather than zero, so a
 * gap is never ranked as "fine" just because a field was left blank.
 */
const SURFACE_TYPE_POINTS = { earth: 60, gravel: 30 };
const SURFACE_TYPE_UNKNOWN = 45;
const CONDITION_POINTS = { poor: 40, fair: 20, good: 0 };
const CONDITION_UNKNOWN = 20;

export function surfaceSeverity(gapType, condition) {
  const type = String(gapType || '').toLowerCase();
  const typePoints = /earth/.test(type) ? SURFACE_TYPE_POINTS.earth
    : /gravel/.test(type) ? SURFACE_TYPE_POINTS.gravel
    : SURFACE_TYPE_UNKNOWN;
  const cond = String(condition || '').trim().toLowerCase();
  const conditionPoints = cond in CONDITION_POINTS ? CONDITION_POINTS[cond] : CONDITION_UNKNOWN;
  return typePoints + conditionPoints;
}

/**
 * Market-access direction.
 *
 * true  -> a gap NEARER the market hub scores higher, on the reading that roads
 *          closer to the consolidation point carry traffic from more barangays, so
 *          closing them benefits a larger share of the network.
 * false -> a gap FARTHER from the market scores higher, on the reading that
 *          remoteness is itself the access penalty being measured.
 *
 * This is the one genuine judgement call in the formula, so it is a named switch
 * rather than an arithmetic detail buried in the scoring expression.
 */
export const MARKET_PROXIMITY_SCORES_HIGHER = true;

// Composition of E, the connectivity factor. Replaces the previous substring test,
// which produced the same value for every row.
const CONNECTIVITY_JOIN_WEIGHT = 55;      // closing the gap links two funded segments
const CONNECTIVITY_DENSITY_WEIGHT = 45;   // built road already meeting these barangays
const CONNECTIVITY_SATURATION = 4;        // projects per barangay pair where density maxes out

const normalizePct = (value, max) => (max > 0 ? (Number(value) / max) * 100 : 0);
const distinctCount = (values) =>
  new Set(values.filter((v) => Number.isFinite(v)).map((v) => v.toFixed(4))).size;

/**
 * Rank road-network gaps for improvement.
 *
 * Scores rows of public.road_network_gaps, where a gap is the surveyed unpaved
 * (Earth + Gravel) portion of a barangay road drawn on that road's own alignment.
 * Scoring the gap rather than the project is what lets all three factors come from
 * measured data instead of from the project's name (weights: see GAP_WEIGHTS):
 *
 *  - G gap_km, the surveyed unpaved length
 *  - A access, mixing (ACCESS_MIX):
 *      connectivity -- whether closing the gap joins two funded FMR segments, and
 *                      how much built road already meets the barangays at either end
 *      market       -- market_distance_km over the same local road network
 *  - C surface condition severity, from gap_type and surface_condition
 *
 * Returns rows with project, score, rank, reason and G/A/C, plus `gap` and
 * `factorVariance`. The two halves of A stay on the row as E and M so the
 * write-up can show what A is made of.
 */
export function computeRoadGapPriorityScores(gaps, projects = [], reports = []) {
  const safeGaps = Array.isArray(gaps) ? gaps : [];
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeReports = Array.isArray(reports) ? reports : [];
  if (safeGaps.length === 0) return [];

  const projectById = new Map(safeProjects.map((p) => [p.id, p]));

  // How many funded projects touch each barangay, for the density half of E.
  const projectsPerBarangay = new Map();
  for (const project of safeProjects) {
    for (const barangay of [project.barangay, project.barangay_end]) {
      if (!barangay) continue;
      projectsPerBarangay.set(barangay, (projectsPerBarangay.get(barangay) || 0) + 1);
    }
  }

  const raw = safeGaps.map((gap) => {
    const project = projectById.get(gap.from_project_id) || null;
    const gapKm = Number(gap.gap_km) || 0;

    const joinsTwoSegments = Boolean(gap.to_project_id);
    const incidentProjects =
      (projectsPerBarangay.get(gap.barangay) || 0) +
      (projectsPerBarangay.get(gap.barangay_end) || 0);

    const connectivityRaw =
      (joinsTwoSegments ? CONNECTIVITY_JOIN_WEIGHT : 0) +
      Math.min(1, incidentProjects / CONNECTIVITY_SATURATION) * CONNECTIVITY_DENSITY_WEIGHT;

    // Guard the null explicitly: Number(null) is 0, and 0 is finite, so a gap with
    // no measured market distance would otherwise read as sitting AT the market and
    // score full marks on the market factor.
    const marketRaw = gap.market_distance_km;
    const marketKm =
      marketRaw === null || marketRaw === undefined || marketRaw === ''
        ? null
        : Number(marketRaw);

    const projectReports = project
      ? safeReports.filter(
          (r) =>
            String(r.project_name || '').trim().toLowerCase() ===
            String(project.project_name || '').trim().toLowerCase()
        )
      : [];

    return {
      gap,
      // Keep the shape PriorityTab expects even when the parent project is absent.
      project: project || {
        id: gap.from_project_id,
        project_name: gap.source_road_name || gap.gap_code,
        municipality: gap.municipality || 'Leon',
        barangay: gap.barangay,
        barangay_end: gap.barangay_end,
      },
      gapKm,
      gapType: gap.gap_type || 'Road Network Gap',
      gapReason: gap.gap_reason || '',
      surfaceCondition: gap.surface_condition || null,
      joinsTwoSegments,
      incidentProjects,
      connectivityRaw,
      marketKm: Number.isFinite(marketKm) ? marketKm : null,
      reportCount: projectReports.length,
    };
  });

  const maxGapKm = Math.max(...raw.map((r) => r.gapKm), 0);
  const maxConnectivity = Math.max(...raw.map((r) => r.connectivityRaw), 0);
  const measuredMarket = raw.map((r) => r.marketKm).filter((n) => Number.isFinite(n));
  const maxMarketKm = measuredMarket.length > 0 ? Math.max(...measuredMarket) : 0;

  const scored = raw.map((r) => {
    const G = normalizePct(r.gapKm, maxGapKm);
    const E = normalizePct(r.connectivityRaw, maxConnectivity);

    // Gaps with no measured market distance sit mid-range rather than at zero, so a
    // measurement failure cannot masquerade as "no market impact".
    let M = 50;
    if (Number.isFinite(r.marketKm) && maxMarketKm > 0) {
      const proximity = 1 - Math.min(1, r.marketKm / maxMarketKm);
      M = (MARKET_PROXIMITY_SCORES_HIGHER ? proximity : 1 - proximity) * 100;
    }

    const A = E * ACCESS_MIX.connectivity + M * ACCESS_MIX.market;
    const C = surfaceSeverity(r.gapType, r.surfaceCondition);

    return {
      ...r,
      score: Math.round(G * GAP_WEIGHTS.G + A * GAP_WEIGHTS.A + C * GAP_WEIGHTS.C),
      G: Math.round(G),
      A: Math.round(A),
      C: Math.round(C),
      E: Math.round(E),
      M: Math.round(M),
      // Fields the shared row renderer expects from the agri module.
      cropData: { score: 0, primary_crop: 'N/A (not used by this module)', hectares: 0 },
      bySeverity: { safety: 0, flood: 0, issue: 0, general: 0 },
      hasEscalation: false,
    };
  });

  // A factor taking one value across the batch cannot affect the ordering, whatever
  // its weight -- which is exactly how the previous version's 35% and 25% came to do
  // nothing without anyone noticing. Surface it instead of letting it hide.
  const factorVariance = {
    G: distinctCount(scored.map((r) => r.G)),
    A: distinctCount(scored.map((r) => r.A)),
    C: distinctCount(scored.map((r) => r.C)),
    rows: scored.length,
  };
  if (scored.length > 1) {
    const inert = ['G', 'A', 'C'].filter((key) => factorVariance[key] < 2);
    if (inert.length > 0) {
      console.warn(
        `[priorityScoring] Factor(s) ${inert.join(', ')} are constant across ${scored.length} gaps, so ` +
        `${inert.map((key) => `${Math.round(GAP_WEIGHTS[key] * 100)}%`).join(' + ')} of the weighting ` +
        'has no effect on the ranking.'
      );
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      factorVariance,
      reason: buildGapReason(r, i + 1),
    }));
}

function buildGapReason(row, rank) {
  const where = [row.gap.barangay, row.gap.barangay_end].filter(Boolean).join(' to ');
  const parts = [`${row.gapKm.toFixed(2)} km unpaved`];

  if (row.surfaceCondition) parts.push(`${row.surfaceCondition.toLowerCase()} condition`);
  parts.push(
    row.joinsTwoSegments
      ? 'closing it would join two funded FMR segments'
      : 'no funded project continues beyond it'
  );
  if (Number.isFinite(row.marketKm)) parts.push(`${row.marketKm.toFixed(1)} km from Leon market`);
  if (row.reportCount > 0) {
    parts.push(`${row.reportCount} citizen report${row.reportCount > 1 ? 's' : ''}`);
  }

  return `Rank #${rank} — ${where || row.gap.municipality || 'Leon'}: ${parts.join(', ')}.`;
}

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
