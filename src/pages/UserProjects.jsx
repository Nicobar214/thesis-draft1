import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

import Icons from '../components/Icons';
import UserLayout from '../components/UserLayout';
import { normalizeProjectName } from '../lib/projectHelpers';
/* â”€â”€â”€ Icons â”€â”€â”€ */
/* â”€â”€â”€ Constants â”€â”€â”€ */
const statusFilters = ['All', 'In Progress', 'Completed', 'Planning', 'On Hold'];

const feedbackTypes = [
  { value: 'issue', label: 'Road Condition', color: 'text-red-600 bg-red-50 border-red-200' },
  { value: 'suggestion', label: 'Maintenance Request', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'compliment', label: 'Project Appreciation', color: 'text-teal-600 bg-emerald-50 border-emerald-200' },
  { value: 'concern', label: 'Safety Hazard', color: 'text-violet-600 bg-violet-50 border-violet-200' },
];

/* â”€â”€â”€ Helpers â”€â”€â”€ */
function formatCurrency(amount) {
  if (!amount) return 'â‚±0';
  if (amount >= 1000000) return `â‚±${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `â‚±${(amount / 1000).toFixed(0)}K`;
  return `â‚±${amount.toLocaleString()}`;
}

function getStatusStyle(status) {
  const styles = {
    'Completed':   { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
    'In Progress': { badge: 'bg-amber-100 text-amber-700',     bar: 'bg-amber-500' },
    'Planning':    { badge: 'bg-sky-100 text-sky-700',          bar: 'bg-sky-500' },
    'On Hold':     { badge: 'bg-red-100 text-red-700',          bar: 'bg-red-400' },
    'Pending':     { badge: 'bg-slate-100 text-slate-600',        bar: 'bg-zinc-400' },
  };
  return styles[status] || styles['Pending'];
}

/* â”€â”€â”€ Feedback Status Badge â”€â”€â”€ */
function FeedbackStatusBadge({ status }) {
  const styles = {
    pending:  'bg-amber-100 text-amber-700',
    reviewed: 'bg-sky-100 text-sky-700',
    resolved: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {status?.charAt(0).toUpperCase() + status?.slice(1) || 'Pending'}
    </span>
  );
}

/* â”€â”€â”€ Project Card (list view) â”€â”€â”€ */
function ProjectListCard({ project, onClick }) {
  const name = normalizeProjectName(project);
  const style = getStatusStyle(project.status);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/60 p-5 shadow-xs hover:shadow-md transition-shadow duration-300 ease-out group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate">
            {name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-sm text-slate-500">
            <Icons.MapPin />
            <span className="truncate">{project.municipality}, {project.province}</span>
          </div>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${style.badge}`}>
          {project.status || 'Pending'}
        </span>
      </div>

      {project.description && (
        <p className="text-sm text-slate-500 line-clamp-2 mb-3">{project.description}</p>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${project.progress || 0}%` }} />
        </div>
        <span className="text-xs font-medium text-slate-600 tabular-nums w-10 text-right">
          {project.progress || 0}%
        </span>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
        {project.totalBudget > 0 && (
          <span className="flex items-center gap-1"><Icons.Money />{formatCurrency(project.totalBudget)}</span>
        )}
        {project.contractor && (
          <span className="flex items-center gap-1 truncate"><Icons.Building />{project.contractor}</span>
        )}
      </div>
    </button>
  );
}

/* â”€â”€â”€ Skeleton â”€â”€â”€ */
function ProjectSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 p-5 animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1">
          <div className="h-5 w-3/4 bg-zinc-200 rounded mb-2" />
          <div className="h-4 w-1/2 bg-zinc-200 rounded" />
        </div>
        <div className="h-6 w-20 bg-zinc-200 rounded-full" />
      </div>
      <div className="h-4 w-full bg-zinc-200 rounded mb-3" />
      <div className="h-1.5 bg-zinc-200 rounded-full" />
    </div>
  );
}

/* â”€â”€â”€ Feedback Card (shown in project detail) â”€â”€â”€ */
function FeedbackCard({ feedback }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = feedbackTypes.find(t => t.value === feedback.type) || feedbackTypes[0];

  return (
    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <FeedbackStatusBadge status={feedback.status} />
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
          <Icons.Clock />
          <span>{new Date(feedback.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <p className={`text-sm text-slate-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
        {feedback.message}
      </p>
      {feedback.message?.length > 150 && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-teal-600 hover:text-teal-700 mt-1">
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      {feedback.latitude && feedback.longitude && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
          <Icons.MapPin />
          <span>GPS: {Number(feedback.latitude).toFixed(4)}, {Number(feedback.longitude).toFixed(4)}</span>
        </div>
      )}

      {feedback.photo_urls?.length > 0 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {feedback.photo_urls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <img src={url} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover rounded-lg border border-slate-200 hover:opacity-80 transition-opacity" />
            </a>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-2">By {feedback.user_email || 'Anonymous'}</p>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   PROJECT DETAIL VIEW (with integrated feedback)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ProjectDetail({ project, onBack }) {
  const name = normalizeProjectName(project);
  const style = getStatusStyle(project.status);

  // Feedback state
  const [feedbacks, setFeedbacks] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({ type: 'issue', message: '' });
  const [photos, setPhotos] = useState([]);
  const [geoLocation, setGeoLocation] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const geoWatchRef = useRef(null);

  // Cleanup GPS watcher on unmount
  useEffect(() => {
    return () => {
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
        geoWatchRef.current = null;
      }
    };
  }, []);

  // Fetch feedback for this project
  useEffect(() => {
    fetchFeedbacks();
    const channel = supabase
      .channel(`project-feedback-${project.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'feedbacks',
        filter: `project_id=eq.${project.id}`,
      }, fetchFeedbacks)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [project.id]);

  async function fetchFeedbacks() {
    try {
      const { data } = await supabase
        .from('feedbacks')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false });
      if (data) setFeedbacks(data);
    } catch (e) {
      console.error(e);
    } finally {
      setFeedbackLoading(false);
    }
  }

  function requestGeoLocation() {
    if (!navigator.geolocation) { setGeoError('Geolocation not supported.'); return; }
    setGeoLoading(true); setGeoError('');
    // Clear existing watcher
    if (geoWatchRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchRef.current);
    }
    // Use watchPosition for realtime GPS updates
    geoWatchRef.current = navigator.geolocation.watchPosition(
      pos => { setGeoLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setGeoLoading(false); },
      err => { setGeoError(`Location error: ${err.message}`); setGeoLoading(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function handlePhotoSelect(e) {
    const files = Array.from(e.target.files);
    if (photos.length + files.length > 5) { setError('Maximum 5 photos allowed.'); return; }
    setPhotos(prev => [...prev, ...files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))]);
    setError('');
  }

  function removePhoto(i) {
    setPhotos(prev => { const u = [...prev]; URL.revokeObjectURL(u[i].preview); u.splice(i, 1); return u; });
  }

  /** Watermark a photo file with timestamp + GPS for credibility */
  function watermarkPhoto(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Timestamp text
        const now = new Date();
        const tsText = now.toLocaleString('en-PH', {
          year: 'numeric', month: 'short', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
        });
        const gpsText = geoLocation
          ? `GPS: ${geoLocation.lat.toFixed(6)}, ${geoLocation.lng.toFixed(6)} (\u00b1${Math.round(geoLocation.accuracy || 0)}m)`
          : '';

        const fontSize = Math.max(14, Math.floor(canvas.width / 50));
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textBaseline = 'bottom';

        const padding = 8;
        const lineHeight = fontSize + 4;
        const lines = [tsText, gpsText].filter(Boolean);
        const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
        const stripH = lines.length * lineHeight + padding * 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, canvas.height - stripH, maxWidth + padding * 2, stripH);

        ctx.fillStyle = '#ffffff';
        lines.forEach((line, i) => {
          ctx.fillText(line, padding, canvas.height - stripH + padding + (i + 1) * lineHeight);
        });

        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadPhotos() {
    const urls = [];
    for (const photo of photos) {
      // Watermark each photo with timestamp + GPS
      const watermarked = await watermarkPhoto(photo.file);
      const fileName = `feedback/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const { error: upErr } = await supabase.storage.from('feedback-photos').upload(fileName, watermarked, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: urlData } = supabase.storage.from('feedback-photos').getPublicUrl(fileName);
      urls.push(urlData.publicUrl);
    }
    return urls;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.message.trim()) { setError('Please write your feedback.'); return; }
    setSubmitting(true); setError(''); setSuccess('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');

      let photoUrls = [];
      if (photos.length > 0) photoUrls = await uploadPhotos();

      const feedbackData = {
        user_id: user.id,
        user_email: user.email,
        project_id: project.id,
        project_name: name,
        type: form.type,
        message: form.message.trim(),
        photo_urls: photoUrls,
        latitude: geoLocation?.lat || null,
        longitude: geoLocation?.lng || null,
        geo_accuracy: geoLocation?.accuracy || null,
        photo_timestamp: new Date().toISOString(),
        status: 'pending',
      };

      const { error: insertErr } = await supabase.from('feedbacks').insert([feedbackData]);
      if (insertErr) throw insertErr;

      setForm({ type: 'issue', message: '' });
      photos.forEach(p => URL.revokeObjectURL(p.preview));
      setPhotos([]); setGeoLocation(null); setShowFeedbackForm(false);
      // Stop GPS watcher
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
        geoWatchRef.current = null;
      }
      setSuccess('Feedback submitted! Thank you for your input.');
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.message || 'Failed to submit.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors">
        <Icons.ArrowLeft /> Back to Projects
      </button>

      {/* Project Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{name}</h1>
              {project.projectCode && (
                <p className="text-sm text-slate-400 font-mono mt-0.5">{project.projectCode}</p>
              )}
            </div>
            <span className={`self-start px-3 py-1.5 rounded-full text-sm font-medium ${style.badge}`}>
              {project.status || 'Pending'}
            </span>
          </div>

          {project.description && (
            <p className="text-sm text-slate-600 leading-relaxed mb-5">{project.description}</p>
          )}

          {/* Progress bar */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-slate-700">Progress</span>
              <span className="text-sm font-semibold text-slate-900">{project.progress || 0}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${project.progress || 0}%` }} />
            </div>
          </div>

          {/* Detail Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailItem icon={<Icons.MapPin />} label="Location" value={`${project.barangay ? project.barangay + ', ' : ''}${project.municipality || ''}, ${project.province || ''}`} />
            {project.region && <DetailItem icon={<Icons.MapPinLg />} label="Region" value={project.region} />}
            {project.contractor && <DetailItem icon={<Icons.Building />} label="Contractor" value={project.contractor} />}
            {project.totalBudget > 0 && <DetailItem icon={<Icons.Money />} label="Total Budget" value={formatCurrency(project.totalBudget)} />}
            {project.disbursedAmount > 0 && <DetailItem icon={<Icons.Money />} label="Disbursed" value={formatCurrency(project.disbursedAmount)} />}
            {project.budgetSource && <DetailItem icon={<Icons.Money />} label="Budget Source" value={project.budgetSource} />}
            {project.roadLength > 0 && <DetailItem icon={<Icons.Ruler />} label="Road Length" value={`${project.roadLength} km`} />}
            {project.roadWidth > 0 && <DetailItem icon={<Icons.Ruler />} label="Road Width" value={`${project.roadWidth} m`} />}
            {project.roadType && <DetailItem icon={<Icons.Ruler />} label="Road Type" value={project.roadType} />}
            {project.startDate && <DetailItem icon={<Icons.Calendar />} label="Start Date" value={new Date(project.startDate).toLocaleDateString()} />}
            {project.expectedEndDate && <DetailItem icon={<Icons.Calendar />} label="Expected End" value={new Date(project.expectedEndDate).toLocaleDateString()} />}
          </div>
        </div>
      </div>

      {/* â•â•â• FEEDBACK SECTION (Integrated) â•â•â• */}
      <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Community Feedback</h2>
            <p className="text-sm text-slate-500 mt-0.5">Share your thoughts, report issues, or give suggestions about this project</p>
          </div>
          <button
            onClick={() => setShowFeedbackForm(!showFeedbackForm)}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm shrink-0"
          >
            {showFeedbackForm ? 'Cancel' : 'Give Feedback'}
          </button>
        </div>

        {/* Alerts */}
        {success && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
            <span>{success}</span>
          </div>
        )}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <span>{error}</span>
          </div>
        )}

        {/* Feedback Form */}
        {showFeedbackForm && (
          <form onSubmit={handleSubmit} className="p-6 border-b border-slate-100 space-y-5">
            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Feedback Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {feedbackTypes.map(t => (
                  <button key={t.value} type="button" onClick={() => setForm(f => ({ ...f, type: t.value }))}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                      form.type === t.value ? t.color + ' ring-2 ring-offset-1 ring-current' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >{t.label}</button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Your Feedback</label>
              <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Describe what you observed, any issues, or your suggestion about this project..."
                rows={4} className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
              />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Photos <span className="text-slate-400 font-normal">(up to 5)</span>
              </label>
              <div className="flex flex-wrap gap-3">
                {photos.map((p, i) => (
                  <div key={i} className="relative group">
                    <img src={p.preview} alt="" className="h-20 w-20 object-cover rounded-xl border border-slate-200" />
                    <button type="button" onClick={() => removePhoto(i)}
                      className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                      <svg className="size-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                {photos.length < 5 && (
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="h-20 w-20 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-zinc-300 rounded-xl text-slate-400 hover:text-emerald-500 hover:border-emerald-300 transition-colors">
                    <Icons.Upload /><span className="text-[10px] font-medium">Add Photo</span>
                  </button>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoSelect} className="hidden" capture="environment" />
            </div>

            {/* Geolocation */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Location Geo-Tag <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              {geoLocation ? (
                <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="size-10 bg-emerald-100 rounded-lg grid place-items-center text-teal-600 shrink-0">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-800">Live GPS Active</p>
                    <p className="text-xs text-teal-600">{geoLocation.lat.toFixed(6)}, {geoLocation.lng.toFixed(6)}{geoLocation.accuracy && ` (+/-${Math.round(geoLocation.accuracy)}m)`}</p>
                  </div>
                  <button type="button" onClick={() => { setGeoLocation(null); if (geoWatchRef.current !== null) { navigator.geolocation.clearWatch(geoWatchRef.current); geoWatchRef.current = null; } }} className="text-emerald-500 hover:text-teal-700 text-xs font-medium">Remove</button>
                </div>
              ) : (
                <button type="button" onClick={requestGeoLocation} disabled={geoLoading}
                  className="flex items-center gap-3 w-full p-3 border border-zinc-300 rounded-xl text-left hover:bg-slate-50 transition-colors disabled:opacity-60">
                  <div className="size-10 bg-slate-100 rounded-lg grid place-items-center text-slate-500 shrink-0"><Icons.MapPinLg /></div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">{geoLoading ? 'Getting location...' : 'Tag your current location'}</p>
                    <p className="text-xs text-slate-400">Helps verify where the concern was observed</p>
                  </div>
                  {geoLoading && <div className="ml-auto animate-spin size-5 border-2 border-zinc-300 border-t-emerald-600 rounded-full" />}
                </button>
              )}
              {geoError && <p className="text-xs text-red-500 mt-1.5">{geoError}</p>}
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowFeedbackForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button type="submit" disabled={submitting || !form.message.trim()}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-emerald-400 text-white text-sm font-medium rounded-xl transition-colors shadow-sm">
                {submitting ? (<><div className="animate-spin size-4 border-2 border-white/30 border-t-white rounded-full" />Submitting...</>) : (<><Icons.Send />Submit Feedback</>)}
              </button>
            </div>
          </form>
        )}

        {/* Feedback List */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-slate-700">{feedbacks.length} feedback{feedbacks.length !== 1 ? 's' : ''}</p>
          </div>

          {feedbackLoading ? (
            <div className="space-y-3">
              {[1,2].map(i => (
                <div key={i} className="p-4 bg-slate-50 rounded-xl animate-pulse">
                  <div className="flex gap-2 mb-2"><div className="h-5 w-24 bg-zinc-200 rounded-md" /><div className="h-5 w-16 bg-zinc-200 rounded-full" /></div>
                  <div className="h-4 w-3/4 bg-zinc-200 rounded mb-1" /><div className="h-4 w-1/2 bg-zinc-200 rounded" />
                </div>
              ))}
            </div>
          ) : feedbacks.length === 0 ? (
            <div className="text-center py-10">
              <div className="mx-auto size-12 bg-slate-100 rounded-xl grid place-items-center text-slate-400 mb-3"><Icons.Feedback /></div>
              <p className="font-medium text-slate-900">No feedback yet</p>
              <p className="text-sm text-slate-500 mt-1">Be the first to share your thoughts about this project!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {feedbacks.map(fb => <FeedbackCard key={fb.id} feedback={fb} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* â”€â”€â”€ Detail Item â”€â”€â”€ */
function DetailItem({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-slate-50 rounded-xl">
      <div className="size-8 bg-white rounded-lg grid place-items-center text-slate-400 border border-slate-100 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-slate-800 truncate">{value}</p>
      </div>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAIN USER PROJECTS PAGE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function UserProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Fetch projects from Supabase (same table admin manages)
  useEffect(() => {
    fetchProjects();
    const channel = supabase
      .channel('user-projects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, fetchProjects)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchProjects() {
    try {
      setFetchError(null);
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        setFetchError(error.message);
        throw error;
      }

      setProjects(data || []);
    } catch (e) {
      setFetchError(e.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Filter logic
  const filtered = projects.filter(p => {
    const name = (p.projectName || p.project_name || '').toLowerCase();
    const code = (p.projectCode || '').toLowerCase();
    const muni = (p.municipality || '').toLowerCase();
    const prov = (p.province || '').toLowerCase();
    const contractor = (p.contractor || '').toLowerCase();
    const q = search.toLowerCase();

    const matchesSearch = !q || name.includes(q) || code.includes(q) || muni.includes(q) || prov.includes(q) || contractor.includes(q);
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // If a project is selected, show detail view
  if (selectedProject) {
    return (
      <UserLayout>
        <ProjectDetail project={selectedProject} onBack={() => setSelectedProject(null)} />
      </UserLayout>
    );
  }

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Header */}
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Projects</h1>
          <p className="mt-1 text-slate-500">Browse all FMR projects - click any project to view details and give feedback</p>
        </section>

        {/* Error banner */}
        {fetchError && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <Icons.Warning />
            <div>
              <p className="font-medium">Unable to load projects</p>
              <p className="mt-0.5 text-red-600">{fetchError}</p>
              <p className="mt-1 text-xs text-red-500">
                Make sure the <code className="bg-red-100 px-1 py-0.5 rounded">projects</code> table has a RLS SELECT policy allowing authenticated users to read.
                Run the SQL in <code className="bg-red-100 px-1 py-0.5 rounded">supabase_fix_projects_rls.sql</code> in your Supabase SQL Editor.
              </p>
            </div>
          </div>
        )}

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Icons.Search />
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, location, contractor..."
              className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"
            />
          </div>

          {/* Status filter pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                  statusFilter === s
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        <p className="text-sm text-slate-400">{filtered.length} project{filtered.length !== 1 ? 's' : ''} found</p>

        {/* Projects List */}
        <div className="space-y-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <ProjectSkeleton key={i} />)
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
              <div className="mx-auto size-14 bg-slate-100 rounded-xl grid place-items-center text-slate-400 mb-3">
                <Icons.Folder />
              </div>
              <p className="font-medium text-slate-900">
                {search || statusFilter !== 'All' ? 'No matching projects' : 'No projects yet'}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {search || statusFilter !== 'All'
                  ? 'Try adjusting your search or filters'
                  : 'Projects added by the admin will appear here'}
              </p>
            </div>
          ) : (
            filtered.map(p => (
              <ProjectListCard key={p.id} project={p} onClick={() => setSelectedProject(p)} />
            ))
          )}
        </div>

        {showBackToTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-6 right-6 z-20 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium shadow-lg"
          >
            Back to top
          </button>
        )}
      </div>
    </UserLayout>
  );
}

export default UserProjects;



