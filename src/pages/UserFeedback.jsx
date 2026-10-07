import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

import UserLayout from '../components/UserLayout';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle';
import Pagination, { usePagination } from '../components/ui/Pagination';
import { ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react';
import FeedbackDetailModal from '../components/publicReports/FeedbackDetailModal';
import { selectCommunityFeedback } from '../lib/communityFeedback';
import { SUPPORTABLE_STATUSES, supportCountLabel } from '../lib/reportSupport';

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

/** Props that make a whole card or row open its detail, by mouse or keyboard. */
function openProps(onOpen, label) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: () => onOpen(),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    },
  };
}
const stop = (e) => e.stopPropagation();

/* â”€â”€â”€ Feedback Card â”€â”€â”€ */
function FeedbackCard({ feedback, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = feedbackTypes.find(t => t.value === feedback.type) || feedbackTypes[0];

  return (
    <article
      {...openProps(onOpen, `Open details: ${feedback.project_name || 'General Feedback'}`)}
      className="group cursor-pointer bg-white rounded-2xl border border-slate-200/60 overflow-hidden hover:border-emerald-300 hover:shadow-md transition-all duration-200 flex flex-col h-full focus-visible:outline-2 focus-visible:outline-emerald-600"
    >
      {feedback.photo_urls?.length > 0 && (
        <a href={feedback.photo_urls[0]} target="_blank" rel="noopener noreferrer" onClick={stop} className="relative block">
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
          <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="text-xs text-teal-600 hover:text-teal-700 mt-1 self-start">
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}

        {feedback.photo_urls?.length > 1 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
            {feedback.photo_urls.slice(1).map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={stop} className="shrink-0">
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
        {feedback._supportCount > 0 && (
          <p className="mt-2 text-xs font-medium text-violet-700">{supportCountLabel(feedback._supportCount)}</p>
        )}
        <p className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-3 text-xs font-semibold text-emerald-700">
          View details
          <ChevronRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </p>
      </div>
    </article>
  );
}

function itemTypeKey(f) {
  return f._type === 'public_report' || f.source === 'public_report' ? 'public_report' : f.type;
}

const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'All types' },
  ...feedbackTypes.map((t) => ({ value: t.value, label: t.label })),
  { value: 'public_report', label: 'Public Report' },
];
const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'resolved', label: 'Resolved' },
];
const VERIFICATION_FILTER_OPTIONS = [
  { value: 'all', label: 'All verification' },
  { value: 'Verified On-Site', label: 'Verified On-Site' },
  { value: 'Needs Review', label: 'Needs Review' },
  { value: 'Location Mismatch', label: 'Location Mismatch' },
  { value: 'none', label: 'Not verified' },
];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

function FilterSelect({ label, value, onChange, options }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none cursor-pointer focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* --- Feedback Table --- */
function verificationTone(v) {
  if (v === 'Verified On-Site') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (v === 'Needs Review') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function FeedbackTable({ items, onOpen }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Project</th>
            <th className="px-4 py-3 font-semibold">Message</th>
            <th className="px-4 py-3 font-semibold">Location</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Verification</th>
            <th className="px-4 py-3 font-semibold whitespace-nowrap">Date</th>
            <th className="px-2 py-3"><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((f) => {
            const isReport = f._type === 'public_report' || f.source === 'public_report';
            const typeInfo = feedbackTypes.find((t) => t.value === f.type) || feedbackTypes[0];
            return (
              <tr key={f.id} {...openProps(() => onOpen(f), `Open details: ${f.project_name || 'General Feedback'}`)} className="group cursor-pointer hover:bg-emerald-50/40 align-top focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600">
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${isReport ? 'bg-violet-50 text-violet-600 border-violet-200' : typeInfo.color}`}>
                    {isReport ? 'Public Report' : typeInfo.label}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">{f.project_name || 'General Feedback'}</td>
                <td className="px-4 py-3 max-w-xs">
                  <p className="line-clamp-2 text-slate-600">{f.message}</p>
                  {f.photo_urls?.length > 0 && (
                    <a href={f.photo_urls[0]} target="_blank" rel="noopener noreferrer" onClick={stop} className="text-xs text-teal-600 hover:text-teal-700">
                      View photo{f.photo_urls.length > 1 ? `s (${f.photo_urls.length})` : ''}
                    </a>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{[f.barangay, f.municipality].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={f.status} /></td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {f.verification ? (
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${verificationTone(f.verification)}`}>{f.verification}</span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(f.created_at).toLocaleDateString()}</td>
                <td className="px-2 py-3 text-slate-300 group-hover:text-emerald-700"><ChevronRightIcon className="size-4" aria-hidden="true" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const [viewMode, setViewMode] = useViewMode('userFeedback.viewMode');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedItem, setSelectedItem] = useState(null);
  // report id -> { count, mine }. null until the supporters migration exists, which keeps the feature hidden.
  const [supportByReport, setSupportByReport] = useState(null);
  // 'community' = everyone's feedback and reports; 'mine' = only what this user submitted.
  // The dashboard's View My Feedback link arrives with ?mine=1.
  const [scope, setScope] = useState(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mine') === '1' ? 'mine' : 'community'
  ));

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
    // Realtime only carries a user's own rows once feedbacks is owner-only, so also
    // refresh when the tab regains focus to pick up what the community added.
    const refreshOnFocus = () => { if (document.visibilityState === 'visible') fetchData(); };
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      document.removeEventListener('visibilitychange', refreshOnFocus);
      supabase.removeChannel(fbChannel);
      supabase.removeChannel(prChannel);
    };
  }, []);

  async function fetchData() {
    try {
      const [feedbackRes, publicReportRes, projectRes, supportRes] = await Promise.all([
        // Shared with everyone, so it comes from the community view: no author id or email,
        // just an is_current_user_feedback flag (see lib/communityFeedback.js).
        selectCommunityFeedback(supabase, (q) => q.order('created_at', { ascending: false }).limit(500)),
        // The citizen view already strips reporter identity and hides dismissed reports.
        supabase.from('public_reports_citizen_view').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('projects').select('id, projectName, project_name, municipality, province'),
        // Counts only - never who backed a report. Errors until supabase_report_supporters.sql is run.
        supabase.from('public_report_support_counts').select('report_id, support_count, i_support'),
      ]);

      if (!supportRes.error && supportRes.data) {
        const next = {};
        supportRes.data.forEach((row) => {
          next[row.report_id] = { count: Number(row.support_count) || 0, mine: Boolean(row.i_support) };
        });
        setSupportByReport(next);
      }

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
      _isMine: Boolean(fb.is_current_user_feedback),
      _supportCount: supportByReport?.[fb.public_report_id]?.count || 0,
    }));

    // Only add public reports that are NOT already linked as feedback
    const prItems = publicReports
      .filter(pr => !linkedReportIds.has(pr.id))
      .map(pr => ({
        id: `pr-${pr.id}`,
        _originalId: pr.id,
        _type: 'public_report',
        _isMine: Boolean(pr.is_current_user_report),
        _supportCount: supportByReport?.[pr.id]?.count || 0,
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
  }, [feedbacks, publicReports, supportByReport]);

  const mineCount = useMemo(() => combinedItems.filter((i) => i._isMine).length, [combinedItems]);
  // Everything the current tab is about, before the search and filter controls narrow it down.
  const scopedItems = useMemo(
    () => (scope === 'mine' ? combinedItems.filter((i) => i._isMine) : combinedItems),
    [combinedItems, scope]
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = scopedItems.filter((f) => {
      if (q) {
        const hay = `${f.project_name || ''} ${f.message || ''} ${f.barangay || ''} ${f.municipality || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (typeFilter !== 'all' && itemTypeKey(f) !== typeFilter) return false;
      if (statusFilter !== 'all' && (f.status || 'pending') !== statusFilter) return false;
      if (verificationFilter === 'none') {
        if (f.verification) return false;
      } else if (verificationFilter !== 'all' && f.verification !== verificationFilter) return false;
      return true;
    });
    const dir = sortBy === 'oldest' ? 1 : -1;
    return result.sort((x, y) => dir * (new Date(x._sortDate) - new Date(y._sortDate)));
  }, [scopedItems, search, typeFilter, statusFilter, verificationFilter, sortBy]);

  // The road report behind an entry: the report itself, or the one a feedback is linked to.
  const selectedReport = useMemo(() => {
    if (!selectedItem) return null;
    const reportId = selectedItem._originalId || selectedItem.public_report_id;
    return reportId ? publicReports.find((r) => r.id === reportId) || null : null;
  }, [selectedItem, publicReports]);

  // "I see this too" state for the open report; null hides the control (migration not run yet).
  const selectedSupport = useMemo(() => {
    if (!selectedItem || !selectedReport || supportByReport === null) return null;
    const entry = supportByReport[selectedReport.id] || { count: 0, mine: false };
    return {
      count: entry.count,
      mine: entry.mine,
      canSupport: !selectedItem._isMine && SUPPORTABLE_STATUSES.includes(selectedReport.status),
    };
  }, [selectedItem, selectedReport, supportByReport]);

  const handleSupportChange = useCallback((reportId, count, mine) => {
    setSupportByReport((prev) => ({ ...(prev || {}), [reportId]: { count, mine } }));
  }, []);

  const pager = usePagination(filteredItems, [search, typeFilter, statusFilter, verificationFilter, sortBy].join('|'));
  const hasFilters = Boolean(search) || typeFilter !== 'all' || statusFilter !== 'all' || verificationFilter !== 'all';
  const clearFilters = () => { setSearch(''); setTypeFilter('all'); setStatusFilter('all'); setVerificationFilter('all'); };

  return (
    <UserLayout>
      <div className="space-y-8">
        {/* Page Header */}
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Community Feedback</h1>
          <p className="mt-1 text-slate-500">Road reports and feedback from across the community, so you can see what others have raised and follow your own.</p>
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
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-slate-900">Recent Feedback</h2>
              <div role="tablist" aria-label="Whose feedback to show" className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1">
                {[
                  { id: 'community', label: 'Everyone', count: combinedItems.length },
                  { id: 'mine', label: 'My submissions', count: mineCount },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={scope === tab.id}
                    onClick={() => setScope(tab.id)}
                    className={'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ' + (scope === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
                  >
                    {tab.label}
                    <span className={'rounded-full px-1.5 text-[10px] tabular-nums ' + (scope === tab.id ? 'bg-teal-50 text-teal-700' : 'bg-slate-200/70 text-slate-500')}>{tab.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">{hasFilters ? `${filteredItems.length} of ${scopedItems.length}` : scopedItems.length} total</span>
              {!loading && scopedItems.length > 0 && <ViewToggle mode={viewMode} onChange={setViewMode} />}
            </div>
          </div>

          {!loading && scopedItems.length > 0 && (
            <div className="mb-4 flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search project, message or location..."
                  aria-label="Search feedback"
                  className="h-10 w-full rounded-xl border border-slate-200 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterSelect label="Filter by type" value={typeFilter} onChange={setTypeFilter} options={TYPE_FILTER_OPTIONS} />
                <FilterSelect label="Filter by status" value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
                <FilterSelect label="Filter by verification" value={verificationFilter} onChange={setVerificationFilter} options={VERIFICATION_FILTER_OPTIONS} />
                <FilterSelect label="Sort order" value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
                {hasFilters && (
                  <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-xs font-medium text-slate-500 hover:text-red-600 transition">
                    <XIcon className="size-3.5" aria-hidden="true" /> Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <FeedbackSkeleton key={i} />)}
            </div>
          ) : scopedItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
              <p className="font-medium text-slate-900">{scope === 'mine' ? 'You have not submitted anything yet' : 'No community activity yet'}</p>
              <p className="text-sm text-slate-500 mt-1">
                {scope === 'mine'
                  ? 'Reports and feedback you submit will show up here as they are reviewed.'
                  : 'Reports and feedback from the community will appear here.'}
              </p>
              {scope === 'mine' && combinedItems.length > 0 && (
                <button type="button" onClick={() => setScope('community')} className="mt-3 text-sm font-medium text-teal-600 hover:text-teal-700">
                  See what the community has shared
                </button>
              )}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/60 py-14 text-center">
              <p className="font-medium text-slate-900">No feedback matches your filters</p>
              <button type="button" onClick={clearFilters} className="mt-2 text-sm text-teal-600 hover:text-teal-700">Clear filters</button>
            </div>
          ) : viewMode === 'table' ? (
            <FeedbackTable items={pager.pageItems} onOpen={setSelectedItem} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pager.pageItems.map(item => (
                <FeedbackCard key={item.id} feedback={item} onOpen={() => setSelectedItem(item)} />
              ))}
            </div>
          )}
          {!loading && filteredItems.length > 0 && (
            <div className="mt-4">
              <Pagination pager={pager} noun="entry" />
            </div>
          )}
        </section>
      </div>

      {selectedItem && (
        <FeedbackDetailModal key={selectedItem.id} item={selectedItem} report={selectedReport} support={selectedSupport} onSupportChange={handleSupportChange} items={filteredItems} onSelect={setSelectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </UserLayout>
  );
}



