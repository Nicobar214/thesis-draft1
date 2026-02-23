/* PublicReportsPage.jsx – Community-reported issues listing
 * Public page (no login needed). Shows all public_reports
 * with search, date-range & status filters.
 * Uses the same light zinc/emerald palette as UserDashboard.
 */
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PublicReportForm from '../components/PublicReportForm';

/* ─── Icons ─── */
const Icons = {
  Search: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  ),
  Calendar: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v9.75" />
    </svg>
  ),
  Filter: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
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
  Document: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  ),
  Plus: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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
  ChevronDown: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  ),
};

/* ─── Status badge (light theme) ─── */
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

/* ─── Classify report from description ─── */
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

// ════════════════════════════════════════════════════════════
export default function PublicReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selected, setSelected] = useState(null);
  const [showReportForm, setShowReportForm] = useState(false);

  /* ── Fetch ── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error: err } = await supabase
          .from('public_reports')
          .select('*')
          .order('created_at', { ascending: false });

        if (err) {
          console.error('Supabase fetch error:', err);
          setError(`Failed to load reports: ${err.message}`);
        } else {
          setReports(data || []);
        }
      } catch (e) {
        console.error('Unexpected error:', e);
        setError('An unexpected error occurred while loading reports.');
      }
      setLoading(false);
    })();
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
      if (dateFrom && new Date(r.created_at) < new Date(dateFrom)) return false;
      if (dateTo) { const to = new Date(dateTo); to.setHours(23,59,59,999); if (new Date(r.created_at) > to) return false; }
      return true;
    });
  }, [reports, search, statusFilter, dateFrom, dateTo]);

  /* ── Stat counts ── */
  const counts = useMemo(() => ({
    total: reports.length,
    pending: reports.filter(r => r.status === 'pending').length,
    reviewed: reports.filter(r => r.status === 'reviewed').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
  }), [reports]);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* ── Navbar ── */}
      <nav className="bg-white/95 backdrop-blur-md border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-lg font-bold">K</span>
            </div>
            <span className="text-lg font-bold text-zinc-900">KalsaTrack</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/" className="text-zinc-500 hover:text-zinc-900 transition text-sm font-medium">Home</Link>
            <Link to="/signin" className="text-zinc-600 hover:text-zinc-900 transition font-medium px-4 py-2 text-sm">Sign In</Link>
            <Link to="/signup" className="bg-emerald-600 text-white px-5 py-2 rounded-lg hover:bg-emerald-700 transition font-medium text-sm">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* ── Page header ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-medium text-emerald-600 uppercase tracking-wider mb-1">Community Reports</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight">Reported Issues</h1>
            <p className="mt-1 text-zinc-500">Track and monitor issues reported by citizens across FMR projects</p>
          </div>
          <button
            onClick={() => setShowReportForm(true)}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-emerald-700 transition text-sm shrink-0 self-start sm:self-auto"
          >
            <Icons.Plus />
            Report New Issue
          </button>
        </div>

        {/* ── Quick stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
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

        {/* ── Filters ── */}
        <div className="bg-white rounded-2xl border border-zinc-200/60 p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"><Icons.Search /></span>
              <input
                type="text"
                placeholder="Search by description, location, or project..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition"
              />
            </div>

            {/* Date from */}
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"><Icons.Calendar /></span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="pl-11 pr-3 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition"
                title="From date"
              />
            </div>

            {/* Date to */}
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"><Icons.Calendar /></span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="pl-11 pr-3 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition"
                title="To date"
              />
            </div>

            {/* Status */}
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
      </div>

      {/* ── Report cards ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl border border-zinc-200/60 py-20 text-center">
            <div className="inline-block w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-zinc-500 text-sm">Loading reports…</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-white rounded-2xl border border-red-200 py-16 text-center">
            <p className="text-red-600 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
            <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
              <Icons.Document />
            </div>
            <p className="font-medium text-zinc-900">No reports found</p>
            <p className="text-sm text-zinc-500 mt-1">Try adjusting your search or filters</p>
          </div>
        )}

        {/* Cards list */}
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
                      {/* Left: meta */}
                      <div className="flex flex-wrap items-center gap-2 sm:w-48 shrink-0">
                        <StatusBadge status={r.status} />
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${categoryColor[cat]}`}>{cat}</span>
                      </div>

                      {/* Center: details */}
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

                      {/* Right: action */}
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

        {/* Count */}
        {!loading && !error && (
          <p className="text-xs text-zinc-400 mt-4 text-right">
            Showing {filtered.length} of {reports.length} report{reports.length !== 1 ? 's' : ''}
          </p>
        )}
      </section>

      {/* ── Detail modal ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="bg-white border border-zinc-200 rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
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
              {/* Description */}
              <div>
                <h3 className="text-base font-semibold text-zinc-900 mb-1">Issue Description</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{selected.description}</p>
              </div>

              {/* Info grid */}
              <div className="bg-zinc-50 rounded-xl p-4 space-y-3">
                {[
                  { label: 'Location', value: `${selected.barangay}, ${selected.municipality}${selected.street ? ` — ${selected.street}` : ''}` },
                  selected.project_name && { label: 'Project', value: selected.project_name },
                  { label: 'Date Reported', value: fmtDate(selected.created_at) },
                  { label: 'Reported by', value: selected.full_name || 'Anonymous' },
                  { label: 'Verification', value: selected.verification },
                ].filter(Boolean).map((item) => (
                  <div key={item.label} className="flex items-start gap-3 text-sm">
                    <span className="text-zinc-400 w-28 shrink-0 font-medium">{item.label}</span>
                    <span className="text-zinc-800">{item.value}</span>
                  </div>
                ))}
              </div>

              {/* Photo */}
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

      {/* ── Report form modal ── */}
      {showReportForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowReportForm(false)}>
          <div
            className="bg-white border border-zinc-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 pb-0">
              <div>
                <p className="text-sm font-medium text-emerald-600 uppercase tracking-wider">Location-Verified Feedback</p>
                <h3 className="text-lg font-semibold text-zinc-900 mt-1">Report from the Ground</h3>
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

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-zinc-200 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm text-zinc-400">© 2026 KalsaTrack. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
