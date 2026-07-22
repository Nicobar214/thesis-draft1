import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

import Icons from '../components/Icons';
import PublicReportForm from '../components/PublicReportForm';
import UserLayout from '../components/UserLayout';
import CitizenReportTimeline from '../components/publicReports/CitizenReportTimeline';
import PublicReportRouteMapPanel from '../components/publicReports/PublicReportRouteMapPanel';
import DAResolutionCertificate from '../components/publicReports/DAResolutionCertificate';

export const SEVERITY_TAXONOMY = {
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

/* â”€â”€â”€ Icons â”€â”€â”€ */
/* â”€â”€â”€ Status badge â”€â”€â”€ */
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

const STATUS_PRIORITY = { pending: 0, reviewed: 1, resolved: 2 };

/* â”€â”€â”€ Format date â”€â”€â”€ */
function fmtDate(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* â”€â”€â”€ Classify report â”€â”€â”€ */
function classifyReport(desc = '') {
  const d = desc.toLowerCase();
  if (/safety|aksidente|peligro|danger|hazard/.test(d)) return 'safety';
  if (/flood|baha|tubig|drainage|water|inundated/.test(d)) return 'flood';
  if (/lubak|sira|pothole|road|daan|crack|damage|broken/.test(d)) return 'issue';
  return 'general';
}

function resolveCategory(report) {
  return report.severity_category || classifyReport(report.description);
}

function resolveSpecificProblem(report) {
  if (!report.specific_problem || !report.severity_category) return null;
  const cat = SEVERITY_TAXONOMY[report.severity_category];
  if (!cat) return null;
  return cat.problems.find((p) => p.value === report.specific_problem) || null;
}

function SeverityBadge({ category }) {
  const meta = SEVERITY_TAXONOMY[category];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

function UserReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [selectedResolutionSummary, setSelectedResolutionSummary] = useState('');
  const [selectedResolution, setSelectedResolution] = useState(null);
  const [selectedFieldFinding, setSelectedFieldFinding] = useState(null);
  const [selectedLguDecision, setSelectedLguDecision] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedProjectRoute, setSelectedProjectRoute] = useState(null);
  const [showCertModal, setShowCertModal] = useState(false);
  const [userId, setUserId] = useState(null);
  const [reportStep, setReportStep] = useState('idle');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [problemFilter, setProblemFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [searchParams, setSearchParams] = useSearchParams();

  // Arriving with ?action=new (e.g. the "Report Road Issue" button elsewhere
  // in the app) opens the report form immediately instead of landing on the list.
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setReportStep('form');
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* â”€â”€ Get current user & fetch their reports â”€â”€ */
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, async () => {
        if (!userId) return;
        const { data } = await supabase
          .from('public_reports')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (data) setReports(data);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [userId]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;

      if (showCertModal) {
        setShowCertModal(false);
      } else if (selected) {
        setSelected(null);
      } else if (reportStep !== 'idle') {
        setReportStep('idle');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selected, reportStep, showCertModal]);

  useEffect(() => {
    if (!selected?.id) return;
    const latest = reports.find((row) => row.id === selected.id);
    if (!latest) return;

    if (
      latest.updated_at !== selected.updated_at ||
      latest.status !== selected.status ||
      latest.engineer_status !== selected.engineer_status ||
      latest.verification !== selected.verification
    ) {
      setSelected(latest);
    }
  }, [reports, selected]);

  useEffect(() => {
    let alive = true;

    const loadSelectedContext = async () => {
      if (!selected?.id) {
        if (alive) {
          setSelectedResolutionSummary('');
          setSelectedResolution(null);
          setSelectedFieldFinding(null);
          setSelectedLguDecision(null);
          setSelectedProject(null);
          setSelectedProjectRoute(null);
        }
        return;
      }

      try {
        const [resolutionRes, findingRes, lguDecisionRes] = await Promise.all([
          supabase
            .from('public_report_resolutions')
            .select('*')
            .eq('report_id', selected.id)
            .order('resolved_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('public_report_field_findings')
            .select('*')
            .eq('report_id', selected.id)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('public_report_lgu_decisions')
            .select('decision, remarks, created_at')
            .eq('report_id', selected.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!alive) return;

        // project_id on public_reports is sometimes stored as a prefixed
        // string (e.g. "fmr-<uuid>") rather than the raw fmr_projects.id, so
        // a direct id match can miss — always fall back to matching by name.
        let projectRow = null;
        if (selected.project_id) {
          const { data } = await supabase.from('fmr_projects').select('*').eq('id', selected.project_id).maybeSingle();
          projectRow = data || null;
        }
        if (!projectRow && selected.project_name) {
          const { data } = await supabase.from('fmr_projects').select('*').ilike('project_name', String(selected.project_name)).limit(1).maybeSingle();
          projectRow = data || null;
        }
        if (!alive) return;

        setSelectedResolution(resolutionRes?.data || null);
        setSelectedResolutionSummary(resolutionRes?.data?.summary || '');
        setSelectedFieldFinding(findingRes?.data || null);
        setSelectedLguDecision(lguDecisionRes?.data || null);
        setSelectedProject(projectRow);

        if (projectRow?.id) {
          const { data: routeRow } = await supabase
            .from('project_routes')
            .select('*')
            .eq('project_id', projectRow.id)
            .maybeSingle();
          if (alive) setSelectedProjectRoute(routeRow || null);
        } else {
          setSelectedProjectRoute(null);
        }
      } catch {
        if (!alive) return;
        setSelectedResolutionSummary('');
        setSelectedResolution(null);
        setSelectedFieldFinding(null);
        setSelectedLguDecision(null);
        setSelectedProject(null);
        setSelectedProjectRoute(null);
      }
    };

    loadSelectedContext();

    return () => {
      alive = false;
    };
  }, [selected]);

  /* â”€â”€ Filter + Sort â”€â”€ */
  const filtered = useMemo(() => {
    const result = reports.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.description} ${r.municipality} ${r.barangay} ${r.street} ${r.project_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (categoryFilter !== 'all') {
        if (resolveCategory(r) !== categoryFilter) return false;
      }
      if (problemFilter !== 'all') {
        if (r.specific_problem !== problemFilter) return false;
      }
      return true;
    });

    const sorted = [...result];
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sortBy === 'status') {
      sorted.sort((a, b) => (STATUS_PRIORITY[a.status] ?? 0) - (STATUS_PRIORITY[b.status] ?? 0));
    } else {
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return sorted;
  }, [reports, search, statusFilter, categoryFilter, problemFilter, sortBy]);

  /* â”€â”€ Stat counts â”€â”€ */
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
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Reports</h1>
            <p className="mt-1 text-slate-500">Track the status of your submitted reports</p>
          </section>
          <button
            onClick={() => setReportStep('form')}
            className="inline-flex items-center gap-2 bg-teal-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-teal-700 transition text-sm shrink-0 self-start sm:self-auto"
          >
            <Icons.Plus />
            Submit New Report
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Reports', value: counts.total, color: 'bg-slate-100 text-slate-600' },
            { label: 'Pending', value: counts.pending, color: 'bg-amber-100 text-amber-600' },
            { label: 'Reviewed', value: counts.reviewed, color: 'bg-sky-100 text-sky-600' },
            { label: 'Resolved', value: counts.resolved, color: 'bg-emerald-100 text-teal-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:border-zinc-300 transition-colors">
              <div className={`inline-flex items-center justify-center size-9 rounded-xl mb-3 ${s.color}`}>
                <Icons.Document />
              </div>
              <p className="text-2xl font-semibold tracking-tight text-slate-900">{s.value}</p>
              <p className="text-sm text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span>
              <input
                type="text"
                placeholder="Search by description or location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition"
              />
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icons.Filter /></span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none pl-11 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending Review</option>
                <option value="reviewed">Reviewed</option>
                <option value="resolved">Resolved</option>
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icons.ChevronDown /></span>
            </div>
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="appearance-none pl-4 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition cursor-pointer"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="status">By Status</option>
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icons.ChevronDown /></span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-400 font-medium w-24 shrink-0 flex items-center">
              Filter by type
            </span>
            <div className="relative flex-1">
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setProblemFilter('all'); }}
                className="appearance-none w-full px-4 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition cursor-pointer"
              >
                <option value="all">All Severity Types</option>
                {Object.entries(SEVERITY_TAXONOMY).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.icon} {meta.label}</option>
                ))}
              </select>
            </div>
            {categoryFilter !== 'all' && (
              <div className="relative flex-1">
                <select
                  value={problemFilter}
                  onChange={(e) => setProblemFilter(e.target.value)}
                  className="appearance-none w-full px-4 pr-9 py-2.5 border border-teal-200 bg-teal-50 rounded-xl text-sm text-teal-800 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition cursor-pointer"
                >
                  <option value="all">All — {SEVERITY_TAXONOMY[categoryFilter]?.label}</option>
                  {(SEVERITY_TAXONOMY[categoryFilter]?.problems || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}
            {(categoryFilter !== 'all' || statusFilter !== 'all' || search) && (
              <button
                onClick={() => { setCategoryFilter('all'); setProblemFilter('all'); setStatusFilter('all'); setSearch(''); }}
                className="shrink-0 text-xs text-slate-400 hover:text-red-500 transition font-medium px-2"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {(categoryFilter !== 'all' || problemFilter !== 'all') && (
          <div className="flex flex-wrap gap-2">
            {categoryFilter !== 'all' && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${SEVERITY_TAXONOMY[categoryFilter]?.color}`}>
                {SEVERITY_TAXONOMY[categoryFilter]?.icon} {SEVERITY_TAXONOMY[categoryFilter]?.label}
                <button onClick={() => { setCategoryFilter('all'); setProblemFilter('all'); }} className="ml-1 hover:opacity-70">×</button>
              </span>
            )}
            {problemFilter !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-teal-50 text-teal-700 border-teal-200">
                {SEVERITY_TAXONOMY[categoryFilter]?.problems.find((p) => p.value === problemFilter)?.label}
                <button onClick={() => setProblemFilter('all')} className="ml-1 hover:opacity-70">×</button>
              </span>
            )}
          </div>
        )}

        {/* Reports list */}
        {loading && (
          <div className="bg-white rounded-2xl border border-slate-200/60 py-20 text-center">
            <div className="inline-block w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-slate-500 text-sm">Loading your reports...</p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-white rounded-2xl border border-red-200 py-16 text-center">
            <p className="text-red-600 text-sm font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
            <div className="mx-auto size-14 bg-slate-100 rounded-xl grid place-items-center text-slate-400 mb-3">
              <Icons.Document />
            </div>
            <p className="font-medium text-slate-900">No reports found</p>
            <p className="text-sm text-slate-500 mt-1">
              {reports.length === 0
                ? 'Submit a report from the community reports page to see it here'
                : 'Try adjusting your search or filters'}
            </p>
            {reports.length === 0 && (
              <button
                onClick={() => setReportStep('form')}
                className="inline-flex items-center gap-2 mt-4 text-sm font-medium text-teal-600 hover:text-teal-700"
              >
                Submit a Report
                <Icons.ExternalLink />
              </button>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((r) => {
              const cat = resolveCategory(r);
              const problem = resolveSpecificProblem(r);
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200/60 hover:border-teal-500/50 hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col h-full"
                >
                  {r.photo_url && (
                    <img
                      src={r.photo_url}
                      alt="Report site"
                      className="w-full h-36 object-cover"
                    />
                  )}
                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      <StatusBadge status={r.status} />
                      <SeverityBadge category={cat} />
                    </div>

                    {problem && (
                      <span className="self-start mb-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-50 border border-slate-200 text-slate-600">
                        {problem.label}
                      </span>
                    )}

                    <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-2">{r.description}</p>

                    <div className="mt-auto pt-3 space-y-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Icons.MapPin />
                        <span className="truncate">{r.barangay}, {r.municipality}</span>
                      </span>
                      {r.project_name && (
                        <span className="flex items-center gap-1">
                          <Icons.Document />
                          <span className="truncate">{r.project_name}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Icons.Clock />
                        {fmtDate(r.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && !error && (
          <p className="text-xs text-slate-400 text-right">
            Showing {filtered.length} of {reports.length} report{reports.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-6 pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selected.status} />
                <SeverityBadge category={resolveCategory(selected)} />
                {resolveSpecificProblem(selected) && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-50 border border-slate-200 text-slate-600">
                    {resolveSpecificProblem(selected).label}
                  </span>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 transition p-1 -mr-1">
                <Icons.X />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {selected?.status === 'resolved' && selectedLguDecision?.decision === 'endorsed' && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold">
                  Endorsed by LGU
                </div>
              )}

              <CitizenReportTimeline
                report={selected}
                resolutionSummary={selectedResolutionSummary}
              />

              <PublicReportRouteMapPanel
                project={selectedProject}
                routeRecord={selectedProjectRoute}
                reportLatitude={selected.latitude}
                reportLongitude={selected.longitude}
                heightClass="h-64"
                title="Project Route Context"
              />

              {/* DA Field Engineer Technical Inspection Findings Card */}
              {selectedFieldFinding && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                      <Icons.ShieldCheck /> DA Field Engineer Technical Inspection
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium">{fmtDate(selectedFieldFinding.submitted_at)}</span>
                  </div>
                  <div className="text-xs space-y-1.5 text-slate-800 pt-1">
                    <p><span className="font-semibold text-slate-600">Observed Condition:</span> {selectedFieldFinding.condition_observed}</p>
                    <p><span className="font-semibold text-slate-600">Recommended Action:</span> {selectedFieldFinding.recommended_action}</p>
                    {selectedFieldFinding.estimated_cost_range && (
                      <p><span className="font-semibold text-slate-600">Estimated Cost:</span> {selectedFieldFinding.estimated_cost_range}</p>
                    )}
                  </div>
                  {selectedFieldFinding.field_photo_url && (
                    <div className="pt-2">
                      <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">On-Site Verified Photo:</p>
                      <img src={selectedFieldFinding.field_photo_url} alt="Field inspection" className="w-full h-32 object-cover rounded-lg border border-slate-300" />
                    </div>
                  )}
                </div>
              )}

              {/* Official DA Action Certificate Button — only once the DA has resolved the issue */}
              {selected.status === 'resolved' ? (
                <button
                  onClick={() => setShowCertModal(true)}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-xs transition-colors"
                >
                  <Icons.Document />
                  <span>View Official DA Action Resolution Certificate</span>
                </button>
              ) : (
                <div className="w-full flex items-center justify-center gap-2 bg-slate-100 text-slate-500 font-semibold py-2.5 px-4 rounded-xl text-xs border border-slate-200">
                  <Icons.Clock />
                  <span>Resolution certificate is issued once the DA settles this road issue</span>
                </div>
              )}

              <div>
                <h3 className="text-base font-semibold text-slate-900 mb-1">Issue Description</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{selected.description}</p>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                {[
                  { label: 'Location', value: `${selected.barangay}, ${selected.municipality}${selected.street ? ` - ${selected.street}` : ''}` },
                  selected.project_name && { label: 'Project', value: selected.project_name },
                  { label: 'Date Reported', value: fmtDate(selected.created_at) },
                  { label: 'Status', value: selected.status?.charAt(0).toUpperCase() + selected.status?.slice(1) },
                  {
                    label: 'Field Engineer Status',
                    value: selected.engineer_status
                      ? selected.engineer_status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
                      : 'Waiting for assignment',
                  },
                  {
                    label: 'Assigned Engineer',
                    value: selected.assigned_engineer_name || 'Not assigned yet',
                  },
                  { label: 'Verification', value: selected.verification },
                  selected.severity_category && {
                    label: 'Severity',
                    value: `${SEVERITY_TAXONOMY[selected.severity_category]?.icon} ${SEVERITY_TAXONOMY[selected.severity_category]?.label}`,
                  },
                  selected.specific_problem && {
                    label: 'Problem',
                    value: SEVERITY_TAXONOMY[selected.severity_category]?.problems
                      .find((p) => p.value === selected.specific_problem)?.label || selected.specific_problem,
                  },
                ].filter(Boolean).map((item) => (
                  <div key={item.label} className="flex items-start gap-3 text-sm">
                    <span className="text-slate-400 w-28 shrink-0 font-medium">{item.label}</span>
                    <span className="text-slate-800">{item.value}</span>
                  </div>
                ))}
              </div>

              {selected.photo_url && (
                <div>
                  <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Attached Photo</p>
                  <img src={selected.photo_url} alt="Report photo" className="w-full rounded-xl border border-slate-200" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {reportStep === 'form' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setReportStep('idle')}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-semibold text-teal-600 uppercase tracking-wider">New Report</p>
                <h3 className="text-lg font-semibold text-slate-900 mt-0.5">Location-Verified Report</h3>
              </div>
              <button onClick={() => setReportStep('idle')} className="text-slate-400 hover:text-slate-700 transition p-1">
                ✕
              </button>
            </div>

            <div className="p-6">
              <PublicReportForm />
            </div>
          </div>
        </div>
      )}

      {showCertModal && selected && (
        <DAResolutionCertificate
          report={selected}
          fieldFinding={selectedFieldFinding}
          resolution={selectedResolution}
          onClose={() => setShowCertModal(false)}
        />
      )}
    </UserLayout>
  );
}

export default UserReports;



