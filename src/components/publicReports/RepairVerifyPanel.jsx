import { useCallback, useEffect, useRef, useState } from 'react';

import { supabaseFieldEngineer as defaultClient } from '../../lib/supabase';
import { haversineMeters, toPoint } from './routeGeometry';
import { verifyPublicReportRepair } from '../../services/publicReportWorkflow';
import {
  friendlyReportError,
  repairStatusInfo,
  responsiblePartyLabel,
} from '../../lib/publicReportStatus';

// Mirrors the server limit in verify_public_report_repair. The server is the
// authority; this only warns the engineer before they submit.
const MAX_DISTANCE_M = 500;
const PHOTO_BUCKET = 'public-report-photos';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Engineer's on-site confirmation that follow-up work was really done.
 *
 * The admin records work as done; this is the independent check. It needs an
 * after-photo and the engineer's GPS position, and the server rejects a position
 * more than 500 m from the original report. Note the coordinates come from the
 * device, so this proves plausibility rather than presence — the audit entry
 * records who verified and from how far away.
 */
export default function RepairVerifyPanel({ report, client = defaultClient, onDone }) {
  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [geo, setGeo] = useState(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!report?.id) return;
    setLoading(true);
    try {
      const { data, error } = await client
        .from('public_report_repair_actions')
        .select('id, status, kind, responsible_party, target_date, completed_at, verified_at, verification_photo_url, verification_distance_m')
        .eq('report_id', report.id)
        .maybeSingle();
      if (error) throw error;
      setAction(data || null);
    } catch (err) {
      console.warn('[repair] could not load follow-up:', err?.message || err);
      setAction(null);
    } finally {
      setLoading(false);
    }
  }, [client, report?.id]);

  useEffect(() => {
    setPhotoFile(null);
    setGeo(null);
    setNote('');
    setGeoError('');
    load();
  }, [load]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('This device cannot provide a location.');
      return;
    }
    setGeoBusy(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGeoBusy(false);
      },
      (err) => {
        setGeoBusy(false);
        setGeoError(
          err.code === 1
            ? 'Location permission was denied. Allow location for this site and try again.'
            : 'Could not read your location. Move to open sky and try again.'
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const reportPoint = toPoint(report?.latitude, report?.longitude);
  const distance = geo && reportPoint
    ? haversineMeters(reportPoint, [geo.latitude, geo.longitude])
    : NaN;
  const tooFar = Number.isFinite(distance) && distance > MAX_DISTANCE_M;

  const submit = async () => {
    if (!action || !photoFile || !geo) return;
    setBusy(true);
    try {
      const ext = (photoFile.name?.split('.').pop() || 'jpg').toLowerCase();
      const path = `repair-verifications/${report.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await client.storage
        .from(PHOTO_BUCKET)
        .upload(path, photoFile, { upsert: false, contentType: photoFile.type || 'image/jpeg' });
      if (uploadErr) throw uploadErr;

      const { data: pub } = client.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('Photo uploaded but no public URL was returned.');

      await verifyPublicReportRepair(client, {
        actionId: action.id,
        photoUrl: pub.publicUrl,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracyMeters: geo.accuracy ?? null,
        note: note.trim() || null,
      });

      if (onDone) onDone('Repair verified. Thank you.');
      setPhotoFile(null);
      setGeo(null);
      setNote('');
      await load();
    } catch (err) {
      console.error('[repair] verification failed:', err);
      if (onDone) onDone(friendlyReportError(err, 'Could not verify this repair. Please try again.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !action || action.status === 'cancelled') return null;

  const info = repairStatusInfo(action.status);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Repair follow-up</p>
        {info && (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${info.tone}`}>
            {info.staff}
          </span>
        )}
      </div>

      {action.status === 'planned' && (
        <p className="text-sm text-slate-700">
          Follow-up work is scheduled with {responsiblePartyLabel(action.responsible_party) || 'the responsible office'}
          {action.target_date ? `, target ${fmtDate(action.target_date)}` : ''}. You&rsquo;ll be asked to confirm it on
          site once it&rsquo;s recorded as done.
        </p>
      )}

      {action.status === 'verified' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            Verified on {fmtDate(action.verified_at)}
            {Number.isFinite(Number(action.verification_distance_m))
              ? `, ${Math.round(Number(action.verification_distance_m))} m from the reported site`
              : ''}.
          </p>
          {action.verification_photo_url && (
            <img
              src={action.verification_photo_url}
              alt="After-photo taken during on-site verification"
              className="h-32 w-full rounded-lg border border-slate-200 object-cover"
            />
          )}
        </div>
      )}

      {action.status === 'completed' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Action required</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Confirm the repair on site</p>
            <p className="mt-1 text-xs text-slate-600">
              The work was recorded as done on {fmtDate(action.completed_at)}. Visit the location, take an
              after-photo and capture your position. You can only verify work someone else recorded.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
              1. After-photo <span className="text-red-600">*</span>
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
            />
            {photoPreview && (
              <img src={photoPreview} alt="Your after-photo" className="mt-2 h-36 w-full rounded-lg border border-slate-200 object-cover" />
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
              2. Your location <span className="text-red-600">*</span>
            </p>
            <button
              type="button"
              onClick={captureLocation}
              disabled={geoBusy}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {geoBusy ? 'Reading location...' : geo ? 'Capture again' : 'Capture my location'}
            </button>
            {geoError && <p className="mt-1.5 text-xs text-red-700">{geoError}</p>}
            {geo && (
              <p className={`mt-1.5 text-xs ${tooFar ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
                {Number.isFinite(distance)
                  ? tooFar
                    ? `You are ${Math.round(distance)} m from the reported site. Move within ${MAX_DISTANCE_M} m before submitting.`
                    : `${Math.round(distance)} m from the reported site. Accuracy ±${Math.round(geo.accuracy || 0)} m.`
                  : `Location captured (±${Math.round(geo.accuracy || 0)} m).`}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="repair-verify-note" className="mb-1.5 block text-[11px] font-semibold text-slate-600">
              3. Note <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id="repair-verify-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you saw on site"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={busy || !photoFile || !geo || tooFar}
            className="w-full rounded-lg bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {busy ? 'Submitting...' : 'Confirm repair on site'}
          </button>
        </div>
      )}
    </div>
  );
}
