/* The KalsaTrack camera: live camera only (no gallery, no file picker). A
 * capture freezes the frame, waits for a precise GPS fix, stamps the photo
 * (place, time, verification QR) and checks it against the road: it must be
 * taken within MAX_DISTANCE_M of `roadPoints` with GPS of ±100 m or better.
 *
 *   <GeotagCamera roadPoints={line} kind="priority_validation" label="…"
 *     place="the road gap" onCaptured={(photo) => …} />
 *
 * photo: { file, attestation, preview, check: { ok, distanceM, problem } }
 *
 * The live view opens full screen (CameraSheet) from an "Open camera" button and
 * closes after each capture; the camera runs only while it is open. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon } from 'lucide-react';
import CameraSheet from './CameraSheet';
import { captureGeotagPhoto, distanceToRoad } from '../../lib/geotagPhoto';
import { FIELD_PHOTO_TEST_LIMITS, geoErrorMessage, onSiteCheck } from '../../lib/onSiteLocation';
import { describeCameraError } from '../../lib/useReportCamera';

/* `compact`: just a small "Take photo" button (for a card's corner), no help text.
 * With no `roadPoints` only the GPS precision is checked, not the distance. */
export default function GeotagCamera({ roadPoints = [], kind, label, place = 'the site', onCaptured, disabled = false, captureText = 'Capture photo', compact = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

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

  // The camera runs only while the full-screen view is open, and is always released.
  useEffect(() => {
    if (!open || disabled) return undefined;
    startCamera();
    return () => stopCamera();
  }, [open, disabled, startCamera, stopCamera]);

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
      setOpen(false);
    } catch (err) {
      setError(err?.message === 'timeout' ? 'Could not get a GPS fix. Move to open sky and try again.' : geoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? 'inline-flex' : 'max-w-md'}>
      <button
        type="button"
        onClick={() => { setError(''); setOpen(true); }}
        disabled={disabled}
        title={compact ? 'Opens the camera. GPS position, time and a verification QR are stamped on the photo.' : undefined}
        className={compact
          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50'
          : 'inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50'}
      >
        <CameraIcon className="size-4" aria-hidden="true" /> {captureText === 'Capture photo' ? (compact ? 'Take photo' : 'Open camera') : captureText}
      </button>
      {!compact && <p className="mt-1 text-[11px] text-slate-400">Opens full screen. Your GPS position and the time are stamped on the photo, with a verification QR.</p>}
      <canvas ref={canvasRef} className="hidden" />
      <CameraSheet
        open={open}
        title={label || 'KalsaTrack camera'}
        onClose={() => { if (!busy) setOpen(false); }}
        videoRef={videoRef}
        ready={cameraReady}
        error={cameraError || error}
        hint={busy ? `Getting GPS${accuracy != null ? ` (±${Math.round(accuracy)} m)` : ''}… hold still` : `Take it at ${place}. Position, time and a verification QR are stamped on it.`}
        onShutter={capture}
        shutterDisabled={!cameraReady || busy || disabled}
        busy={busy}
        shutterLabel="Capture photo"
        onRestart={busy ? undefined : startCamera}
      />
    </div>
  );
}
