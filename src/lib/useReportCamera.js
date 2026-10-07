import { useCallback, useEffect, useRef, useState } from 'react';
import { captureOverlayLines, paintCaptureOverlay } from './captureOverlay';

/** What to tell the user when the camera cannot start. */
export function describeCameraError(err) {
  return err?.name === 'NotAllowedError'
    ? 'Camera permission denied. Please allow camera access.'
    : `Camera error: ${err?.message}`;
}

/**
 * The live camera and captured photo for the report form.
 *
 * Reports require a photo taken on the spot (no gallery uploads), stamped with the
 * time and GPS position. The camera runs only while `active`, and is always released
 * when the step is left, the photo is retaken, or the form unmounts - so the camera
 * light never stays on behind the user's back.
 *
 *   const cam = useReportCamera({ gps, active: step === 'reporting' });
 *   <video ref={cam.videoRef} /> <canvas ref={cam.canvasRef} hidden />
 */
export function useReportCamera({ gps, active }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const startIdRef = useRef(0); // lets stopCamera cancel a start that has not finished yet
  const previewRef = useRef(null);

  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoTs, setPhotoTs] = useState(null);
  const [camError, setCamError] = useState(null);
  const [camReady, setCamReady] = useState(false);

  const stopCamera = useCallback(() => {
    startIdRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    const startId = ++startIdRef.current;
    setCamError(null);
    setCamReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      // The step was left (or the form closed) while the browser was asking for the
      // camera. Release it straight away instead of leaving it running.
      if (startId !== startIdRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCamReady(true);
      }
    } catch (err) {
      if (startId === startIdRef.current) setCamError(describeCameraError(err));
    }
  }, []);

  // Run the camera while the step is active and there is no photo yet. The cleanup
  // releases it when the step is left, after a capture, before a retake, and on unmount.
  useEffect(() => {
    if (!active) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the browser camera
    if (!photoBlob) startCamera();
    return stopCamera;
  }, [active, photoBlob, startCamera, stopCamera]);

  useEffect(() => {
    previewRef.current = photoPreview;
  }, [photoPreview]);

  // Free the preview image when the form goes away.
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const now = new Date();
    setPhotoTs(now.toISOString());
    paintCaptureOverlay(ctx, canvas, captureOverlayLines(now, gps));
    canvas.toBlob((blob) => {
      setPhotoBlob(blob);
      setPhotoPreview(URL.createObjectURL(blob));
      stopCamera();
    }, 'image/jpeg', 0.85);
  }, [gps, stopCamera]);

  /** Discard the photo and everything about it. */
  const resetPhoto = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    setPhotoBlob(null);
    setPhotoPreview(null);
    setPhotoTs(null);
  }, []);

  // Clearing the photo is enough: the effect above restarts the camera by itself.
  const retakePhoto = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    setPhotoBlob(null);
    setPhotoPreview(null);
  }, []);

  return {
    videoRef, canvasRef,
    photoBlob, photoPreview, photoTs,
    camError, camReady,
    capturePhoto, retakePhoto, resetPhoto, stopCamera,
  };
}

export default useReportCamera;
