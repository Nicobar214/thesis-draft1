import { useEffect, useRef, useState } from 'react';
import CameraSheet from '../camera/CameraSheet';
import { buttonClass } from '../ui/Button';

import { haversineMeters, toPoint } from './routeGeometry';
import {
  HANDLER_PHOTO_TEST_LIMITS,
  MAX_ACCURACY_M as NORMAL_MAX_ACCURACY_M,
  MAX_DISTANCE_M as NORMAL_MAX_DISTANCE_M,
  geoErrorMessage,
  readBestPosition,
  readPosition,
} from '../../lib/onSiteLocation';

// Testing may widen these (see onSiteLocation.js); the server checks the same.
const MAX_DISTANCE_M = HANDLER_PHOTO_TEST_LIMITS?.maxDistanceM ?? NORMAL_MAX_DISTANCE_M;
const MAX_ACCURACY_M = HANDLER_PHOTO_TEST_LIMITS?.maxAccuracyM ?? NORMAL_MAX_ACCURACY_M;
import { attestPhoto, registerAttestation } from '../../lib/photoAttestation';
import { submitPublicReportRepairWork } from '../../services/publicReportWorkflow';
import { friendlyReportError } from '../../lib/publicReportStatus';

const PHOTO_BUCKET = 'public-report-photos';

/**
 * The LGU's or contractor's on-site after-photo for a follow-up assigned to them.
 *
 * Same order as the engineer's RepairVerifyPanel, so the photo cannot come from
 * somewhere else: confirm the position (camera locked until within 500 m),
 * take the photo with the live camera (no gallery), stamp it with a fresh fix.
 * The server re-checks distance, accuracy and age; the DA then reviews the
 * photo and resolves the report (for contractor work, optionally after an
 * engineer confirms it on site).
 */
export default function RepairWorkSubmit({ action, report, client, party, onDone }) {
  const [geo, setGeo] = useState(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [liveAccuracy, setLiveAccuracy] = useState(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [shotBusy, setShotBusy] = useState(false);

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [shotGeo, setShotGeo] = useState(null);
  const [attestation, setAttestation] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
    setCameraOn(false);
  };

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

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
        setCameraError(err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access for this site and try again.'
          : `Camera error: ${err?.message || 'Unable to start the camera.'}`);
        setCameraOn(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cameraOn]);

  const reportPoint = toPoint(report?.latitude, report?.longitude);
  const distanceTo = (g) => (g && reportPoint ? haversineMeters(reportPoint, [g.latitude, g.longitude]) : NaN);
  const distance = distanceTo(geo);
  const tooFar = Number.isFinite(distance) && distance > MAX_DISTANCE_M;
  const tooVague = geo && geo.accuracy > MAX_ACCURACY_M;
  // A report without coordinates cannot be distance-checked; the server allows it too.
  const inRange = !!geo && !tooFar && !tooVague;

  const checkLocation = async () => {
    setGeoBusy(true);
    setGeoError('');
    setLiveAccuracy(null);
    try {
      setGeo(await readBestPosition({ onSample: (s) => setLiveAccuracy(s.accuracy) }));
    } catch (err) {
      setGeo(null);
      setGeoError(geoErrorMessage(err));
    } finally {
      setGeoBusy(false);
      setLiveAccuracy(null);
    }
  };

  const openCamera = () => {
    if (!inRange) return;
    setCameraError('');
    setPhotoFile(null);
    setShotGeo(null);
    setAttestation(null);
    setCameraOn(true);
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady) return;
    setShotBusy(true);
    setCameraError('');
    try {
      const fix = await readPosition();
      const d = distanceTo(fix);
      if (Number.isFinite(d) && d > MAX_DISTANCE_M) {
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
      const raw = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!raw) throw new Error('capture');

      let photo = raw;
      let stampedAttestation = null;
      try {
        const who = party === 'lgu' ? 'LGU after-photo' : 'Contractor after-photo';
        const stamped = await attestPhoto(raw, {
          kind: 'repair_verification',
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy: fix.accuracy,
          capturedAt: fix.capturedAt,
          label: Number.isFinite(d) ? `${who} · ${Math.round(d)} m from the reported site` : who,
        });
        photo = stamped.blob;
        stampedAttestation = stamped.attestation;
      } catch (stampErr) {
        console.warn('[repair work] photo stamp failed, keeping the plain photo', stampErr);
      }
      setPhotoFile(new File([photo], `repair-work-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      setAttestation(stampedAttestation);
      setShotGeo(fix);
      stopCamera();
    } catch (err) {
      setCameraError(err?.message === 'capture' || err?.message === 'canvas'
        ? 'Could not capture the photo. Try again.'
        : geoErrorMessage(err));
    } finally {
      setShotBusy(false);
    }
  };

  const submit = async () => {
    if (!action || !photoFile || !shotGeo) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onDone?.('No connection. Keep this page open and send the photo when you have signal.', 'error');
      return;
    }
    setBusy(true);
    try {
      const path = `repair-work/${report.id}/${Date.now()}.jpg`;
      const { error: uploadErr } = await client.storage
        .from(PHOTO_BUCKET)
        .upload(path, photoFile, { upsert: false, contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;
      const { data: pub } = client.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('Photo uploaded but no public URL was returned.');
      await registerAttestation(client, attestation, { recordId: report.id, bucket: PHOTO_BUCKET, path });

      await submitPublicReportRepairWork(client, {
        actionId: action.id,
        photoUrl: pub.publicUrl,
        latitude: shotGeo.latitude,
        longitude: shotGeo.longitude,
        accuracyMeters: shotGeo.accuracy ?? null,
        capturedAt: shotGeo.capturedAt,
        note: note.trim() || null,
      });
      setPhotoFile(null);
      setShotGeo(null);
      setAttestation(null);
      setGeo(null);
      setNote('');
      onDone?.('Sent. The DA will check your photo and resolve the report.');
    } catch (err) {
      console.error('[repair work] send failed:', err);
      onDone?.(friendlyReportError(err, 'Could not send the after-photo. Please try again.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-slate-600">1. Confirm you are at the site</p>
        <button
          type="button"
          onClick={checkLocation}
          disabled={geoBusy || busy}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {geoBusy
            ? liveAccuracy != null ? `Improving accuracy... (±${Math.round(liveAccuracy)} m so far)` : 'Reading location...'
            : geo ? 'Check again' : 'Check my location'}
        </button>
        {geoError && <p className="mt-1.5 text-xs text-red-700">{geoError}</p>}
        {geo && !geoError && (
          <p className={`mt-1.5 text-xs font-semibold ${inRange ? 'text-emerald-700' : 'text-red-700'}`}>
            {tooFar
              ? `You are ${Math.round(distance)} m from the reported site. Move within ${MAX_DISTANCE_M} m to unlock the camera.`
              : tooVague
                ? `Location is too imprecise (±${Math.round(geo.accuracy)} m). Move to open sky and check again.`
                : Number.isFinite(distance)
                  ? `At the site: ${Math.round(distance)} m away (±${Math.round(geo.accuracy)} m). Camera unlocked.`
                  : 'Location read. Camera unlocked.'}
          </p>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
          2. After-photo <span className="text-red-600">*</span>
        </p>
        {!cameraOn && !photoFile && (
          <button type="button" onClick={openCamera} disabled={!inRange} className={buttonClass('primary', 'md', 'w-full')}>
            {inRange ? 'Open camera' : 'Camera locked until you are at the site'}
          </button>
        )}
        <CameraSheet
          open={cameraOn}
          title="After-photo"
          onClose={() => { if (!shotBusy) stopCamera(); }}
          videoRef={videoRef}
          ready={cameraReady}
          error={cameraError}
          hint={shotBusy ? 'Taking photo… hold still while GPS is read.' : 'Your position and the time are stamped on the photo.'}
          onShutter={takePhoto}
          shutterDisabled={!cameraReady || shotBusy}
          busy={shotBusy}
          shutterLabel="Take photo"
        />
        {photoFile && (
          <div className="space-y-2">
            <img src={photoPreview} alt="Your after-photo" className="w-full rounded-lg border border-slate-200 object-cover" />
            {shotGeo && (
              <p className="text-xs text-slate-600">
                Taken {new Date(shotGeo.capturedAt).toLocaleTimeString('en-PH')}
                {Number.isFinite(distanceTo(shotGeo)) ? ` · ${Math.round(distanceTo(shotGeo))} m from the reported site` : ''}
                {' '}(±{Math.round(shotGeo.accuracy)} m)
              </p>
            )}
            <button type="button" onClick={openCamera} disabled={busy} className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              Retake photo
            </button>
          </div>
        )}
        {cameraError && <p className="mt-1.5 text-xs text-red-700">{cameraError}</p>}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div>
        <label htmlFor={`repair-work-note-${action?.id}`} className="mb-1.5 block text-[11px] font-semibold text-slate-600">
          3. What was done <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id={`repair-work-note-${action?.id}`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={party === 'lgu' ? 'e.g. Tree cut and cleared from the road' : 'e.g. Potholes patched with asphalt'}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
        />
      </div>

      <button type="button" onClick={submit} disabled={busy || !photoFile || !shotGeo} className={buttonClass('primary', 'md', 'w-full')}>
        {busy ? 'Sending...' : 'Send after-photo to the DA'}
      </button>
    </div>
  );
}
