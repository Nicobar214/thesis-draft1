import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';

/* ─── Icons ─── */
const Icons = {
  Search: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  ),
  MapPin: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  MapPinLg: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  ArrowLeft: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  ),
  Calendar: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v9.75" />
    </svg>
  ),
  Ruler: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
    </svg>
  ),
  Money: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
    </svg>
  ),
  Building: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
    </svg>
  ),
  Folder: () => (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  ),
  Feedback: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
    </svg>
  ),
  Camera: () => (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
    </svg>
  ),
  Upload: () => (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
    </svg>
  ),
  Send: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
    </svg>
  ),
  CheckCircle: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  Warning: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  ),
  Clock: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  X: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  ),
};

/* ─── Constants ─── */
const statusFilters = ['All', 'In Progress', 'Completed', 'Planning', 'On Hold'];

const feedbackTypes = [
  { value: 'issue', label: 'Report an Issue', color: 'text-red-600 bg-red-50 border-red-200' },
  { value: 'suggestion', label: 'Suggestion', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'compliment', label: 'Compliment', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { value: 'concern', label: 'Safety Concern', color: 'text-violet-600 bg-violet-50 border-violet-200' },
];

/* ─── Helpers ─── */
function formatCurrency(amount) {
  if (!amount) return '₱0';
  if (amount >= 1000000) return `₱${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `₱${(amount / 1000).toFixed(0)}K`;
  return `₱${amount.toLocaleString()}`;
}

function getStatusStyle(status) {
  const styles = {
    'Completed':   { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
    'In Progress': { badge: 'bg-amber-100 text-amber-700',     bar: 'bg-amber-500' },
    'Planning':    { badge: 'bg-sky-100 text-sky-700',          bar: 'bg-sky-500' },
    'On Hold':     { badge: 'bg-red-100 text-red-700',          bar: 'bg-red-400' },
    'Pending':     { badge: 'bg-zinc-100 text-zinc-600',        bar: 'bg-zinc-400' },
  };
  return styles[status] || styles['Pending'];
}

/* ─── Feedback Status Badge ─── */
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

/* ─── Project Card (list view) ─── */
function ProjectListCard({ project, onClick }) {
  const name = project.projectName || project.project_name || 'Untitled';
  const style = getStatusStyle(project.status);

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-zinc-200/60 p-5 hover:border-zinc-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-zinc-900 group-hover:text-emerald-700 transition-colors truncate">
            {name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-sm text-zinc-500">
            <Icons.MapPin />
            <span className="truncate">{project.municipality}, {project.province}</span>
          </div>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${style.badge}`}>
          {project.status || 'Pending'}
        </span>
      </div>

      {project.description && (
        <p className="text-sm text-zinc-500 line-clamp-2 mb-3">{project.description}</p>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${project.progress || 0}%` }} />
        </div>
        <span className="text-xs font-medium text-zinc-600 tabular-nums w-10 text-right">
          {project.progress || 0}%
        </span>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-zinc-400">
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

/* ─── Skeleton ─── */
function ProjectSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 animate-pulse">
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

/* ─── Feedback Card (shown in project detail) ─── */
function FeedbackCard({ feedback }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = feedbackTypes.find(t => t.value === feedback.type) || feedbackTypes[0];

  return (
    <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <FeedbackStatusBadge status={feedback.status} />
        </div>
        <div className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
          <Icons.Clock />
          <span>{new Date(feedback.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <p className={`text-sm text-zinc-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
        {feedback.message}
      </p>
      {feedback.message?.length > 150 && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-emerald-600 hover:text-emerald-700 mt-1">
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      {feedback.latitude && feedback.longitude && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
          <Icons.MapPin />
          <span>📍 {Number(feedback.latitude).toFixed(4)}, {Number(feedback.longitude).toFixed(4)}</span>
        </div>
      )}

      {feedback.photo_urls?.length > 0 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {feedback.photo_urls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <img src={url} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover rounded-lg border border-zinc-200 hover:opacity-80 transition-opacity" />
            </a>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-400 mt-2">— {feedback.user_email || 'Anonymous'}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PROJECT DETAIL VIEW (with integrated feedback)
═══════════════════════════════════════════════════════════ */
function ProjectDetail({ project, onBack }) {
  const name = project.projectName || project.project_name || 'Untitled';
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
    navigator.geolocation.getCurrentPosition(
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

  async function uploadPhotos() {
    const urls = [];
    for (const photo of photos) {
      const ext = photo.file.name.split('.').pop();
      const fileName = `feedback/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('feedback-photos').upload(fileName, photo.file, { cacheControl: '3600', upsert: false });
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
        status: 'pending',
      };

      const { error: insertErr } = await supabase.from('feedbacks').insert([feedbackData]);
      if (insertErr) throw insertErr;

      setForm({ type: 'issue', message: '' });
      photos.forEach(p => URL.revokeObjectURL(p.preview));
      setPhotos([]); setGeoLocation(null); setShowFeedbackForm(false);
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
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 transition-colors">
        <Icons.ArrowLeft /> Back to Projects
      </button>

      {/* Project Header Card */}
      <div className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">{name}</h1>
              {project.projectCode && (
                <p className="text-sm text-zinc-400 font-mono mt-0.5">{project.projectCode}</p>
              )}
            </div>
            <span className={`self-start px-3 py-1.5 rounded-full text-sm font-medium ${style.badge}`}>
              {project.status || 'Pending'}
            </span>
          </div>

          {project.description && (
            <p className="text-sm text-zinc-600 leading-relaxed mb-5">{project.description}</p>
          )}

          {/* Progress bar */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-zinc-700">Progress</span>
              <span className="text-sm font-semibold text-zinc-900">{project.progress || 0}%</span>
            </div>
            <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden">
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

      {/* ═══ FEEDBACK SECTION (Integrated) ═══ */}
      <div className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden">
        <div className="px-6 py-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-semibold text-zinc-900 flex items-center gap-2">
              <Icons.Feedback /> Community Feedback
            </h2>
            <p className="text-sm text-zinc-500 mt-0.5">Share your thoughts, report issues, or give suggestions about this project</p>
          </div>
          <button
            onClick={() => setShowFeedbackForm(!showFeedbackForm)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm shrink-0"
          >
            {showFeedbackForm ? <Icons.X /> : <Icons.Camera />}
            {showFeedbackForm ? 'Cancel' : 'Give Feedback'}
          </button>
        </div>

        {/* Alerts */}
        {success && (
          <div className="mx-6 mt-4 flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
            <Icons.CheckCircle /><span>{success}</span>
          </div>
        )}
        {error && (
          <div className="mx-6 mt-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <Icons.Warning /><span>{error}</span>
          </div>
        )}

        {/* Feedback Form */}
        {showFeedbackForm && (
          <form onSubmit={handleSubmit} className="p-6 border-b border-zinc-100 space-y-5">
            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">Feedback Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {feedbackTypes.map(t => (
                  <button key={t.value} type="button" onClick={() => setForm(f => ({ ...f, type: t.value }))}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                      form.type === t.value ? t.color + ' ring-2 ring-offset-1 ring-current' : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                    }`}
                  >{t.label}</button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">Your Feedback</label>
              <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Describe what you observed, any issues, or your suggestion about this project..."
                rows={4} className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Photos <span className="text-zinc-400 font-normal">(up to 5)</span>
              </label>
              <div className="flex flex-wrap gap-3">
                {photos.map((p, i) => (
                  <div key={i} className="relative group">
                    <img src={p.preview} alt="" className="h-20 w-20 object-cover rounded-xl border border-zinc-200" />
                    <button type="button" onClick={() => removePhoto(i)}
                      className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                      <svg className="size-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                {photos.length < 5 && (
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="h-20 w-20 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-zinc-300 rounded-xl text-zinc-400 hover:text-emerald-500 hover:border-emerald-300 transition-colors">
                    <Icons.Upload /><span className="text-[10px] font-medium">Add Photo</span>
                  </button>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoSelect} className="hidden" capture="environment" />
            </div>

            {/* Geolocation */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Location Geo-Tag <span className="text-zinc-400 font-normal">(optional)</span>
              </label>
              {geoLocation ? (
                <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="size-10 bg-emerald-100 rounded-lg grid place-items-center text-emerald-600 shrink-0"><Icons.MapPinLg /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-800">Location captured!</p>
                    <p className="text-xs text-emerald-600">{geoLocation.lat.toFixed(6)}, {geoLocation.lng.toFixed(6)}{geoLocation.accuracy && ` (±${Math.round(geoLocation.accuracy)}m)`}</p>
                  </div>
                  <button type="button" onClick={() => setGeoLocation(null)} className="text-emerald-500 hover:text-emerald-700 text-xs font-medium">Remove</button>
                </div>
              ) : (
                <button type="button" onClick={requestGeoLocation} disabled={geoLoading}
                  className="flex items-center gap-3 w-full p-3 border border-zinc-300 rounded-xl text-left hover:bg-zinc-50 transition-colors disabled:opacity-60">
                  <div className="size-10 bg-zinc-100 rounded-lg grid place-items-center text-zinc-500 shrink-0"><Icons.MapPinLg /></div>
                  <div>
                    <p className="text-sm font-medium text-zinc-700">{geoLoading ? 'Getting location...' : 'Tag your current location'}</p>
                    <p className="text-xs text-zinc-400">Helps verify where the concern was observed</p>
                  </div>
                  {geoLoading && <div className="ml-auto animate-spin size-5 border-2 border-zinc-300 border-t-emerald-600 rounded-full" />}
                </button>
              )}
              {geoError && <p className="text-xs text-red-500 mt-1.5">{geoError}</p>}
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowFeedbackForm(false)} className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-800">Cancel</button>
              <button type="submit" disabled={submitting || !form.message.trim()}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium rounded-xl transition-colors shadow-sm">
                {submitting ? (<><div className="animate-spin size-4 border-2 border-white/30 border-t-white rounded-full" />Submitting...</>) : (<><Icons.Send />Submit Feedback</>)}
              </button>
            </div>
          </form>
        )}

        {/* Feedback List */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-zinc-700">{feedbacks.length} feedback{feedbacks.length !== 1 ? 's' : ''}</p>
          </div>

          {feedbackLoading ? (
            <div className="space-y-3">
              {[1,2].map(i => (
                <div key={i} className="p-4 bg-zinc-50 rounded-xl animate-pulse">
                  <div className="flex gap-2 mb-2"><div className="h-5 w-24 bg-zinc-200 rounded-md" /><div className="h-5 w-16 bg-zinc-200 rounded-full" /></div>
                  <div className="h-4 w-3/4 bg-zinc-200 rounded mb-1" /><div className="h-4 w-1/2 bg-zinc-200 rounded" />
                </div>
              ))}
            </div>
          ) : feedbacks.length === 0 ? (
            <div className="text-center py-10">
              <div className="mx-auto size-12 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3"><Icons.Feedback /></div>
              <p className="font-medium text-zinc-900">No feedback yet</p>
              <p className="text-sm text-zinc-500 mt-1">Be the first to share your thoughts about this project!</p>
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

/* ─── Detail Item ─── */
function DetailItem({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-zinc-50 rounded-xl">
      <div className="size-8 bg-white rounded-lg grid place-items-center text-zinc-400 border border-zinc-100 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-zinc-800 truncate">{value}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN USER PROJECTS PAGE
═══════════════════════════════════════════════════════════ */
function UserProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);

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
        console.error('Supabase projects error:', error);
        setFetchError(error.message);
        throw error;
      }

      console.log('Projects fetched for user:', data?.length || 0);
      setProjects(data || []);
    } catch (e) {
      console.error('Error fetching projects:', e);
    } finally {
      setLoading(false);
    }
  }

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
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Projects</h1>
          <p className="mt-1 text-zinc-500">Browse all FMR projects — click any project to view details & give feedback</p>
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
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
              <Icons.Search />
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, location, contractor..."
              className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
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
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        <p className="text-sm text-zinc-400">{filtered.length} project{filtered.length !== 1 ? 's' : ''} found</p>

        {/* Projects List */}
        <div className="space-y-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <ProjectSkeleton key={i} />)
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
              <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
                <Icons.Folder />
              </div>
              <p className="font-medium text-zinc-900">
                {search || statusFilter !== 'All' ? 'No matching projects' : 'No projects yet'}
              </p>
              <p className="text-sm text-zinc-500 mt-1">
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
      </div>
    </UserLayout>
  );
}

export default UserProjects;
