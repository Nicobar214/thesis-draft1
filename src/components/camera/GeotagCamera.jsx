/* The KalsaTrack camera: live camera only (no gallery, no file picker). A
 * capture freezes the frame, waits for a precise GPS fix, stamps the photo
 * (place, time, verification QR) and checks it against the road: it must be
 * taken within MAX_DISTANCE_M of `roadPoints` with GPS of ±100 m or better.
 *
 *   <GeotagCamera roadPoints={line} kind="priority_validation" label="…"
 *     place="the road gap" onCaptured={(photo) => …} />
 *
 * photo: { file, attestation, preview, check: { ok, distanceM, problem } } */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon, RefreshCwIcon } from 'lucide-react';
import { captureGeotagPhoto, distanceToRoad } from '../../lib/geotagPhoto';
import { FIELD_PHOTO_TEST_LIMITS, geoErrorMessage, onSiteCheck } from '../../lib/onSiteLocation';
import { describeCameraError } from '../../lib/useReportCamera';

export default function GeotagCamera({ roadPoints = [], kind, label, place = 'the site', onCaptured, disabled = false, captureText = 'Capture photo' }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState('');

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

  // The camera runs only while this is on screen, and is always released.
  useEffect(() => {
    if (!disabled) startCamera();
    return () => stopCamera();
  }, [disabled, startCamera, stopCamera]);

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
      const photo = await captureGeotagPhoto(blob, { kind, label, onSample: (fix) => setAccuracy(fix.accuracy) });
      const a = photo.attestation;
      const check = onSiteCheck(
        { accuracy: a.accuracy, distanceM: distanceToRoad(roadPoints, [a.latitude, a.longitude]) },
        { place, ...(FIELD_PHOTO_TEST_LIMITS || {}) },
      );
      onCaptured({ ...photo, check, preview: URL.createObjectURL(photo.file) });
    } catch (err) {
      setError(err?.message === 'timeout' ? 'Could not get a GPS fix. Move to open sky and try again.' : geoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
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
          <CameraIcon className="size-4" aria-hidden="true" />
          {busy ? `Getting GPS${accuracy != null ? ` (±${Math.round(accuracy)} m)` : ''}…` : captureText}
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
      {cameraError && <p role="alert" className="mt-1.5 text-xs text-amber-700">{cameraError}</p>}
      {error && <p role="alert" className="mt-1.5 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
