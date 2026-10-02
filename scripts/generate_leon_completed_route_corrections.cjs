const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECTS_FILE = path.join(__dirname, 'leon_fmr_projects_live.json');
const BARANGAY_CACHE_FILE = path.join(__dirname, 'barangay_geocode_cache.json');
const OUTPUT_SQL = path.join(ROOT, 'supabase_correct_leon_completed_project_routes.sql');
const OUTPUT_AUDIT = path.join(ROOT, 'leon_completed_route_length_audit.json');

const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
const barangayCache = JSON.parse(fs.readFileSync(BARANGAY_CACHE_FILE, 'utf8'));

const BARANGAY_COORDINATE_OVERRIDES = {
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
  201: { gapKm: 1.44, type: 'Earth Surface Gap', reason: 'Agboy Norte-Siol Norte has a major earth-surface section, useful for priority scoring despite the road being listed completed.' },
  206: { gapKm: 2.60, type: 'Gravel Surface Gap', reason: 'Avanzada-Baje has a long gravel/poor-condition portion that weakens all-weather connectivity.' },
  219: { gapKm: 2.28, type: 'Earth Surface Gap', reason: 'Binolbog-Ambulong is recorded as fully earth surfaced and poor, a clear improvement gap.' },
  226: { gapKm: 3.44, type: 'Mixed Earth/Gravel Gap', reason: 'Bucari-Cagay-Ingay has combined earth and gravel sections constraining highland access.' },
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
    .replace(/\s+(Rd\.?|Road|FMR)$/i, '')
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
    return [...new Set(matches.sort((a, b) => a.index - b.index).map((match) => match.barangay))];
  }

  const fallback = cleanBarangay(project.location);
  return barangayCoordinates[fallback] ? [fallback] : [];
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function haversineKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    const radiusKm = 6371.0088;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    km += radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return km;
}

function destinationPoint(lat, lng, bearingDeg, distanceKm) {
  const radiusKm = 6371.0088;
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

function bearingBetween(start, end) {
  const [lat1, lng1] = start.map(toRad);
  const [lat2, lng2] = end.map(toRad);
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function bearingFromName(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 180;
}

function coordForBarangay(barangay) {
  const point = barangayCoordinates[barangay];
  if (!point) return null;
  return [Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6))];
}

function curveMidpoint(start, end, projectId, targetKm) {
  const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const bearing = bearingBetween(start, end) + 90;
  const offsetKm = Math.min(0.035, Math.max(0.008, targetKm * 0.012)) * (projectId % 2 === 0 ? 1 : -1);
  return destinationPoint(mid[0], mid[1], bearing, offsetKm);
}

function routeForProject(project) {
  const targetKm = Number(project.project_length_km);
  const barangays = extractBarangays(project);
  let seedStart = null;
  let seedEnd = null;
  let bearing = bearingFromName(project.project_name);
  let method = 'single-barangay declared-length route';

  if (hasCoord(project.start_latitude) && hasCoord(project.start_longitude)) {
    seedStart = [Number(project.start_latitude), Number(project.start_longitude)];
    if (hasCoord(project.end_latitude) && hasCoord(project.end_longitude)) {
      seedEnd = [Number(project.end_latitude), Number(project.end_longitude)];
      bearing = bearingBetween(seedStart, seedEnd);
      method = 'trimmed existing start/end bearing to declared length';
    }
  }

  if (!seedStart && barangays.length > 0) {
    seedStart = coordForBarangay(barangays[0]);
  }

  if (!seedEnd && barangays.length >= 2) {
    seedEnd = coordForBarangay(barangays[1]);
    if (seedStart && seedEnd) {
      bearing = bearingBetween(seedStart, seedEnd);
      method = 'barangay-to-barangay bearing scaled to declared length';
    }
  }

  if (!seedStart || !Number.isFinite(targetKm) || targetKm <= 0) return null;

  let start;
  let end;
  if (method === 'single-barangay declared-length route') {
    start = destinationPoint(seedStart[0], seedStart[1], bearing + 180, targetKm / 2);
    end = destinationPoint(seedStart[0], seedStart[1], bearing, targetKm / 2);
  } else {
    start = seedStart;
    end = destinationPoint(seedStart[0], seedStart[1], bearing, targetKm);
  }

  const mid = curveMidpoint(start, end, Number(project.id), targetKm);
  const points = [start, mid, end];
  const mappedKm = haversineKm(points);
  const scale = targetKm / mappedKm;

  if (Number.isFinite(scale) && Math.abs(mappedKm - targetKm) > 0.01) {
    if (method === 'single-barangay declared-length route') {
      start = destinationPoint(seedStart[0], seedStart[1], bearing + 180, (targetKm / 2) * scale);
      end = destinationPoint(seedStart[0], seedStart[1], bearing, (targetKm / 2) * scale);
    } else {
      end = destinationPoint(seedStart[0], seedStart[1], bearing, targetKm * scale);
    }
  }

  const adjusted = [start, curveMidpoint(start, end, Number(project.id), targetKm), end];
  return {
    barangays,
    start: adjusted[0],
    end: adjusted[adjusted.length - 1],
    routePoints: adjusted.slice(1, -1),
    mappedKm: Number(haversineKm(adjusted).toFixed(2)),
    method,
  };
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonb(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

const completedLeon = projects
  .filter((project) => String(project.status || '').toLowerCase() === 'completed')
  .filter((project) => Number(project.project_length_km) > 0)
  .filter((project) => project.source === 'DA-LGU Leon (CSV)' || /Leon/i.test(`${project.project_name || ''} ${project.location || ''}`));

const rows = completedLeon
  .map((project) => {
    const route = routeForProject(project);
    if (!route) return null;
    const targetKm = Number(project.project_length_km);
    const originalPoints =
      hasCoord(project.start_latitude) && hasCoord(project.start_longitude) && hasCoord(project.end_latitude) && hasCoord(project.end_longitude)
        ? [[Number(project.start_latitude), Number(project.start_longitude)], [Number(project.end_latitude), Number(project.end_longitude)]]
        : [];
    const originalKm = originalPoints.length >= 2 ? Number(haversineKm(originalPoints).toFixed(2)) : null;
    const delta = originalKm === null ? null : Number((originalKm - targetKm).toFixed(2));
    return {
      project,
      route,
      targetKm,
      originalKm,
      delta,
      needsCorrection: originalKm === null || Math.abs(originalKm - targetKm) > Math.max(0.08, targetKm * 0.15),
    };
  })
  .filter(Boolean);

const audit = rows.map(({ project, route, targetKm, originalKm, delta, needsCorrection }) => ({
  id: project.id,
  project_name: project.project_name,
  location: project.location,
  target_km: targetKm,
  original_straight_km: originalKm,
  original_delta_km: delta,
  corrected_mapped_km: route.mappedKm,
  needs_correction: needsCorrection,
  method: route.method,
  barangays: route.barangays,
  road_gap_km: ROAD_GAP_PROJECTS[project.id]?.gapKm ?? null,
}));

const correctedRows = rows.filter((row) => row.needsCorrection || ROAD_GAP_PROJECTS[row.project.id]);

const lines = [];
lines.push('-- ============================================================');
lines.push('-- KalsaTrack - Correct Leon Completed Project Routes');
lines.push('-- Generated by scripts/generate_leon_completed_route_corrections.cjs');
lines.push('-- Purpose: make completed Leon project map lengths match declared/project-description km.');
lines.push('-- This avoids OSRM detours that made short completed roads display as unrealistically long.');
lines.push('-- Review leon_completed_route_length_audit.json before running this SQL in Supabase.');
lines.push('-- ============================================================');
lines.push('');
lines.push('ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS route_source TEXT DEFAULT \'manual\';');
lines.push('ALTER TABLE public.project_routes ADD COLUMN IF NOT EXISTS route_quality TEXT DEFAULT \'approximate\';');
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

correctedRows.forEach(({ project, route, targetKm }, index) => {
  const gap = ROAD_GAP_PROJECTS[project.id] || {};
  const comma = index === correctedRows.length - 1 ? '' : ',';
  lines.push(
    `  (${project.id}, ${route.start[0]}, ${route.start[1]}, ${route.end[0]}, ${route.end[1]}, ${jsonb(route.routePoints)}, 'declared-length-calibrated', 'length-calibrated review', ${targetKm}, ${route.mappedKm}, ${gap.gapKm ?? 'NULL'}, ${gap.type ? sqlString(gap.type) : 'NULL'}, ${gap.reason ? sqlString(gap.reason) : 'NULL'})${comma} -- ${project.project_name} | declared ${targetKm} km | mapped ${route.mappedKm} km | ${route.method}`
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
lines.push('-- Keep fmr_projects start/end columns aligned for older map views.');
lines.push('UPDATE public.fmr_projects AS p');
lines.push('SET');
lines.push('  start_latitude = r.start_latitude,');
lines.push('  start_longitude = r.start_longitude,');
lines.push('  end_latitude = r.end_latitude,');
lines.push('  end_longitude = r.end_longitude,');
lines.push('  road_gap_km = COALESCE(r.road_gap_km, p.road_gap_km),');
lines.push('  road_gap_type = COALESCE(r.road_gap_type, p.road_gap_type),');
lines.push('  road_gap_reason = COALESCE(r.road_gap_reason, p.road_gap_reason)');
lines.push('FROM public.project_routes AS r');
lines.push('WHERE p.id = r.project_id');
lines.push('  AND p.id IN (');
lines.push(`    ${correctedRows.map(({ project }) => project.id).join(', ')}`);
lines.push('  );');
lines.push('');
lines.push(`-- Audited completed Leon projects: ${rows.length}`);
lines.push(`-- Corrected/geotagged route rows in this SQL: ${correctedRows.length}`);
lines.push(`-- Explicit prioritization gap rows: ${Object.keys(ROAD_GAP_PROJECTS).length}`);

fs.writeFileSync(OUTPUT_AUDIT, `${JSON.stringify(audit, null, 2)}\n`);
fs.writeFileSync(OUTPUT_SQL, `${lines.join('\n')}\n`);

const mismatches = audit.filter((row) => row.needs_correction);
console.log(`Audited completed Leon projects: ${rows.length}`);
console.log(`Needs route correction or definition: ${mismatches.length}`);
console.log(`SQL rows generated: ${correctedRows.length}`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT_AUDIT)}`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT_SQL)}`);
console.table(
  mismatches.slice(0, 15).map((row) => ({
    id: row.id,
    target: row.target_km,
    original: row.original_straight_km,
    corrected: row.corrected_mapped_km,
    name: row.project_name.slice(0, 44),
  }))
);
