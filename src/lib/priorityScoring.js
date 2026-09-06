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
 * Module 1: Road Network Gaps Prioritization
 * Edge-to-edge connectivity between barangay roads and market hubs.
 * Disregards agricultural/farmer data since production data is not readily available.
 * 
 * Factors:
 *  - G (Gap Distance / Unpaved Length) 40%
 *  - E (Edge-to-Edge Connectivity)      35%
 *  - M (Market Access Impact)           25%
 */
export function computeRoadGapPriorityScores(projects, roadInventory = [], reports = []) {
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

    // Calculate unpaved gap length (Earth + Gravel or Poor/Critical condition)
    let gapKm = Number(project.project_length_km || project.length_km || 1.2);
    let gapType = 'Barangay Road Gap';

    if (invMatch) {
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
    const marketAccessScore = projName.includes('poblacion') || barangay.includes('poblacion') ? 95 : 75;

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
