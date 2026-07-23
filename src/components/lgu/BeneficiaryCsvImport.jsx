import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

const CHUNK_SIZE = 50;

function cropYieldPerHectare(crop) {
  if (crop === 'Rice') return 4.2;
  if (crop === 'Corn') return 3.6;
  if (crop === 'Sugarcane') return 65;
  if (crop === 'Coconut') return 8;
  if (crop === 'Vegetables') return 12;
  return 9;
}

function getField(row, ...keys) {
  const lowerMap = {};
  Object.keys(row).forEach((k) => { lowerMap[k.trim().toLowerCase()] = row[k]; });
  for (const key of keys) {
    const value = lowerMap[key.toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

// Excel epoch (Dec 30 1899) -> ISO date. Built via Date.UTC + read back with
// UTC getters so the conversion is pure day-count arithmetic, immune to
// whatever timezone the browser happens to be running in.
function excelSerialToISODate(serial) {
  const utcMs = Date.UTC(1899, 11, 30) + Math.round(Number(serial)) * 86400000;
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// xlsx's cellDates option hands back a JS Date constructed from LOCAL
// calendar fields (not UTC) -- so it must be read back with local getters;
// using toISOString (which converts to UTC first) shifts the day backward
// for any timezone ahead of UTC. Some cells also come through as
// already-reformatted "DD/MM/YYYY" strings depending on how xlsx's CSV
// type-sniffing guessed them, so that's normalized too.
function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function normalizeDateString(str) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return str;
}

// xlsx auto-detects "YYYY-MM-DD"-looking CSV/Excel cells as dates and hands
// back a JS Date, a raw Excel serial number, or a reformatted string instead
// of the plain text -- Postgres rejects the first two as-is, so normalize
// everything to a clean ISO date.
function getDateField(row, ...keys) {
  const lowerMap = {};
  Object.keys(row).forEach((k) => { lowerMap[k.trim().toLowerCase()] = row[k]; });
  for (const key of keys) {
    const value = lowerMap[key.toLowerCase()];
    if (value === undefined || value === null || value === '') continue;
    if (value instanceof Date) return formatLocalDate(value);
    if (typeof value === 'number') return excelSerialToISODate(value);
    const trimmed = String(value).trim();
    if (trimmed) return normalizeDateString(trimmed);
  }
  return '';
}

export default function BeneficiaryCsvImport({ user, profile, municipalityScope, onImported }) {
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [summary, setSummary] = useState(null); // { inserted, skipped, errors }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setSummary(null);
    setImporting(true);
    setProgress({ done: 0, total: 0 });

    try {
      // Lazy-loaded: xlsx is a sizeable library only needed for this
      // rarely-used bulk-import path, so keep it out of the main bundle.
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      const skippedReasons = [];
      const payloads = [];
      const submittedAt = new Date().toISOString();
      const submitterName = profile?.full_name || profile?.email || user.email;

      rawRows.forEach((row, idx) => {
        const fullNameField = getField(row, 'full_name');
        const firstName = getField(row, 'first_name');
        const lastName = getField(row, 'last_name');
        const fullName = fullNameField || [firstName, getField(row, 'middle_name'), lastName, getField(row, 'ext_name')].filter(Boolean).join(' ');
        const rsbsaNumber = getField(row, 'rsbsa_number', 'rsbsa_no');
        const barangay = getField(row, 'barangay');
        const crop = getField(row, 'crop', 'cropname') || 'Vegetables';

        if (!fullName || !rsbsaNumber) {
          skippedReasons.push(`Row ${idx + 2}: missing ${!fullName ? 'name' : 'RSBSA number'}`);
          return;
        }

        const farmAreaHa = Number(getField(row, 'farm_area_ha') || 0) || 0;
        const estimatedYield = Number((farmAreaHa * cropYieldPerHectare(crop)).toFixed(1));
        const beneficiaryId = `BEN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

        // Optional geocoding/recommendation columns -- present when the CSV
        // was produced by scripts/geocode_leon_farmers.cjs, absent (and
        // safely defaulted) for a plain RSBSA export.
        const farmLatitude = getField(row, 'farm_latitude');
        const farmLongitude = getField(row, 'farm_longitude');
        const nearestMarketId = getField(row, 'nearest_market_id');
        const distanceToFmrKm = getField(row, 'distance_to_fmr_km');
        const benefitReason = getField(row, 'benefit_reason');

        payloads.push({
          beneficiary_id: beneficiaryId,
          full_name: fullName,
          first_name: firstName,
          middle_name: getField(row, 'middle_name'),
          last_name: lastName,
          ext_name: getField(row, 'ext_name'),
          rsbsa_number: rsbsaNumber,
          control_no: getField(row, 'control_no'),
          contact_number: getField(row, 'contact_number', 'contact_num'),
          birthday: getDateField(row, 'birthday') || null,
          gender: getField(row, 'gender') || 'Male',
          agency: getField(row, 'agency') || 'DA',
          municipality: municipalityScope || getField(row, 'municipality') || 'Leon',
          barangay,
          crop,
          farm_area_ha: farmAreaHa,
          estimated_yield: estimatedYield,
          linked_project_id: getField(row, 'linked_project_id'),
          linked_project_name: getField(row, 'linked_project_name'),
          linked_project_status: getField(row, 'linked_project_status') || 'On-Going',
          nearest_market_id: nearestMarketId || null,
          farm_latitude: farmLatitude ? Number(farmLatitude) : null,
          farm_longitude: farmLongitude ? Number(farmLongitude) : null,
          distance_to_fmr_km: distanceToFmrKm ? Number(distanceToFmrKm) : 0,
          service_area: getField(row, 'service_area'),
          benefit_reason: benefitReason || 'Imported from RSBSA farmer dataset (bulk import).',
          beneficiary_status: 'Active Beneficiary',
          validation_status: 'Validated',
          submitted_by_lgu: submitterName,
          created_by_user_id: user.id,
          created_by_name: submitterName,
          created_by_role: 'lgu',
          submitted_date: submittedAt,
          last_updated: submittedAt,
          admin_remarks: 'Imported from RSBSA farmer dataset (bulk import).',
          supporting_documents: ['RSBSA registration'],
          validation_history: [
            {
              date: submittedAt,
              actor: submitterName,
              action: 'Imported',
              remarks: 'Bulk-imported from RSBSA farmer dataset.',
            },
          ],
          gps: farmLatitude && farmLongitude ? { lat: Number(farmLatitude), lng: Number(farmLongitude) } : {},
        });
      });

      setProgress({ done: 0, total: payloads.length });

      let inserted = 0;
      const insertErrors = [];
      for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
        const chunk = payloads.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from('farmer_beneficiaries').insert(chunk);
        if (error) {
          insertErrors.push(`Rows ${i + 1}-${i + chunk.length}: ${error.message}`);
        } else {
          inserted += chunk.length;
        }
        setProgress({ done: Math.min(i + CHUNK_SIZE, payloads.length), total: payloads.length });
      }

      setSummary({
        inserted,
        skipped: skippedReasons.length,
        skippedReasons,
        errors: insertErrors,
      });

      if (inserted > 0 && onImported) await onImported();
    } catch (err) {
      setSummary({ inserted: 0, skipped: 0, skippedReasons: [], errors: [err.message] });
    } finally {
      setImporting(false);
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Bulk Import Farmer Beneficiaries</p>
          <p className="text-xs text-slate-500">Upload a CSV or Excel file (columns: full_name, rsbsa_number, barangay, crop, farm_area_ha, etc.) to register many farmers at once.</p>
        </div>
        <label className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50">
          {importing ? 'Importing…' : 'Import from CSV/Excel'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileSelect}
            disabled={importing}
            className="hidden"
          />
        </label>
      </div>

      {progress && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-teal-500 transition-all"
              style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }}
            />
          </div>
          <p className="text-xs text-slate-500">{progress.done} / {progress.total} processed</p>
        </div>
      )}

      {summary && (
        <div className={`rounded-lg border p-3 text-sm ${summary.errors.length > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          <p className="font-semibold">{summary.inserted} imported, {summary.skipped} skipped{summary.errors.length > 0 ? `, ${summary.errors.length} chunk error(s)` : ''}.</p>
          {summary.skippedReasons?.length > 0 && (
            <ul className="mt-1 text-xs list-disc list-inside">
              {summary.skippedReasons.slice(0, 10).map((r, i) => <li key={i}>{r}</li>)}
              {summary.skippedReasons.length > 10 && <li>...and {summary.skippedReasons.length - 10} more</li>}
            </ul>
          )}
          {summary.errors?.length > 0 && (
            <ul className="mt-1 text-xs list-disc list-inside">
              {summary.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
