import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

import Icons from '../components/Icons';
import PublicReportForm from '../components/PublicReportForm';
import UserLayout from '../components/UserLayout';
import CitizenReportTimeline from '../components/publicReports/CitizenReportTimeline';
import PublicReportRouteMapPanel from '../components/publicReports/PublicReportRouteMapPanel';
import DAResolutionCertificate from '../components/publicReports/DAResolutionCertificate';
import {
  CITIZEN_STATUS_FILTERS,
  SEVERITY_TAXONOMY,
  getCitizenStatus,
  resolveCategory,
  resolveSpecificProblem,
} from '../lib/publicReportStatus';

/* Status badge — derived from the citizen view's citizen_status so a closed or
 * mid-inspection report is never mislabelled as still pending. */
function StatusBadge({ report }) {
  const status = getCitizenStatus(report);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${status.tone}`}>
      {status.label}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
  const [refreshing, setRefreshing] = useState(false);
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

  /* Citizens read their reports through public_reports_citizen_view, which
   * strips staff-only columns and exposes a ready-made citizen_status. */
  const fetchReports = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Not authenticated');
        return;
      }

      const { data, error: err } = await supabase
        .from('public_reports_citizen_view')
        .select('*')
        .eq('is_current_user_report', true)
        .order('created_at', { ascending: false });

      if (err) {
        console.error('Failed to load citizen reports:', err);
        setError('We could not load your reports right now. Please try again.');
      } else {
        setError(null);
        setReports(data || []);
      }
    } catch (e) {
      console.error('Unexpected error loading citizen reports:', e);
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  /* Postgres realtime is not usable here: citizens have no SELECT policy on
   * public_reports (only on the view), so change events never reach them.
   * Refresh when the tab regains focus instead — that is when a citizen who
   * has been waiting for an update actually comes back to look. */
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') fetchReports({ silent: true });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchReports]);

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
      latest.verification !== selected.verification ||
      latest.citizen_status !== selected.citizen_status
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
            .from('public_report_resolutions_citizen_view')
            .select('*')
            .eq('report_id', selected.id)
            .order('resolved_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('public_report_field_findings_citizen_view')
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
      if (statusFilter !== 'all' && getCitizenStatus(r).key !== statusFilter) return false;
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
      sorted.sort((a, b) => getCitizenStatus(a).order - getCitizenStatus(b).order);
    } else {
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return sorted;
  }, [reports, search, statusFilter, categoryFilter, problemFilter, sortBy]);

  /* Summary tiles answer "where do my reports stand?" — in progress means the
   * report is live somewhere in the workflow, not that nothing has happened. */
  const counts = useMemo(() => {
    const byKey = reports.reduce((acc, r) => {
      const key = getCitizenStatus(r).key;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      total: reports.length,
      submitted: byKey.submitted || 0,
      inProgress:
        (byKey.under_review || 0)
        + (byKey.inspection_scheduled || 0)
        + (byKey.under_verification || 0),
      resolved: byKey.resolved || 0,
      closed: byKey.closed || 0,
    };
  }, [reports]);

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <section>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Reports</h1>
            <p className="mt-1 text-slate-500">Track the status of your submitted reports</p>
          </section>
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => fetchReports({ silent: true })}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 disabled:opacity-50 transition text-sm"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={() => setReportStep('form')}
            className="inline-flex items-center gap-2 bg-teal-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-teal-700 transition text-sm shrink-0 self-start sm:self-auto"
          >
            <Icons.Plus />
            Submit New Report
          </button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: 'all', label: 'Total Reports', value: counts.total, color: 'bg-slate-100 text-slate-600' },
            { key: 'submitted', label: 'Awaiting Review', value: counts.submitted, color: 'bg-amber-100 text-amber-600' },
            { key: 'in_progress', label: 'In Progress', value: counts.inProgress, color: 'bg-sky-100 text-sky-600' },
            { key: 'resolved', label: 'Resolved', value: counts.resolved, color: 'bg-emerald-100 text-teal-600' },
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
                {CITIZEN_STATUS_FILTERS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
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
                      <StatusBadge report={r} />
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
                <StatusBadge report={selected} />
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
              {/* 1. Where the report stands right now */}
              <CitizenReportTimeline
                report={selected}
                finding={selectedFieldFinding}
                resolution={selectedResolution}
                resolutionSummary={selectedResolutionSummary}
              />

              {/* 2. What the citizen actually reported — their own words first */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Your Report</h3>

                <p className="text-sm text-slate-700 leading-relaxed">{selected.description}</p>

                <dl className="bg-slate-50 rounded-xl p-4 space-y-3">
                  {[
                    { label: 'Location', value: `${selected.barangay}, ${selected.municipality}${selected.street ? ` - ${selected.street}` : ''}` },
                    selected.project_name && { label: 'Project', value: selected.project_name },
                    { label: 'Date Reported', value: fmtDate(selected.created_at) },
                    selected.severity_category && {
                      label: 'Issue Type',
                      value: `${SEVERITY_TAXONOMY[selected.severity_category]?.icon} ${SEVERITY_TAXONOMY[selected.severity_category]?.label}`,
                    },
                    selected.specific_problem && {
                      label: 'Problem',
                      value: SEVERITY_TAXONOMY[selected.severity_category]?.problems
                        .find((p) => p.value === selected.specific_problem)?.label || selected.specific_problem,
                    },
                    selected.verification && { label: 'Location Check', value: selected.verification },
                  ].filter(Boolean).map((item) => (
                    <div key={item.label} className="flex items-start gap-3 text-sm">
                      <dt className="text-slate-500 w-28 shrink-0 font-medium">{item.label}</dt>
                      <dd className="text-slate-800 min-w-0">{item.value}</dd>
                    </div>
                  ))}
                </dl>

                {selected.photo_url && (
                  <figure className="space-y-1.5">
                    <figcaption className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                      Photo you submitted
                    </figcaption>
                    <img src={selected.photo_url} alt="The site condition you reported" className="w-full rounded-xl border border-slate-200" />
                  </figure>
                )}
              </section>

              {/* 3. Where it is on the map */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Location &amp; Project Route</h3>
                <PublicReportRouteMapPanel
                  project={selectedProject}
                  routeRecord={selectedProjectRoute}
                  reportLatitude={selected.latitude}
                  reportLongitude={selected.longitude}
                  heightClass="h-64"
                  title={null}
                />
              </section>

              {/* 4. The official inspection — deliberately kept visually distinct
                   from the citizen's own account above. The citizen view only
                   exposes submitted/validated findings, never drafts. */}
              {selectedFieldFinding && (
                <section className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-emerald-900 flex items-center gap-1.5">
                      <Icons.ShieldCheck /> Official Field Inspection
                    </h3>
                    {selectedFieldFinding.submitted_at && (
                      <span className="text-xs text-emerald-800 font-medium">
                        {fmtDate(selectedFieldFinding.submitted_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-emerald-800">
                    Conducted on site by a government field engineer.
                    {selectedFieldFinding.validated_at
                      ? ' These findings have been verified.'
                      : ' These findings are awaiting verification.'}
                  </p>

                  <dl className="text-sm space-y-2 text-slate-800">
                    <div>
                      <dt className="text-xs font-semibold text-slate-600">Condition Observed</dt>
                      <dd className="mt-0.5">{selectedFieldFinding.condition_observed}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-600">Recommended Action</dt>
                      <dd className="mt-0.5">{selectedFieldFinding.recommended_action}</dd>
                    </div>
                    {selectedFieldFinding.estimated_cost_range && (
                      <div>
                        <dt className="text-xs font-semibold text-slate-600">Estimated Cost</dt>
                        <dd className="mt-0.5">{selectedFieldFinding.estimated_cost_range}</dd>
                      </div>
                    )}
                  </dl>

                  {selectedFieldFinding.field_photo_url && (
                    <figure className="space-y-1.5">
                      <figcaption className="text-xs text-slate-600 font-semibold">
                        Engineer&rsquo;s on-site photo
                      </figcaption>
                      <img src={selectedFieldFinding.field_photo_url} alt="Photo taken during the official field inspection" className="w-full h-40 object-cover rounded-lg border border-emerald-200" />
                    </figure>
                  )}
                </section>
              )}

              {/* 5. Final outcome — the certificate button appears only once
                   there is something to certify. */}
              {selected.status === 'resolved' && (
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">Outcome</h3>
                  {selectedLguDecision?.decision === 'endorsed' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold">
                      Endorsed by LGU
                    </span>
                  )}
                  <button
                    onClick={() => setShowCertModal(true)}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-2.5 px-4 rounded-xl text-sm transition-colors"
                  >
                    <Icons.Document />
                    <span>View Resolution Certificate</span>
                  </button>
                </section>
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



