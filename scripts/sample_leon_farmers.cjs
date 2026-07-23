// One-off data-prep script: filters leonfarmers.xlsx down to pure-crop
// farmers (no livestock/poultry), resolves one representative crop per
// farmer, stratified-samples 500 across barangays, and writes a review CSV.
// Also reports which crop names are new relative to BENEFICIARY_CROPS.
//
// Run: node scripts/sample_leon_farmers.cjs

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SOURCE_FILE = path.join(__dirname, '..', 'leonfarmers.xlsx');
const OUTPUT_FILE = path.join(__dirname, '..', 'leon_farmers_sample_500.csv');
const TARGET_TOTAL = 500;
const FLOOR_PER_BARANGAY = 2;

const ANIMAL_OR_NONCROP = new Set([
  'Chickens', 'Buffaloes (Carabaos)', 'Cattle', 'Pigs or swine', 'Goats',
  'Ducks', 'Turkeys', 'Rabbits and hares', 'Geese', 'Guinea Fowls', 'Quail',
  'Peacock', 'Other poultry', 'Bees', 'Other Fish', '',
]);

const EXISTING_CROPS = ['Rice', 'Corn', 'Sugarcane', 'Coconut', 'Vegetables', 'Banana'];

function cleanCropName(raw) {
  const trimmed = String(raw || '').replace(/\s+/g, ' ').trim();
  if (trimmed === 'Rice/Palay') return 'Rice';
  return trimmed;
}

// Deterministic seeded PRNG (mulberry32) so the sample is reproducible.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const rand = mulberry32(seed);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---- 1. Load + group by farmer ----------------------------------------
const wb = XLSX.readFile(SOURCE_FILE);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

const byFarmer = new Map();
rows.forEach((r) => {
  const id = r.rsbsa_no || r.control_no;
  if (!byFarmer.has(id)) byFarmer.set(id, []);
  byFarmer.get(id).push(r);
});

// ---- 2. Classify: keep pure-crop farmers only --------------------------
const pureCropFarmers = [];
byFarmer.forEach((entries) => {
  const cropRows = entries.filter((e) => !ANIMAL_OR_NONCROP.has(String(e.cropname).trim()));
  const animalRows = entries.filter((e) => ANIMAL_OR_NONCROP.has(String(e.cropname).trim()));
  if (cropRows.length === 0 || animalRows.length > 0) return; // not pure-crop

  // Representative crop = largest crop_area.
  const primary = cropRows.reduce((best, r) => {
    const area = Number(r.crop_area) || 0;
    const bestArea = Number(best.crop_area) || 0;
    return area > bestArea ? r : best;
  }, cropRows[0]);

  const base = entries[0];
  const fullName = [base.first_name, base.middle_name, base.last_name, base.ext_name]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');

  pureCropFarmers.push({
    rsbsa_number: base.rsbsa_no || '',
    control_no: base.control_no || '',
    full_name: fullName,
    first_name: base.first_name || '',
    middle_name: base.middle_name || '',
    last_name: base.last_name || '',
    ext_name: base.ext_name || '',
    birthday: base.birthday || '',
    gender: base.gender || '',
    contact_number: base.contact_num || '',
    municipality: 'Leon',
    barangay: String(base.farmer_address_bgy || '').trim(),
    crop: cleanCropName(primary.cropname),
    original_cropname: String(primary.cropname || '').trim(),
    farm_area_ha: Number(primary.crop_area) || 0,
    agency: base.agency || 'DA',
  });
});

console.log(`Pure-crop farmers eligible: ${pureCropFarmers.length}`);

// ---- 3. Group by barangay, allocate 500 proportionally with a floor ----
const byBarangay = new Map();
pureCropFarmers.forEach((f) => {
  const key = f.barangay || 'Unknown';
  if (!byBarangay.has(key)) byBarangay.set(key, []);
  byBarangay.get(key).push(f);
});

const barangays = [...byBarangay.keys()];
const availability = new Map(barangays.map((b) => [b, byBarangay.get(b).length]));

// Step 1: floor allocation (capped by availability).
const allocation = new Map();
let allocatedSoFar = 0;
barangays.forEach((b) => {
  const floor = Math.min(FLOOR_PER_BARANGAY, availability.get(b));
  allocation.set(b, floor);
  allocatedSoFar += floor;
});

// Step 2: distribute the remaining target proportionally to remaining
// capacity, using the largest-remainder method so the total lands exactly
// on TARGET_TOTAL.
let remainingTarget = TARGET_TOTAL - allocatedSoFar;
const remainingCapacity = new Map(barangays.map((b) => [b, availability.get(b) - allocation.get(b)]));
const totalRemainingCapacity = [...remainingCapacity.values()].reduce((a, b) => a + b, 0);

if (remainingTarget > 0 && totalRemainingCapacity > 0) {
  const shares = barangays.map((b) => {
    const raw = (remainingCapacity.get(b) / totalRemainingCapacity) * remainingTarget;
    const whole = Math.min(Math.floor(raw), remainingCapacity.get(b));
    return { b, raw, whole, remainder: raw - whole };
  });

  shares.forEach(({ b, whole }) => {
    allocation.set(b, allocation.get(b) + whole);
    remainingTarget -= whole;
  });

  // Largest-remainder method for the leftover units (rounding gaps).
  shares
    .filter(({ b, whole }) => remainingCapacity.get(b) - whole > 0)
    .sort((a, b) => b.remainder - a.remainder)
    .forEach(({ b }) => {
      if (remainingTarget <= 0) return;
      const capLeft = availability.get(b) - allocation.get(b);
      if (capLeft <= 0) return;
      allocation.set(b, allocation.get(b) + 1);
      remainingTarget -= 1;
    });
}

// ---- 4. Sample within each barangay (seeded, reproducible) -------------
const SEED = 20260723;
const selected = [];
barangays.forEach((b, idx) => {
  const pool = seededShuffle(byBarangay.get(b), SEED + idx);
  const take = Math.min(allocation.get(b) || 0, pool.length);
  selected.push(...pool.slice(0, take));
});

console.log(`Barangays represented: ${barangays.length}`);
console.log(`Total selected: ${selected.length} (target ${TARGET_TOTAL})`);

// ---- 5. Report new crops relative to the existing system list ---------
const selectedCrops = new Set(selected.map((f) => f.crop));
const newCrops = [...selectedCrops].filter((c) => !EXISTING_CROPS.includes(c)).sort();
console.log(`\nNew crops to add to BENEFICIARY_CROPS (${newCrops.length}):`);
console.log(newCrops.join(', '));

// ---- 6. Write CSV -------------------------------------------------------
const headers = [
  'rsbsa_number', 'control_no', 'full_name', 'first_name', 'middle_name',
  'last_name', 'ext_name', 'birthday', 'gender', 'contact_number',
  'municipality', 'barangay', 'crop', 'original_cropname', 'farm_area_ha', 'agency',
];
const csvLines = [headers.join(',')];
selected.forEach((f) => {
  csvLines.push(headers.map((h) => csvEscape(f[h])).join(','));
});
fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n'), 'utf8');
console.log(`\nWrote ${selected.length} rows to ${OUTPUT_FILE}`);

// Emit the new-crops list to a small json file too, for the follow-up code edit.
fs.writeFileSync(
  path.join(__dirname, 'new_crops.json'),
  JSON.stringify(newCrops, null, 2)
);
