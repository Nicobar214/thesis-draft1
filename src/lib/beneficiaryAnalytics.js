/*
 * beneficiaryAnalytics.js — every number on the admin Farmer Beneficiaries
 * analytics (KPI cards, charts, insights) comes from summarizeBeneficiaries(),
 * so the cards and charts can never disagree.
 *
 * Data facts this relies on (audited against farmer_beneficiaries):
 *   - one row per farmer; `crop` is a single main commodity, so commodity shares
 *     are mutually exclusive and add up to 100% of farmers;
 *   - `submitted_date` is the registration date (`created_at` as fallback);
 *     `last_updated` is NOT used for history;
 *   - farm_area_ha may be missing or 0 — counted as "not recorded", never as 0 ha.
 *
 * Input rows are the normalized rows from Dashboard.normalizeFarmerBeneficiaryRow
 * (camelCase: id, crop, municipality, farmAreaHa, validationStatus, submittedDate).
 */

export const NOT_RECORDED = 'Not recorded';
const VALIDATION_KEYS = ['Validated', 'For Verification', 'Needs Correction'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clean = (value) => String(value ?? '').trim();

// Measured farm-to-road distances in Leon are short (avg ~0.25 km, see
// supabase_link_farmers_to_nearest_fmr.sql), so the bands are fine-grained.
export const DISTANCE_BANDS = [
  { key: 'le05', label: 'Within 0.5 km', max: 0.5 },
  { key: 'le1', label: '0.5–1 km', max: 1 },
  { key: 'le2', label: '1–2 km', max: 2 },
  { key: 'gt2', label: 'Over 2 km', max: Infinity },
];

export function normalizeSex(value) {
  const v = clean(value).toLowerCase();
  if (v === 'male' || v === 'm') return 'Male';
  if (v === 'female' || v === 'f') return 'Female';
  return NOT_RECORDED;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** One entry per farmer (by id, falling back to beneficiary/RSBSA id). */
export function dedupeFarmers(rows) {
  const seen = new Set();
  const out = [];
  (rows || []).forEach((row) => {
    if (!row) return;
    const key = row.id ?? row.beneficiaryId ?? row.rsbsaNumber;
    if (key == null || key === '') { out.push(row); return; }
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
}

/** [{ name, count, share }] sorted by count desc, then name; blanks -> NOT_RECORDED. */
function rankBy(farmers, pick) {
  const counts = new Map();
  farmers.forEach((f) => {
    const key = clean(pick(f)) || NOT_RECORDED;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const total = farmers.length;
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Keeps the top `keep` real categories and folds the rest into one labelled
 * bucket. "Not recorded" is never folded in, so missing data stays visible.
 */
export function groupCommodities(ranked, keep = 6) {
  const recorded = ranked.filter((r) => r.name !== NOT_RECORDED);
  const missing = ranked.find((r) => r.name === NOT_RECORDED);
  if (recorded.length <= keep + 1) return ranked;
  const head = recorded.slice(0, keep);
  const tail = recorded.slice(keep);
  const count = tail.reduce((sum, r) => sum + r.count, 0);
  const share = tail.reduce((sum, r) => sum + r.share, 0);
  return [
    ...head,
    { name: `All other crops (${tail.length})`, count, share, grouped: tail },
    ...(missing ? [missing] : []),
  ];
}

export function summarizeBeneficiaries(rows, { municipalityMaster = [] } = {}) {
  const farmers = dedupeFarmers(rows);
  const total = farmers.length;

  // Validation status
  const validation = { Validated: 0, 'For Verification': 0, 'Needs Correction': 0, Other: 0 };
  farmers.forEach((f) => {
    const key = VALIDATION_KEYS.includes(f.validationStatus) ? f.validationStatus : 'Other';
    validation[key] += 1;
  });

  // Farm area: only finite, positive values count; the rest is "not recorded".
  let hectares = 0;
  let areaRecorded = 0;
  farmers.forEach((f) => {
    const ha = Number(f.farmAreaHa);
    if (Number.isFinite(ha) && ha > 0) {
      hectares += ha;
      areaRecorded += 1;
    }
  });

  // Commodities
  const commodities = rankBy(farmers, (f) => f.crop);
  const recordedCommodities = commodities.filter((c) => c.name !== NOT_RECORDED);
  const topCount = recordedCommodities[0]?.count || 0;
  const leaders = recordedCommodities.filter((c) => c.count === topCount && topCount > 0);
  const leadingCommodity = leaders.length
    ? { names: leaders.map((c) => c.name), count: topCount, share: total ? topCount / total : 0 }
    : null;

  // Municipalities
  const municipalities = rankBy(farmers, (f) => f.municipality);
  const recordedMunis = municipalities.filter((m) => m.name !== NOT_RECORDED);
  const masterSet = new Set(municipalityMaster);
  const coverage = {
    withFarmers: recordedMunis.length,
    masterTotal: municipalityMaster.length || null,
    withoutFarmers: municipalityMaster.length
      ? municipalityMaster.filter((m) => !recordedMunis.some((r) => r.name === m)).length
      : null,
    outsideMaster: municipalityMaster.length ? recordedMunis.filter((r) => !masterSet.has(r.name)).map((r) => r.name) : [],
  };

  // Registrations over time, by registration (submitted) date.
  const byYear = new Map();
  const byMonth = new Map(); // `${year}-${mm}`
  let undated = 0;
  farmers.forEach((f) => {
    const d = toDate(f.submittedDate);
    if (!d) { undated += 1; return; }
    const y = d.getFullYear();
    const ha = Number(f.farmAreaHa);
    const year = byYear.get(y) || { year: y, registered: 0, hectares: 0 };
    year.registered += 1;
    if (Number.isFinite(ha) && ha > 0) year.hectares += ha;
    byYear.set(y, year);
    const mKey = `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(mKey, (byMonth.get(mKey) || 0) + 1);
  });

  let running = 0;
  const years = [...byYear.values()]
    .sort((a, b) => a.year - b.year)
    .map((row) => {
      running += row.registered;
      return { ...row, hectares: Math.round(row.hectares * 100) / 100, cumulative: running };
    });

  // Month series for the span actually covered (gaps filled with real zeros).
  const months = [];
  if (byMonth.size) {
    const keys = [...byMonth.keys()].sort();
    let [y, m] = keys[0].split('-').map(Number);
    const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
    let cumulative = 0;
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const registered = byMonth.get(key) || 0;
      cumulative += registered;
      months.push({ key, label: `${MONTHS[m - 1]} ${y}`, short: MONTHS[m - 1], registered, cumulative });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }

  const lastTwo = years.slice(-2);
  const yearOverYear = lastTwo.length === 2 && lastTwo[0].registered > 0
    ? { from: lastTwo[0].year, to: lastTwo[1].year, change: (lastTwo[1].registered - lastTwo[0].registered) / lastTwo[0].registered }
    : null;

  // Barangays (the useful breakdown when the registry sits in one municipality).
  const barangays = rankBy(farmers, (f) => f.barangay);

  // Road access: linked to an FMR project, and distance to the nearest FMR.
  // A distance of 0 / missing is "not recorded", never "on the road".
  const linked = farmers.filter((f) => clean(f.linkedProjectId) || clean(f.linkedProject)).length;
  const distanceBands = DISTANCE_BANDS.map((b) => ({ ...b, count: 0 }));
  let distanceMissing = 0;
  farmers.forEach((f) => {
    const km = Number(f.distanceToFmrKm);
    if (!Number.isFinite(km) || km <= 0) { distanceMissing += 1; return; }
    distanceBands.find((b) => km <= b.max).count += 1;
  });
  const roadAccess = {
    linked,
    unlinked: total - linked,
    bands: distanceBands.map((b) => ({ ...b, share: total ? b.count / total : 0 })),
    distanceMissing,
  };

  // Sex, normalized for counting only ("MALE" / "Male" -> Male); records are untouched.
  const sex = { Female: 0, Male: 0, [NOT_RECORDED]: 0 };
  farmers.forEach((f) => { sex[normalizeSex(f.gender)] += 1; });

  return {
    total,
    validation,
    hectares: Math.round(hectares * 100) / 100,
    areaRecorded,
    areaMissing: total - areaRecorded,
    commodities,
    commodityTypes: recordedCommodities.length,
    leadingCommodity,
    municipalities,
    barangays,
    coverage,
    roadAccess,
    sex,
    years,
    months,
    undated,
    yearOverYear,
    missing: {
      crop: commodities.find((c) => c.name === NOT_RECORDED)?.count || 0,
      municipality: municipalities.find((m) => m.name === NOT_RECORDED)?.count || 0,
      area: total - areaRecorded,
      date: undated,
    },
  };
}

/** "79.7%" — one decimal, used for every share on the page. */
export function formatPct(share) {
  const value = Number(share) * 100;
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

/** "370.5" — hectares with up to `digits` decimals and thousands separators. */
export function formatHa(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
