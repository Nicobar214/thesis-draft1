import { useCallback, useEffect, useRef, useState } from 'react';
import { buttonClass } from '../ui/Button';

import { supabaseFieldEngineer as defaultClient } from '../../lib/supabase';
import { haversineMeters, toPoint } from './routeGeometry';
import { verifyPublicReportRepair } from '../../services/publicReportWorkflow';
import {
  friendlyReportError,
  repairStatusInfo,
  responsiblePartyLabel,
} from '../../lib/publicReportStatus';

// Mirrors the server limit in verify_public_report_repair. The server is the
// authority; this only stops the engineer before they waste a trip.
const MAX_DISTANCE_M = 500;
// A fix this loose could put the engineer anywhere within a few blocks.
const MAX_ACCURACY_M = 100;
const PHOTO_BUCKET = 'public-report-photos';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        capturedAt: new Date().toISOString(),
      }),
      reject,
      // maximumAge 0: never accept a cached position.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function geoErrorMessage(err) {
  if (err?.message === 'unsupported') return 'This device cannot provide a location.';
  if (err?.code === 1) return 'Location permission was denied. Allow location for this site and try again.';
  return 'Could not read your location. Move to open sky and try again.';
}

/**
 * Engineer's on-site confirmation that follow-up work was really done.
 *
 * The admin records work as done; this is the independent check. The flow is
 * deliberately in this order so the photo cannot come from somewhere else:
 *   1. read the device position — the camera stays locked until it is within
 *      500 m of the report and the fix is accurate enough;
 *   2. open the live camera (no file picker, so no gallery uploads);
 *   3. take a fresh position at the moment of the shutter and stamp the photo
 *      with it, so the evidence is bound to where and when it was taken.
 * The server re-checks the distance and is the authority. Coordinates still come
 * from the device, so this proves plausibility rather than presence.
 */
export default function RepairVerifyPanel({ report, client = defaultClient, onDone }) {
  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [geo, setGeo] = useState(null); // gate check
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState('');

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [shotBusy, setShotBusy] = useState(false);

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [shotGeo, setShotGeo] = useState(null); // position at the shutter
  const [note, setNote] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

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

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
    setCameraOn(false);
  }, []);

  useEffect(() => {
    setPhotoFile(null);
    setShotGeo(null);
    setGeo(null);
    setNote('');
    setGeoError('');
    setCameraError('');
    stopCamera();
    load();
  }, [load, stopCamera]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  // Start the stream once the <video> element exists.
  useEffect(() => {
    if (!cameraOn) return undefined;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera is not supported on this device or browser.');
        setCameraOn(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setCameraReady(true);
        }
      } catch (err) {
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access for this site and try again.'
            : `Camera error: ${err?.message || 'Unable to start the camera.'}`
        );
        setCameraOn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraOn]);

  const reportPoint = toPoint(report?.latitude, report?.longitude);
  const distanceTo = (g) => (g && reportPoint ? haversineMeters(reportPoint, [g.latitude, g.longitude]) : NaN);

  const distance = distanceTo(geo);
  const tooFar = Number.isFinite(distance) && distance > MAX_DISTANCE_M;
  const tooVague = geo && geo.accuracy > MAX_ACCURACY_M;
  const inRange = !!geo && Number.isFinite(distance) && !tooFar && !tooVague;

  const checkLocation = async () => {
    setGeoBusy(true);
    setGeoError('');
    try {
      setGeo(await readPosition());
    } catch (err) {
      setGeo(null);
      setGeoError(geoErrorMessage(err));
    } finally {
      setGeoBusy(false);
    }
  };

  const openCamera = () => {
    if (!inRange) return;
    setCameraError('');
    setPhotoFile(null);
    setShotGeo(null);
    setCameraOn(true);
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady) return;
    setShotBusy(true);
    setCameraError('');
    try {
      // Fresh fix at the shutter, not the one from earlier.
      const fix = await readPosition();
      const d = distanceTo(fix);
      if (!Number.isFinite(d) || d > MAX_DISTANCE_M) {
        setGeo(fix);
        stopCamera();
        setGeoError(`You are ${Math.round(d)} m from the reported site, so the photo was not taken. Move within ${MAX_DISTANCE_M} m.`);
        return;
      }

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Stamp where and when, so a screenshot of the file carries its own evidence.
      const stamp = [
        `Repair verification · ${new Date(fix.capturedAt).toLocaleString('en-PH')}`,
        `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)} (±${Math.round(fix.accuracy)} m) · ${Math.round(d)} m from report`,
      ];
      const barH = 56;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(12, Math.round(canvas.width * 0.018))}px sans-serif`;
      stamp.forEach((line, i) => ctx.fillText(line, 14, canvas.height - barH + 22 + i * 22));

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('capture');
      setPhotoFile(new File([blob], `repair-verification-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      setShotGeo(fix);
      stopCamera();
    } catch (err) {
      if (err?.message === 'capture' || err?.message === 'canvas') {
        setCameraError('Could not capture the photo. Try again.');
      } else {
        setCameraError(geoErrorMessage(err));
      }
    } finally {
      setShotBusy(false);
    }
  };

  const retake = () => {
    setPhotoFile(null);
    setShotGeo(null);
    openCamera();
  };

  const submit = async () => {
    if (!action || !photoFile || !shotGeo) return;
    setBusy(true);
    try {
      const path = `repair-verifications/${report.id}/${Date.now()}.jpg`;
      const { error: uploadErr } = await client.storage
        .from(PHOTO_BUCKET)
        .upload(path, photoFile, { upsert: false, contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;

      const { data: pub } = client.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('Photo uploaded but no public URL was returned.');

      await verifyPublicReportRepair(client, {
        actionId: action.id,
        photoUrl: pub.publicUrl,
        latitude: shotGeo.latitude,
        longitude: shotGeo.longitude,
        accuracyMeters: shotGeo.accuracy ?? null,
        note: note.trim() || null,
        capturedAt: shotGeo.capturedAt,
      });

      if (onDone) onDone('Repair verified. Thank you.');
      setPhotoFile(null);
      setShotGeo(null);
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
              The work was recorded as done on {fmtDate(action.completed_at)}. Go to the location, confirm your
              position, then take the after-photo with the camera. You can only verify work someone else recorded.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600">1. Confirm you are at the site</p>
            <button
              type="button"
              onClick={checkLocation}
              disabled={geoBusy || busy}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {geoBusy ? 'Reading location...' : geo ? 'Check again' : 'Check my location'}
            </button>
            {geoError && <p className="mt-1.5 text-xs text-red-700">{geoError}</p>}
            {geo && !geoError && (
              <p className={`mt-1.5 text-xs ${inRange ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}`}>
                {!Number.isFinite(distance)
                  ? 'This report has no coordinates to compare against.'
                  : tooFar
                    ? `You are ${Math.round(distance)} m from the reported site. Move within ${MAX_DISTANCE_M} m to unlock the camera.`
                    : tooVague
                      ? `Location is too imprecise (±${Math.round(geo.accuracy)} m). Move to open sky and check again.`
                      : `At the site: ${Math.round(distance)} m away (±${Math.round(geo.accuracy)} m). Camera unlocked.`}
              </p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
              2. After-photo <span className="text-red-600">*</span>
            </p>

            {!cameraOn && !photoFile && (
              <button
                type="button"
                onClick={openCamera}
                disabled={!inRange}
                className={buttonClass('primary', 'md', 'w-full')}
              >
                {inRange ? 'Open camera' : 'Camera locked until you are at the site'}
              </button>
            )}

            {cameraOn && (
              <div className="space-y-2">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full rounded-lg border border-slate-200 bg-black object-cover"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={takePhoto}
                    disabled={!cameraReady || shotBusy}
                    className={buttonClass('primary', 'md', 'flex-1')}
                  >
                    {shotBusy ? 'Taking photo...' : cameraReady ? 'Take photo' : 'Starting camera...'}
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {photoFile && (
              <div className="space-y-2">
                <img src={photoPreview} alt="Your after-photo" className="w-full rounded-lg border border-slate-200 object-cover" />
                {shotGeo && (
                  <p className="text-xs text-slate-600">
                    Taken {new Date(shotGeo.capturedAt).toLocaleTimeString('en-PH')} ·{' '}
                    {Math.round(distanceTo(shotGeo))} m from the reported site (±{Math.round(shotGeo.accuracy)} m)
                  </p>
                )}
                <button
                  type="button"
                  onClick={retake}
                  disabled={busy}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Retake photo
                </button>
              </div>
            )}

            {cameraError && <p className="mt-1.5 text-xs text-red-700">{cameraError}</p>}
            <canvas ref={canvasRef} className="hidden" />
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
            disabled={busy || !photoFile || !shotGeo}
            className={buttonClass('primary', 'md', 'w-full')}
          >
            {busy ? 'Submitting...' : 'Confirm repair on site'}
          </button>
        </div>
      )}
    </div>
  );
}
