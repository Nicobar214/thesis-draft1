import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

import UserLayout from '../components/UserLayout';

/* â”€â”€â”€ Icons â”€â”€â”€ */
/* â”€â”€â”€ Feedback Type Options â”€â”€â”€ */
const feedbackTypes = [
  { value: 'issue', label: 'Road Condition', color: 'text-red-600 bg-red-50 border-red-200' },
  { value: 'suggestion', label: 'Maintenance Request', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'compliment', label: 'Project Appreciation', color: 'text-teal-600 bg-emerald-50 border-emerald-200' },
  { value: 'concern', label: 'Safety Hazard', color: 'text-violet-600 bg-violet-50 border-violet-200' },
];

/* â”€â”€â”€ Status Badge â”€â”€â”€ */
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

/* â”€â”€â”€ Feedback Card â”€â”€â”€ */
function FeedbackCard({ feedback }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = feedbackTypes.find(t => t.value === feedback.type) || feedbackTypes[0];

  return (
    <article className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden hover:border-zinc-300 hover:shadow-md transition-all duration-200 flex flex-col h-full">
      {feedback.photo_urls?.length > 0 && (
        <a href={feedback.photo_urls[0]} target="_blank" rel="noopener noreferrer" className="relative block">
          <img
            src={feedback.photo_urls[0]}
            alt="Report photo"
            className="w-full h-36 object-cover hover:opacity-90 transition-opacity"
          />
          {feedback.photo_urls.length > 1 && (
            <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md text-[11px] font-bold bg-black/60 text-white backdrop-blur-sm">
              +{feedback.photo_urls.length - 1} more
            </span>
          )}
        </a>
      )}

      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
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
        </div>

        <h3 className="font-medium text-slate-900 line-clamp-1">{feedback.project_name || 'General Feedback'}</h3>
        {feedback.municipality && feedback.barangay && (
          <p className="text-xs text-slate-400 mt-0.5">{feedback.barangay}, {feedback.municipality}</p>
        )}

        <p className={`text-sm text-slate-600 leading-relaxed mt-2 ${expanded ? '' : 'line-clamp-3'}`}>
          {feedback.message}
        </p>
        {feedback.message?.length > 120 && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-teal-600 hover:text-teal-700 mt-1 self-start">
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}

        {feedback.photo_urls?.length > 1 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
            {feedback.photo_urls.slice(1).map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <img
                  src={url}
                  alt={`Additional photo ${i + 2}`}
                  className="h-12 w-12 object-cover rounded-md border border-slate-200 hover:opacity-80 transition-opacity"
                />
              </a>
            ))}
          </div>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between text-xs text-slate-400">
          {feedback.verification ? (
            <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
              feedback.verification === 'Verified On-Site' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              feedback.verification === 'Needs Review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-red-50 text-red-700 border-red-200'
            }`}>
              {feedback.verification}
            </span>
          ) : <span />}
          <span>{new Date(feedback.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </article>
  );
}

/* â”€â”€â”€ Loading Skeleton â”€â”€â”€ */
function FeedbackSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden animate-pulse">
      <div className="h-36 bg-zinc-200" />
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-5 w-24 bg-zinc-200 rounded-md" />
          <div className="h-5 w-16 bg-zinc-200 rounded-full" />
        </div>
        <div className="h-4 w-3/4 bg-zinc-200 rounded mb-2" />
        <div className="h-4 w-1/2 bg-zinc-200 rounded" />
      </div>
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Main UserFeedback Component
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function UserFeedback() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [publicReports, setPublicReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

      const [feedbackRes, publicReportRes, projectRes] = await Promise.all([
        userId
          ? supabase.from('feedbacks').select('*').eq('user_id', userId).order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        userId
          ? supabase.from('public_reports').select('*').eq('user_id', userId).order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        supabase.from('projects').select('id, projectName, project_name, municipality, province'),
      ]);

      if (feedbackRes.data) {
        setFeedbacks(feedbackRes.data);
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
  const combinedItems = useMemo(() => {
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
  }, [feedbacks, publicReports]);

  return (
    <UserLayout>
      <div className="space-y-8">
        {/* Page Header */}
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Community Feedback</h1>
          <p className="mt-1 text-slate-500">Track your submitted road reports and community activity</p>
        </section>

        {/* Error Alert */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <span>{error}</span>
          </div>
        )}

        {/* â”€â”€â”€ Combined Feedbacks & Reports List â”€â”€â”€ */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Recent Feedback</h2>
            <span className="text-sm text-slate-400">{combinedItems.length} total</span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <FeedbackSkeleton key={i} />)}
            </div>
          ) : combinedItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
              <p className="font-medium text-slate-900">No activity yet</p>
              <p className="text-sm text-slate-500 mt-1">Reports you submit will show up here as they're reviewed.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {combinedItems.map(item => (
                <FeedbackCard key={item.id} feedback={item} />
              ))}
            </div>
          )}
        </section>
      </div>
    </UserLayout>
  );
}



