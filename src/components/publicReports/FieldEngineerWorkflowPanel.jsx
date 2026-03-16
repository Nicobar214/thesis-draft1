import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '../../lib/supabase';
import { buildRoutePoints } from '../../lib/mapRouteUtils';
import PublicReportRouteMapPanel from './PublicReportRouteMapPanel';
import { formatDistance, sumRouteLengthMeters } from './routeGeometry';

function fmtCountdown(deadlineIso) {
  if (!deadlineIso) return 'No deadline set';
  const now = new Date();
  const deadline = new Date(deadlineIso);
  if (Number.isNaN(deadline.getTime())) return 'Invalid deadline';

  const diffMs = deadline.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);

  if (diffDays < 0) return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`;
  if (diffDays === 0) return 'Due today';
  return `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

async function createGeoOverlayImage(file, report, capturedGeo) {
  if (!file) return null;

  const imageUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const instance = new Image();
      instance.onload = () => resolve(instance);
      instance.onerror = reject;
      instance.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, img.width, img.height);

    const lines = [
      `Captured: ${new Date().toLocaleString()}`,
      `Capture GPS: ${Number(capturedGeo?.latitude || 0).toFixed(6)}, ${Number(capturedGeo?.longitude || 0).toFixed(6)}`,
      `Report GPS: ${Number(report?.latitude || 0).toFixed(6)}, ${Number(report?.longitude || 0).toFixed(6)}`,
    ];

    const boxHeight = 74;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight);

    ctx.font = `${Math.max(12, Math.round(canvas.width * 0.018))}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, idx) => {
      ctx.fillText(line, 16, canvas.height - boxHeight + 20 + idx * 20);
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) return file;

    return new File([blob], `overlay-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function FieldEngineerWorkflowPanel({ report, currentUser, onSaved }) {
  const [workflowMeta, setWorkflowMeta] = useState(null);
  const [project, setProject] = useState(null);
  const [routeRecord, setRouteRecord] = useState(null);
  const [latestFinding, setLatestFinding] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [capturedGeo, setCapturedGeo] = useState(null);
  const [captureGeoError, setCaptureGeoError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [conditionObserved, setConditionObserved] = useState('');
  const [recommendedAction, setRecommendedAction] = useState('');
  const [estimatedCostRange, setEstimatedCostRange] = useState('');

  const notifyAdmin = useCallback(async (title, message) => {
    try {
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .limit(5);

      if (!Array.isArray(admins) || admins.length === 0) return;

      const rows = admins.map((adm) => ({
        user_id: adm.id,
        type: 'public_report_field_finding',
        title,
        message,
        is_read: false,
      }));

      await supabase.from('notifications').insert(rows);
    } catch {
      // Silent fallback for deployments without notifications table.
    }
  }, []);

  const loadSupportingData = useCallback(async () => {
    if (!report?.id) return;
    setLoading(true);
    try {
      const tasks = [
        supabase
          .from('public_report_workflow_meta')
          .select('*')
          .eq('report_id', report.id)
          .maybeSingle(),
        supabase
          .from('public_report_field_findings')
          .select('*')
          .eq('report_id', report.id)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ];

      if (report.project_id) {
        tasks.push(
          supabase.from('fmr_projects').select('*').eq('id', report.project_id).maybeSingle(),
          supabase.from('project_routes').select('*').eq('project_id', report.project_id).maybeSingle()
        );
      } else {
        tasks.push(
          supabase.from('fmr_projects').select('*').ilike('project_name', String(report.project_name || '')).limit(1).maybeSingle(),
          Promise.resolve({ data: null, error: null })
        );
      }

      const [metaRes, findingRes, projRes, routeRes] = await Promise.all(tasks);
      setWorkflowMeta(metaRes?.data || null);
      setLatestFinding(findingRes?.data || null);
      setProject(projRes?.data || null);
      setRouteRecord(routeRes?.data || null);

      if (findingRes?.data) {
        setConditionObserved(findingRes.data.condition_observed || '');
        setRecommendedAction(findingRes.data.recommended_action || '');
        setEstimatedCostRange(findingRes.data.estimated_cost_range || '');
      } else {
        setConditionObserved('');
        setRecommendedAction('');
        setEstimatedCostRange('');
      }
    } finally {
      setLoading(false);
    }
  }, [report]);

  useEffect(() => {
    loadSupportingData();
  }, [loadSupportingData]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl('');
      return;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photoFile]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not supported on this device/browser.');
      return;
    }

    try {
      setCameraError('');
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
      const message = err?.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access.'
        : `Camera error: ${err?.message || 'Unable to start camera'}`;
      setCameraError(message);
    }
  }, []);

  useEffect(() => {
    if (!photoFile) {
      startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [photoFile, startCamera, stopCamera]);

  const routeData = useMemo(() => buildRoutePoints(project, routeRecord), [project, routeRecord]);

  const startPoint = routeData.startPoint;
  const endPoint = routeData.endPoint;
  const routeLengthMeters = useMemo(() => {
    const km = Number(project?.project_length_km);
    if (Number.isFinite(km) && km > 0) return km * 1000;
    return sumRouteLengthMeters(routeData.points || []);
  }, [project, routeData.points]);

  const navigateTo = (lat, lng) => {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const markVisited = async () => {
    if (!report?.id || !currentUser?.id) return;
    setSaving(true);
    try {
      const payload = {
        report_id: report.id,
        engineer_id: currentUser.id,
        visited_at: new Date().toISOString(),
        latitude: Number(report.latitude) || null,
        longitude: Number(report.longitude) || null,
      };

      await supabase.from('public_report_visits').insert(payload);
      await supabase.from('public_report_activity_logs').insert({
        report_id: report.id,
        action_type: 'visited',
        description: 'Field engineer marked site as visited',
        actor_name: currentUser.user_metadata?.full_name || currentUser.email || 'Field Engineer',
      });

      if (onSaved) onSaved('Visit logged');
    } catch {
      if (onSaved) onSaved('Visited log could not be saved in this deployment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitFindings = async () => {
    if (!report?.id || !currentUser?.id) return;
    if (!conditionObserved.trim() || !recommendedAction.trim()) {
      if (onSaved) onSaved('Condition observed and recommended action are required', 'error');
      return;
    }
    if (!photoFile) {
      if (onSaved) onSaved('On-site photo capture is required before submitting findings', 'error');
      return;
    }
    if (!capturedGeo) {
      if (onSaved) onSaved('Live geotag is required. Enable location and capture again.', 'error');
      return;
    }

    setSaving(true);
    try {
      let uploadedPhotoUrl = '';
      const ext = (photoFile?.name?.split('.').pop() || 'jpg').toLowerCase();
      const path = `field-findings/${report.id}/${Date.now()}.${ext}`;

      const candidateBuckets = ['public-report-photos', 'public-photos'];
      let bucketUsed = '';
      let lastUploadError = null;

      for (const bucket of candidateBuckets) {
        const { error: uploadErr } = await supabase.storage
          .from(bucket)
          .upload(path, photoFile, { upsert: false, contentType: photoFile.type || 'image/jpeg' });

        if (!uploadErr) {
          bucketUsed = bucket;
          break;
        }

        lastUploadError = uploadErr;
      }

      if (!bucketUsed) {
        const reason = lastUploadError?.message || 'Storage bucket not found';
        throw new Error(`${reason}. Create bucket public-report-photos (preferred) or public-photos.`);
      }

      const { data: pub } = supabase.storage.from(bucketUsed).getPublicUrl(path);
      uploadedPhotoUrl = pub?.publicUrl || '';
      if (!uploadedPhotoUrl) {
        throw new Error('Photo upload completed but public URL was not generated.');
      }

      const findingPayload = {
        report_id: report.id,
        engineer_id: currentUser.id,
        condition_observed: conditionObserved.trim(),
        recommended_action: recommendedAction.trim(),
        estimated_cost_range: estimatedCostRange.trim() || null,
        field_photo_url: uploadedPhotoUrl || null,
        submitted_at: new Date().toISOString(),
      };

      const { error: insErr } = await supabase
        .from('public_report_field_findings')
        .insert(findingPayload);

      if (insErr) throw insErr;

      await supabase.from('public_report_activity_logs').insert({
        report_id: report.id,
        action_type: 'findings_submitted',
        description: 'Field engineer submitted findings',
        actor_name: currentUser.user_metadata?.full_name || currentUser.email || 'Field Engineer',
      });

      await notifyAdmin(
        'Field findings submitted',
        `Field findings are available for report ${String(report.id).slice(0, 8)}.`
      );

      if (onSaved) onSaved('Field findings submitted');
      setPhotoFile(null);
      setCapturedGeo(null);
      await loadSupportingData();
    } catch (err) {
      if (onSaved) onSaved(`Failed to submit findings: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deadlineText = fmtCountdown(workflowMeta?.visit_deadline);

  const captureFromCamera = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (!navigator.geolocation) {
      setCaptureGeoError('Geolocation is not supported on this device/browser.');
      return;
    }

    setCaptureGeoError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const geo = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        };

        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
          if (!blob) return;
          const capturedFile = new File([blob], `field-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
          const stampedFile = await createGeoOverlayImage(capturedFile, report, geo);
          setCapturedGeo(geo);
          setPhotoFile(stampedFile);
          stopCamera();
        }, 'image/jpeg', 0.9);
      },
      () => {
        setCaptureGeoError('Unable to read current GPS location. Enable location and capture again.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, [stopCamera]);

  const retakeCapture = () => {
    setPhotoFile(null);
    setCapturedGeo(null);
    setCaptureGeoError('');
    setCameraError('');
  };

  return (
    <section className="space-y-4">
      <PublicReportRouteMapPanel
        project={project}
        routeRecord={routeRecord}
        reportLatitude={report?.latitude}
        reportLongitude={report?.longitude}
        heightClass="h-64 sm:h-72"
        title="Project Route Map"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => navigateTo(report?.latitude, report?.longitude)}
          className="rounded-xl border border-teal-200 bg-teal-50 text-teal-700 px-3 py-2 text-sm font-semibold hover:bg-teal-100 transition"
        >
          Navigate to Report
        </button>
        <button
          type="button"
          onClick={() => navigateTo(startPoint?.[0], startPoint?.[1])}
          className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm font-semibold hover:bg-emerald-100 transition"
        >
          Navigate to Project Start
        </button>
        <button
          type="button"
          onClick={() => navigateTo(endPoint?.[0], endPoint?.[1])}
          className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-100 transition"
        >
          Navigate to Project End
        </button>
        <button
          type="button"
          onClick={markVisited}
          disabled={saving}
          className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-50 transition disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Mark as Visited'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500 uppercase font-semibold">Route Length</p>
          <p className="mt-1 font-semibold text-slate-800">{formatDistance(routeLengthMeters)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-700 uppercase font-semibold">Assigned Deadline</p>
          <p className="mt-1 font-semibold text-amber-800">{deadlineText}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-800">Field Findings Form</p>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Condition Observed</label>
          <textarea
            value={conditionObserved}
            onChange={(e) => setConditionObserved(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Describe actual road condition observed on-site"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Recommended Action</label>
          <textarea
            value={recommendedAction}
            onChange={(e) => setRecommendedAction(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Recommended corrective action"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Estimated Cost Range</label>
          <input
            value={estimatedCostRange}
            onChange={(e) => setEstimatedCostRange(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="e.g. PHP 150,000 - PHP 220,000"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">On-Site Camera Capture</label>
          <p className="mt-1 text-xs text-slate-500">Capture directly from camera with live GPS geotag.</p>

          <div className="mt-2 relative bg-black rounded-2xl overflow-hidden aspect-video border border-slate-200">
            {!photoFile ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <img src={photoPreviewUrl} alt="Field capture preview" className="w-full h-full object-cover" />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {!photoFile ? (
              <button
                type="button"
                onClick={captureFromCamera}
                disabled={!cameraReady || saving}
                className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                Capture Photo
              </button>
            ) : (
              <button
                type="button"
                onClick={retakeCapture}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                Retake Photo
              </button>
            )}
            {!photoFile && (
              <button
                type="button"
                onClick={startCamera}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                Restart Camera
              </button>
            )}
          </div>

          {cameraError && (
            <p className="mt-1 text-xs text-amber-700">{cameraError}</p>
          )}
          {capturedGeo && (
            <p className="mt-1 text-xs text-emerald-700">
              GPS captured: {capturedGeo.latitude.toFixed(6)}, {capturedGeo.longitude.toFixed(6)}
              {Number.isFinite(capturedGeo.accuracy) ? ` (±${Math.round(capturedGeo.accuracy)}m)` : ''}
            </p>
          )}
          {captureGeoError && (
            <p className="mt-1 text-xs text-amber-700">{captureGeoError}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {(latestFinding?.field_photo_url || photoFile) && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Field Engineer Photo</p>
              {photoFile ? (
                <img src={photoPreviewUrl} alt="Field capture" className="w-full h-40 object-cover rounded-xl border border-slate-200" />
              ) : (
                <img src={latestFinding.field_photo_url} alt="Field capture" className="w-full h-40 object-cover rounded-xl border border-slate-200" />
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={submitFindings}
            disabled={saving || loading}
            className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60"
          >
            {saving ? 'Submitting...' : 'Submit Findings'}
          </button>
        </div>
      </div>
    </section>
  );
}
