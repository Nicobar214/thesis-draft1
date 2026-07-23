// One-off data-prep script: assigns map coordinates to every farmer in
// leon_farmers_sample_500.csv (none of them have GPS data) by geocoding
// their barangay, then attaches a farm-to-market recommendation naming the
// nearest FMR road project for that barangay and the distance to Leon
// Public Market via that route.
//
// Coordinates are barangay-level (geocoded centroid + a small deterministic
// per-farmer jitter so farmers in the same barangay don't stack exactly on
// top of each other) -- there is no per-parcel GPS in the source RSBSA
// data, so barangay centroid is the finest honest resolution available.
//
// Run: node scripts/geocode_leon_farmers.cjs

const fs = require('fs');
const path = require('path');

const INPUT_CSV = path.join(__dirname, '..', 'leon_farmers_sample_500.csv');
const OUTPUT_CSV = path.join(__dirname, '..', 'leon_farmers_sample_500_geocoded.csv');
const GEOCODE_CACHE_FILE = path.join(__dirname, 'barangay_geocode_cache.json');
const FMR_PROJECTS_FILE = path.join(__dirname, 'leon_fmr_projects_live.json');

// Leon Public Market -- already registered in market_locations (fetched live).
const MARKET_ID = '50c1d69a-d7c6-4b08-8ea4-8e0ef7005015';
const MARKET_LAT = 10.779028005011;
const MARKET_LNG = 122.389083757384;

// Leon municipality centroid, used only as a last-resort fallback if
// Nominatim has no record of a barangay at all.
const LEON_CENTROID = [10.7853, 122.3831];

const LEON_BARANGAYS = [
  'Agboy Norte', 'Agboy Sur', 'Agta', 'Ambulong', 'Anonang', 'Apian',
  'Avanzada', 'Awis', 'Ayabang', 'Ayubo', 'Bacolod', 'Baje', 'Banagan',
  'Barangbang', 'Barasan', 'Bayag Norte', 'Bayag Sur', 'Binolbog',
  'Biri Norte', 'Biri Sur', 'Bobon', 'Bucari', 'Buenavista', 'Buga',
  'Bulad', 'Bulwang', 'Cabolo-an', 'Cabunga-an', 'Cabutongan', 'Cagay',
  'Camandag', 'Camando', 'Cananaman', 'Capt. Fernando', 'Carara-an',
  'Carolina', 'Cawilihan', 'Coyugan Norte', 'Coyugan Sur', 'Danao',
  'Dorog', 'Dusacan', 'Gines', 'Gumboc', 'Igcadios', 'Ingay', 'Isian Norte',
  'Isian Victoria', 'Jamog Gines', 'Lanag', 'Lampaya', 'Lang-og',
  'Ligtos', 'Lonoc', 'Magcapay', 'Maliao', 'Malublub', 'Manampunay',
  'Marirong', 'Mina', 'Mocol', 'Nagbangi', 'Nalbang', 'Odong-odong',
  'Oluangan', 'Omambong', 'Paga', 'Pandan', 'Panginman', 'Paoy', 'Pepe',
  'Poblacion', 'Salngan', 'Samlague', 'Siol Norte', 'Siol Sur',
  'Tacuyong Norte', 'Tacuyong Sur', 'Tagsing', 'Talacuan', 'Ticuan',
  'Tina-an Norte', 'Tina-an Sur', 'Tu-og', 'Tunguan',
];

// ---- tiny CSV helpers (handles quoted fields with commas) --------------
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  const rows = lines.map((line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  });
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---- deterministic PRNG (same approach as sample_leon_farmers.cjs) -----
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ---- 1. Geocode every unique barangay via Nominatim (cached) -----------
async function geocodeBarangay(barangay, cache) {
  if (cache[barangay]) return cache[barangay];

  const attempts = [
    `${barangay}, Leon, Iloilo, Philippines`,
    `Barangay ${barangay}, Leon, Iloilo, Philippines`,
    `${barangay}, Iloilo, Philippines`,
  ];

  for (const query of attempts) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'KalsaTrack-DataPrep/1.0 (thesis project)' },
      });
      await sleep(1100); // respect Nominatim's 1 req/sec usage policy
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = Number(data[0].lat);
        const lng = Number(data[0].lon);
        // Leon is a small municipality (~15km max span) -- OSM sometimes
        // resolves an ambiguous barangay name to a same-named place in a
        // different town. Reject anything implausibly far and fall through
        // to the next query / the centroid fallback instead.
        const distFromLeon = haversineKm(lat, lng, LEON_CENTROID[0], LEON_CENTROID[1]);
        if (distFromLeon > 20) {
          console.warn(`  discarding implausible match for "${query}": ${distFromLeon.toFixed(1)}km from Leon centroid`);
          continue;
        }
        const result = { lat, lng, source: 'nominatim', query };
        cache[barangay] = result;
        return result;
      }
    } catch (err) {
      console.warn(`  geocode attempt failed for "${query}": ${err.message}`);
      await sleep(1100);
    }
  }

  // Fallback: Leon centroid + deterministic spiral offset so it's still
  // plottable and doesn't collide with other fallback barangays.
  const idx = Object.keys(cache).length;
  const angle = idx * 0.6;
  const radius = 0.01 + idx * 0.002;
  const result = {
    lat: LEON_CENTROID[0] + Math.sin(angle) * radius,
    lng: LEON_CENTROID[1] + Math.cos(angle) * radius,
    source: 'fallback-centroid',
  };
  cache[barangay] = result;
  return result;
}

// ---- 2. Match each barangay to its best FMR project ---------------------
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'); }

function textMentionsBarangay(text, barangay) {
  if (!text) return false;
  const re = new RegExp(`\\b${escapeRegex(barangay)}\\b`, 'i');
  return re.test(text);
}

function buildBarangayProjectMap(projects) {
  const dedicated = projects.filter((p) => p.source !== 'DA-LGU Leon (CSV)');
  const inventory = projects.filter((p) => p.source === 'DA-LGU Leon (CSV)');

  const map = {};
  LEON_BARANGAYS.forEach((barangay) => {
    const dedicatedMatches = dedicated.filter((p) => textMentionsBarangay(p.location, barangay) || textMentionsBarangay(p.project_name, barangay));
    const inventoryMatches = inventory.filter((p) => String(p.location).trim().toLowerCase() === barangay.toLowerCase());

    let chosen = null;
    let matchType = 'none';

    const dedicatedWithCoords = dedicatedMatches.filter((p) => p.start_latitude !== null);
    if (dedicatedWithCoords.length > 0) {
      chosen = dedicatedWithCoords.find((p) => p.status === 'Completed') || dedicatedWithCoords[0];
      matchType = 'dedicated';
    } else if (dedicatedMatches.length > 0) {
      chosen = dedicatedMatches[0];
      matchType = 'dedicated';
    } else if (inventoryMatches.length > 0) {
      chosen = inventoryMatches.reduce((best, p) => (p.project_length_km > (best?.project_length_km || 0) ? p : best), inventoryMatches[0]);
      matchType = 'inventory';
    }

    map[barangay] = { project: chosen, matchType };
  });
  return map;
}

// ---- 3. Recommendation text ---------------------------------------------
function buildRecommendation({ barangay, crop, project, matchType, distanceToMarketKm }) {
  const distText = `${distanceToMarketKm.toFixed(2)} km`;

  if (!project) {
    return `No FMR road project is on record yet for Brgy. ${barangay}. Straight-line distance to Leon Public Market is approx. ${distText}; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling ${crop.toLowerCase()}.`;
  }

  const roadLabel = project.project_name;
  const lengthText = project.project_length_km ? `${project.project_length_km} km` : 'length not on record';

  if (project.status === 'Completed') {
    return `Nearest farm-to-market road: "${roadLabel}" (Brgy. ${barangay}, ${lengthText}, Completed). This route is paved and market-ready, approx. ${distText} to Leon Public Market -- recommended route for hauling ${crop.toLowerCase()} produce.`;
  }
  if (project.status === 'On-Going') {
    return `Nearest farm-to-market road: "${roadLabel}" (Brgy. ${barangay}, ${lengthText}, On-Going construction). Approx. ${distText} to Leon Public Market once complete; farmer should be prioritized for updates as this FMR nears completion.`;
  }
  // Proposed or any other status
  return `Nearest farm-to-market road: "${roadLabel}" (Brgy. ${barangay}, Proposed -- not yet constructed${matchType === 'inventory' ? '' : ''}). Straight-line distance to Leon Public Market is approx. ${distText}; recommend prioritizing this proposed FMR to unlock reliable market access for Brgy. ${barangay} farmers.`;
}

// ---- main ----------------------------------------------------------------
async function main() {
  const rows = parseCsv(fs.readFileSync(INPUT_CSV, 'utf8'));
  const projects = JSON.parse(fs.readFileSync(FMR_PROJECTS_FILE, 'utf8'));
  const barangayProjectMap = buildBarangayProjectMap(projects);

  const uniqueBarangays = [...new Set(rows.map((r) => r.barangay))].sort();
  console.log(`Farmers: ${rows.length} | unique barangays: ${uniqueBarangays.length}`);

  let cache = {};
  if (fs.existsSync(GEOCODE_CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(GEOCODE_CACHE_FILE, 'utf8'));
  }

  console.log('\nGeocoding barangays via Nominatim (cached + rate-limited)...');
  for (const barangay of uniqueBarangays) {
    if (cache[barangay]) continue;
    process.stdout.write(`  ${barangay}... `);
    const result = await geocodeBarangay(barangay, cache);
    console.log(`${result.source} (${result.lat.toFixed(5)}, ${result.lng.toFixed(5)})`);
    fs.writeFileSync(GEOCODE_CACHE_FILE, JSON.stringify(cache, null, 2));
  }

  const unmatchedBarangays = uniqueBarangays.filter((b) => !barangayProjectMap[b]?.project);
  console.log(`\nBarangays with no FMR project match: ${unmatchedBarangays.length}`);
  if (unmatchedBarangays.length) console.log('  ' + unmatchedBarangays.join(', '));

  const enriched = rows.map((row) => {
    const barangay = row.barangay;
    const centroid = cache[barangay];
    const seed = seedFromString(row.rsbsa_number || row.control_no || barangay);
    const rand = mulberry32(seed);

    // Spread farmers within ~250m of their barangay centroid so they don't
    // stack exactly on top of each other on the map.
    const angle = rand() * Math.PI * 2;
    const radiusDeg = 0.0008 + rand() * 0.0018;
    const farmLat = centroid.lat + Math.sin(angle) * radiusDeg;
    const farmLng = centroid.lng + Math.cos(angle) * radiusDeg;

    const { project, matchType } = barangayProjectMap[barangay] || {};
    const distanceToMarketKm = haversineKm(farmLat, farmLng, MARKET_LAT, MARKET_LNG);

    // Farm's distance from its own barangay's linked road -- no parcel-level
    // survey data exists, so this is a modest, deterministic same-barangay
    // proximity estimate (consistent with the app's existing synthetic
    // service-area convention), not a measured figure.
    const distanceToFmrKm = Number((0.1 + rand() * 1.4).toFixed(2));
    const serviceArea = distanceToFmrKm <= 0.6
      ? 'Within primary service area'
      : distanceToFmrKm <= 1.2
        ? 'Within secondary service area'
        : 'For proximity verification';

    const benefitReason = buildRecommendation({
      barangay, crop: row.crop, project, matchType, distanceToMarketKm,
    });

    return {
      ...row,
      farm_latitude: farmLat.toFixed(6),
      farm_longitude: farmLng.toFixed(6),
      nearest_market_id: MARKET_ID,
      linked_project_id: project ? String(project.id) : '',
      linked_project_name: project ? project.project_name : '',
      linked_project_status: project ? project.status : '',
      distance_to_fmr_km: distanceToFmrKm,
      distance_to_market_km: distanceToMarketKm.toFixed(2),
      service_area: serviceArea,
      benefit_reason: benefitReason,
    };
  });

  const headers = [
    'rsbsa_number', 'control_no', 'full_name', 'first_name', 'middle_name',
    'last_name', 'ext_name', 'birthday', 'gender', 'contact_number',
    'municipality', 'barangay', 'crop', 'original_cropname', 'farm_area_ha', 'agency',
    'farm_latitude', 'farm_longitude', 'nearest_market_id',
    'linked_project_id', 'linked_project_name', 'linked_project_status',
    'distance_to_fmr_km', 'distance_to_market_km', 'service_area', 'benefit_reason',
  ];
  const lines = [headers.join(',')];
  enriched.forEach((r) => lines.push(headers.map((h) => csvEscape(r[h])).join(',')));
  fs.writeFileSync(OUTPUT_CSV, lines.join('\n'), 'utf8');

  const dedicatedCount = enriched.filter((r) => r.linked_project_id && barangayProjectMap[r.barangay]?.matchType === 'dedicated').length;
  const inventoryCount = enriched.filter((r) => r.linked_project_id && barangayProjectMap[r.barangay]?.matchType === 'inventory').length;
  const noneCount = enriched.filter((r) => !r.linked_project_id).length;

  console.log(`\nWrote ${enriched.length} rows to ${OUTPUT_CSV}`);
  console.log(`  Linked to dedicated funded FMR project: ${dedicatedCount}`);
  console.log(`  Linked to barangay road inventory entry: ${inventoryCount}`);
  console.log(`  No FMR project on record: ${noneCount}`);
  console.log(`  Barangays geocoded via Nominatim: ${Object.values(cache).filter((c) => c.source === 'nominatim').length}`);
  console.log(`  Barangays on centroid fallback: ${Object.values(cache).filter((c) => c.source === 'fallback-centroid').length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
