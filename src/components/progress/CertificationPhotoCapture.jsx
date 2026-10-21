/* The field engineer's geotagged site photo for a progress certification.
 * Live camera only (no gallery, no file picker), stamped with GPS, time and a
 * verification QR, and checked against the project road: it must be taken
 * within MAX_DISTANCE_M of it with a precise fix (the server checks the same in
 * attach_progress_certification_photo).
 * value: { file, attestation, preview, check } or null. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraIcon, MapPinIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { supabaseFieldEngineer as supabase } from '../../lib/supabase';
import { captureCertificationPhoto } from '../../lib/progressCertificationPhoto';
import { geoErrorMessage, MAX_DISTANCE_M, onSiteCheck } from '../../lib/onSiteLocation';
import { buildRoutePoints } from '../../lib/mapRouteUtils';
import { nearestPointOnRoute, haversineMeters } from '../publicReports/routeGeometry';
import { describeCameraError } from '../../lib/useReportCamera';
import ZoomablePhoto from '../ui/ZoomablePhoto';

/* The project's road as points, to measure how far the engineer is from it. */
function useProjectRoad(projectId) {
  const [state, setState] = useState({ projectId: null, points: [] });
  useEffect(() => {
    if (projectId == null) return undefined;
    let active = true;
    Promise.all([
      supabase.from('fmr_projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('project_routes').select('*').eq('project_id', projectId).maybeSingle(),
    ]).then(([p, r]) => {
      if (!active) return;
      const points = p.data ? buildRoutePoints(p.data, r.data || null).points : [];
      setState({ projectId, points });
    });
    return () => { active = false; };
  }, [projectId]);
  return state.projectId === projectId ? state.points : [];
}

function distanceToRoad(points, at) {
  if (points.length >= 2) return nearestPointOnRoute(points, at)?.distanceMeters ?? null;
  if (points.length === 1) return haversineMeters(points[0], at);
  return null;
}

export default function CertificationPhotoCapture({ value, onChange, projectId, projectName, disabled = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState('');
  const roadPoints = useProjectRoad(projectId);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This device or browser cannot open the camera.');
      return;
    }
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch (err) {
      setCameraError(describeCameraError(err));
    }
  }, []);

  // The camera runs only while there is no photo, and is always released.
  useEffect(() => {
    if (!value && !disabled) startCamera();
    return () => stopCamera();
  }, [value, disabled, startCamera, stopCamera]);

  useEffect(() => () => {
    if (value?.preview) URL.revokeObjectURL(value.preview);
  }, [value?.preview]);

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // Freeze the frame first, so the picture is the moment the button was pressed.
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return;

    setError('');
    setBusy(true);
    setAccuracy(null);
    try {
      const photo = await captureCertificationPhoto(blob, {
        projectName,
        onSample: (fix) => setAccuracy(fix.accuracy),
      });
      const a = photo.attestation;
      const check = onSiteCheck(
        { accuracy: a.accuracy, distanceM: distanceToRoad(roadPoints, [a.latitude, a.longitude]) },
        { place: 'the project road' },
      );
      onChange({ ...photo, check, preview: URL.createObjectURL(photo.file) });
      stopCamera();
    } catch (err) {
      setError(err?.message === 'timeout' ? 'Could not get a GPS fix. Move to open sky and try again.' : geoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const a = value?.attestation;
  const check = value?.check;
  const captureLabel = useMemo(
    () => (busy ? `Getting GPS${accuracy != null ? ` (±${Math.round(accuracy)} m)` : ''}…` : 'Capture photo'),
    [busy, accuracy],
  );

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        Your site photo <span className="text-rose-500">*</span>
        <span className="ml-1 font-normal text-slate-400">live camera · geotagged · within {MAX_DISTANCE_M} m of the road</span>
      </label>

      {value ? (
        <div className="max-w-md">
          <div className="relative">
            <ZoomablePhoto
              src={value.preview}
              alt="Your certification site photo"
              label="Your certification site photo"
              wrapperClassName="w-full rounded-xl"
              className="w-full aspect-video object-cover rounded-xl border border-slate-200"
            />
            {!disabled && (
              <button type="button" onClick={() => onChange(null)} aria-label="Retake photo" title="Retake" className="absolute right-2 top-2 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow hover:text-rose-600">
                <XIcon className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          {check && (
            <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${check.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
              <p className="font-semibold">
                {check.ok
                  ? (check.distanceM != null ? `On site: ${Math.round(check.distanceM)} m from the project road` : 'Geotagged (this project has no mapped road to compare with)')
                  : 'Not accepted as on-site evidence. Retake it at the project.'}
              </p>
              {!check.ok && <p className="mt-0.5">{check.problem}</p>}
              {a && (
                <p className="mt-0.5 flex items-center gap-1 opacity-80">
                  <MapPinIcon className="size-3 shrink-0" aria-hidden="true" />
                  {a.latitude?.toFixed(6)}, {a.longitude?.toFixed(6)}
                  {a.accuracy != null && ` · ±${Math.round(a.accuracy)} m`}
                  {' · '}{new Date(a.capturedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-md">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-200 bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {!cameraReady && !cameraError && (
              <p className="absolute inset-0 grid place-items-center text-xs text-white/70">Starting camera…</p>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={capture}
              disabled={!cameraReady || busy || disabled}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <CameraIcon className="size-4" aria-hidden="true" /> {captureLabel}
            </button>
            <button
              type="button"
              onClick={startCamera}
              disabled={busy || disabled}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCwIcon className="size-3.5" aria-hidden="true" /> Restart camera
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Your GPS position and the time are stamped on the photo, with a verification QR.</p>
        </div>
      )}
      {cameraError && <p role="alert" className="mt-1.5 max-w-md text-xs text-amber-700">{cameraError}</p>}
      {error && <p role="alert" className="mt-1.5 max-w-md text-xs text-rose-600">{error}</p>}
    </div>
  );
}
