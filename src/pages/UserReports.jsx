import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';
import PublicReportForm from '../components/PublicReportForm';

/* ─── Icons ─── */
const Icons = {
  Search: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  ),
  Document: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  ),
  MapPin: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  Clock: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  ArrowRight: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  ),
  X: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  ),
  Plus: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  ),
  Filter: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  ),
  ExternalLink: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  ),
};

/* ─── Status badge ─── */
function StatusBadge({ status }) {
  const styles = {
    pending:  'bg-amber-100 text-amber-700',
    reviewed: 'bg-sky-100 text-sky-700',
    resolved: 'bg-emerald-100 text-emerald-700',
  };
  const labels = { pending: 'Pending Review', reviewed: 'Reviewed', resolved: 'Resolved' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {labels[status] || 'Pending Review'}
    </span>
  );
}

/* ─── Format date ─── */
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ─── Classify report ─── */
function classifyReport(desc = '') {
  const d = desc.toLowerCase();
  if (d.includes('lubak') || d.includes('sira') || d.includes('infrastructure') || d.includes('road') || d.includes('daan')) return 'Infrastructure';
  if (d.includes('safety') || d.includes('aksidente') || d.includes('peligro') || d.includes('danger')) return 'Safety Concern';
  if (d.includes('flood') || d.includes('baha') || d.includes('tubig') || d.includes('drainage')) return 'Flood / Drainage';
  return 'General';
}

const categoryColor = {
  'Infrastructure':   'bg-violet-100 text-violet-700',
  'Safety Concern':   'bg-red-100 text-red-700',
  'Flood / Drainage': 'bg-sky-100 text-sky-700',
  'General':          'bg-zinc-100 text-zinc-600',
};

function UserReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [userId, setUserId] = useState(null);
  const [showReportForm, setShowReportForm] = useState(false);

  /* ── Get current user & fetch their reports ── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError('Not authenticated');
          setLoading(false);
          return;
        }
        setUserId(user.id);

        const { data, error: err } = await supabase
          .from('public_reports')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (err) {
          setError(`Failed to load reports: ${err.message}`);
        } else {
          setReports(data || []);
        }
      } catch (e) {
        setError('An unexpected error occurred.');
      }
      setLoading(false);
    })();

    // Realtime subscription for user's reports
    const channel = supabase
      .channel('user-reports-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, async (payload) => {
        // Re-fetch the user's reports on any change
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('public_reports')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (data) setReports(data);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  /* ── Filter ── */
  const filtered = useMemo(() => {
    return reports.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.description} ${r.municipality} ${r.barangay} ${r.street} ${r.project_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [reports, search, statusFilter]);

  /* ── Stat counts ── */
  const counts = useMemo(() => ({
    total: reports.length,
    pending: reports.filter(r => r.status === 'pending').length,
    reviewed: reports.filter(r => r.status === 'reviewed').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
  }), [reports]);

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <section>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">My Reports</h1>
            <p className="mt-1 text-zinc-500">Track the status of your submitted reports</p>
          </section>
          <button
            onClick={() => setShowReportForm(true)}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-emerald-700 transition text-sm shrink-0 self-start sm:self-auto"
          >
            <Icons.Plus />
            Submit New Report
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Reports', value: counts.total, color: 'bg-zinc-100 text-zinc-600' },
            { label: 'Pending', value: counts.pending, color: 'bg-amber-100 text-amber-600' },
            { label: 'Reviewed', value: counts.reviewed, color: 'bg-sky-100 text-sky-600' },
            { label: 'Resolved', value: counts.resolved, color: 'bg-emerald-100 text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-zinc-200/60 p-5 hover:border-zinc-300 transition-colors">
              <div className={`inline-flex items-center justify-center size-9 rounded-xl mb-3 ${s.color}`}>
                <Icons.Document />
              </div>
              <p className="text-2xl font-semibold tracking-tight text-zinc-900">{s.value}</p>
              <p className="text-sm text-zinc-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-zinc-200/60 p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"><Icons.Search /></span>
              <input
                type="text"
                placeholder="Search by description or location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition"
              />
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"><Icons.Filter /></span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none pl-11 pr-9 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-700 bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending Review</option>
                <option value="reviewed">Reviewed</option>
                <option value="resolved">Resolved</option>
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"><Icons.ChevronDown /></span>
            </div>
          </div>
        </div>

        {/* Reports list */}
        {loading && (
          <div className="bg-white rounded-2xl border border-zinc-200/60 py-20 text-center">
            <div className="inline-block w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-zinc-500 text-sm">Loading your reports...</p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-white rounded-2xl border border-red-200 py-16 text-center">
            <p className="text-red-600 text-sm font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
            <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
              <Icons.Document />
            </div>
            <p className="font-medium text-zinc-900">No reports found</p>
            <p className="text-sm text-zinc-500 mt-1">
              {reports.length === 0
                ? 'Submit a report from the community reports page to see it here'
                : 'Try adjusting your search or filters'}
            </p>
            {reports.length === 0 && (
              <button
                onClick={() => setShowReportForm(true)}
                className="inline-flex items-center gap-2 mt-4 text-sm font-medium text-emerald-600 hover:text-emerald-700"
              >
                Submit a Report
                <Icons.ExternalLink />
              </button>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((r) => {
              const cat = classifyReport(r.description);
              return (
                <article
                  key={r.id}
                  className="bg-white rounded-2xl border border-zinc-200/60 hover:border-zinc-300 transition-colors overflow-hidden"
                >
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className="flex flex-wrap items-center gap-2 sm:w-48 shrink-0">
                        <StatusBadge status={r.status} />
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${categoryColor[cat]}`}>{cat}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 leading-snug line-clamp-2 mb-1.5">{r.description}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                          <span className="inline-flex items-center gap-1">
                            <Icons.Clock />
                            {fmtDate(r.created_at)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Icons.MapPin />
                            {r.barangay}, {r.municipality}
                          </span>
                          {r.project_name && (
                            <span className="inline-flex items-center gap-1">
                              <Icons.Document />
                              {r.project_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setSelected(r)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition shrink-0 self-start sm:self-center"
                      >
                        View Details
                        <Icons.ArrowRight />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && !error && (
          <p className="text-xs text-zinc-400 text-right">
            Showing {filtered.length} of {reports.length} report{reports.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="bg-white border border-zinc-200 rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-6 pb-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={selected.status} />
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${categoryColor[classifyReport(selected.description)]}`}>
                  {classifyReport(selected.description)}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-700 transition p-1 -mr-1">
                <Icons.X />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <h3 className="text-base font-semibold text-zinc-900 mb-1">Issue Description</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{selected.description}</p>
              </div>

              <div className="bg-zinc-50 rounded-xl p-4 space-y-3">
                {[
                  { label: 'Location', value: `${selected.barangay}, ${selected.municipality}${selected.street ? ` — ${selected.street}` : ''}` },
                  selected.project_name && { label: 'Project', value: selected.project_name },
                  { label: 'Date Reported', value: fmtDate(selected.created_at) },
                  { label: 'Status', value: selected.status?.charAt(0).toUpperCase() + selected.status?.slice(1) },
                  { label: 'Verification', value: selected.verification },
                ].filter(Boolean).map((item) => (
                  <div key={item.label} className="flex items-start gap-3 text-sm">
                    <span className="text-zinc-400 w-28 shrink-0 font-medium">{item.label}</span>
                    <span className="text-zinc-800">{item.value}</span>
                  </div>
                ))}
              </div>

              {selected.photo_url && (
                <div>
                  <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wider">Attached Photo</p>
                  <img src={selected.photo_url} alt="Report photo" className="w-full rounded-xl border border-zinc-200" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Report form modal */}
      {showReportForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowReportForm(false)}>
          <div
            className="bg-white border border-zinc-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-0">
              <div>
                <p className="text-sm font-medium text-emerald-600 uppercase tracking-wider">Location-Verified Feedback</p>
                <h3 className="text-lg font-semibold text-zinc-900 mt-1">Submit a Report</h3>
              </div>
              <button onClick={() => setShowReportForm(false)} className="text-zinc-400 hover:text-zinc-700 transition p-1 -mr-1">
                <Icons.X />
              </button>
            </div>
            <div className="p-6">
              <PublicReportForm />
            </div>
          </div>
        </div>
      )}
    </UserLayout>
  );
}

export default UserReports;
