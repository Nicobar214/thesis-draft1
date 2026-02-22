/* PublicReportForm.jsx – Location-Verified Public Feedback (Region VI – Iloilo)
 * Live camera capture + GPS verification. No file uploads allowed.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getMunicipalities, getBarangays } from '../data/iloiloLocations';

// ── Constants ──────────────────────────────────────────────
const GPS_MISMATCH_RADIUS = 100; // metres
const REGION = 'Region VI – Western Visayas';
const PROVINCE = 'Iloilo';

// ── Helpers ────────────────────────────────────────────────
/** Haversine distance in metres between two lat/lng points */
function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Determine verification label */
function computeVerification(userLat, userLng, accuracy, projectLat, projectLng) {
  if (!projectLat || !projectLng || !userLat || !userLng) return 'Needs Review';
  const dist = haversineMetres(userLat, userLng, projectLat, projectLng);
  if (dist <= GPS_MISMATCH_RADIUS) return 'Verified On-Site';
  if (accuracy && accuracy > 50) return 'Needs Review'; // weak GPS
  return 'Location Mismatch';
}

// ── Shared input class ─────────────────────────────────────
const inputCls =
  'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition';

// ═══════════════════════════════════════════════════════════
export default function PublicReportForm() {
  // ── Step management (0-based) ──
  const STEPS = ['location', 'project', 'photo', 'feedback', 'review'];
  const [step, setStep] = useState(-1); // -1 = GPS consent screen

  // ── GPS state ──
  const [gps, setGps] = useState({ lat: null, lng: null, accuracy: null });
  const [gpsError, setGpsError] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // ── Location selection ──
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
  const [street, setStreet] = useState('');

  // ── Projects ──
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);

  // ── GPS watcher ref ──
  const gpsWatchRef = useRef(null);

  // ── Camera / photo ──
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);

  // ── Feedback fields ──
  const [description, setDescription] = useState('');
  const [fullName, setFullName] = useState('');
  const [contactInfo, setContactInfo] = useState('');

  // ── Photo timestamp ──
  const [photoTimestamp, setPhotoTimestamp] = useState(null);

  // ── Submission ──
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // ────────────────────────────────────────────────────────
  // GPS Request
  // ────────────────────────────────────────────────────────
  const requestGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);

    // Clear any existing watcher
    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
    }

    // Use watchPosition for realtime GPS updates
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGpsLoading(false);
        setStep((prev) => (prev === -1 ? 0 : prev)); // move to location step on first fix
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === 1) {
          setGpsError('Location permission denied. You must allow GPS access to submit a report.');
        } else {
          setGpsError(`Unable to get location: ${err.message}`);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // Cleanup GPS watcher on unmount
  useEffect(() => {
    return () => {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }
    };
  }, []);

  // ────────────────────────────────────────────────────────
  // Fetch projects for selected barangay
  // ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!barangay || !municipality) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setProjectsLoading(true);
      try {
        const { data, error: fetchErr } = await supabase
          .from('projects')
          .select('id, "projectName", latitude, longitude, barangay, municipality, status')
          .ilike('municipality', `%${municipality}%`)
          .ilike('barangay', `%${barangay}%`)
          .order('projectName', { ascending: true });

        if (fetchErr) throw fetchErr;
        if (!cancelled) setProjects(data || []);
      } catch (err) {
        console.error('Error loading projects:', err.message);
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [municipality, barangay]);

  // ────────────────────────────────────────────────────────
  // Camera lifecycle
  // ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch (err) {
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access.'
          : `Camera error: ${err.message}`
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  // Start camera when entering the photo step
  useEffect(() => {
    if (step === 2 && !photoBlob) {
      startCamera();
    }
    return () => {
      if (step !== 2) stopCamera();
    };
  }, [step, photoBlob, startCamera, stopCamera]);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // ── Timestamp watermark for credibility ──
    const now = new Date();
    setPhotoTimestamp(now.toISOString());
    const tsText = now.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const gpsText = gps.lat && gps.lng
      ? `GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy || 0)}m)`
      : '';

    const fontSize = Math.max(14, Math.floor(canvas.width / 50));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textBaseline = 'bottom';

    // Semi-transparent background strip
    const padding = 8;
    const lineHeight = fontSize + 4;
    const lines = [tsText, gpsText].filter(Boolean);
    const maxWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const stripH = lines.length * lineHeight + padding * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, canvas.height - stripH, maxWidth + padding * 2, stripH);

    // White text
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => {
      ctx.fillText(line, padding, canvas.height - stripH + padding + (i + 1) * lineHeight);
    });

    canvas.toBlob(
      (blob) => {
        setPhotoBlob(blob);
        setPhotoPreview(URL.createObjectURL(blob));
        stopCamera();
      },
      'image/jpeg',
      0.85
    );
  };

  const retakePhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(null);
    setPhotoPreview(null);
    startCamera();
  };

  // ────────────────────────────────────────────────────────
  // Upload photo + submit
  // ────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError(null);
    if (!description.trim()) { setError('Please enter a description.'); return; }
    if (!photoBlob) { setError('A photo is required.'); return; }
    if (!selectedProject) { setError('Please select a project.'); return; }

    setSubmitting(true);
    try {
      // 1. Upload photo
      const path = `reports/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('public-report-photos')
        .upload(path, photoBlob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage
        .from('public-report-photos')
        .getPublicUrl(path);

      // 2. Compute verification
      const verification = computeVerification(
        gps.lat, gps.lng, gps.accuracy,
        selectedProject.latitude, selectedProject.longitude
      );

      // 3. Insert report
      const { error: insertErr } = await supabase.from('public_reports').insert({
        full_name: fullName.trim() || 'Anonymous',
        contact_info: contactInfo.trim(),
        region: REGION,
        province: PROVINCE,
        municipality,
        barangay,
        street: street.trim(),
        project_id: selectedProject.id,
        project_name: selectedProject.projectName,
        photo_url: urlData.publicUrl,
        latitude: gps.lat,
        longitude: gps.lng,
        geo_accuracy: gps.accuracy,
        photo_timestamp: photoTimestamp || new Date().toISOString(),
        verification,
        description: description.trim(),
        source: fullName.trim() ? 'Public Report' : 'Anonymous Public Report',
      });

      if (insertErr) throw insertErr;
      setSubmitted(true);
    } catch (err) {
      console.error('Submission error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ────────────────────────────────────────────────────────
  // Full reset
  // ────────────────────────────────────────────────────────
  const resetAll = () => {
    setStep(-1);
    setGps({ lat: null, lng: null, accuracy: null });
    setGpsError(null);
    setMunicipality('');
    setBarangay('');
    setStreet('');
    setSelectedProject(null);
    setPhotoBlob(null);
    setPhotoTimestamp(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setDescription('');
    setFullName('');
    setContactInfo('');
    setSubmitted(false);
    setError(null);
    // Stop GPS watcher
    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
  };

  // ════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════

  // ── Success ────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="text-center py-12 px-6">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">Report Submitted!</h3>
        <p className="text-slate-600 max-w-md mx-auto mb-6">
          Your feedback has been recorded. The photo and location were verified to support your report. Thank you for helping monitor community projects.
        </p>
        <button onClick={resetAll} className="inline-flex items-center gap-2 text-emerald-600 hover:text-emerald-700 font-semibold text-sm transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Submit another report
        </button>
      </div>
    );
  }

  // ── Progress indicator ─────────────────────────────────
  const stepLabels = ['Location', 'Project', 'Photo', 'Details', 'Review'];
  const ProgressBar = () => (
    <div className="flex items-center gap-1.5 mb-6">
      {stepLabels.map((label, i) => (
        <div key={label} className="flex-1">
          <div className={`h-1.5 rounded-full transition-colors ${i <= step ? 'bg-emerald-500' : 'bg-slate-200'}`} />
          <p className={`text-[10px] mt-1 text-center font-medium ${i <= step ? 'text-emerald-600' : 'text-slate-400'}`}>{label}</p>
        </div>
      ))}
    </div>
  );

  // ── GPS Consent (step -1) ──────────────────────────────
  if (step === -1) {
    return (
      <div className="space-y-5">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <div className="flex gap-3">
            <svg className="w-5 h-5 shrink-0 mt-0.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <p className="font-semibold mb-1">Privacy Notice</p>
              <p>This form collects your GPS location and a live photo to verify the report is submitted on-site. Your location data is used solely for report verification. You may submit anonymously.</p>
            </div>
          </div>
        </div>

        <div className="text-center py-4">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Enable Location Access</h3>
          <p className="text-sm text-slate-500 max-w-xs mx-auto mb-5">
            GPS is required to verify you are at the project site. Please allow location access to continue.
          </p>

          {gpsError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-left mb-4 max-w-sm mx-auto">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              <span>{gpsError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={requestGps}
            disabled={gpsLoading}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-emerald-700 disabled:opacity-60 transition shadow-lg shadow-emerald-500/20"
          >
            {gpsLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Getting location…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                Allow GPS &amp; Continue
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  //  Multi-step form (steps 0-4)
  // ════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      <ProgressBar />

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
          <span>{error}</span>
        </div>
      )}

      {/* GPS mini-badge – live updating */}
      <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 w-fit">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        <span>Live GPS: {gps.lat?.toFixed(5)}, {gps.lng?.toFixed(5)}</span>
        <span className="text-slate-400">(±{Math.round(gps.accuracy || 0)}m)</span>
      </div>

      {/* ──────────────── STEP 0: Location ─────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <h4 className="text-base font-semibold text-slate-900">Select Location</h4>

          {/* Region + Province (fixed) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Region</label>
              <input type="text" value={REGION} readOnly className={`${inputCls} bg-slate-50 cursor-not-allowed`} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Province</label>
              <input type="text" value={PROVINCE} readOnly className={`${inputCls} bg-slate-50 cursor-not-allowed`} />
            </div>
          </div>

          {/* Municipality */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Municipality <span className="text-red-500">*</span></label>
            <select value={municipality} onChange={(e) => { setMunicipality(e.target.value); setBarangay(''); setSelectedProject(null); }} className={inputCls}>
              <option value="">Select municipality</option>
              {getMunicipalities().map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Barangay */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Barangay <span className="text-red-500">*</span></label>
            <select value={barangay} onChange={(e) => { setBarangay(e.target.value); setSelectedProject(null); }} disabled={!municipality} className={inputCls}>
              <option value="">Select barangay</option>
              {getBarangays(municipality).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Street / Sitio */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Street / Sitio <span className="text-slate-400 font-normal">(optional)</span></label>
            <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="e.g., Purok 3, Sitio Ilaya" className={inputCls} />
          </div>

          <div className="flex justify-end pt-2">
            <button type="button" disabled={!municipality || !barangay} onClick={() => { setError(null); setStep(1); }}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50 transition">
              Next: Select Project
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 1: Project ────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <h4 className="text-base font-semibold text-slate-900">Select Project in {barangay}, {municipality}</h4>

          {projectsLoading ? (
            <div className="py-8 text-center">
              <div className="animate-spin mx-auto w-7 h-7 border-2 border-slate-300 border-t-emerald-600 rounded-full mb-2" />
              <p className="text-sm text-slate-500">Loading projects…</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="py-8 text-center bg-slate-50 border border-slate-200 rounded-xl">
              <svg className="w-10 h-10 mx-auto text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" /></svg>
              <p className="text-sm font-medium text-slate-900">No registered projects found</p>
              <p className="text-xs text-slate-500 mt-1">No farm-to-market road projects are registered in this barangay yet.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {projects.map((p) => (
                <button type="button" key={p.id} onClick={() => setSelectedProject(p)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition ${selectedProject?.id === p.id ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-slate-200 bg-white hover:border-emerald-300'}`}>
                  <p className="text-sm font-semibold text-slate-900">{p.projectName}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${p.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' : p.status === 'In Progress' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{p.status}</span>
                    {p.latitude && p.longitude && <span>GPS: {Number(p.latitude).toFixed(4)}, {Number(p.longitude).toFixed(4)}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(0)} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition">← Back</button>
            <button type="button" disabled={!selectedProject} onClick={() => { setError(null); setStep(2); }}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50 transition">
              Next: Take Photo
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 2: Photo ──────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <h4 className="text-base font-semibold text-slate-900">Capture Site Photo</h4>
          <p className="text-sm text-slate-500 -mt-2">Take a live photo of the project site. Gallery uploads are not allowed.</p>

          {cameraError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              <span>{cameraError}</span>
            </div>
          )}

          {/* Live viewfinder or captured preview */}
          <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
            {!photoPreview ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!cameraReady && !cameraError && (
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

          {/* Capture / retake buttons */}
          <div className="flex justify-center gap-3">
            {!photoPreview ? (
              <button type="button" onClick={capturePhoto} disabled={!cameraReady}
                className="inline-flex items-center gap-2 bg-white text-slate-900 border-2 border-slate-300 px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-50 disabled:opacity-40 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
                Capture Photo
              </button>
            ) : (
              <button type="button" onClick={retakePhoto}
                className="inline-flex items-center gap-2 text-slate-600 border border-slate-300 px-5 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                Retake
              </button>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => { stopCamera(); setStep(1); }} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition">← Back</button>
            <button type="button" disabled={!photoBlob} onClick={() => { setError(null); setStep(3); }}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50 transition">
              Next: Add Details
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 3: Feedback Details ────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <h4 className="text-base font-semibold text-slate-900">Report Details</h4>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Description <span className="text-red-500">*</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required
              placeholder="Describe the current condition, issue, or feedback about this project…"
              className={`${inputCls} resize-none`} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Your Name <span className="text-slate-400 font-normal">(optional)</span></label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Juan Dela Cruz" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Contact Info <span className="text-slate-400 font-normal">(optional)</span></label>
              <input type="text" value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} placeholder="Email or phone" className={inputCls} />
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(2)} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition">← Back</button>
            <button type="button" disabled={!description.trim()} onClick={() => { setError(null); setStep(4); }}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50 transition">
              Review &amp; Submit
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 4: Review & Submit ─────────── */}
      {step === 4 && (() => {
        const verification = computeVerification(gps.lat, gps.lng, gps.accuracy, selectedProject?.latitude, selectedProject?.longitude);
        const verifyStyle = {
          'Verified On-Site': 'bg-emerald-50 border-emerald-200 text-emerald-700',
          'Needs Review': 'bg-amber-50 border-amber-200 text-amber-700',
          'Location Mismatch': 'bg-red-50 border-red-200 text-red-700',
        }[verification] || 'bg-slate-50 border-slate-200 text-slate-600';
        const verifyIcon = {
          'Verified On-Site': '✔',
          'Needs Review': '⚠',
          'Location Mismatch': '✖',
        }[verification] || '?';

        return (
          <div className="space-y-5">
            <h4 className="text-base font-semibold text-slate-900">Review Your Report</h4>

            {/* Verification badge */}
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold ${verifyStyle}`}>
              <span className="text-base">{verifyIcon}</span>
              {verification}
            </div>

            {/* Photo thumbnail */}
            {photoPreview && (
              <img src={photoPreview} alt="Captured site" className="w-full max-h-48 object-cover rounded-xl border border-slate-200" />
            )}

            {/* Summary grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><span className="text-xs text-slate-400 uppercase font-semibold">Municipality</span><p className="text-slate-800">{municipality}</p></div>
              <div><span className="text-xs text-slate-400 uppercase font-semibold">Barangay</span><p className="text-slate-800">{barangay}</p></div>
              {street && <div><span className="text-xs text-slate-400 uppercase font-semibold">Street / Sitio</span><p className="text-slate-800">{street}</p></div>}
              <div><span className="text-xs text-slate-400 uppercase font-semibold">Project</span><p className="text-slate-800">{selectedProject?.projectName}</p></div>
              <div><span className="text-xs text-slate-400 uppercase font-semibold">Name</span><p className="text-slate-800">{fullName || 'Anonymous'}</p></div>
              <div><span className="text-xs text-slate-400 uppercase font-semibold">Contact</span><p className="text-slate-800">{contactInfo || '—'}</p></div>
            </div>

            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">Description</span>
              <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 p-3 rounded-xl mt-1">{description}</p>
            </div>

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setStep(3)} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition">← Back</button>
              <button type="button" onClick={handleSubmit} disabled={submitting}
                className="inline-flex items-center gap-2 bg-emerald-600 text-white px-8 py-3 rounded-xl font-semibold text-sm hover:bg-emerald-700 disabled:opacity-60 transition shadow-lg shadow-emerald-500/20">
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                    Submit Report
                  </>
                )}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
