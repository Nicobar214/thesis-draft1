/* PublicReportForm.jsx - Location-First Public Report (Region VI - Iloilo)
 * Flow: locating -> picking -> classify -> reporting -> success
 * GPS is detected automatically on mount; nearby FMR projects are auto-filtered by proximity.
 *
 * This component owns the flow and the submit. The pieces live elsewhere:
 *   lib/useGpsLocation.js      GPS fix + drift watcher
 *   lib/useReportCamera.js     live camera + stamped photo
 *   lib/reportSubmission.js    nearby / validation / payload / error rules
 *   publicReports/reportForm/  one component per step
 */
import { useState, useEffect } from 'react';
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
import { useGpsLocation } from '../lib/useGpsLocation';
import { useReportCamera } from '../lib/useReportCamera';
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

/**
 * `client` is the Supabase client whose session owns the report. It defaults
 * to the citizen client; other portals (e.g. farmers) must pass their own,
 * since each role keeps its session under a separate storage key. With the
 * wrong client the report is saved anonymously and never shows up in that
 * user's "My Reports".
 */
export default function PublicReportForm({ prefillCategory = null, prefillProblem = null, client = supabase, onSubmitted }) {
  // Step: 'locating' | 'picking' | 'classify' | 'reporting' | 'success'
  const [step, setStep] = useState('locating');

  const { gps, gpsError, gpsLoading, gpsSlow, acquireGps, resetGps } = useGpsLocation();

  // FMR projects
  const [allProjects, setAllProjects] = useState([]);
  const [projReady,   setProjReady]   = useState(false);
  const [nearby,      setNearby]      = useState([]);
  const [widerSearch, setWiderSearch] = useState(false);
  const [browseAll,   setBrowseAll]   = useState(false);
  const [selProject,  setSelProject]  = useState(null);
  const [selProjectRoute, setSelProjectRoute] = useState(null);

  // Camera / photo (runs only while the reporting step is showing)
  const {
    videoRef, canvasRef,
    photoBlob, photoPreview, photoTs,
    camError, camReady,
    capturePhoto, retakePhoto, resetPhoto, stopCamera,
  } = useReportCamera({ gps, active: step === 'reporting' });

  // Form fields
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState('general');
  const [severityCategory, setSeverityCategory] = useState(prefillCategory || '');
  const [specificProblem, setSpecificProblem] = useState(prefillProblem || '');
  const [fullName,    setFullName]    = useState('');
  const [contact,     setContact]     = useState('');

  // Auth + submission
  const [currentUser, setCurrentUser] = useState(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState(null);
  const [isOffline,   setIsOffline]   = useState(!navigator.onLine);
  const [cachedProjectsMeta, setCachedProjectsMeta] = useState(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  // Auth check
  useEffect(() => {
    client.auth.getUser().then(({ data: { user } }) => { if (user) setCurrentUser(user); });
  }, [client]);

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

  // Load all FMR projects (falls back to the offline cache)
  useEffect(() => {
    if (projReady) return;
    let alive = true;

    const loadProjects = async () => {
      try {
        const { data, error: fetchErr } = await client
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
  }, [projReady, client]);

  // Leave 'locating' only when we have both a position and the project list. A short
  // pause on the confirmation keeps it from flashing past; if the list is slow we
  // continue anyway after 8s rather than trap the user here.
  useEffect(() => {
    if (step !== 'locating' || !gps) return undefined;
    const timer = setTimeout(() => setStep('picking'), projReady ? 450 : 8000);
    return () => clearTimeout(timer);
  }, [step, gps, projReady]);

  // Recompute nearby when GPS or projects change
  useEffect(() => {
    if (!gps || !projReady) return;
    setNearby(findNearbyProjects(allProjects, gps, widerSearch));
  }, [gps, allProjects, projReady, widerSearch]);

  // Fetch the project's mapped route once a project is selected
  useEffect(() => {
    if (!selProject?.id) {
      setSelProjectRoute(null);
      return;
    }
    let alive = true;
    client
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
  }, [selProject, client]);

  // Submit
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
      const session = await client.auth.getSession();
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
      const { error: upErr } = await client.storage.from('public-report-photos').upload(photoPath, photoBlob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = client.storage.from('public-report-photos').getPublicUrl(photoPath);

      const { error: insErr } = await client.from('public_reports').insert({ ...payloadBase, photo_url: urlData.publicUrl });
      if (insErr) throw insErr;
      setQueuedOffline(false);
      setStep('success');
      onSubmitted?.();
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

  // Reset for "Submit another report"
  const resetAll = () => {
    stopCamera();
    resetGps();
    resetPhoto();
    setStep('locating');
    setProjReady(false);
    setAllProjects([]);
    setNearby([]);
    setWiderSearch(false);
    setBrowseAll(false);
    setSelProject(null);
    setDescription('');
    setCategory('general');
    setSeverityCategory(prefillCategory || '');
    setSpecificProblem(prefillProblem || '');
    setFullName('');
    setContact('');
    setError(null);
    setQueuedOffline(false);
    // The lookup restarts a moment later; resetGps shows "loading" meanwhile so the
    // manual button never flashes.
    setTimeout(acquireGps, 80);
  };

  // Render - one component per step (see publicReports/reportForm/)
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
