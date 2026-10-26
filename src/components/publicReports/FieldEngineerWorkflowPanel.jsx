import { CheckIcon, StarIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CameraSheet from '../camera/CameraSheet';

import { supabaseFieldEngineer as supabase } from '../../lib/supabase';
import { buildRoutePoints } from '../../lib/mapRouteUtils';
import PublicReportRouteMapPanel from './PublicReportRouteMapPanel';
import { formatDistance, sumRouteLengthMeters } from './routeGeometry';
import { friendlyReportError } from '../../lib/publicReportStatus';
import { buttonClass } from '../ui/Button';
import { attestPhoto } from '../../lib/photoAttestation';
import { geoErrorMessage, MAX_DISTANCE_M, onSiteCheck, readBestPosition } from '../../lib/onSiteLocation';
import { haversineMeters as distanceBetween, toPoint as asPoint } from './routeGeometry';
import { cacheGet, cacheSet, isConnectionError } from '../../lib/offlineCache';
import { sendInspection, enqueueInspection, listQueuedInspections, discardQueuedInspection, INSPECTION_QUEUE_EVENT } from '../../lib/offlineInspections';
import ZoomablePhoto from '../ui/ZoomablePhoto';

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


export default function FieldEngineerWorkflowPanel({ report, currentUser, onSaved, startOnSend = false }) {
  const [workflowMeta, setWorkflowMeta] = useState(null);
  const [project, setProject] = useState(null);
  const [routeRecord, setRouteRecord] = useState(null);
  const [latestFinding, setLatestFinding] = useState(null);
  const [mapFocus, setMapFocus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [capturedGeo, setCapturedGeo] = useState(null);
  const [photoAttestation, setPhotoAttestation] = useState(null);
  const [captureGeoError, setCaptureGeoError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [fixAccuracy, setFixAccuracy] = useState(null); // live accuracy while the GPS settles
  const [capturing, setCapturing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false); // full-screen camera (CameraSheet)

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [conditionObserved, setConditionObserved] = useState('');
  const [recommendedAction, setRecommendedAction] = useState('');
  const [estimatedCostRange, setEstimatedCostRange] = useState('');
  const [inspectionRating, setInspectionRating] = useState(5);
  const [engineerCertified, setEngineerCertified] = useState(false);

  // An inspection finished offline and still waiting to be sent (lib/offlineInspections.js).
  const [queuedInspection, setQueuedInspection] = useState(null);
  const refreshQueued = useCallback(async () => {
    if (!report?.id) return;
    const items = await listQueuedInspections(currentUser?.id);
    setQueuedInspection(items.find((it) => String(it.report?.id) === String(report.id)) || null);
  }, [report?.id, currentUser?.id]);

  useEffect(() => {
    refreshQueued();
    window.addEventListener(INSPECTION_QUEUE_EVENT, refreshQueued);
    return () => window.removeEventListener(INSPECTION_QUEUE_EVENT, refreshQueued);
  }, [refreshQueued]);

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

      const [metaRes, findingRes] = await Promise.all(tasks);
      // No signal: show what was saved the last time this report was opened.
      if (isConnectionError(metaRes?.error) || isConnectionError(findingRes?.error)) {
        const saved = await cacheGet(`fe:report:${report.id}:support`);
        if (saved?.data) {
          const d = saved.data;
          setWorkflowMeta(d.meta);
          setLatestFinding(d.finding);
          setConditionObserved(d.finding?.condition_observed || '');
          setRecommendedAction(d.finding?.recommended_action || '');
          setEstimatedCostRange(d.finding?.estimated_cost_range || '');
          setProject(d.project);
          setRouteRecord(d.route);
        }
        return;
      }
      setWorkflowMeta(metaRes?.data || null);
      setLatestFinding(findingRes?.data || null);

      if (findingRes?.data) {
        setConditionObserved(findingRes.data.condition_observed || '');
        setRecommendedAction(findingRes.data.recommended_action || '');
        setEstimatedCostRange(findingRes.data.estimated_cost_range || '');
      } else {
        setConditionObserved('');
        setRecommendedAction('');
        setEstimatedCostRange('');
      }

      // Fetch matched project
      let matchedProject = null;
      if (report.project_id) {
        const { data: proj } = await supabase.from('fmr_projects').select('*').eq('id', report.project_id).maybeSingle();
        matchedProject = proj;
      }

      if (!matchedProject && report.project_name) {
        const cleanName = String(report.project_name).trim();
        const { data: projByName } = await supabase
          .from('fmr_projects')
          .select('*')
          .ilike('project_name', `%${cleanName}%`)
          .limit(1)
          .maybeSingle();
        matchedProject = projByName;
      }

      if (!matchedProject && report.municipality) {
        const { data: projByMuni } = await supabase
          .from('fmr_projects')
          .select('*')
          .ilike('municipality', String(report.municipality).trim())
          .limit(1)
          .maybeSingle();
        matchedProject = projByMuni;
      }

      setProject(matchedProject || null);

      // Fetch route for matched project
      let routeForCache = null;
      if (matchedProject?.id) {
        const { data: route } = await supabase
          .from('project_routes')
          .select('*')
          .eq('project_id', matchedProject.id)
          .maybeSingle();
        setRouteRecord(route || null);
        routeForCache = route || null;
      } else {
        setRouteRecord(null);
      }
      cacheSet(`fe:report:${report.id}:support`, {
        meta: metaRes?.data || null,
        finding: findingRes?.data || null,
        project: matchedProject || null,
        route: routeForCache,
      });
    } catch (err) {
      console.warn('Failed loading supporting data:', err);
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

  // The camera runs only while the full-screen view is open and no photo is kept.
  useEffect(() => {
    if (!cameraOpen || photoFile) return undefined;
    startCamera();
    return () => {
      stopCamera();
    };
  }, [cameraOpen, photoFile, startCamera, stopCamera]);

  const routeData = useMemo(() => buildRoutePoints(project, routeRecord), [project, routeRecord]);

  const startPoint = routeData.startPoint || (project?.start_latitude && project?.start_longitude ? [Number(project.start_latitude), Number(project.start_longitude)] : null);
  const endPoint = routeData.endPoint || (project?.end_latitude && project?.end_longitude ? [Number(project.end_latitude), Number(project.end_longitude)] : (startPoint || null));
  const routeLengthMeters = useMemo(() => {
    const km = Number(project?.project_length_km);
    if (Number.isFinite(km) && km > 0) return km * 1000;
    return sumRouteLengthMeters(routeData.points || []);
  }, [project, routeData.points]);

  const navigateTo = (lat, lng) => {
    const numLat = Number(lat);
    const numLng = Number(lng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
      if (onSaved) onSaved('Coordinates unavailable for this location point.', 'error');
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${numLat},${numLng}`;
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
    if (siteCheck && !siteCheck.ok) {
      if (onSaved) onSaved(siteCheck.problem, 'error');
      return;
    }
    if (!engineerCertified) {
      if (onSaved) onSaved('Certification is required before submitting findings.', 'error');
      return;
    }

    const item = {
      engineerId: currentUser.id,
      report: { id: report.id, user_id: report.user_id || null, project_name: report.project_name || '' },
      findings: {
        conditionObserved: conditionObserved.trim(),
        recommendedAction: recommendedAction.trim(),
        estimatedCostRange: estimatedCostRange.trim(),
        siteRating: inspectionRating,
        certified: engineerCertified,
      },
      photoBlob: photoFile,
      photoExt: (photoFile?.name?.split('.').pop() || 'jpg').toLowerCase(),
      geo: capturedGeo,
      attestation: photoAttestation,
      needsStart: startOnSend, // inspection was started offline (see sendInspection)
    };
    const clearCapture = () => {
      setPhotoFile(null);
      setCapturedGeo(null);
      setPhotoAttestation(null);
      setEngineerCertified(false);
    };
    // No signal on site: keep the finished inspection on this phone and send it
    // through the same server check once the connection returns.
    const saveOnDevice = async () => {
      await enqueueInspection(item);
      clearCapture();
      if (onSaved) onSaved('No signal. Inspection saved on this phone and will be sent automatically when you are back online.', 'warning');
    };

    setSaving(true);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await saveOnDevice();
        return;
      }
      await sendInspection(supabase, item);
      if (onSaved) onSaved('Field findings submitted');
      clearCapture();
      await loadSupportingData();
    } catch (err) {
      if (isConnectionError(err)) {
        try { await saveOnDevice(); } catch (saveErr) {
          console.error('Could not save inspection on device:', saveErr);
          if (onSaved) onSaved('No signal, and the inspection could not be saved on this phone. Please try again.', 'error');
        }
      } else {
        console.error('Failed to submit inspection findings:', err);
        if (onSaved) onSaved(friendlyReportError(err, 'Could not submit your findings. Please try again.'), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const deadlineText = fmtCountdown(workflowMeta?.visit_deadline);

  // Geofence: the photo must be taken at the reported site (the server checks
  // the same limits in submit_public_report_inspection).
  const sitePoint = asPoint(report?.latitude, report?.longitude);
  const siteCheck = useMemo(() => {
    if (!capturedGeo) return null;
    const distanceM = sitePoint ? distanceBetween(sitePoint, [capturedGeo.latitude, capturedGeo.longitude]) : null;
    return onSiteCheck({ accuracy: capturedGeo.accuracy, distanceM }, { place: "the citizen's reported pin" });
  }, [capturedGeo, sitePoint]);

  const captureFromCamera = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Freeze the frame first, so the picture is the moment the button was pressed.
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setCaptureGeoError('');
    setCapturing(true);
    setFixAccuracy(null);
    let geo;
    try {
      // Sample the GPS for a few seconds and keep the most precise fix.
      const fix = await readBestPosition({ onSample: (sample) => setFixAccuracy(sample.accuracy) });
      geo = { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, capturedAt: fix.capturedAt };
    } catch (err) {
      setCaptureGeoError(err?.message === 'timeout' ? 'Could not get a GPS fix. Move to open sky and capture again.' : geoErrorMessage(err));
      setCapturing(false);
      return;
    }

    canvas.toBlob(async (blob) => {
      if (!blob) { setCapturing(false); return; }
      // Tamper-evident stamp: date/time, GPS, project and a verification QR
      // (lib/photoAttestation.js). Falls back to the plain photo if stamping fails.
      let photo = new File([blob], `field-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
      let attestation = null;
      try {
        const stamped = await attestPhoto(blob, {
          kind: 'field_inspection',
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy: geo.accuracy,
          capturedAt: geo.capturedAt,
          label: `Field inspection · ${report?.project_name || `Report ${String(report?.id || '').slice(0, 8).toUpperCase()}`}`,
        });
        photo = new File([stamped.blob], `field-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        attestation = stamped.attestation;
      } catch (stampErr) {
        console.warn('[inspection] photo stamp failed, keeping the plain photo', stampErr);
      }
      setCapturedGeo(geo);
      setPhotoAttestation(attestation);
      setPhotoFile(photo);
      setCapturing(false);
      setCameraOpen(false);
      stopCamera();
    }, 'image/jpeg', 0.9);
  }, [report, stopCamera]);

  const retakeCapture = () => {
    setPhotoFile(null);
    setCapturedGeo(null);
    setPhotoAttestation(null);
    setCaptureGeoError('');
    setCameraError('');
    setCameraOpen(true);
  };

  return (
    <section className="space-y-4">
      {/* Workflow stepper — mirrors the real public_reports state machine
          (status + engineer_status). No stage here exists that the backend
          cannot actually reach. */}
      {(() => {
        const engineerStatus = String(report?.engineer_status || '').toLowerCase();
        const reportStatus = String(report?.status || '').toLowerCase();

        const reached = {
          submitted: 1,
          assigned: ['assigned', 'in_progress', 'inspected', 'rejected', 'validated'].includes(engineerStatus) ? 1 : 0,
          inspection: ['in_progress', 'inspected', 'rejected', 'validated'].includes(engineerStatus) ? 1 : 0,
          validation: ['inspected', 'rejected', 'validated'].includes(engineerStatus) ? 1 : 0,
          resolved: reportStatus === 'resolved' ? 1 : 0,
        };

        const steps = [
          { key: 'submitted', title: 'Reported', desc: 'Citizen submitted' },
          { key: 'assigned', title: 'Assigned', desc: 'Engineer dispatched' },
          { key: 'inspection', title: 'Inspection', desc: 'On-site visit' },
          { key: 'validation', title: 'Validation', desc: 'DA admin review' },
          { key: 'resolved', title: 'Resolved', desc: 'Outcome recorded' },
        ];

        const currentIndex = steps.reduce((acc, step, i) => (reached[step.key] ? i : acc), 0);

        return (
          <div className="bg-slate-950 text-white rounded-xl p-4 border border-slate-800 shadow-sm">
            <p className="text-[11px] font-semibold text-emerald-300 uppercase tracking-widest mb-3">
              Report Workflow
            </p>
            <ol className="grid grid-cols-5 gap-1 text-center">
              {steps.map((s2, idx) => {
                const done = Boolean(reached[s2.key]);
                const active = idx === currentIndex && reportStatus !== 'resolved';
                return (
                  <li key={s2.key} className="flex flex-col items-center">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                      done
                        ? 'bg-emerald-400 text-slate-950 ring-2 ring-emerald-400/30'
                        : active
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}>
                      {done ? <CheckIcon className="size-4" aria-hidden="true" /> : idx + 1}
                    </div>
                    <p className={`text-[11px] font-semibold mt-1.5 leading-tight ${done || active ? 'text-slate-200' : 'text-slate-500'}`}>
                      {s2.title}
                    </p>
                    <p className="text-[9px] text-slate-400 hidden sm:block mt-0.5">{s2.desc}</p>
                  </li>
                );
              })}
            </ol>
            {engineerStatus === 'rejected' && (
              <p className="text-[11px] text-amber-300 mt-3 text-center">
                Returned for re-inspection — the inspection stage runs again.
              </p>
            )}
          </div>
        );
      })()}

      <PublicReportRouteMapPanel
        project={project}
        routeRecord={routeRecord}
        reportLatitude={report?.latitude}
        reportLongitude={report?.longitude}
        heightClass="h-64 sm:h-72"
        title="Project Route Map"
        focusTarget={mapFocus}
        onResetFocus={() => setMapFocus('fit')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setMapFocus([report?.latitude, report?.longitude])}
          className={buttonClass('secondary')}
        >
          <svg className="w-4 h-4 shrink-0 text-teal-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0z" />
          </svg>
          Focus Damage Site
        </button>
        <button
          type="button"
          onClick={() => {
            if (startPoint) setMapFocus(startPoint);
            else if (onSaved) onSaved('Start point coordinates unavailable.', 'error');
          }}
          className={buttonClass('secondary')}
        >
          <svg className="w-4 h-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.779V4.5l-3.114.778a9 9 0 0 1-6.086-.71l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
          </svg>
          Focus Project Start
        </button>
        <button
          type="button"
          onClick={() => {
            if (endPoint) setMapFocus(endPoint);
            else if (onSaved) onSaved('End point coordinates unavailable.', 'error');
          }}
          className={buttonClass('secondary')}
        >
          <svg className="w-4 h-4 shrink-0 text-rose-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.779V4.5l-3.114.778a9 9 0 0 1-6.086-.71l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
          </svg>
          Focus Project End
        </button>
        <button
          type="button"
          onClick={markVisited}
          disabled={saving}
          className={buttonClass('primary')}
        >
          <svg className="w-4 h-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          </svg>
          {saving ? 'Saving...' : 'Mark Site Visited'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500 uppercase font-semibold">Route Length</p>
          <p className="mt-1 font-semibold text-slate-800">{formatDistance(routeLengthMeters)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <p className="text-xs text-amber-700 uppercase font-semibold">Assigned Deadline</p>
          <p className="mt-1 font-semibold text-amber-800">{deadlineText}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <p className="text-sm font-semibold text-slate-900">Field Findings Form</p>
          <p className="text-xs text-slate-500 mt-0.5">Document the site condition, recommendation, cost range, rating, and geotagged evidence.</p>
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Condition Observed</label>
          <textarea
            value={conditionObserved}
            onChange={(e) => setConditionObserved(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            placeholder="Describe actual road condition observed on-site"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Recommended Action</label>
          <textarea
            value={recommendedAction}
            onChange={(e) => setRecommendedAction(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            placeholder="Recommended corrective action"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Estimated Repair Cost <span className="normal-case font-normal text-slate-400">(optional)</span></label>
          <input
            value={estimatedCostRange}
            onChange={(e) => setEstimatedCostRange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            placeholder="e.g. PHP 150,000 - PHP 220,000"
          />
          <p className="mt-1 text-[11px] text-slate-400">A rough estimate to help the DA plan the repair. It is not the project budget or a payment.</p>
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Site Condition Rating</label>
          <div className="mt-1 flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => {
                  setInspectionRating(star);
                }}
                className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  inspectionRating >= star ? 'text-amber-500 scale-110 bg-white shadow-sm' : 'text-slate-300 hover:text-amber-300'
                }`}
                title={`${star} Star${star > 1 ? 's' : ''}`}
              >
                <StarIcon className="size-4 fill-current" aria-hidden="true" />
              </button>
            ))}
            <span className="text-xs font-semibold text-slate-700 ml-2 whitespace-nowrap">
              {inspectionRating}/5 {['', 'Defective', 'Substandard', 'Fair', 'Good', 'Excellent'][inspectionRating] || ''}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">1-click rating score for site findings.</p>
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">On-Site Camera Capture</label>
          <p className="mt-1 text-xs text-slate-500">Capture directly from camera with live GPS geotag.</p>

          {photoFile ? (
            <div className="mt-2 relative bg-black rounded-xl overflow-hidden aspect-video border border-slate-200">
              <img src={photoPreviewUrl} alt="Field capture preview" className="w-full h-full object-cover" />
            </div>
          ) : null}
          <canvas ref={canvasRef} className="hidden" />

          <div className="mt-2 flex flex-wrap gap-2">
            {!photoFile ? (
              <button
                type="button"
                onClick={() => { setCaptureGeoError(''); setCameraError(''); setCameraOpen(true); }}
                disabled={saving}
                className={buttonClass('primary')}
              >
                Open camera
              </button>
            ) : (
              <button
                type="button"
                onClick={retakeCapture}
                disabled={saving}
                className={buttonClass('secondary')}
              >
                Retake Photo
              </button>
            )}
          </div>
          <CameraSheet
            open={cameraOpen && !photoFile}
            title={`Field inspection · ${report?.project_name || 'site photo'}`}
            onClose={() => { if (!capturing) setCameraOpen(false); }}
            videoRef={videoRef}
            ready={cameraReady}
            error={cameraError || captureGeoError}
            hint={capturing ? `Getting GPS${fixAccuracy != null ? ` (±${Math.round(fixAccuracy)} m)` : ''}… hold still` : 'Take it at the reported pin. Position, time and a verification QR are stamped on it.'}
            onShutter={captureFromCamera}
            shutterDisabled={!cameraReady || saving || capturing}
            busy={capturing}
            shutterLabel="Capture photo"
            onRestart={capturing ? undefined : startCamera}
          />

          {cameraError && (
            <p className="mt-1 text-xs text-amber-700">{cameraError}</p>
          )}
          {capturedGeo && siteCheck && (
            <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${siteCheck.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
              <p className="font-semibold">
                {siteCheck.ok
                  ? (siteCheck.distanceM != null
                    ? `On site: ${Math.round(siteCheck.distanceM)} m from the reported pin (within ${MAX_DISTANCE_M} m)`
                    : 'Geotagged (this report has no pin to compare with)')
                  : 'Not accepted as on-site evidence'}
              </p>
              {!siteCheck.ok && <p className="mt-0.5">{siteCheck.problem}</p>}
              <p className="mt-0.5 opacity-80">
                GPS: {capturedGeo.latitude.toFixed(6)}, {capturedGeo.longitude.toFixed(6)}
                {Number.isFinite(capturedGeo.accuracy) ? ` (±${Math.round(capturedGeo.accuracy)} m)` : ''}
              </p>
            </div>
          )}
          {!photoFile && sitePoint && (
            <p className="mt-1 text-[11px] text-slate-500">The photo must be taken within {MAX_DISTANCE_M} m of the citizen's reported pin.</p>
          )}
          {captureGeoError && (
            <p className="mt-1 text-xs text-amber-700">{captureGeoError}</p>
          )}
        </div>

        {!photoFile && latestFinding?.field_photo_url && (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Previously Submitted Photo</p>
              <ZoomablePhoto
                src={latestFinding.field_photo_url}
                alt="Previously submitted field capture"
                label="Your earlier inspection photo"
                wrapperClassName="w-full"
                className="w-full h-40 object-cover rounded-lg border border-slate-200"
              />
            </div>
          </div>
        )}

        <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={engineerCertified}
            onChange={(e) => setEngineerCertified(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="font-semibold">
            I certify that these inspection findings, photo, and GPS capture were collected on site.
          </span>
        </label>

        {queuedInspection && (
          <div className={`flex flex-wrap items-start gap-3 rounded-xl border p-3 text-xs ${queuedInspection.lastError ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {queuedInspection.lastError ? 'Saved inspection was not accepted' : 'Inspection saved on this phone, waiting to send'}
              </p>
              <p className="mt-0.5">
                {queuedInspection.lastError
                  ? queuedInspection.lastError
                  : `Saved ${new Date(queuedInspection.queuedAt).toLocaleString()}. It is sent automatically when you are back online.`}
              </p>
            </div>
            {queuedInspection.lastError && (
              <button
                type="button"
                onClick={() => discardQueuedInspection(queuedInspection.id)}
                className="shrink-0 rounded-lg border border-red-300 bg-white px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100"
              >
                Discard
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={submitFindings}
            disabled={saving || loading || !engineerCertified}
            className={buttonClass('primary')}
          >
            {saving ? 'Submitting...' : 'Submit Findings'}
          </button>
        </div>
      </div>
    </section>
  );
}
