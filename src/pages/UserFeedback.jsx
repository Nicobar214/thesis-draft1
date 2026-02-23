import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';
import PublicReportForm from '../components/PublicReportForm';

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
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {feedback._type === 'public_report' || feedback.source === 'public_report' ? (
                <span className="px-2 py-0.5 rounded-md text-xs font-medium border bg-violet-50 text-violet-600 border-violet-200">
                  Public Report
                </span>
              ) : (
                <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${typeInfo.color}`}>
                  {typeInfo.label}
                </span>
              )}
              <StatusBadge status={feedback.status} />
              {feedback.verification && (
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                  feedback.verification === 'Verified On-Site' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  feedback.verification === 'Needs Review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  'bg-red-50 text-red-700 border-red-200'
                }`}>
                  {feedback.verification}
                </span>
              )}
            </div>
            <h3 className="font-medium text-zinc-900 truncate">{feedback.project_name || 'General Feedback'}</h3>
            {feedback.municipality && feedback.barangay && (
              <p className="text-xs text-zinc-400 mt-0.5">{feedback.barangay}, {feedback.municipality}</p>
            )}
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
  const [publicReports, setPublicReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);

  // Fetch feedbacks + user's public reports + projects
  useEffect(() => {
    fetchData();
    const fbChannel = supabase
      .channel('feedbacks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, fetchData)
      .subscribe();
    const prChannel = supabase
      .channel('user-public-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, fetchData)
      .subscribe();
    return () => {
      supabase.removeChannel(fbChannel);
      supabase.removeChannel(prChannel);
    };
  }, []);

  async function fetchData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      setCurrentUserId(userId);

      const [feedbackRes, publicReportRes, projectRes] = await Promise.all([
        supabase.from('feedbacks').select('*').order('created_at', { ascending: false }),
        userId
          ? supabase.from('public_reports').select('*').eq('user_id', userId).order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        supabase.from('projects').select('id, projectName, project_name, municipality, province'),
      ]);

      if (feedbackRes.data) {
        // Show only current user's feedbacks
        const userFeedbacks = userId
          ? feedbackRes.data.filter(fb => fb.user_id === userId)
          : feedbackRes.data;
        setFeedbacks(userFeedbacks);
      }
      if (publicReportRes.data) {
        setPublicReports(publicReportRes.data);
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

  // Combine feedbacks and public reports (that don't already have a linked feedback) into one list
  const combinedItems = (() => {
    // Get IDs of public reports that already have a linked feedback
    const linkedReportIds = new Set(feedbacks.filter(fb => fb.public_report_id).map(fb => fb.public_report_id));

    // Map feedbacks
    const fbItems = feedbacks.map(fb => ({
      ...fb,
      _type: fb.source === 'public_report' ? 'public_report_feedback' : 'feedback',
      _sortDate: fb.created_at,
    }));

    // Only add public reports that are NOT already linked as feedback
    const prItems = publicReports
      .filter(pr => !linkedReportIds.has(pr.id))
      .map(pr => ({
        id: `pr-${pr.id}`,
        _originalId: pr.id,
        _type: 'public_report',
        _sortDate: pr.created_at,
        project_name: pr.project_name,
        type: 'issue',
        message: pr.description,
        status: pr.status,
        created_at: pr.created_at,
        photo_urls: pr.photo_url ? [pr.photo_url] : [],
        latitude: pr.latitude,
        longitude: pr.longitude,
        verification: pr.verification,
        municipality: pr.municipality,
        barangay: pr.barangay,
      }));

    return [...fbItems, ...prItems].sort((a, b) => new Date(b._sortDate) - new Date(a._sortDate));
  })();

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

        {/* ─── Location-Verified Feedback Form (PublicReportForm) ─── */}
        {showForm && (
          <div className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden">
            <div className="px-6 py-5 border-b border-zinc-100">
              <p className="text-sm font-medium text-emerald-600 uppercase tracking-wider">Location-Verified Feedback</p>
              <h2 className="font-semibold text-zinc-900 mt-1">Report from the Ground</h2>
              <p className="text-sm text-zinc-500 mt-0.5">Take a photo and verify your location to submit a report about a road project</p>
            </div>
            <div className="p-6">
              <PublicReportForm />
            </div>
          </div>
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

        {/* ─── Combined Feedbacks & Reports List ─── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-900">Recent Feedback</h2>
            <span className="text-sm text-zinc-400">{combinedItems.length} total</span>
          </div>

          <div className="space-y-4">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <FeedbackSkeleton key={i} />)
            ) : combinedItems.length === 0 ? (
              <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
                <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
                  <Icons.Camera />
                </div>
                <p className="font-medium text-zinc-900">No feedback yet</p>
                <p className="text-sm text-zinc-500 mt-1">Be the first to share your thoughts!</p>
              </div>
            ) : (
              combinedItems.map(item => (
                <FeedbackCard key={item.id} feedback={item} />
              ))
            )}
          </div>
        </section>
      </div>
    </UserLayout>
  );
}
