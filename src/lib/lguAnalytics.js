/*
 * LGU Analytics — computed from records LguDashboard.jsx already fetches
 * (municipality-scoped), nothing estimated or hardcoded.
 *
 * Relationships, as audited from the actual migrations:
 *   - fmr_projects.barangay is a real (sparsely filled) column; projects
 *     without it are kept and shown as "Barangay not recorded".
 *   - Farmers have no real FK to a specific FMR project (linked_project_id is
 *     free text), so farmer and harvest figures are municipality/barangay
 *     scoped, never claimed to be per-project.
 *   - farmer_harvest_logs has no location of its own; a harvest is placed in a
 *     barangay through the farmer's registry record (farmer_id === user_id).
 */

const PROPOSED = 'Proposed';
const STATUS_ORDER = ['Completed', 'On-Going', 'Proposed'];
export const NO_BARANGAY = '__no_barangay__';

/** Matching key for free-text barangay names ("Brgy. Agta " === "agta"). */
export function barangayKey(name) {
  if (name === null || name === undefined) return null;
  const key = String(name)
    .trim()
    .toLowerCase()
    .replace(/^(brgy\.?|barangay)\s+/, '')
    .replace(/\s+/g, ' ');
  return key || null;
}

/** A physical-accomplishment percentage, or null if missing/out of range. */
function validPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function yearOf(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}

function fundingYear(project) {
  const y = Number(project.year_funded);
  return Number.isInteger(y) && y > 1900 ? y : null;
}

// One person, however many registry rows (e.g. several farms) they have.
// RSBSA is the national farmer registry number, so it's the identity of record.
function farmerIdentity(b) {
  const rsbsa = String(b.rsbsaNumber || '').trim().toUpperCase();
  if (rsbsa) return `rsbsa:${rsbsa}`;
  if (b.userId) return `user:${b.userId}`;
  return `row:${b.id}`;
}

// Proposed projects carry the column default (0), not a certified figure, so
// averaging them in would drag "physical accomplishment" down with non-data.
function measuredAccomplishment(project) {
  if (project.status === PROPOSED) return null;
  return validPercent(project.accomplishment);
}

/**
 * Normalizes the three sources once: barangay keys, years, and the
 * harvest→farmer attribution. Harvest whose farmer isn't in this LGU's
 * registry is excluded (and counted) rather than silently added to totals.
 */
export function buildAnalyticsBase({ projects, beneficiaries, harvestLogs }) {
  const names = new Map();
  const remember = (name) => {
    const key = barangayKey(name);
    if (key && !names.has(key)) names.set(key, String(name).trim().replace(/^(brgy\.?|barangay)\s+/i, ''));
    return key;
  };

  const projectRows = (projects || []).map((p) => ({ p, key: remember(p.barangay), year: fundingYear(p) }));
  const farmerRows = (beneficiaries || []).map((b) => ({ b, key: remember(b.barangay) }));

  const farmerByUser = new Map();
  farmerRows.forEach((f) => {
    if (f.b.userId && !farmerByUser.has(f.b.userId)) farmerByUser.set(f.b.userId, f);
  });

  const harvestRows = [];
  let unattributedHarvest = 0;
  (harvestLogs || []).forEach((h) => {
    const farmer = farmerByUser.get(h.farmer_id);
    if (!farmer) {
      unattributedHarvest += 1;
      return;
    }
    harvestRows.push({ h, key: farmer.key, year: yearOf(h.harvest_date) });
  });

  const years = [...new Set([...projectRows, ...harvestRows].map((r) => r.year).filter((y) => y !== null))]
    .sort((a, b) => b - a);
  const barangays = [...names.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { projectRows, farmerRows, harvestRows, unattributedHarvest, years, barangays, names };
}

/**
 * Year applies to project funding year and harvest date. The farmer registry
 * isn't time-bound, so farmers are filtered by barangay only.
 */
export function applyAnalyticsFilters(base, { year = 'all', barangay = 'all' }) {
  const y = year === 'all' ? null : Number(year);
  const b = barangay === 'all' ? null : barangay;
  return {
    projectRows: base.projectRows.filter((r) => (y === null || r.year === y) && (b === null || r.key === b)),
    farmerRows: base.farmerRows.filter((r) => b === null || r.key === b),
    harvestRows: base.harvestRows.filter((r) => (y === null || r.year === y) && (b === null || r.key === b)),
  };
}

export function summarizeProjects(projectRows) {
  const total = projectRows.length;
  const counts = new Map();
  projectRows.forEach(({ p }) => {
    const status = (p.status && String(p.status).trim()) || 'Unspecified';
    counts.set(status, (counts.get(status) || 0) + 1);
  });
  const rank = (s) => (STATUS_ORDER.includes(s) ? STATUS_ORDER.indexOf(s) : STATUS_ORDER.length);
  const statuses = [...counts.entries()]
    .map(([name, count]) => ({ name, count, pct: total > 0 ? (count / total) * 100 : 0 }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.count - a.count);

  const measured = projectRows.map(({ p }) => measuredAccomplishment(p)).filter((v) => v !== null);
  return { total, statuses, avgAccomplishment: average(measured), measuredCount: measured.length };
}

export function summarizeFarmers(farmerRows) {
  const people = new Set();
  farmerRows.forEach(({ b }) => {
    if (b.validationStatus === 'Validated') people.add(farmerIdentity(b));
  });
  return { count: people.size };
}

const monthKey = (year, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function summarizeHarvest(harvestRows) {
  let totalKg = 0;
  let records = 0;
  const crops = new Map();
  const months = new Map();

  harvestRows.forEach(({ h }) => {
    const kg = Number(h.quantity_kg);
    if (!Number.isFinite(kg)) return;
    totalKg += kg;
    records += 1;
    const crop = (h.crop && String(h.crop).trim()) || 'Unspecified';
    crops.set(crop, (crops.get(crop) || 0) + kg);
    const d = new Date(h.harvest_date);
    if (!Number.isNaN(d.getTime())) {
      const key = monthKey(d.getFullYear(), d.getMonth());
      months.set(key, (months.get(key) || 0) + kg);
    }
  });

  const byCrop = [...crops.entries()].map(([crop, kg]) => ({ crop, kg })).sort((a, b) => b.kg - a.kg);
  const keys = [...months.keys()].sort();
  // One month isn't a trend -- the UI says so instead of drawing a lone dot.
  const trend = keys.length >= 2 ? keys.map((key) => ({ key, label: monthLabel(key), kg: months.get(key) })) : null;

  return { totalKg, records, byCrop, trend };
}

/** Sparkline series: projects funded per year, oldest first. */
export function projectsFundedByYear(projectRows) {
  const counts = new Map();
  projectRows.forEach(({ year }) => {
    if (year !== null) counts.set(year, (counts.get(year) || 0) + 1);
  });
  return [...counts.keys()].sort((a, b) => a - b).map((y) => ({ label: String(y), value: counts.get(y) }));
}

/**
 * Sparkline series: running total of validated farmers by the month their
 * registry record was submitted (submitted_date is NOT NULL in the schema).
 * Each person counts once, at their earliest record.
 */
export function farmerRegistrationTrend(farmerRows) {
  const firstSeen = new Map();
  farmerRows.forEach(({ b }) => {
    if (b.validationStatus !== 'Validated') return;
    const t = new Date(b.submittedDate).getTime();
    if (!Number.isFinite(t)) return;
    const id = farmerIdentity(b);
    if (!firstSeen.has(id) || t < firstSeen.get(id)) firstSeen.set(id, t);
  });
  const perMonth = new Map();
  firstSeen.forEach((t) => {
    const d = new Date(t);
    const key = monthKey(d.getFullYear(), d.getMonth());
    perMonth.set(key, (perMonth.get(key) || 0) + 1);
  });
  let running = 0;
  return [...perMonth.keys()].sort().map((key) => {
    running += perMonth.get(key);
    return { label: monthLabel(key), value: running };
  });
}

/**
 * One row per barangay with projects, farmers, and reported harvest side by
 * side. Numbers stay raw (sorting needs numbers, not formatted strings).
 */
export function buildBarangayBreakdown({ projectRows, farmerRows, harvestRows }, names) {
  const rows = new Map();
  const ensure = (key) => {
    const k = key || NO_BARANGAY;
    if (!rows.has(k)) {
      rows.set(k, { key: k, name: key ? names.get(key) : null, projects: 0, pcts: [], farmers: new Set(), harvestKg: 0, harvestRecords: 0 });
    }
    return rows.get(k);
  };

  projectRows.forEach(({ p, key }) => {
    const row = ensure(key);
    row.projects += 1;
    const pct = measuredAccomplishment(p);
    if (pct !== null) row.pcts.push(pct);
  });
  farmerRows.forEach(({ b, key }) => {
    if (!key || b.validationStatus !== 'Validated') return;
    ensure(key).farmers.add(farmerIdentity(b));
  });
  harvestRows.forEach(({ h, key }) => {
    if (!key) return;
    const kg = Number(h.quantity_kg);
    if (!Number.isFinite(kg)) return;
    const row = ensure(key);
    row.harvestKg += kg;
    row.harvestRecords += 1;
  });

  return [...rows.values()].map((r) => ({
    key: r.key,
    name: r.name,
    unassigned: r.key === NO_BARANGAY,
    projects: r.projects,
    avgAccomplishment: average(r.pcts),
    farmers: r.farmers.size,
    harvestKg: r.harvestKg,
    harvestRecords: r.harvestRecords,
  }));
}

export const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
export const fmtPct = (v) => (v === null || v === undefined ? 'N/A' : `${v.toFixed(1)}%`);
export const fmtKg = (kg) => `${Math.round(kg).toLocaleString('en-US')} kg`;
export const fmtTons = (kg) => `${(kg / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} t`;
