const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECTS_FILE = path.join(__dirname, 'leon_fmr_projects_live.json');
const BARANGAY_CACHE_FILE = path.join(__dirname, 'barangay_geocode_cache.json');
const OUTPUT_FILE = path.join(ROOT, 'supabase_define_missing_leon_project_routes.sql');
const SNAP_ROUTES = process.argv.includes('--snap');

const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
const barangayCache = JSON.parse(fs.readFileSync(BARANGAY_CACHE_FILE, 'utf8'));

const BARANGAY_COORDINATE_OVERRIDES = {
  // Local cache misses or outliers, anchored to public barangay profile coordinates.
  Ayubo: { lat: 10.7927, lng: 122.3249, source: 'philatlas' },
  Baje: { lat: 10.7987, lng: 122.3414, source: 'philatlas' },
  'Biri Sur': { lat: 10.7594, lng: 122.3923, source: 'philatlas' },
  Salngan: { lat: 10.7801, lng: 122.3654, source: 'philatlas' },
  Talacuan: { lat: 10.7730, lng: 122.3894, source: 'philatlas' },
  Tunguan: { lat: 10.8704, lng: 122.3346, source: 'philatlas' },
};

const barangayCoordinates = {
  ...barangayCache,
  ...BARANGAY_COORDINATE_OVERRIDES,
};

const BARANGAY_ALIASES = {
  'Tac. Norte': 'Tacuyong Norte',
  'Tac. Sur': 'Tacuyong Sur',
  'Talacu-an': 'Talacuan',
};

const ROAD_GAP_PROJECTS = {
  201: { gapKm: 1.44, type: 'Earth Surface Gap', reason: 'Agboy Norte-Siol Norte has 98% earth surface in poor condition, creating a priority market-access gap.' },
  206: { gapKm: 2.60, type: 'Gravel Surface Gap', reason: 'Avanzada-Baje has a long gravel/poor-condition portion that weakens all-weather connectivity.' },
  219: { gapKm: 2.28, type: 'Earth Surface Gap', reason: 'Binolbog-Ambulong is recorded as fully earth surfaced and poor, a clear missing paved link.' },
  226: { gapKm: 3.44, type: 'Mixed Earth/Gravel Gap', reason: 'Bucari-Cagay-Ingay has combined earth and gravel sections that constrain highland access.' },
  228: { gapKm: 2.11, type: 'Critical Earth Gap', reason: 'Bucari-Cumpan-Sibucao is recorded as a critical earth road gap.' },
  231: { gapKm: 2.47, type: 'Mixed Earth/Gravel Gap', reason: 'Buga-Sitio Dao-Baong has mostly earth and gravel surface, affecting rainy-season access.' },
  232: { gapKm: 3.68, type: 'Mixed Earth/Gravel Gap', reason: 'Buga-Kananghan-Iguaras has a long unpaved section suitable for gap-based prioritization.' },
  236: { gapKm: 1.90, type: 'Earth Surface Gap', reason: 'Buga-Sitio Tibod-Lanag is recorded as fully earth surfaced in poor condition.' },
  257: { gapKm: 2.49, type: 'Gravel Surface Gap', reason: 'Dorog-Cawilihan has a long gravel segment that can delay produce movement.' },
  295: { gapKm: 2.00, type: 'Gravel Surface Gap', reason: 'Malublub-Sitio Lintian is fully gravel surfaced and can justify improvement priority.' },
  297: { gapKm: 1.82, type: 'Earth Surface Gap', reason: 'Malublub-Sitio Tumotob is recorded as fully earth surfaced and poor.' },
  334: { gapKm: 1.44, type: 'Earth Surface Gap', reason: 'Tu-og-Siol Norte is recorded as a full earth surface gap.' },
};

function hasCoord(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function cleanBarangay(value) {
  return String(value || '')
    .replace(/^Brgy\.\s*/i, '')
    .replace(/\s+Road$/i, '')
    .trim();
}

function extractBarangays(project) {
  const haystack = `${project.project_name || ''} ${project.location || ''}`;
  const known = Object.keys(barangayCoordinates).sort((a, b) => b.length - a.length);
  const matches = [];

  for (const [alias, barangay] of Object.entries(BARANGAY_ALIASES)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^A-Za-z])(${escaped})([^A-Za-z]|$)`, 'ig');
    let match;
    while ((match = re.exec(haystack)) !== null) {
      matches.push({ barangay, index: match.index + match[1].length });
    }
  }

  for (const barangay of known) {
    const escaped = barangay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^A-Za-z])((?:Brgy\\.\\s*)?${escaped})([^A-Za-z]|$)`, 'ig');
    let match;
    while ((match = re.exec(haystack)) !== null) {
      const startIndex = match.index + match[1].length;
      const before = haystack.slice(Math.max(0, startIndex - 8), startIndex).toLowerCase();
      if (before.endsWith('sitio ')) continue;
      matches.push({ barangay, index: startIndex });
    }
  }

  if (matches.length > 0) {
    const ordered = matches.sort((a, b) => a.index - b.index);
    return [...new Set(ordered.map((match) => match.barangay))];
  }

  const fallback = cleanBarangay(project.location);
  return barangayCoordinates[fallback] ? [fallback] : [];
}

function destinationPoint(lat, lng, bearingDeg, distanceKm) {
  const radiusKm = 6371.0088;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const bearing = toRad(bearingDeg);
  const angularDistance = distanceKm / radiusKm;
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [Number(toDeg(lat2).toFixed(6)), Number(toDeg(lng2).toFixed(6))];
}

function bearingFromName(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 180;
}

function haversineKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    const radiusKm = 6371.0088;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    km += radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return Number(km.toFixed(2));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'KalsaTrack route seeder' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

async function snapRoute(points) {
  if (!SNAP_ROUTES || !Array.isArray(points) || points.length < 2) {
    return { points, snapped: false };
  }

  const coordString = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
  const json = await fetchJson(url);
  const snapped = json?.routes?.[0]?.geometry?.coordinates
    ?.map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  return snapped?.length >= 2 ? { points: snapped, snapped: true } : { points, snapped: false };
}

function routeSeedForProject(project) {
  const barangays = extractBarangays(project);
  const lengthKm = Number(project.project_length_km);
  if (barangays.length === 0 || !Number.isFinite(lengthKm) || lengthKm <= 0) return null;

  if (barangays.length >= 2) {
    const start = barangayCoordinates[barangays[0]];
    const end = barangayCoordinates[barangays[1]];
    return {
      barangays,
      basePoints: [
        [Number(start.lat.toFixed(6)), Number(start.lng.toFixed(6))],
        [Number(end.lat.toFixed(6)), Number(end.lng.toFixed(6))],
      ],
      method: 'barangay-to-barangay centroid route',
    };
  }

  const center = barangayCoordinates[barangays[0]];
  const halfLength = lengthKm / 2;
  const bearing = bearingFromName(project.project_name);
  return {
    barangays,
    basePoints: [
      destinationPoint(center.lat, center.lng, bearing + 180, halfLength),
      [Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))],
      destinationPoint(center.lat, center.lng, bearing, halfLength),
    ],
    method: 'single-barangay centroid route scaled to project length',
  };
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonb(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function routeQuality(route, declaredLengthKm) {
  if (!route.snapped) return 'barangay approximate';
  if (!Number.isFinite(route.mappedLengthKm) || !Number.isFinite(declaredLengthKm) || declaredLengthKm <= 0) {
    return 'road-snapped approximate';
  }
  const ratio = route.mappedLengthKm / declaredLengthKm;
  const delta = Math.abs(route.mappedLengthKm - declaredLengthKm);
  if (ratio > 2 || delta > 2) return 'road-snapped approximate - length mismatch';
  return 'road-snapped approximate';
}

const missing = projects
  .filter((project) => project.municipality === undefined || project.municipality === 'Leon' || project.source === 'DA-LGU Leon (CSV)' || /Leon/i.test(project.location || project.project_name || ''))
  .filter((project) => !(hasCoord(project.start_latitude) && hasCoord(project.start_longitude) && hasCoord(project.end_latitude) && hasCoord(project.end_longitude)))
  .filter((project) => Number(project.project_length_km) > 0);

async function main() {
  const routeRows = [];

  for (const project of missing) {
    const seed = routeSeedForProject(project);
    if (!seed) {
      routeRows.push({ project, route: null });
      continue;
    }

    let points = seed.basePoints;
    let snapped = false;
    try {
      const result = await snapRoute(seed.basePoints);
      points = result.points;
      snapped = result.snapped;
    } catch (error) {
      console.warn(`OSRM snap failed for ${project.id}: ${error.message}`);
    }

    routeRows.push({
      project,
      route: {
        ...seed,
        points,
        start: points[0],
        end: points[points.length - 1],
        snapped,
        mappedLengthKm: haversineKm(points),
      },
    });
  }

  const matched = routeRows.filter((row) => row.route);
  const unmatched = routeRows.filter((row) => !row.route);
  const lines = [];

  lines.push('-- ============================================================');
  lines.push('-- KalsaTrack - Define Missing Leon Project Routes');
  lines.push('-- Generated from scripts/leon_fmr_projects_live.json and barangay_geocode_cache.json');
  lines.push(SNAP_ROUTES ? '-- Routes were requested from OSRM road-network geometry.' : '-- Routes are approximate barangay-based lines, not surveyed GPS polylines.');
  lines.push('-- Keep project_length_km as the declared project length; mapped_length_km records generated geometry length.');
  lines.push('-- Ayubo, Baje, Biri Sur, Salngan, Talacuan, and Tunguan use barangay profile coordinate overrides.');
  lines.push('-- ============================================================');
  lines.push('');
  lines.push('CREATE TABLE IF NOT EXISTS public.project_routes (');
  lines.push('  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,');
  lines.push('  project_id BIGINT NOT NULL UNIQUE REFERENCES public.fmr_projects(id) ON DELETE CASCADE,');
  lines.push('  start_latitude DOUBLE PRECISION,');
  lines.push('  start_longitude DOUBLE PRECISION,');
  lines.push('  end_latitude DOUBLE PRECISION,');
  lines.push('  end_longitude DOUBLE PRECISION,');
  lines.push("  route_points JSONB DEFAULT '[]'::jsonb,");
  lines.push("  route_source TEXT DEFAULT 'manual',");
  lines.push("  route_quality TEXT DEFAULT 'approximate',");
  lines.push('  declared_length_km DOUBLE PRECISION,');
  lines.push('  mapped_length_km DOUBLE PRECISION,');
  lines.push('  road_gap_km DOUBLE PRECISION,');
  lines.push('  road_gap_type TEXT,');
  lines.push('  road_gap_reason TEXT,');
  lines.push('  created_at TIMESTAMPTZ DEFAULT now(),');
  lines.push('  updated_at TIMESTAMPTZ DEFAULT now()');
  lines.push(');');
  lines.push('');
  lines.push("ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS route_source TEXT DEFAULT 'manual';");
  lines.push("ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS route_quality TEXT DEFAULT 'approximate';");
  lines.push('ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS declared_length_km DOUBLE PRECISION;');
  lines.push('ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS mapped_length_km DOUBLE PRECISION;');
  lines.push('ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS road_gap_km DOUBLE PRECISION;');
  lines.push('ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS road_gap_type TEXT;');
  lines.push('ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS road_gap_reason TEXT;');
  lines.push('');
  lines.push('ALTER TABLE public.fmr_projects ADD COLUMN IF NOT EXISTS road_gap_km DOUBLE PRECISION;');
  lines.push('ALTER TABLE public.fmr_projects ADD COLUMN IF NOT EXISTS road_gap_type TEXT;');
  lines.push('ALTER TABLE public.fmr_projects ADD COLUMN IF NOT EXISTS road_gap_reason TEXT;');
  lines.push('');
  lines.push('INSERT INTO public.project_routes (project_id, start_latitude, start_longitude, end_latitude, end_longitude, route_points, route_source, route_quality, declared_length_km, mapped_length_km, road_gap_km, road_gap_type, road_gap_reason)');
  lines.push('VALUES');

  matched.forEach(({ project, route }, index) => {
    const comma = index === matched.length - 1 ? '' : ',';
    const gap = ROAD_GAP_PROJECTS[project.id] || {};
    const middlePoints = route.points.slice(1, -1);
    const declaredLengthKm = Number(project.project_length_km);
    lines.push(
      `  (${project.id}, ${route.start[0]}, ${route.start[1]}, ${route.end[0]}, ${route.end[1]}, ${jsonb(middlePoints)}, ${sqlString(route.snapped ? 'OSRM' : 'barangay centroid')}, ${sqlString(routeQuality(route, declaredLengthKm))}, ${declaredLengthKm}, ${route.mappedLengthKm}, ${gap.gapKm ?? 'NULL'}, ${gap.type ? sqlString(gap.type) : 'NULL'}, ${gap.reason ? sqlString(gap.reason) : 'NULL'})${comma} -- ${project.project_name} | ${route.barangays.join(' to ')} | declared ${project.project_length_km} km | mapped ${route.mappedLengthKm} km | ${route.method}`
    );
  });

  lines.push('ON CONFLICT (project_id) DO UPDATE SET');
  lines.push('  start_latitude = EXCLUDED.start_latitude,');
  lines.push('  start_longitude = EXCLUDED.start_longitude,');
  lines.push('  end_latitude = EXCLUDED.end_latitude,');
  lines.push('  end_longitude = EXCLUDED.end_longitude,');
  lines.push('  route_points = EXCLUDED.route_points,');
  lines.push('  route_source = EXCLUDED.route_source,');
  lines.push('  route_quality = EXCLUDED.route_quality,');
  lines.push('  declared_length_km = EXCLUDED.declared_length_km,');
  lines.push('  mapped_length_km = EXCLUDED.mapped_length_km,');
  lines.push('  road_gap_km = EXCLUDED.road_gap_km,');
  lines.push('  road_gap_type = EXCLUDED.road_gap_type,');
  lines.push('  road_gap_reason = EXCLUDED.road_gap_reason,');
  lines.push('  updated_at = now();');
  lines.push('');
  lines.push('-- Keep fmr_projects start/end columns aligned for older views that do not read project_routes first.');
  lines.push('UPDATE public.fmr_projects AS p');
  lines.push('SET');
  lines.push('  start_latitude = r.start_latitude,');
  lines.push('  start_longitude = r.start_longitude,');
  lines.push('  end_latitude = r.end_latitude,');
  lines.push('  end_longitude = r.end_longitude');
  lines.push('FROM public.project_routes AS r');
  lines.push('WHERE p.id = r.project_id');
  lines.push('  AND p.id IN (');
  lines.push(`    ${matched.map(({ project }) => project.id).join(', ')}`);
  lines.push('  );');
  lines.push('');
  lines.push('UPDATE public.fmr_projects AS p');
  lines.push('SET');
  lines.push('  road_gap_km = r.road_gap_km,');
  lines.push('  road_gap_type = r.road_gap_type,');
  lines.push('  road_gap_reason = r.road_gap_reason');
  lines.push('FROM public.project_routes AS r');
  lines.push('WHERE p.id = r.project_id');
  lines.push('  AND r.road_gap_km IS NOT NULL;');
  lines.push('');
  lines.push('-- Explicit gap metadata for prioritized projects, including projects whose GPS route already existed.');
  lines.push('UPDATE public.fmr_projects AS p');
  lines.push('SET');
  lines.push('  road_gap_km = gaps.road_gap_km,');
  lines.push('  road_gap_type = gaps.road_gap_type,');
  lines.push('  road_gap_reason = gaps.road_gap_reason');
  lines.push('FROM (VALUES');
  Object.entries(ROAD_GAP_PROJECTS).forEach(([projectId, gap], index, all) => {
    const comma = index === all.length - 1 ? '' : ',';
    lines.push(`  (${projectId}::bigint, ${gap.gapKm}::double precision, ${sqlString(gap.type)}::text, ${sqlString(gap.reason)}::text)${comma}`);
  });
  lines.push(') AS gaps(project_id, road_gap_km, road_gap_type, road_gap_reason)');
  lines.push('WHERE p.id = gaps.project_id;');
  lines.push('');
  lines.push(`-- Generated ${matched.length} route definitions.`);
  lines.push(`-- Snap mode: ${SNAP_ROUTES ? 'OSRM road-network requested' : 'off; run node scripts/generate_missing_project_routes_sql.cjs --snap to request road-network geometry'}.`);
  lines.push(`-- Explicit road gap projects: ${Object.keys(ROAD_GAP_PROJECTS).length}.`);
  if (unmatched.length > 0) {
    lines.push(`-- Unmatched projects (${unmatched.length}) need manual review:`);
    unmatched.forEach(({ project }) => lines.push(`--   ${project.id}: ${project.project_name}`));
  }

  fs.writeFileSync(OUTPUT_FILE, `${lines.join('\n')}\n`);

  console.log(`Missing route candidates: ${missing.length}`);
  console.log(`Generated route definitions: ${matched.length}`);
  console.log(`Manual review needed: ${unmatched.length}`);
  console.log(`Snap mode: ${SNAP_ROUTES ? 'OSRM' : 'off'}`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
