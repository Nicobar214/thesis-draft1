/* PublicReportForm.jsx — Location-First Public Report (Region VI — Iloilo)
 * Flow: locating → picking → classify → reporting → success
 * GPS is detected automatically on mount; nearby FMR projects are auto-filtered by proximity.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { enqueueReport, loadCachedProjects, saveCachedProjects } from '../lib/offlineReports';
import { requestBackgroundSync, triggerQueuedSync } from '../lib/offlineSync';
import {
  buildReportPayload,
  findNearbyProjects,
  friendlySubmitError,
  isNetworkFailure,
  makePhotoPath,
  validateReportInput,
} from '../lib/reportSubmission';
import SuccessStep from './publicReports/reportForm/SuccessStep';
import LocatingStep from './publicReports/reportForm/LocatingStep';
import PickingStep from './publicReports/reportForm/PickingStep';
import ClassifyStep from './publicReports/reportForm/ClassifyStep';
import ReportingStep from './publicReports/reportForm/ReportingStep';

// Each step fades and rises in, so moving between steps reads as one flow
// instead of the content being swapped out underneath the user.
const STEP_STYLE_ID = 'report-step-styles';
if (typeof document !== 'undefined' && !document.getElementById(STEP_STYLE_ID)) {
  const el = document.createElement('style');
  el.id = STEP_STYLE_ID;
  el.textContent = '@keyframes report-step-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } } .report-step-in { animation: report-step-in 280ms ease-out both; } @media (prefers-reduced-motion: reduce) { .report-step-in { animation: none !important; } }';
  document.head.appendChild(el);
}


export default function PublicReportForm({ prefillCategory = null, prefillProblem = null }) {
  // ── Step: 'locating' | 'picking' | 'classify' | 'reporting' | 'success' ──
  const [step, setStep] = useState('locating');

  // ── GPS ──
  const [gps,        setGps]        = useState(null);  // { lat, lng, accuracy }
  const [gpsError,   setGpsError]   = useState(null);
  // Start as loading when geolocation exists: the mount effect starts the lookup
  // immediately, so this avoids painting a 'Detect My Location' button for one frame.
  const [gpsLoading, setGpsLoading] = useState(() => typeof navigator !== 'undefined' && Boolean(navigator.geolocation));
  const [gpsSlow, setGpsSlow] = useState(false);
  const gpsWatchRef = useRef(null);

  // ── FMR projects ──
  const [allProjects, setAllProjects] = useState([]);
  const [projReady,   setProjReady]   = useState(false);
  const [nearby,      setNearby]      = useState([]);
  const [widerSearch, setWiderSearch] = useState(false);
  const [browseAll,   setBrowseAll]   = useState(false);
  const [selProject,  setSelProject]  = useState(null);
  const [selProjectRoute, setSelProjectRoute] = useState(null);

  // ── Camera / photo ──
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const [photoBlob,    setPhotoBlob]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoTs,      setPhotoTs]      = useState(null);
  const [camError,     setCamError]     = useState(null);
  const [camReady,     setCamReady]     = useState(false);

  // ── Form fields ──
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState('general');
  const [severityCategory, setSeverityCategory] = useState(prefillCategory || '');
  const [specificProblem, setSpecificProblem] = useState(prefillProblem || '');
  const [fullName,    setFullName]    = useState('');
  const [contact,     setContact]     = useState('');

  // ── Auth + submission ──
  const [currentUser, setCurrentUser] = useState(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState(null);
  const [isOffline,   setIsOffline]   = useState(!navigator.onLine);
  const [cachedProjectsMeta, setCachedProjectsMeta] = useState(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  // ── Auth check ───────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setCurrentUser(user); });
  }, []);

  useEffect(() => {
    const updateStatus = () => setIsOffline(!navigator.onLine);
    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  useEffect(() => {
    if (isOffline) return;
    console.info('[offline-sync] Online in PublicReportForm');
    triggerQueuedSync();
  }, [isOffline]);

  // ── Acquire GPS ──────────────────────────────────────────────
  const acquireGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setGps(loc);
        setGpsLoading(false);
        // The step advances (below) once the nearby projects are ready too, so the
        // user never lands on an empty list that fills in a moment later.
        // Start watcher for live drift correction
        if (gpsWatchRef.current !== null) navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = navigator.geolocation.watchPosition(
          (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000 },
        );
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === 1) {
          setGpsError('Location permission denied. Open your browser settings, enable Location for this site, then tap "Try Again".');
        } else if (err.code === 3) {
          setGpsError('GPS timed out. Move to open sky and try again.');
        } else {
          setGpsError(`Unable to get your location: ${err.message}`);
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, []);

  // If the fix is taking a while, say so instead of leaving a silent spinner.
  useEffect(() => {
    if (!gpsLoading) { setGpsSlow(false); return undefined; }
    const timer = setTimeout(() => setGpsSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [gpsLoading]);

  // Auto-start on mount
  useEffect(() => {
    acquireGps();
    return () => {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load all FMR projects once GPS resolves ──────────────────
  useEffect(() => {
    if (projReady) return;
    let alive = true;

    const loadProjects = async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from('fmr_projects')
          .select('id, project_name, start_latitude, start_longitude, end_latitude, end_longitude, municipality, location, status, project_length_km');

        if (fetchErr) throw fetchErr;
        if (!alive) return;
        setAllProjects(data || []);
        setProjReady(true);
        const cached = await saveCachedProjects(data || []);
        if (alive) setCachedProjectsMeta(cached);
      } catch {
        const cached = await loadCachedProjects();
        if (!alive) return;
        if (cached?.data?.length) {
          setAllProjects(cached.data);
          setProjReady(true);
          setCachedProjectsMeta(cached);
        } else {
          setAllProjects([]);
          setProjReady(true);
          setCachedProjectsMeta(null);
        }
      }
    };

    loadProjects();
    return () => {
      alive = false;
    };
  }, [projReady]);

  // Leave 'locating' only when we have both a position and the project list. A short
  // pause on the confirmation keeps it from flashing past; if the list is slow we
  // continue anyway after 8s rather than trap the user here.
  useEffect(() => {
    if (step !== 'locating' || !gps) return undefined;
    const timer = setTimeout(() => setStep('picking'), projReady ? 450 : 8000);
    return () => clearTimeout(timer);
  }, [step, gps, projReady]);

  // ── Recompute nearby when GPS or projects change ─────────────
  useEffect(() => {
    if (!gps || !projReady) return;
    setNearby(findNearbyProjects(allProjects, gps, widerSearch));
  }, [gps, allProjects, projReady, widerSearch]);

  // ── Fetch the project's mapped route once a project is selected ──
  useEffect(() => {
    if (!selProject?.id) {
      setSelProjectRoute(null);
      return;
    }
    let alive = true;
    supabase
      .from('project_routes')
      .select('*')
      .eq('project_id', selProject.id)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setSelProjectRoute(data || null);
      })
      .catch(() => {
        if (alive) setSelProjectRoute(null);
      });
    return () => { alive = false; };
  }, [selProject]);

  // ── Camera ────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCamError(null);
    setCamReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCamReady(true);
      }
    } catch (err) {
      setCamError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access.'
          : `Camera error: ${err.message}`,
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }, []);

  useEffect(() => {
    if (step === 'reporting' && !photoBlob) startCamera();
    return () => { if (step !== 'reporting') stopCamera(); };
  }, [step, photoBlob, startCamera, stopCamera]);

  const capturePhoto = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const now     = new Date();
    setPhotoTs(now.toISOString());
    const tsText  = now.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const gpsText = gps ? `GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy || 0)}m)` : '';
    const fontSize = Math.max(14, Math.floor(canvas.width / 50));
    const lineH    = fontSize + 4;
    const padding  = 8;
    const lines    = [tsText, gpsText].filter(Boolean);
    ctx.font         = `bold ${fontSize}px monospace`;
    ctx.textBaseline = 'bottom';
    const maxW   = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const stripH = lines.length * lineH + padding * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height - stripH, maxW + padding * 2, stripH);
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => ctx.fillText(line, padding, canvas.height - stripH + padding + (i + 1) * lineH));
    canvas.toBlob((blob) => { setPhotoBlob(blob); setPhotoPreview(URL.createObjectURL(blob)); stopCamera(); }, 'image/jpeg', 0.85);
  };

  const retakePhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(null);
    setPhotoPreview(null);
    startCamera();
  };

  // ── Submit ────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError(null);
    const problem = validateReportInput({ severityCategory, specificProblem, description, photoBlob, selProject, gps });
    if (problem) { setError(problem); return; }
    setSubmitting(true);

    // Validated above, so the project and GPS fix exist. One payload serves both the
    // online insert and the offline queue.
    const payloadBase = buildReportPayload({
      fullName, contact, selProject, gps, photoTs, description,
      severityCategory, category, specificProblem, userId: currentUser?.id,
    });

    const queueForLater = async (reason) => {
      const session = await supabase.auth.getSession();
      const authToken = session?.data?.session?.access_token || null;
      const queued = await enqueueReport(payloadBase, photoBlob, { photoPath: makePhotoPath(), authToken });
      console.info(reason, queued?.id);
      await requestBackgroundSync();
      setQueuedOffline(true);
      setStep('success');
    };

    try {
      if (isOffline) {
        await queueForLater('[offline-report] Saved offline report');
        return;
      }

      const photoPath = makePhotoPath();
      const { error: upErr } = await supabase.storage.from('public-report-photos').upload(photoPath, photoBlob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('public-report-photos').getPublicUrl(photoPath);

      const { error: insErr } = await supabase.from('public_reports').insert({ ...payloadBase, photo_url: urlData.publicUrl });
      if (insErr) throw insErr;
      setQueuedOffline(false);
      setStep('success');
    } catch (err) {
      console.error('Submit error:', err);
      if (isNetworkFailure(err, navigator.onLine)) {
        await queueForLater('[offline-report] Saved offline report after failure');
        return;
      }
      setError(friendlySubmitError(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────
  const resetAll = () => {
    stopCamera();
    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    setStep('locating');
    setGps(null);
    setGpsError(null);
    // acquireGps runs a moment later; show 'loading' meanwhile so the manual button never flashes.
    setGpsLoading(Boolean(navigator.geolocation));
    setProjReady(false);
    setAllProjects([]);
    setNearby([]);
    setWiderSearch(false);
    setBrowseAll(false);
    setSelProject(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(null);
    setPhotoPreview(null);
    setPhotoTs(null);
    setDescription('');
    setCategory('general');
    setSeverityCategory(prefillCategory || '');
    setSpecificProblem(prefillProblem || '');
    setFullName('');
    setContact('');
    setError(null);
    setQueuedOffline(false);
    setTimeout(acquireGps, 80);
  };
  // ════════════════════════════════════════════════════════
  //  RENDER - one component per step (see publicReports/reportForm/)
  // ════════════════════════════════════════════════════════
  if (step === 'success') {
    return <SuccessStep queuedOffline={queuedOffline} resetAll={resetAll} />;
  }

  if (step === 'locating') {
    return <LocatingStep gpsLoading={gpsLoading} gpsSlow={gpsSlow} gps={gps} gpsError={gpsError} acquireGps={acquireGps} />;
  }

  if (step === 'picking') {
    return (
      <PickingStep
        gps={gps}
        allProjects={allProjects}
        nearby={nearby}
        browseAll={browseAll}
        widerSearch={widerSearch}
        isOffline={isOffline}
        cachedProjectsMeta={cachedProjectsMeta}
        setWiderSearch={setWiderSearch}
        setBrowseAll={setBrowseAll}
        setSelProject={setSelProject}
        setStep={setStep}
      />
    );
  }

  if (step === 'classify') {
    return (
      <ClassifyStep
        severityCategory={severityCategory}
        specificProblem={specificProblem}
        setSeverityCategory={setSeverityCategory}
        setSpecificProblem={setSpecificProblem}
        setCategory={setCategory}
        setStep={setStep}
      />
    );
  }

  if (step === 'reporting') {
    return (
      <ReportingStep
        stopCamera={stopCamera}
        setStep={setStep}
        selProject={selProject}
        gps={gps}
        selProjectRoute={selProjectRoute}
        error={error}
        severityCategory={severityCategory}
        specificProblem={specificProblem}
        description={description}
        setDescription={setDescription}
        camError={camError}
        camReady={camReady}
        photoPreview={photoPreview}
        photoBlob={photoBlob}
        videoRef={videoRef}
        canvasRef={canvasRef}
        capturePhoto={capturePhoto}
        retakePhoto={retakePhoto}
        fullName={fullName}
        setFullName={setFullName}
        contact={contact}
        setContact={setContact}
        handleSubmit={handleSubmit}
        submitting={submitting}
      />
    );
  }

  return null;
}
