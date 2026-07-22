/* PublicReportForm.jsx — Location-First Public Report (Region VI — Iloilo)
 * Flow: locating → picking → classify → reporting → success
 * GPS is detected automatically on mount; nearby FMR projects are auto-filtered by proximity.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { enqueueReport, loadCachedProjects, saveCachedProjects } from '../lib/offlineReports';
import { requestBackgroundSync, triggerQueuedSync } from '../lib/offlineSync';
import PublicReportRouteMapPanel from './publicReports/PublicReportRouteMapPanel';

// ── Constants ──────────────────────────────────────────────
const REGION          = 'Region VI – Western Visayas';
const PROVINCE        = 'Iloilo';
const RADIUS_MIDPOINT = 250;   // metres – midpoint check
const RADIUS_ENDPOINT = 150;   // metres – start / end point check
const RADIUS_WIDER    = 1000;  // metres – "wider search" fallback

// ── Haversine ──────────────────────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectMidpoint(p) {
  if (!p.start_latitude || !p.end_latitude) return null;
  return {
    lat: (p.start_latitude  + p.end_latitude)  / 2,
    lng: (p.start_longitude + p.end_longitude) / 2,
  };
}

function isProjectNearby(userLat, userLng, p, midR = RADIUS_MIDPOINT, endR = RADIUS_ENDPOINT) {
  if (!p.start_latitude) return false;
  const mid      = projectMidpoint(p);
  const nearMid  = mid  && haversineMeters(userLat, userLng, mid.lat, mid.lng) <= midR;
  const nearStart =       haversineMeters(userLat, userLng, p.start_latitude, p.start_longitude) <= endR;
  const nearEnd  = p.end_latitude &&
                   haversineMeters(userLat, userLng, p.end_latitude, p.end_longitude) <= endR;
  return !!(nearMid || nearStart || nearEnd);
}

function distToProject(userLat, userLng, p) {
  const mid = projectMidpoint(p);
  if (mid)              return haversineMeters(userLat, userLng, mid.lat, mid.lng);
  if (p.start_latitude) return haversineMeters(userLat, userLng, p.start_latitude, p.start_longitude);
  return Infinity;
}

function fmtDist(m) {
  return m < 1000 ? `~${Math.round(m)}m away` : `~${(m / 1000).toFixed(1)}km away`;
}

function computeVerification(userLat, userLng, accuracy, projLat, projLng) {
  if (!projLat || !projLng || !userLat) return 'Needs Review';
  const d = haversineMeters(userLat, userLng, projLat, projLng);
  if (d <= 100) return 'Verified On-Site';
  if (accuracy && accuracy > 50) return 'Needs Review';
  return 'Location Mismatch';
}

function statusCls(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('complet'))                                               return 'bg-emerald-100 text-emerald-700';
  if (s.includes('progress') || s.includes('going') || s.includes('ongoing')) return 'bg-blue-100 text-blue-700';
  if (s.includes('proposed'))                                              return 'bg-sky-100 text-sky-700';
  return 'bg-slate-100 text-slate-600';
}

// ── Severity taxonomy ───────────────────────────────────────
const SEVERITY_TAXONOMY = {
  safety: {
    label: 'Safety Hazard',
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: '🔴',
    description: 'Risk to life or physical harm',
    problems: [
      { value: 'fallen_tree', label: 'Fallen tree blocking road' },
      { value: 'collapsed_road', label: 'Road collapse / sinkhole' },
      { value: 'missing_guardrail', label: 'Missing or broken guardrail' },
      { value: 'accident_site', label: 'Active accident site' },
      { value: 'sharp_debris', label: 'Sharp debris / broken glass on road' },
      { value: 'unsafe_bridge', label: 'Unsafe or damaged bridge' },
    ],
  },
  flood: {
    label: 'Flood / Drainage',
    color: 'bg-sky-100 text-sky-700 border-sky-200',
    icon: '🌊',
    description: 'Water-related road obstruction',
    problems: [
      { value: 'road_flooded', label: 'Road completely flooded' },
      { value: 'partial_flood', label: 'Partial flooding — passable with care' },
      { value: 'blocked_drainage', label: 'Blocked or clogged drainage' },
      { value: 'erosion', label: 'Soil erosion along road edge' },
      { value: 'landslide', label: 'Landslide / mudflow on road' },
    ],
  },
  issue: {
    label: 'Road Condition Issue',
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    icon: '🔧',
    description: 'Physical damage to road surface',
    problems: [
      { value: 'pothole', label: 'Potholes / lubak' },
      { value: 'crack', label: 'Surface cracks' },
      { value: 'missing_pavement', label: 'Missing pavement / unpaved section' },
      { value: 'broken_curb', label: 'Broken curb or road edge' },
      { value: 'uneven_surface', label: 'Severely uneven / bumpy surface' },
      { value: 'dust_gravel', label: 'Excessive dust / loose gravel' },
    ],
  },
  general: {
    label: 'General Concern',
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: '💬',
    description: 'Other observations or suggestions',
    problems: [
      { value: 'no_signage', label: 'Missing road signs' },
      { value: 'poor_lighting', label: 'No or poor streetlighting' },
      { value: 'vegetation', label: 'Overgrown vegetation blocking view' },
      { value: 'project_delay', label: 'Project seems delayed / stalled' },
      { value: 'quality_concern', label: 'Construction quality concern' },
      { value: 'other', label: 'Other concern' },
    ],
  },
};

// ── Shared input style ──────────────────────────────────────
const inputCls =
  'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm ' +
  'focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition';
// ═══════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════
export default function PublicReportForm({ prefillCategory = null, prefillProblem = null }) {
  // ── Step: 'locating' | 'picking' | 'classify' | 'reporting' | 'success' ──
  const [step, setStep] = useState('locating');

  // ── GPS ──
  const [gps,        setGps]        = useState(null);  // { lat, lng, accuracy }
  const [gpsError,   setGpsError]   = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
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
        setStep('picking');
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
    if (!gps || projReady) return;
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
  }, [gps, projReady]);

  // ── Recompute nearby when GPS or projects change ─────────────
  useEffect(() => {
    if (!gps || !projReady) return;
    const midR = widerSearch ? RADIUS_WIDER : RADIUS_MIDPOINT;
    const endR = widerSearch ? RADIUS_WIDER : RADIUS_ENDPOINT;
    const list = allProjects
      .filter((p) => isProjectNearby(gps.lat, gps.lng, p, midR, endR))
      .sort((a, b) => distToProject(gps.lat, gps.lng, a) - distToProject(gps.lat, gps.lng, b));
    setNearby(list);
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
    if (!severityCategory || !specificProblem) { setError('Please classify the report before submitting.'); return; }
    if (!description.trim()) { setError('Please enter a description.'); return; }
    if (!photoBlob)           { setError('A site photo is required.');   return; }
    if (!selProject)          { setError('No project selected.');        return; }
    if (!gps)                 { setError('GPS coordinates are required.'); return; }
    setSubmitting(true);
    try {
      const verification = computeVerification(gps.lat, gps.lng, gps.accuracy, selProject.start_latitude, selProject.start_longitude);
      const payloadBase = {
        full_name:       fullName.trim() || 'Anonymous',
        contact_info:    contact.trim(),
        region:          REGION,
        province:        PROVINCE,
        municipality:    selProject.municipality || '',
        barangay:        selProject.location     || '',
        street:          '',
        project_id:      `fmr-${selProject.id}`,
        project_name:    selProject.project_name,
        latitude:        gps.lat,
        longitude:       gps.lng,
        geo_accuracy:    gps.accuracy,
        photo_timestamp: photoTs || new Date().toISOString(),
        verification,
        description:     description.trim(),
        category: severityCategory || category,
        severity_category: severityCategory || null,
        specific_problem: specificProblem || null,
        source:          fullName.trim() ? 'Public Report' : 'Anonymous Public Report',
      };
      if (currentUser) payloadBase.user_id = currentUser.id;

      const session = await supabase.auth.getSession();
      const authToken = session?.data?.session?.access_token || null;
      const photoPath = `reports/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;

      if (isOffline) {
        const queued = await enqueueReport(payloadBase, photoBlob, { photoPath, authToken });
        console.info('[offline-report] Saved offline report', queued.id);
        await requestBackgroundSync();
        setQueuedOffline(true);
        setStep('success');
        return;
      }

      const { error: upErr } = await supabase.storage.from('public-report-photos').upload(photoPath, photoBlob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('public-report-photos').getPublicUrl(photoPath);
      const payload = { ...payloadBase, photo_url: urlData.publicUrl };

      const { error: insErr } = await supabase.from('public_reports').insert(payload);
      if (insErr) throw insErr;
      setQueuedOffline(false);
      setStep('success');
    } catch (err) {
      console.error('Submit error:', err);
      if (!navigator.onLine || err?.message?.toLowerCase().includes('failed to fetch')) {
        const session = await supabase.auth.getSession();
        const authToken = session?.data?.session?.access_token || null;
        const photoPath = `reports/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const queued = await enqueueReport({
          full_name:       fullName.trim() || 'Anonymous',
          contact_info:    contact.trim(),
          region:          REGION,
          province:        PROVINCE,
          municipality:    selProject.municipality || '',
          barangay:        selProject.location     || '',
          street:          '',
          project_id:      `fmr-${selProject.id}`,
          project_name:    selProject.project_name,
          latitude:        gps.lat,
          longitude:       gps.lng,
          geo_accuracy:    gps.accuracy,
          photo_timestamp: photoTs || new Date().toISOString(),
          verification: computeVerification(gps.lat, gps.lng, gps.accuracy, selProject.start_latitude, selProject.start_longitude),
          description:     description.trim(),
          category: severityCategory || category,
          severity_category: severityCategory || null,
          specific_problem: specificProblem || null,
          source:          fullName.trim() ? 'Public Report' : 'Anonymous Public Report',
          ...(currentUser ? { user_id: currentUser.id } : {}),
        }, photoBlob, { photoPath, authToken });
        console.info('[offline-report] Saved offline report after failure', queued?.id);
        await requestBackgroundSync();
        setQueuedOffline(true);
        setStep('success');
        return;
      }
      if (err.message?.includes("Could not find the 'category' column")) {
        setError('The database schema is outdated. Run supabase_fix_public_reports_schema.sql in Supabase SQL Editor, then submit again.');
      } else if (err.message?.toLowerCase().includes('project_id') && err.message?.toLowerCase().includes('integer')) {
        setError('The database schema is outdated. Run supabase_fix_public_reports_schema.sql in Supabase SQL Editor to update public_reports.project_id, then submit again.');
      } else {
        setError(err.message || 'Something went wrong. Please try again.');
      }
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
    setGpsLoading(false);
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
  //  RENDER
  // ════════════════════════════════════════════════════════

  // ── SUCCESS ──────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="text-center py-12 px-6">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">Report Submitted!</h3>
        <p className="text-slate-600 max-w-md mx-auto mb-6">
          {queuedOffline
            ? 'Your report was saved offline and will sync automatically when you are back online.'
            : 'Your report has been recorded and location-verified. The photo and GPS coordinates confirm your on-site presence. Thank you for helping monitor community infrastructure.'}
        </p>
        <button onClick={resetAll} className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 font-semibold text-sm transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Submit another report
        </button>
      </div>
    );
  }

  // ── LOCATING ─────────────────────────────────────────────
  if (step === 'locating') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] py-10 px-6 space-y-6">
        {gpsLoading && (
          <>
            <div className="relative flex items-center justify-center">
              <span className="absolute inline-flex h-24 w-24 rounded-full bg-teal-400 opacity-20 animate-ping" />
              <span className="absolute inline-flex h-16 w-16 rounded-full bg-teal-400 opacity-25 animate-ping" style={{ animationDelay: '0.25s' }} />
              <div className="relative z-10 w-14 h-14 bg-teal-500 rounded-full flex items-center justify-center shadow-lg shadow-teal-500/40">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-slate-800">Getting your GPS position…</p>
              <p className="text-sm text-slate-400 mt-1">Please stay still for the best accuracy</p>
            </div>
          </>
        )}

        {!gpsLoading && gpsError && (
          <>
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </div>
            <div className="text-center space-y-2 max-w-xs">
              <p className="font-semibold text-slate-900">Location Access Required</p>
              <p className="text-sm text-slate-500">{gpsError}</p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 text-left mt-2">
                <p className="font-semibold mb-1">Enable Location in Browser Settings:</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Tap the lock / info icon in the address bar</li>
                  <li>Set "Location" to "Allow"</li>
                  <li>Reload or tap "Try Again" below</li>
                </ul>
              </div>
            </div>
            <button type="button" onClick={acquireGps}
              className="inline-flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-teal-700 transition shadow-lg shadow-teal-500/20">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Try Again
            </button>
          </>
        )}

        {!gpsLoading && !gpsError && (
          <button type="button" onClick={acquireGps}
            className="inline-flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-teal-700 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            Detect My Location
          </button>
        )}
      </div>
    );
  }
  // ── PICKING ──────────────────────────────────────────────
  if (step === 'picking') {
    const displayList = browseAll
      ? [...allProjects].sort((a, b) => distToProject(gps.lat, gps.lng, a) - distToProject(gps.lat, gps.lng, b))
      : nearby;
    const lowAcc = gps && gps.accuracy > 100;

    return (
      <div className="space-y-4">
        {/* GPS / found banner */}
        <div className={`px-4 py-3.5 rounded-2xl border ${lowAcc ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${lowAcc ? 'bg-amber-400' : 'bg-teal-400'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${lowAcc ? 'bg-amber-500' : 'bg-teal-500'}`} />
            </span>
            <span className={`text-sm font-semibold ${lowAcc ? 'text-amber-900' : 'text-teal-900'}`}>
              {browseAll
                ? `Browsing all ${allProjects.length} projects`
                : widerSearch
                ? `${nearby.length} project${nearby.length !== 1 ? 's' : ''} within 1km`
                : `📍 Found ${nearby.length} project${nearby.length !== 1 ? 's' : ''} near you`}
            </span>
          </div>
          <p className={`text-xs pl-4 ${lowAcc ? 'text-amber-700' : 'text-teal-700'}`}>
            GPS accuracy: ±{Math.round(gps?.accuracy || 0)}m
            {lowAcc && <span className="ml-1 font-medium">— move to open sky for better results</span>}
          </p>
        </div>

        {isOffline && (
          <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
            Offline mode: using the last cached project list.
            {cachedProjectsMeta?.updatedAt && (
              <span className="ml-1">Last synced {new Date(cachedProjectsMeta.updatedAt).toLocaleString()}.</span>
            )}
          </div>
        )}

        {/* Zero results state */}
        {!browseAll && displayList.length === 0 && (
          <div className="text-center py-8 px-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
            <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                No projects found within {widerSearch ? '1km' : '250m'} of your location
              </p>
              <p className="text-xs text-slate-400 mt-0.5">GPS accuracy: ±{Math.round(gps?.accuracy || 0)}m</p>
            </div>
            {!widerSearch && (
              <button type="button" onClick={() => setWiderSearch(true)}
                className="inline-flex items-center gap-2 bg-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 transition">
                Search a wider area (1km)
              </button>
            )}
            <button type="button" onClick={() => setBrowseAll(true)}
              className="block mx-auto text-sm text-slate-400 hover:text-teal-600 underline">
              Browse all projects
            </button>
          </div>
        )}

        {/* Project cards */}
        {displayList.length > 0 && (
          <div className="space-y-3">
            {displayList.map((p) => {
              const dist     = gps ? distToProject(gps.lat, gps.lng, p) : null;
              const isOngoing = /progress|going|ongoing/i.test(p.status || '');
              return (
                <button type="button" key={p.id}
                  onClick={() => { setSelProject(p); setStep('classify'); }}
                  className="w-full text-left p-5 rounded-2xl border-2 border-slate-200 bg-white hover:border-teal-400 hover:bg-teal-50/30 transition-all active:scale-[0.98] shadow-sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-slate-900 leading-tight">{p.project_name}</p>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${statusCls(p.status)}`}>
                      {p.status || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap mb-2">
                    {dist !== null && <span className="text-teal-600 font-semibold">{fmtDist(dist)}</span>}
                    {p.municipality && <span>📍 {p.municipality}</span>}
                    {p.project_length_km > 0 && <span>{p.project_length_km} km road</span>}
                  </div>
                  {isOngoing && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span>Implementation in progress</span>
                        <span>On-Going</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full w-3/5" />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Escape hatch */}
        <div className="text-center pt-1">
          {!browseAll ? (
            <button type="button" onClick={() => setBrowseAll(true)}
              className="text-xs text-slate-400 hover:text-teal-600 underline">
              Not near a project? Browse all
            </button>
          ) : (
            <button type="button" onClick={() => { setBrowseAll(false); setWiderSearch(false); }}
              className="text-xs text-slate-400 hover:text-teal-600 underline">
              ← Back to nearby projects
            </button>
          )}
        </div>
      </div>
    );
  }
  // ── CLASSIFY ─────────────────────────────────────────────
  if (step === 'classify') {
    const categoryMeta = severityCategory ? SEVERITY_TAXONOMY[severityCategory] : null;
    const problemOptions = categoryMeta?.problems || [];
    const canProceed = severityCategory && specificProblem;

    return (
      <div className="space-y-5">
        <button type="button"
          onClick={() => { setSpecificProblem(''); setSeverityCategory(''); setStep('picking'); }}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 font-medium transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to project list
        </button>

        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
          <p className="text-sm font-medium text-teal-800 mb-0.5">Step 1 of 2 — Classify your report</p>
          <p className="text-xs text-teal-600">
            Select the severity and specific problem so your report reaches the right team immediately.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            What type of issue is this?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(SEVERITY_TAXONOMY).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setSeverityCategory(key); setSpecificProblem(''); setCategory(key); }}
                className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                  severityCategory === key
                    ? `${meta.color} ring-2 ring-offset-1 ring-current`
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="text-lg leading-none mt-0.5">{meta.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {severityCategory && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              What specifically is the problem?
            </label>
            <select
              value={specificProblem}
              onChange={(e) => setSpecificProblem(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition"
            >
              <option value="">— Select specific problem —</option>
              {problemOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {specificProblem && (
              <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${categoryMeta.color}`}>
                <span>{categoryMeta.icon}</span>
                <span>
                  {categoryMeta.label} → {problemOptions.find((p) => p.value === specificProblem)?.label}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => { setSeverityCategory(''); setSpecificProblem(''); setStep('picking'); }}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canProceed}
            onClick={() => setStep('reporting')}
            className="flex-1 px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to Report →
          </button>
        </div>
      </div>
    );
  }
  // ── REPORTING ────────────────────────────────────────────
  if (step === 'reporting') {
    const lowAcc = gps && gps.accuracy > 100;
    return (
      <div className="space-y-5">
        {/* Back */}
        <button type="button"
          onClick={() => { stopCamera(); setStep('classify'); }}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 font-medium transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to project list
        </button>

        {/* Auto-filled read-only chips */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Auto-filled from GPS</p>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl max-w-full">
              <svg className="w-3.5 h-3.5 text-teal-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="text-xs font-medium text-slate-700 truncate">{selProject?.project_name}</span>
            </div>
            {selProject?.municipality && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
                <span className="text-xs text-slate-600">{selProject.municipality}</span>
              </div>
            )}
            {selProject?.location && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                <span className="text-xs text-slate-600">{selProject.location}</span>
              </div>
            )}
            {gps && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl">
                <span className="text-xs text-teal-700 font-mono font-medium">
                  📍 {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Map preview: report pin + the reported project's route */}
        {gps && selProject && (
          <PublicReportRouteMapPanel
            project={selProject}
            routeRecord={selProjectRoute}
            reportLatitude={gps.lat}
            reportLongitude={gps.lng}
            heightClass="h-56 sm:h-64"
            title="Your Report Pin & Project Route"
          />
        )}

        {/* Low-accuracy warning */}
        {lowAcc && (
          <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            <span>Low GPS accuracy (±{Math.round(gps.accuracy)}m) — move to open sky for better results. You can still submit.</span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {severityCategory && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium bg-slate-50 border-slate-200 text-slate-700">
            <span>{SEVERITY_TAXONOMY[severityCategory]?.icon}</span>
            <span>
              {SEVERITY_TAXONOMY[severityCategory]?.label}
              {specificProblem ? ` → ${SEVERITY_TAXONOMY[severityCategory]?.problems.find((p) => p.value === specificProblem)?.label}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setStep('classify')}
              className="ml-2 underline underline-offset-2 text-slate-500 hover:text-slate-700"
            >
              change
            </button>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
            placeholder="Describe the current condition, issue, or observation at this project site…"
            className={`${inputCls} resize-none`} />
        </div>

        {/* Photo capture */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Site Photo <span className="text-red-500">*</span>
            <span className="text-xs font-normal text-slate-400 ml-1">(live camera only)</span>
          </label>
          {camError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 mb-3">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{camError}</span>
            </div>
          )}
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video">
            {!photoPreview ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!camReady && !camError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
                    <div className="animate-spin w-8 h-8 border-2 border-white/30 border-t-white rounded-full" />
                  </div>
                )}
              </>
            ) : (
              <img src={photoPreview} alt="Captured" className="w-full h-full object-cover" />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="flex justify-center gap-3 mt-3">
            {!photoPreview ? (
              <button type="button" onClick={capturePhoto} disabled={!camReady}
                className="inline-flex items-center gap-2 bg-white text-slate-900 border-2 border-slate-300 px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-50 disabled:opacity-40 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
                Capture Photo
              </button>
            ) : (
              <button type="button" onClick={retakePhoto}
                className="inline-flex items-center gap-2 text-slate-600 border border-slate-300 px-5 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                Retake
              </button>
            )}
          </div>
        </div>

        {/* Optional identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Your Name <span className="text-xs text-slate-400 font-normal">(optional)</span>
            </label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Juan Dela Cruz" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Contact Info <span className="text-xs text-slate-400 font-normal">(optional)</span>
            </label>
            <input type="text" value={contact} onChange={(e) => setContact(e.target.value)}
              placeholder="Email or phone" className={inputCls} />
          </div>
        </div>

        {/* Submit */}
        <button type="button" onClick={handleSubmit}
          disabled={submitting || !description.trim() || !photoBlob}
          className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 text-white px-8 py-3.5 rounded-xl font-semibold text-sm hover:bg-teal-700 disabled:opacity-60 transition shadow-lg shadow-teal-500/20">
          {submitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              Submit Report
            </>
          )}
        </button>
      </div>
    );
  }

  return null;
}