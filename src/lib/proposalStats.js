import { PROPOSAL_SLA_DAYS } from './mapRouteUtils';

export const AWAITING_REVIEW = ['Submitted', 'Under Validation'];
const STATUS_ORDER = ['Submitted', 'Under Validation', 'Needs Revision', 'Approved', 'Rejected'];

/** Whole days since submission, or null for an unparseable date. */
export function daysPending(submittedAt, now = new Date()) {
  const submitted = new Date(submittedAt);
  if (Number.isNaN(submitted.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  submitted.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - submitted.getTime()) / 86400000));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function summarizeProposals(proposals, now = new Date()) {
  const rows = proposals || [];
  const count = (status) => rows.filter((p) => p.status === status).length;
  const awaiting = rows.filter((p) => AWAITING_REVIEW.includes(p.status));
  const overdue = awaiting.filter((p) => (daysPending(p.submitted_at, now) ?? 0) > PROPOSAL_SLA_DAYS).length;
  const approved = count('Approved');
  const rejected = count('Rejected');
  const decided = approved + rejected;
  // Rejected proposals are no longer a live funding request.
  const live = rows.filter((p) => p.status !== 'Rejected');

  return {
    total: rows.length,
    barangays: new Set(rows.map((p) => p.barangay).filter(Boolean)).size,
    awaiting: awaiting.length,
    overdue,
    needsRevision: count('Needs Revision'),
    approved,
    approvalRate: decided > 0 ? (approved / decided) * 100 : null,
    requestedBudget: live.reduce((s, p) => s + num(p.estimated_budget), 0),
    requestedKm: live.reduce((s, p) => s + num(p.estimated_length_km), 0),
  };
}

/** Filter options built from the proposals themselves, never hardcoded. */
export function proposalFilterOptions(proposals) {
  const rows = proposals || [];
  const present = new Set(rows.map((p) => p.status).filter(Boolean));
  const statuses = [...STATUS_ORDER.filter((s) => present.has(s)), ...[...present].filter((s) => !STATUS_ORDER.includes(s))];
  const barangays = [...new Set(rows.map((p) => p.barangay).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const years = [...new Set(rows.map((p) => Number(p.target_funding_year)).filter((y) => Number.isInteger(y) && y > 1900))].sort((a, b) => b - a);
  return { statuses, barangays, years };
}

export const DEFAULT_PROPOSAL_FILTERS = { search: '', status: 'all', barangay: 'all', year: 'all', sort: 'newest' };

export function filterProposals(proposals, f, now = new Date()) {
  const q = f.search.trim().toLowerCase();
  const rows = (proposals || []).filter((p) => {
    if (f.status === 'awaiting' ? !AWAITING_REVIEW.includes(p.status) : f.status !== 'all' && p.status !== f.status) return false;
    if (f.barangay !== 'all' && p.barangay !== f.barangay) return false;
    if (f.year !== 'all' && String(p.target_funding_year) !== f.year) return false;
    if (!q) return true;
    return [p.project_name, p.barangay, p.justification, p.description]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  const time = (p) => new Date(p.submitted_at).getTime() || 0;
  const sorters = {
    newest: (a, b) => time(b) - time(a),
    oldest: (a, b) => time(a) - time(b),
    'budget-desc': (a, b) => num(b.estimated_budget) - num(a.estimated_budget),
    'length-desc': (a, b) => num(b.estimated_length_km) - num(a.estimated_length_km),
    // Longest-waiting proposals still awaiting DA review first; decided ones after.
    'pending-longest': (a, b) => {
      const wa = AWAITING_REVIEW.includes(a.status) ? daysPending(a.submitted_at, now) ?? -1 : -1;
      const wb = AWAITING_REVIEW.includes(b.status) ? daysPending(b.submitted_at, now) ?? -1 : -1;
      return wb - wa;
    },
  };
  return [...rows].sort(sorters[f.sort] || sorters.newest);
}
