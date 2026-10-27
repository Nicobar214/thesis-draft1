/* PublicReportForm.jsx - Location-First Public Report (Region VI - Iloilo)
 * Flow: locating -> picking (map + list) -> navigating -> classify -> reporting -> success
 * GPS is detected automatically on mount; nearby FMR roads are found by distance to
 * the road line, shown on a map, and the picked one gets in-map directions.
 *
 * This component owns the flow and the submit. The pieces live elsewhere:
 *   lib/useGpsLocation.js      GPS fix + drift watcher
 *   lib/useReportCamera.js     live camera + stamped photo
 *   lib/reportSubmission.js    nearby / validation / payload / error rules
 *   publicReports/reportForm/  one component per step
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseFarmer } from '../lib/supabase';
import { enqueueReport, loadCachedProjects, loadCachedRoutes, saveCachedProjects, saveCachedRoutes } from '../lib/offlineReports';
import { buildRoutePoints } from '../lib/mapRouteUtils';
import { useRoadAlignedLines } from '../lib/useRoadAlignedLines';
import { requestBackgroundSync, triggerQueuedSync } from '../lib/offlineSync';
import {
  buildReportPayload,
  buildReportPhotoLabel,
  findNearbyRoads,
  isSuspectLine,
  friendlySubmitError,
  isNetworkFailure,
  makePhotoPath,
  reportLocationProblem,
  validateReportInput,
} from '../lib/reportSubmission';
import { useGpsLocation } from '../lib/useGpsLocation';
import { useReportCamera } from '../lib/useReportCamera';
import { attestPhoto, registerAttestation } from '../lib/photoAttestation';
import SuccessStep from './publicReports/reportForm/SuccessStep';
import LocatingStep from './publicReports/reportForm/LocatingStep';
import PickingStep from './publicReports/reportForm/PickingStep';
import ClassifyStep from './publicReports/reportForm/ClassifyStep';
import ReportingStep from './publicReports/reportForm/ReportingStep';
import NavigateStep from './publicReports/reportForm/NavigateStep';

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
  // Step: 'locating' | 'picking' | 'navigating' | 'classify' | 'reporting' | 'success'
  const [step, setStep] = useState('locating');

  const { gps, gpsError, gpsLoading, gpsSlow, acquireGps, resetGps } = useGpsLocation();


  // FMR projects
  const [allProjects, setAllProjects] = useState([]);
  const [projReady,   setProjReady]   = useState(false);
  const [routes,      setRoutes]      = useState([]);
  const [widerSearch, setWiderSearch] = useState(false);
  const [browseAll,   setBrowseAll]   = useState(false);
  const [selProject,  setSelProject]  = useState(null);
  const [selProjectRoute, setSelProjectRoute] = useState(null);

  // Camera / photo: runs only while the full-screen camera is open on the reporting step
  const [cameraOpen, setCameraOpen] = useState(false);
  const openCamera = useCallback(() => setCameraOpen(true), []);
  const closeCamera = useCallback(() => setCameraOpen(false), []);
  const {
    videoRef, canvasRef,
    photoBlob, photoPreview, photoTs, photoGps,
    camError, camReady,
    capturePhoto, retakePhoto, resetPhoto, stopCamera,
  } = useReportCamera({ gps, active: step === 'reporting' && cameraOpen });

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

    // Road lines for the map. Not required: without them a project is drawn
    // start-to-end, so a failure here never blocks reporting.
    const loadRoutes = async () => {
      try {
        const { data, error: routeErr } = await client.from('project_routes').select('*');
        if (routeErr) throw routeErr;
        if (!alive) return;
        setRoutes(data || []);
        saveCachedRoutes(data || []).catch(() => {});
      } catch {
        const cached = await loadCachedRoutes().catch(() => null);
        if (alive) setRoutes(cached?.data || []);
      }
    };

    const loadProjects = async () => {
      try {
        const { data, error: fetchErr } = await client
          .from('fmr_projects')
          .select('id, project_name, start_latitude, start_longitude, end_latitude, end_longitude, municipality, location, status, project_length_km');

        if (fetchErr) throw fetchErr;
        if (!alive) return;
        loadRoutes();
        setAllProjects(data || []);
        setProjReady(true);
        const cached = await saveCachedProjects(data || []);
        if (alive) setCachedProjectsMeta(cached);
      } catch {
        const cached = await loadCachedProjects();
        if (!alive) return;
        loadRoutes();
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

  // Every project as a road line ([[lat, lng]]): its mapped route, else start to end.
  const routeByProjectId = useMemo(() => new Map(routes.map((r) => [r.project_id, r])), [routes]);
  const rawLines = useMemo(() => allProjects
    .map((project) => {
      const { points } = buildRoutePoints(project, routeByProjectId.get(project.id) || null);
      // Pins far further apart than the road is long: only the pins count as "near".
      return points.length >= 2 ? { project, points, pinsOnly: isSuspectLine(project, points) } : null;
    })
    .filter(Boolean), [allProjects, routeByProjectId]);
  // Roads known only by their two pins follow the real road near the reporter.
  const me = useMemo(() => (gps ? [gps.lat, gps.lng] : null), [gps]);
  const lines = useRoadAlignedLines(rawLines, me);

  // Nearby = within reach of the road line, nearest first.
  const nearbyRoads = useMemo(
    () => (gps && projReady ? findNearbyRoads(lines, gps, widerSearch) : []),
    [gps, projReady, lines, widerSearch],
  );
  const nearby = useMemo(() => nearbyRoads.map((r) => r.project), [nearbyRoads]);
  const selLine = useMemo(
    () => (selProject ? lines.find((l) => l.project.id === selProject.id) || null : null),
    [lines, selProject],
  );
  // The road the report is checked against: the mapped route, else the aligned
  // road line, so the location badge measures to the real road too.
  const reportRoute = useMemo(
    () => selProjectRoute || (selLine?.aligned ? { route_points: selLine.points, route_source: 'osrm-aligned' } : null),
    [selProjectRoute, selLine],
  );

  // Fetch the project's mapped route once a project is selected
  useEffect(() => {
    if (!selProject?.id) {
      setSelProjectRoute(null);
      return;
    }
    const known = routeByProjectId.get(selProject.id);
    if (known) {
      setSelProjectRoute(known);
      return undefined;
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
  }, [selProject, client, routeByProjectId]);

  // Submit
  const handleSubmit = async () => {
    setError(null);
    // The report is where the photo was taken (photoGps), not where the phone is
    // now: a report made at the road stays credible if it is sent later, elsewhere.
    const reportGps = photoGps || gps;
    const problem = validateReportInput({ severityCategory, specificProblem, description, photoBlob, selProject, gps: reportGps, roadPoints: selLine?.points, pinsOnly: selLine?.pinsOnly });
    if (problem) { setError(problem); return; }
    setSubmitting(true);

    // Validated above, so the project and GPS fix exist. One payload serves both the
    // online insert and the offline queue.
    const payloadBase = buildReportPayload({
      fullName, contact, selProject, gps: reportGps, photoTs, description,
      severityCategory, category, specificProblem, userId: currentUser?.id,
      routeRecord: reportRoute,
    });

    // Tamper-evident photo: stamp date/time, GPS, project and a verification
    // QR onto the photo and fingerprint it (lib/photoAttestation.js). If the
    // browser can't stamp, the report still goes through with the plain photo.
    let uploadBlob = photoBlob;
    let attestation = null;
    try {
      const stamped = await attestPhoto(photoBlob, {
        kind: 'citizen_report',
        latitude: reportGps?.lat,
        longitude: reportGps?.lng,
        accuracy: reportGps?.accuracy,
        capturedAt: photoTs || undefined,
        label: buildReportPhotoLabel({ severityCategory, specificProblem, selProject }),
      });
      uploadBlob = stamped.blob;
      attestation = stamped.attestation;
    } catch (stampErr) {
      console.warn('[report] photo stamp failed, sending the plain photo', stampErr);
    }

    const queueForLater = async (reason) => {
      const session = await client.auth.getSession();
      const authToken = session?.data?.session?.access_token || null;
      const queued = await enqueueReport(payloadBase, uploadBlob, {
        photoPath: makePhotoPath(),
        authToken,
        attestation,
        portal: client === supabaseFarmer ? 'farmer' : 'citizen',
      });
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
      const { error: upErr } = await client.storage.from('public-report-photos').upload(photoPath, uploadBlob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = client.storage.from('public-report-photos').getPublicUrl(photoPath);

      const { error: insErr } = await client.from('public_reports').insert({ ...payloadBase, photo_url: urlData.publicUrl });
      if (insErr) throw insErr;
      await registerAttestation(client, attestation, { bucket: 'public-report-photos', path: photoPath });
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
    setCameraOpen(false);
    resetGps();
    resetPhoto();
    setStep('locating');
    setProjReady(false);
    setAllProjects([]);
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

  const goClassify = useCallback(() => setStep('classify'), []);

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
        lines={lines}
        nearbyRoads={nearbyRoads}
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

  if (step === 'navigating' && selProject) {
    // No drawable line (no coordinates at all): there is no road to check the
    // reporter's location against, so a report on it cannot be accepted.
    if (!selLine) {
      return (
        <div className="report-step-in space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            <p className="font-semibold">{selProject.project_name}</p>
            <p className="mt-1">{reportLocationProblem(gps, null)}</p>
          </div>
          <button type="button" onClick={() => { setSelProject(null); setStep('picking'); }} className="w-full rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            Pick another road
          </button>
        </div>
      );
    }
    return (
      <NavigateStep
        gps={gps}
        project={selProject}
        points={selLine.points}
        pinsOnly={Boolean(selLine.pinsOnly)}
        onReportNow={goClassify}
        onBack={() => { setSelProject(null); setStep('picking'); }}
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
        selProjectRoute={reportRoute}
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
        cameraOpen={cameraOpen}
        openCamera={openCamera}
        closeCamera={closeCamera}
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
