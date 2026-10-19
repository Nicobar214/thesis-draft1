/*
 * proposalDuplicates.js — stops an LGU from proposing a road that already exists.
 *
 * A proposal is blocked when it is the same project as an existing FMR project
 * or one of the LGU's own open proposals in the same municipality:
 *   - same name: identical once filler words ("Concreting of", "FMR", "Brgy.",
 *     punctuation) are ignored, so "Concreting of Brgy. Tabuc FMR" and
 *     "Tabuc Farm-to-Market Road" are the same project;
 *   - same road: both ends lie within SAME_ROAD_METERS of an existing
 *     project's two ends (in either direction).
 *
 * The name rule is also enforced in the database (supabase_lgu_proposal_duplicate_guard.sql),
 * so it cannot be bypassed from the browser.
 */
import { haversineMeters } from './reportSubmission';

export const SAME_ROAD_METERS = 200;

// Words that describe the kind of work or the road type, not which road it is.
// Keep in sync with public.proposal_name_key() in supabase_lgu_proposal_duplicate_guard.sql.
const FILLER = new Set([
  'fmr', 'farm', 'to', 'market', 'road', 'roads', 'of', 'the', 'and', 'in', 'at',
  'brgy', 'bgy', 'barangay', 'concreting', 'construction', 'rehabilitation',
  'improvement', 'improvements', 'repair', 'upgrading', 'proposed', 'project', 'new',
]);

/** "Concreting of Brgy. Tabuc FMR" -> "tabuc". Empty when only filler words. */
export function proposalNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(' ');
}

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
function endsOf(row) {
  const s = [num(row?.start_latitude), num(row?.start_longitude)];
  const e = [num(row?.end_latitude), num(row?.end_longitude)];
  return s.every(Number.isFinite) && e.every(Number.isFinite) ? { s, e } : null;
}

/** True when both ends of `a` are within SAME_ROAD_METERS of both ends of `b`. */
export function isSameRoad(a, b, meters = SAME_ROAD_METERS) {
  const x = endsOf(a);
  const y = endsOf(b);
  if (!x || !y) return false;
  const d = (p, q) => haversineMeters(p[0], p[1], q[0], q[1]);
  const sameWay = d(x.s, y.s) <= meters && d(x.e, y.e) <= meters;
  const reversed = d(x.s, y.e) <= meters && d(x.e, y.s) <= meters;
  return sameWay || reversed;
}

const sameTown = (a, b) => !a || !b || String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * The first existing project or open proposal that the form duplicates, or null.
 * Returns { kind: 'project' | 'proposal', reason: 'name' | 'road', row }.
 */
export function findBlockingDuplicate({ form, municipality, projects = [], proposals = [], editingId = null }) {
  const key = proposalNameKey(form?.project_name);
  const candidates = [
    ...projects
      .filter((p) => sameTown(p.municipality, municipality))
      .map((row) => ({ kind: 'project', row })),
    ...proposals
      .filter((p) => p.id !== editingId && p.status !== 'Rejected' && sameTown(p.municipality, municipality))
      .map((row) => ({ kind: 'proposal', row })),
  ];

  for (const c of candidates) {
    if (key && proposalNameKey(c.row.project_name) === key) return { ...c, reason: 'name' };
  }
  for (const c of candidates) {
    if (isSameRoad(form, c.row)) return { ...c, reason: 'road' };
  }
  return null;
}
