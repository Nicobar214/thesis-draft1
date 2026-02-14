import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';

/* ─── Icons ─── */
const Icons = {
  Camera: () => (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
    </svg>
  ),
  MapPin: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  X: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  ),
  Upload: () => (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
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
  Send: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
    </svg>
  ),
  Clock: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  Photo: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M2.25 18V6a2.25 2.25 0 0 1 2.25-2.25h15A2.25 2.25 0 0 1 21.75 6v12A2.25 2.25 0 0 1 19.5 20.25H4.5A2.25 2.25 0 0 1 2.25 18Z" />
    </svg>
  ),
};

/* ─── Feedback Type Options ─── */
const feedbackTypes = [
  { value: 'issue', label: 'Report an Issue', color: 'text-red-600 bg-red-50 border-red-200' },
  { value: 'suggestion', label: 'Suggestion', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'compliment', label: 'Compliment', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { value: 'concern', label: 'Safety Concern', color: 'text-violet-600 bg-violet-50 border-violet-200' },
];

/* ─── Status Badge ─── */
function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-amber-100 text-amber-700',
    reviewed: 'bg-sky-100 text-sky-700',
    resolved: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {status?.charAt(0).toUpperCase() + status?.slice(1) || 'Pending'}
    </span>
  );
}

/* ─── Feedback Card ─── */
function FeedbackCard({ feedback }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = feedbackTypes.find(t => t.value === feedback.type) || feedbackTypes[0];

  return (
    <article className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden hover:border-zinc-300 transition-colors">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${typeInfo.color}`}>
                {typeInfo.label}
              </span>
              <StatusBadge status={feedback.status} />
            </div>
            <h3 className="font-medium text-zinc-900 truncate">{feedback.project_name || 'General Feedback'}</h3>
          </div>
          <div className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
            <Icons.Clock />
            <span>{new Date(feedback.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        <p className={`text-sm text-zinc-600 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
          {feedback.message}
        </p>
        {feedback.message?.length > 120 && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-emerald-600 hover:text-emerald-700 mt-1">
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}

        {/* Geotagged location */}
        {feedback.latitude && feedback.longitude && (
          <div className="flex items-center gap-1.5 mt-3 text-xs text-zinc-500">
            <Icons.MapPin />
            <span>📍 {Number(feedback.latitude).toFixed(4)}, {Number(feedback.longitude).toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* Photo thumbnails */}
      {feedback.photo_urls?.length > 0 && (
        <div className="px-5 pb-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {feedback.photo_urls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <img
                  src={url}
                  alt={`Feedback photo ${i + 1}`}
                  className="h-20 w-20 object-cover rounded-lg border border-zinc-200 hover:opacity-80 transition-opacity"
                />
              </a>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

/* ─── Loading Skeleton ─── */
function FeedbackSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-5 w-24 bg-zinc-200 rounded-md" />
        <div className="h-5 w-16 bg-zinc-200 rounded-full" />
      </div>
      <div className="h-4 w-3/4 bg-zinc-200 rounded mb-2" />
      <div className="h-4 w-1/2 bg-zinc-200 rounded" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main UserFeedback Component
───────────────────────────────────────────────────────────── */
export default function UserFeedback() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // Form state
  const [form, setForm] = useState({
    project_id: '',
    type: 'issue',
    message: '',
  });
  const [photos, setPhotos] = useState([]); // { file, preview, lat, lng }
  const [geoLocation, setGeoLocation] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');

  // Fetch feedbacks + projects
  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('feedbacks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, fetchData)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchData() {
    try {
      const [feedbackRes, projectRes, userRes] = await Promise.all([
        supabase.from('feedbacks').select('*').order('created_at', { ascending: false }),
        supabase.from('projects').select('id, projectName, project_name, municipality, province'),
        supabase.auth.getUser(),
      ]);

      if (feedbackRes.data) {
        // Show only current user's feedbacks + all public feedbacks
        const userId = userRes.data?.user?.id;
        setFeedbacks(feedbackRes.data);
      }
      if (projectRes.data) {
        setProjects(projectRes.data);
      }
    } catch (e) {
      console.error('Error fetching data:', e);
    } finally {
      setLoading(false);
    }
  }

  /* ─── Geolocation ─── */
  function requestGeoLocation() {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(`Unable to get location: ${err.message}`);
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  /* ─── Photo handling ─── */
  function handlePhotoSelect(e) {
    const files = Array.from(e.target.files);
    if (photos.length + files.length > 5) {
      setError('Maximum 5 photos allowed per feedback.');
      return;
    }

    const newPhotos = files.map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setPhotos(prev => [...prev, ...newPhotos]);
    setError('');
  }

  function removePhoto(index) {
    setPhotos(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  }

  /* ─── Upload photos to Supabase Storage ─── */
  async function uploadPhotos() {
    const urls = [];
    for (const photo of photos) {
      const ext = photo.file.name.split('.').pop();
      const fileName = `feedback/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const { data, error: uploadErr } = await supabase.storage
        .from('feedback-photos')
        .upload(fileName, photo.file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadErr) {
        console.error('Upload error:', uploadErr);
        throw new Error(`Failed to upload photo: ${uploadErr.message}`);
      }

      const { data: urlData } = supabase.storage
        .from('feedback-photos')
        .getPublicUrl(fileName);

      urls.push(urlData.publicUrl);
    }
    return urls;
  }

  /* ─── Submit feedback ─── */
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.message.trim()) {
      setError('Please write your feedback message.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');

      // Upload photos if any
      let photoUrls = [];
      if (photos.length > 0) {
        photoUrls = await uploadPhotos();
      }

      // Find project name
      const selectedProject = projects.find(p => String(p.id) === String(form.project_id));
      const projectName = selectedProject
        ? (selectedProject.projectName || selectedProject.project_name)
        : null;

      const feedbackData = {
        user_id: user.id,
        user_email: user.email,
        project_id: form.project_id || null,
        project_name: projectName,
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

      // Reset form
      setForm({ project_id: '', type: 'issue', message: '' });
      photos.forEach(p => URL.revokeObjectURL(p.preview));
      setPhotos([]);
      setGeoLocation(null);
      setShowForm(false);
      setSuccess('Your feedback has been submitted! Thank you for participating.');

      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      console.error('Submit error:', err);
      setError(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <UserLayout>
      <div className="space-y-8">
        {/* Page Header */}
        <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Community Feedback</h1>
            <p className="mt-1 text-zinc-500">Share your observations and concerns about local projects</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
          >
            {showForm ? <Icons.X /> : <Icons.Camera />}
            {showForm ? 'Cancel' : 'Submit Feedback'}
          </button>
        </section>

        {/* Success / Error Alerts */}
        {success && (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
            <Icons.CheckCircle />
            <span>{success}</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <Icons.Warning />
            <span>{error}</span>
          </div>
        )}

        {/* ─── Feedback Form ─── */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden">
            <div className="px-6 py-5 border-b border-zinc-100">
              <h2 className="font-semibold text-zinc-900">New Feedback</h2>
              <p className="text-sm text-zinc-500 mt-0.5">Help improve road projects in your community</p>
            </div>

            <div className="p-6 space-y-5">
              {/* Project Selection */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">Related Project (optional)</label>
                <select
                  value={form.project_id}
                  onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                  className="w-full border border-zinc-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
                >
                  <option value="">— General feedback (no specific project) —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.projectName || p.project_name} — {p.municipality}, {p.province}
                    </option>
                  ))}
                </select>
              </div>

              {/* Feedback Type */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">Feedback Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {feedbackTypes.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, type: t.value }))}
                      className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                        form.type === t.value
                          ? t.color + ' ring-2 ring-offset-1 ring-current'
                          : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">Your Feedback</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Describe what you observed, any issues, or your suggestion..."
                  rows={4}
                  className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
                />
              </div>

              {/* Photo Upload */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Photos <span className="text-zinc-400 font-normal">(up to 5 images)</span>
                </label>

                <div className="flex flex-wrap gap-3">
                  {/* Photo previews */}
                  {photos.map((photo, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={photo.preview}
                        alt={`Upload ${i + 1}`}
                        className="h-24 w-24 object-cover rounded-xl border border-zinc-200"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                      >
                        <svg className="size-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {/* Add photo button */}
                  {photos.length < 5 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-24 w-24 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-zinc-300 rounded-xl text-zinc-400 hover:text-emerald-500 hover:border-emerald-300 transition-colors"
                    >
                      <Icons.Upload />
                      <span className="text-[10px] font-medium">Add Photo</span>
                    </button>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoSelect}
                  className="hidden"
                  capture="environment"
                />
                <p className="text-xs text-zinc-400 mt-2">You can capture directly from your camera or pick from gallery.</p>
              </div>

              {/* Geolocation */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Location Geo-Tag <span className="text-zinc-400 font-normal">(optional but recommended)</span>
                </label>

                {geoLocation ? (
                  <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="size-10 bg-emerald-100 rounded-lg grid place-items-center text-emerald-600 shrink-0">
                      <Icons.MapPin />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-emerald-800">Location captured!</p>
                      <p className="text-xs text-emerald-600">
                        {geoLocation.lat.toFixed(6)}, {geoLocation.lng.toFixed(6)}
                        {geoLocation.accuracy && ` (±${Math.round(geoLocation.accuracy)}m)`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setGeoLocation(null)}
                      className="text-emerald-500 hover:text-emerald-700 text-xs font-medium"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={requestGeoLocation}
                    disabled={geoLoading}
                    className="flex items-center gap-3 w-full p-3 border border-zinc-300 rounded-xl text-left hover:bg-zinc-50 transition-colors disabled:opacity-60"
                  >
                    <div className="size-10 bg-zinc-100 rounded-lg grid place-items-center text-zinc-500 shrink-0">
                      <Icons.MapPin />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-700">
                        {geoLoading ? 'Getting your location...' : 'Tag your current location'}
                      </p>
                      <p className="text-xs text-zinc-400">
                        Helps verify where the concern was observed
                      </p>
                    </div>
                    {geoLoading && (
                      <div className="ml-auto animate-spin size-5 border-2 border-zinc-300 border-t-emerald-600 rounded-full" />
                    )}
                  </button>
                )}
                {geoError && <p className="text-xs text-red-500 mt-1.5">{geoError}</p>}
              </div>
            </div>

            {/* Submit Button */}
            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.message.trim()}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
              >
                {submitting ? (
                  <>
                    <div className="animate-spin size-4 border-2 border-white/30 border-t-white rounded-full" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Icons.Send />
                    Submit Feedback
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* ─── Info Banner ─── */}
        {!showForm && (
          <div className="p-5 bg-sky-50 rounded-2xl border border-sky-100 flex items-start gap-4">
            <div className="size-10 bg-sky-100 rounded-xl grid place-items-center text-sky-600 shrink-0 mt-0.5">
              <Icons.Camera />
            </div>
            <div>
              <p className="font-medium text-sky-900 mb-1">Your voice matters</p>
              <p className="text-sm text-sky-700 leading-relaxed">
                Take a photo and geo-tag your location to report issues, share suggestions, or give feedback on road projects
                in your community. Your input helps ensure transparency and accountability.
              </p>
            </div>
          </div>
        )}

        {/* ─── Feedbacks List ─── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-900">Recent Feedback</h2>
            <span className="text-sm text-zinc-400">{feedbacks.length} total</span>
          </div>

          <div className="space-y-4">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <FeedbackSkeleton key={i} />)
            ) : feedbacks.length === 0 ? (
              <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
                <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
                  <Icons.Camera />
                </div>
                <p className="font-medium text-zinc-900">No feedback yet</p>
                <p className="text-sm text-zinc-500 mt-1">Be the first to share your thoughts!</p>
              </div>
            ) : (
              feedbacks.map(fb => <FeedbackCard key={fb.id} feedback={fb} />)
            )}
          </div>
        </section>
      </div>
    </UserLayout>
  );
}
