// Regenerate src/data/leonRoadInventory.json from Leon_barangay_roads.csv.
//
// WHY: the committed JSON's `barangay` field was derived by
// scripts/generate_leon_csv_sql.mjs:190 splitting the road name on hyphens and
// taking the first part. Leon has barangays whose canonical names contain a
// hyphen, so that truncated "Lang-og" to "Lang", "Tu-og" to "Tu",
// "Tina-an Norte" to "Tina", "Cabunga-an" to "Cabunga" and so on. 21 of the 82
// distinct values were not barangays at all, including "Cemetery" and "Center".
// Anything keyed on that field (the barangay backfill, gap attribution, the
// priority scorer's inventory match) inherited the corruption.
//
// The CSV has no barangay column -- it must be derived from the road name, which
// scripts/lib/leonPlaceChain.mjs now does with a gazetteer and span-occupancy
// matching.
//
// Every other field is recomputed from the CSV and asserted byte-identical to
// the previous JSON, so this run provably changes only barangay attribution.
//
//   node scripts/regenerate_leon_road_inventory.mjs           # verify + report
//   node scripts/regenerate_leon_road_inventory.mjs --write   # rewrite the JSON

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, resolveRoadBarangay, stripCsvNumbering, LEON_BARANGAYS } from './lib/leonPlaceChain.mjs';

const WRITE = process.argv.includes('--write');

const CSV_PATH = resolve(REPO_ROOT, 'Leon_barangay_roads.csv');
const JSON_PATH = resolve(REPO_ROOT, 'src', 'data', 'leonRoadInventory.json');
const REPORT_PATH = resolve(REPO_ROOT, 'leon_inventory_repair_report.json');

// CSV column order is best surface -> worst surface, which is what the existing
// `surfaceType` / `condition` fields encode: the worst surface present on the road.
const SURFACE_ORDER = ['Concrete', 'Asphalt', 'Gravel', 'Earth'];
const UNPAVED = new Set(['Gravel', 'Earth']);
const CONDITION_RANK = { Good: 0, Fair: 1, Poor: 2, Critical: 3 };

const num = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};
const text = (value) => {
  const s = String(value ?? '').trim();
  return s || null;
};

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0].split(',');
  if (header.length !== 17) throw new Error(`Expected 17 CSV columns, found ${header.length}`);

  return lines.slice(1).map((line, index) => {
    const f = line.split(',');
    if (f.length !== 17) throw new Error(`Row ${index + 2} has ${f.length} fields, expected 17`);

    const surfaces = SURFACE_ORDER.map((type, s) => ({
      type,
      length: num(f[5 + s * 3]),
      pct: num(f[6 + s * 3]),
      condition: text(f[7 + s * 3]),
    }));

    return {
      roadName: stripCsvNumbering(f[0]),
      classification: String(f[1] ?? '').trim(),
      yearConstructed: num(f[2]),
      row: num(f[3]),
      lengthKm: num(f[4]),
      surfaces,
    };
  });
}

/** The existing JSON's summary format: "Concrete 0.03 km (2%, Fair); Earth 1.44 km (98%, Poor)" */
function buildSurfaceSummary(surfaces) {
  return surfaces
    .filter((s) => s.length)
    .map((s) => `${s.type} ${s.length} km (${s.pct}%, ${s.condition})`)
    .join('; ');
}

const worstCondition = (conditions) => {
  const present = conditions.filter((c) => c && c in CONDITION_RANK);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (CONDITION_RANK[b] > CONDITION_RANK[a] ? b : a));
};

function buildRecord(row) {
  const present = row.surfaces.filter((s) => s.length);
  // Worst surface present, matching the existing field's semantics.
  const worst = present.length > 0 ? present[present.length - 1] : null;

  const unpaved = present.filter((s) => UNPAVED.has(s.type));
  const unpavedKm = Number(unpaved.reduce((sum, s) => sum + s.length, 0).toFixed(2));
  const pavedKm = Number(
    present.filter((s) => !UNPAVED.has(s.type)).reduce((sum, s) => sum + s.length, 0).toFixed(2)
  );

  const hasEarth = unpaved.some((s) => s.type === 'Earth');
  const hasGravel = unpaved.some((s) => s.type === 'Gravel');
  const unpavedType = hasEarth && hasGravel
    ? 'Mixed Earth-Gravel Gap'
    : hasEarth ? 'Earth Surface Gap'
    : hasGravel ? 'Gravel Surface Gap'
    : null;

  const resolved = resolveRoadBarangay(row.roadName);

  return {
    roadName: row.roadName,
    barangay: resolved.barangay,
    classification: row.classification,
    lengthKm: row.lengthKm,
    row: row.row,
    yearConstructed: row.yearConstructed,
    surfaceType: worst ? worst.type : null,
    condition: worst ? worst.condition : null,
    surfaceSummary: buildSurfaceSummary(row.surfaces),
    surfaces: row.surfaces,
    // --- added by this repair, all derived and auditable ---
    barangayEnd: resolved.barangayEnd,
    barangaySource: resolved.source,
    barangayNote: resolved.reason,
    placeChain: resolved.chain,
    sitios: resolved.sitios,
    pavedKm,
    unpavedKm,
    unpavedType,
    unpavedCondition: worstCondition(unpaved.map((s) => s.condition)),
  };
}

// ---------------------------------------------------------------------------

const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
const rebuilt = rows.map(buildRecord);
const previous = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

const problems = [];
const assert = (condition, message) => { if (!condition) problems.push(message); };

assert(rebuilt.length === 143, `Expected 143 roads, built ${rebuilt.length}`);
assert(previous.length === rebuilt.length, `Row count changed: ${previous.length} -> ${rebuilt.length}`);

// Prove nothing but barangay attribution moved: every field the app already read
// must round-trip from the CSV unchanged.
const PRESERVED = ['roadName', 'classification', 'lengthKm', 'row', 'yearConstructed',
  'surfaceType', 'condition', 'surfaceSummary'];
const drift = [];

// Compared POSITIONALLY, not by name: three road names legitimately appear twice
// in the CSV as separate segments with different lengths and build years
// ("Bucari Road" 0.99 km/Fair and 0.09 km/Poor, "Jamog Gines Road" 0.14 km and
// 0.30 km, "Isian Victoria Road" 0.77 km and 2.89 km). Keying a lookup on
// roadName silently drops one of each pair and reports false drift.
for (let i = 0; i < rebuilt.length; i += 1) {
  const record = rebuilt[i];
  const before = previous[i];
  if (!before) { drift.push({ index: i, roadName: record.roadName, field: '(row)', before: 'missing', after: 'present' }); continue; }
  for (const field of PRESERVED) {
    if (JSON.stringify(before[field]) !== JSON.stringify(record[field])) {
      drift.push({ index: i, roadName: record.roadName, field, before: before[field], after: record[field] });
    }
  }
  if (JSON.stringify(before.surfaces) !== JSON.stringify(record.surfaces)) {
    drift.push({ index: i, roadName: record.roadName, field: 'surfaces', before: before.surfaces, after: record.surfaces });
  }
}

// Road names that are not unique -- any inventory<->project join on roadName must
// disambiguate these three by length rather than taking the first match.
const nameCounts = rebuilt.reduce((acc, r) => { acc[r.roadName] = (acc[r.roadName] || 0) + 1; return acc; }, {});
const duplicateRoadNames = Object.entries(nameCounts)
  .filter(([, n]) => n > 1)
  .map(([roadName, n]) => ({
    roadName,
    count: n,
    lengthsKm: rebuilt.filter((r) => r.roadName === roadName).map((r) => r.lengthKm),
  }));
assert(drift.length === 0, `${drift.length} preserved field(s) drifted -- see report`);

const canonical = new Set(LEON_BARANGAYS);
const nonCanonical = rebuilt.filter((r) => r.barangay && !canonical.has(r.barangay));
assert(nonCanonical.length === 0,
  `${nonCanonical.length} barangay value(s) are not canonical: ${nonCanonical.map((r) => r.barangay).join(', ')}`);

const barangayChanges = rebuilt
  .map((record, i) => ({ record, before: previous[i] }))
  .filter(({ record, before }) => before && before.barangay !== record.barangay)
  .map(({ record, before }) => ({
    roadName: record.roadName,
    before: before.barangay,
    after: record.barangay,
    source: record.barangaySource,
    note: record.barangayNote,
  }));

const unresolved = rebuilt.filter((r) => !r.barangay);
const withGap = rebuilt.filter((r) => r.unpavedKm > 0);
const gapKms = withGap.map((r) => r.unpavedKm).sort((a, b) => a - b);

const report = {
  generatedAt: new Date().toISOString(),
  source: 'Leon_barangay_roads.csv',
  roads: rebuilt.length,
  preservedFieldDrift: drift,
  duplicateRoadNames,
  barangayChanges,
  barangaySourceCounts: rebuilt.reduce((acc, r) => {
    acc[r.barangaySource] = (acc[r.barangaySource] || 0) + 1;
    return acc;
  }, {}),
  unresolved: unresolved.map((r) => ({ roadName: r.roadName, note: r.barangayNote })),
  distinctBarangays: [...new Set(rebuilt.map((r) => r.barangay).filter(Boolean))].sort(),
  unpaved: {
    roadsWithUnpavedSection: withGap.length,
    totalUnpavedKm: Number(gapKms.reduce((a, b) => a + b, 0).toFixed(2)),
    minKm: gapKms[0] ?? null,
    medianKm: gapKms[Math.floor(gapKms.length / 2)] ?? null,
    maxKm: gapKms[gapKms.length - 1] ?? null,
    atOrAbove0_8Km: gapKms.filter((k) => k >= 0.8).length,
    atOrAbove1_2Km: gapKms.filter((k) => k >= 1.2).length,
  },
  problems,
};

console.log(`Roads parsed from CSV:        ${rebuilt.length}`);
console.log(`Preserved-field drift:        ${drift.length} (must be 0)`);
console.log(`Barangay values corrected:    ${barangayChanges.length}`);
console.log(`Resolution by source:         ${JSON.stringify(report.barangaySourceCounts)}`);
console.log(`Distinct barangays:           ${report.distinctBarangays.length} (all canonical)`);
console.log(`Unresolved roads:             ${unresolved.length}`);
unresolved.forEach((r) => console.log(`    - ${r.roadName}  (${r.barangayNote})`));
console.log(`Duplicate road names:         ${duplicateRoadNames.length} (joins must disambiguate by length)`);
console.log(`Roads with unpaved section:   ${withGap.length}  total ${report.unpaved.totalUnpavedKm} km`);
console.log(`  unpaved km  min ${report.unpaved.minKm} / median ${report.unpaved.medianKm} / max ${report.unpaved.maxKm}`);
console.log(`  >= 0.8 km: ${report.unpaved.atOrAbove0_8Km}    >= 1.2 km: ${report.unpaved.atOrAbove1_2Km}`);

if (barangayChanges.length > 0) {
  console.log('\nCorrections:');
  for (const change of barangayChanges) {
    console.log(`  "${change.before}" -> "${change.after}"   (${change.source})  ${change.roadName}`);
  }
}

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nReport written to ${REPORT_PATH}`);

if (problems.length > 0) {
  console.error('\nFAILED assertions:');
  problems.forEach((p) => console.error(`  - ${p}`));
  if (drift.length > 0) {
    console.error('\n  First 10 drifted fields:');
    drift.slice(0, 10).forEach((d) => console.error(`    ${d.roadName} :: ${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`));
  }
  process.exit(1);
}

if (WRITE) {
  writeFileSync(JSON_PATH, `${JSON.stringify(rebuilt, null, 2)}\n`);
  console.log(`Wrote ${JSON_PATH}`);
} else {
  console.log('\nAll assertions passed. Re-run with --write to update the JSON.');
}
