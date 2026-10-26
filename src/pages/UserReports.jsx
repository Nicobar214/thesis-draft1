import { XIcon, RefreshCwIcon, HardHatIcon } from 'lucide-react';
import SeverityIcon from '../components/SeverityIcon';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle';
import Pagination, { usePagination } from '../components/ui/Pagination';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getCurrentUser, withOfflineCache, isConnectionError } from '../lib/offlineCache';
import { notify } from '../lib/toast';
import { MODAL_OVERLAY, MODAL_PANEL_SCROLL, ModalEffects } from '../components/ui/Modal';
import { buttonClass } from '../components/ui/Button';

import Icons from '../components/Icons';
import HierarchyKpis from '../components/ui/HierarchyKpis';
import PublicReportForm from '../components/PublicReportForm';
import UserLayout from '../components/UserLayout';
import CitizenReportTimeline from '../components/publicReports/CitizenReportTimeline';
import useReportResponders from '../lib/useReportResponders';
import PhotoLightbox from '../components/ui/PhotoLightbox';
import PublicReportRouteMapPanel from '../components/publicReports/PublicReportRouteMapPanel';
import DAResolutionCertificate from '../components/publicReports/DAResolutionCertificate';
import FixConfirmationCard, { FIX_CONFIRMATION_ENABLED } from '../components/publicReports/FixConfirmationCard';
import {
  CITIZEN_STATUS_FILTERS,
  SEVERITY_TAXONOMY,
  getCitizenStatus,
  resolveCategory,
  resolveSpecificProblem,
  repairCitizenLine,
  repairStatusInfo,
  handlerFor,
  handlerLabel,
  resolutionTypeLabel,
  resolutionTypeMeaning,
  responsiblePartyLabel,
  siteRatingLabel,
} from '../lib/publicReportStatus';

/* Status badge — derived from the citizen view's citizen_status so a closed or
 * mid-inspection report is never mislabelled as still pending. */
const IN_PROGRESS_KEYS = ['under_review', 'inspection_scheduled', 'under_verification'];

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
      <SeverityIcon category={category} /> {meta.label}
    </span>
  );
}

/* Inside another portal (the farmer's My Reports): no citizen layout, the
 * header buttons sit above the list, and "new report" can open that portal's
 * own report form. */
function EmbeddedShell({ headerActions, children }) {
  return (
    <>
      {headerActions && <div className="mb-4 flex items-center justify-end gap-2">{headerActions}</div>}
      {children}
    </>
  );
}

function UserReports({ client = supabase, embedded = false, onNewReport = null }) {
  const Shell = embedded ? EmbeddedShell : UserLayout;
  const startNewReport = () => (onNewReport ? onNewReport() : setReportStep('form'));
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useViewMode('userReports.viewMode');
  const [selected, setSelected] = useState(null);
  const [selectedResolutionSummary, setSelectedResolutionSummary] = useState('');
  const [selectedResolution, setSelectedResolution] = useState(null);
  const [selectedFieldFinding, setSelectedFieldFinding] = useState(null);
  const [selectedLguDecision, setSelectedLguDecision] = useState(null);
  const [selectedRepair, setSelectedRepair] = useState(null);
  // Names of the engineer and the contractor/LGU, for the open report.
  const responders = useReportResponders(client, selected?.id);
  // Full-size photo viewer: { reportId, photos, index }. Tied to the report so
  // it never reopens on another one.
  const [viewer, setViewer] = useState(null);
  const openPhotos = (photos, index = 0) => setViewer({ reportId: selected?.id, photos, index });
  const viewerOpen = Boolean(viewer && viewer.reportId === selected?.id);
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
      startNewReport();
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar links arrive as /user/reports?status=<key>; apply it as the filter.
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    const valid = status === 'in_progress' || CITIZEN_STATUS_FILTERS.some((o) => o.value === status);
    if (valid) setStatusFilter(status);
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // /user/reports?report=<id> (from Community Feedback) opens that report once the list has loaded.
  useEffect(() => {
    const id = searchParams.get('report');
    if (!id || reports.length === 0) return;
    const row = reports.find((r) => String(r.id) === id);
    if (row) setSelected(row);
    else notify('That report is no longer available.', 'warning');
    const next = new URLSearchParams(searchParams);
    next.delete('report');
    setSearchParams(next, { replace: true });
  }, [searchParams, reports, setSearchParams]);

  /* Citizens read their reports through public_reports_citizen_view, which
   * strips staff-only columns and exposes a ready-made citizen_status. */
  const fetchReports = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const { user } = await getCurrentUser(client);
      if (!user) {
        setError('Not authenticated');
        return;
      }

      // The last list is kept on this device, so reports still open offline.
      const { data, error: err } = await withOfflineCache(`citizen:${user.id}:reports`, () => client
        .from('public_reports_citizen_view')
        .select('*')
        .eq('is_current_user_report', true)
        .order('created_at', { ascending: false }));

      if (err) {
        console.error('Failed to load citizen reports:', err);
        setError(isConnectionError(err)
          ? "You're offline and your reports haven't been saved on this phone yet. Open this page once with signal to keep a copy."
          : 'We could not load your reports right now. Please try again.');
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
  }, [client]);

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
    const onOnline = () => fetchReports({ silent: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('online', onOnline);
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
          setSelectedRepair(null);
          setSelectedProject(null);
          setSelectedProjectRoute(null);
        }
        return;
      }

      try {
        const [resolutionRes, findingRes, lguDecisionRes, repairRes] = await Promise.all([
          // Each part is kept on this device so an opened report reads offline too.
          withOfflineCache(`citizen:report:${selected.id}:resolution`, () => client
            .from('public_report_resolutions_citizen_view')
            .select('*')
            .eq('report_id', selected.id)
            .order('resolved_at', { ascending: false })
            .limit(1)
            .maybeSingle()),
          withOfflineCache(`citizen:report:${selected.id}:finding`, () => client
            .from('public_report_field_findings_citizen_view')
            .select('*')
            .eq('report_id', selected.id)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle()),
          withOfflineCache(`citizen:report:${selected.id}:lgu`, () => client
            .from('public_report_lgu_decisions')
            .select('decision, remarks, created_at')
            .eq('report_id', selected.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()),
          // Citizen-safe view: what is happening and when, never notes or who.
          // A deployment without repair tracking simply returns an error here,
          // which is ignored below.
          withOfflineCache(`citizen:report:${selected.id}:repair`, () => client
            .from('public_report_repair_actions_citizen_view')
            .select('*')
            .eq('report_id', selected.id)
            .maybeSingle()),
        ]);

        if (!alive) return;

        // project_id on public_reports is sometimes stored as a prefixed
        // string (e.g. "fmr-<uuid>") rather than the raw fmr_projects.id, so
        // a direct id match can miss — always fall back to matching by name.
        let projectRow = null;
        if (selected.project_id) {
          const { data } = await withOfflineCache(`citizen:report:${selected.id}:project-id`, () => client.from('fmr_projects').select('*').eq('id', selected.project_id).maybeSingle());
          projectRow = data || null;
        }
        if (!projectRow && selected.project_name) {
          const { data } = await withOfflineCache(`citizen:report:${selected.id}:project-name`, () => client.from('fmr_projects').select('*').ilike('project_name', String(selected.project_name)).limit(1).maybeSingle());
          projectRow = data || null;
        }
        if (!alive) return;

        setSelectedResolution(resolutionRes?.data || null);
        setSelectedResolutionSummary(resolutionRes?.data?.summary || '');
        setSelectedFieldFinding(findingRes?.data || null);
        setSelectedLguDecision(lguDecisionRes?.data || null);
        setSelectedRepair(repairRes?.error ? null : repairRes?.data || null);
        setSelectedProject(projectRow);

        if (projectRow?.id) {
          const { data: routeRow } = await withOfflineCache(`citizen:route:${projectRow.id}`, () => client
            .from('project_routes')
            .select('*')
            .eq('project_id', projectRow.id)
            .maybeSingle());
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
        setSelectedRepair(null);
        setSelectedProject(null);
        setSelectedProjectRoute(null);
      }
    };

    loadSelectedContext();

    return () => {
      alive = false;
    };
  }, [selected, client]);

  /* â”€â”€ Filter + Sort â”€â”€ */
  const filtered = useMemo(() => {
    const result = reports.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.description} ${r.municipality} ${r.barangay} ${r.street} ${r.project_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter === 'in_progress') {
        if (!IN_PROGRESS_KEYS.includes(getCitizenStatus(r).key)) return false;
      } else if (statusFilter !== 'all' && getCitizenStatus(r).key !== statusFilter) return false;
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

  const pager = usePagination(filtered, [search, statusFilter, categoryFilter, problemFilter, sortBy].join('|'));

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
    <Shell
      headerActions={(
        <>
          <button
            type="button"
            onClick={() => fetchReports({ silent: true })}
            disabled={refreshing || loading}
            title="Refresh"
            aria-label="Refresh reports"
            className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
          >
            <RefreshCwIcon className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={startNewReport}
            data-tour="reports-new"
            aria-label="Submit new report"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-3 sm:px-4 text-sm font-semibold text-white hover:bg-teal-700 transition"
          >
            <Icons.Plus />
            <span className="hidden sm:inline">Submit New Report</span>
          </button>
        </>
      )}
    >
      <div className="space-y-6">
        {/* Same KPI hierarchy as the admin pages. The smaller cards still
            filter the list; tapping the selected one again shows all. */}
        <div data-tour="reports-stats">
          <HierarchyKpis
            ariaLabel="Report summary"
            lead={{
              label: 'Total Reports',
              value: counts.total.toLocaleString(),
              note: counts.total === 0
                ? 'You have not sent any reports yet'
                : <><span className="font-semibold text-emerald-700">{Math.round((counts.resolved / counts.total) * 100)}% resolved</span> of the reports you sent</>,
              icon: <Icons.Document />,
              segments: [
                { label: 'Resolved', value: counts.resolved, bar: 'bg-emerald-500' },
                { label: 'In progress', value: counts.inProgress, bar: 'bg-sky-500' },
                { label: 'Awaiting review', value: counts.submitted, bar: 'bg-amber-500' },
                { label: 'Closed', value: counts.closed, bar: 'bg-slate-400' },
              ],
            }}
            items={[
              { key: 'submitted', icon: <Icons.Clock />, label: 'Awaiting Review', value: counts.submitted, hint: 'Sent, not yet reviewed', chip: 'bg-amber-50 text-amber-600' },
              { key: 'in_progress', icon: <Icons.Search />, label: 'In Progress', value: counts.inProgress, hint: 'Being reviewed or inspected', chip: 'bg-sky-50 text-sky-600' },
              { key: 'resolved', icon: <Icons.CheckCircle />, label: 'Resolved', value: counts.resolved, hint: 'Fixed or acted on', chip: 'bg-emerald-50 text-emerald-600' },
              { key: 'closed', icon: <Icons.X />, label: 'Closed', value: counts.closed, hint: 'Closed without action', chip: 'bg-slate-100 text-slate-600' },
            ].map(({ key, ...item }) => ({
              ...item,
              value: item.value.toLocaleString(),
              active: statusFilter === key,
              onClick: () => setStatusFilter(statusFilter === key ? 'all' : key),
            }))}
          />
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-4" data-tour="reports-filters">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"><Icons.Search /></span>
              <input
                type="text"
                aria-label="Search my reports"
                placeholder="Search by description or location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition"
              />
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"><Icons.Filter /></span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="appearance-none pl-11 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition cursor-pointer"
              >
                {[...CITIZEN_STATUS_FILTERS.slice(0, 2), { value: 'in_progress', label: 'In Progress (all stages)' }, ...CITIZEN_STATUS_FILTERS.slice(2)].map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"><Icons.ChevronDown /></span>
            </div>
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort reports"
                className="appearance-none pl-4 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition cursor-pointer"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="status">By Status</option>
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"><Icons.ChevronDown /></span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-500 font-medium w-24 shrink-0 flex items-center">
              Filter by type
            </span>
            <div className="relative flex-1">
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setProblemFilter('all'); }}
                aria-label="Filter by issue type"
                className="appearance-none w-full px-4 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition cursor-pointer"
              >
                <option value="all">All Severity Types</option>
                {Object.entries(SEVERITY_TAXONOMY).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
            </div>
            {categoryFilter !== 'all' && (
              <div className="relative flex-1">
                <select
                  value={problemFilter}
                  onChange={(e) => setProblemFilter(e.target.value)}
                  aria-label="Filter by specific problem"
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
                className="shrink-0 text-xs text-slate-500 hover:text-red-500 transition font-medium px-2"
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
                <SeverityIcon category={categoryFilter} /> {SEVERITY_TAXONOMY[categoryFilter]?.label}
                <button onClick={() => { setCategoryFilter('all'); setProblemFilter('all'); }} aria-label="Remove issue type filter" className="ml-1 hover:opacity-70">×</button>
              </span>
            )}
            {problemFilter !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-teal-50 text-teal-700 border-teal-200">
                {SEVERITY_TAXONOMY[categoryFilter]?.problems.find((p) => p.value === problemFilter)?.label}
                <button onClick={() => setProblemFilter('all')} aria-label="Remove problem filter" className="ml-1 hover:opacity-70">×</button>
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
            <div className="mx-auto size-14 bg-slate-100 rounded-xl grid place-items-center text-slate-500 mb-3">
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
          <div className="flex justify-end" data-tour="reports-view">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        )}

        {!loading && filtered.length > 0 && viewMode === 'table' && (
          <div className="bg-white rounded-2xl border border-slate-200/60 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pager.pageItems.map((r) => {
                  const cat = resolveCategory(r);
                  const problem = resolveSpecificProblem(r);
                  return (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      onClick={() => setSelected(r)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r); } }}
                      className="cursor-pointer hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50"
                    >
                      <td className="px-4 py-3 align-top whitespace-nowrap"><StatusBadge report={r} /></td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col items-start gap-1">
                          <SeverityBadge category={cat} />
                          {problem && <span className="text-[11px] text-slate-500">{problem.label}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top max-w-xs"><p className="line-clamp-2 text-slate-900">{r.description}</p></td>
                      <td className="px-4 py-3 align-top text-slate-600">{[r.barangay, r.municipality].filter(Boolean).join(', ')}</td>
                      <td className="px-4 py-3 align-top text-slate-600">{r.project_name || '—'}</td>
                      <td className="px-4 py-3 align-top text-slate-500 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && viewMode === 'cards' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pager.pageItems.map((r) => {
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

        {!loading && !error && reports.length > 0 && <Pagination pager={pager} noun="report" />}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className={MODAL_OVERLAY} onClick={() => setSelected(null)}>
          {/* Esc is already handled by this page (it closes the top-most layer). */}
          <ModalEffects onClose={() => setSelected(null)} closeOnEscape={false} />
          <div
            className={`${MODAL_PANEL_SCROLL} max-w-lg`}
            role="dialog"
            aria-modal="true"
            aria-label="Report details"
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
              <button onClick={() => setSelected(null)} aria-label="Close dialog" className="-mr-1 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
                <Icons.X />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* 1. Where the report stands right now */}
              <CitizenReportTimeline
                client={client}
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
                    { label: 'Issue Type', value: SEVERITY_TAXONOMY[resolveCategory(selected)]?.label },
                    selected.specific_problem && {
                      label: 'Problem',
                      value: resolveSpecificProblem(selected)?.label || selected.specific_problem,
                    },
                    { label: 'Handled by', value: `${handlerLabel(handlerFor(selected))} (after the DA check)` },
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
                    <button
                      type="button"
                      onClick={() => openPhotos([{ src: selected.photo_url, label: 'Photo you submitted' }])}
                      className="group relative block w-full overflow-hidden rounded-xl"
                      aria-label="View the photo you submitted full size"
                    >
                      <img src={selected.photo_url} alt="The site condition you reported" className="w-full rounded-xl border border-slate-200 transition group-hover:opacity-95" />
                      <span className="absolute bottom-2 right-2 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">Tap to view</span>
                    </button>
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
                  {responders?.engineer_name && (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-900">
                      <HardHatIcon className="size-4 shrink-0" aria-hidden="true" />
                      Inspected by <strong>{responders.engineer_name}</strong>, DA field engineer
                    </p>
                  )}
                  <p className="text-xs text-emerald-800">
                    Conducted on site by a government field engineer.
                    {selectedFieldFinding.validated_at
                      ? ' These findings have been verified.'
                      : ' These findings are awaiting verification.'}
                  </p>

                  <dl className="text-sm space-y-2 text-slate-800">
                    {siteRatingLabel(selectedFieldFinding.site_rating) && (
                      <div>
                        <dt className="text-xs font-semibold text-slate-600">Road Condition Rating</dt>
                        <dd className="mt-0.5">
                          {siteRatingLabel(selectedFieldFinding.site_rating)}
                          <span className="text-slate-500"> ({selectedFieldFinding.site_rating} of 5)</span>
                        </dd>
                      </div>
                    )}
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
                        <dt className="text-xs font-semibold text-slate-600">Engineer&rsquo;s estimated repair cost</dt>
                        <dd className="mt-0.5">{selectedFieldFinding.estimated_cost_range} <span className="text-xs text-slate-400">(estimate only, not a payment)</span></dd>
                      </div>
                    )}
                  </dl>

                  {selectedFieldFinding.field_photo_url && (
                    <figure className="space-y-1.5">
                      <figcaption className="text-xs text-slate-600 font-semibold">
                        Engineer&rsquo;s on-site photo
                      </figcaption>
                      <button
                        type="button"
                        onClick={() => openPhotos([{ src: selectedFieldFinding.field_photo_url, label: 'Engineer’s on-site photo' }])}
                        className="group relative block w-full overflow-hidden rounded-lg"
                        aria-label="View the engineer's on-site photo full size"
                      >
                        <img src={selectedFieldFinding.field_photo_url} alt="Photo taken during the official field inspection" className="w-full h-40 object-cover rounded-lg border border-emerald-200 transition group-hover:scale-105" />
                        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">Tap to view</span>
                      </button>
                    </figure>
                  )}
                </section>
              )}

              {/* 5. The repair / work by the contractor or LGU, which now happens
                   before the report is resolved. */}
              {selectedRepair && repairStatusInfo(selectedRepair.status) && (
                <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {/* LGU jobs (clearing, signs) are work, not repairs. */}
                      {selectedRepair.kind === 'monitoring' ? 'Monitoring' : selectedRepair.responsible_party === 'lgu' ? 'Work' : 'Repair'} progress
                    </h3>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${repairStatusInfo(selectedRepair.status).tone}`}>
                      {repairStatusInfo(selectedRepair.status).staff}
                    </span>
                  </div>

                  <p className="text-sm text-slate-700">{repairCitizenLine(selectedRepair)}</p>

                  <dl className="space-y-1.5 text-sm">
                    {responsiblePartyLabel(selectedRepair.responsible_party) && (
                      <div className="flex gap-3">
                        <dt className="w-28 shrink-0 font-medium text-slate-500">Handled by</dt>
                        <dd className="font-semibold text-slate-900">
                          {responders?.handler_name || responsiblePartyLabel(selectedRepair.responsible_party)}
                        </dd>
                      </div>
                    )}
                    {selectedRepair.target_date && selectedRepair.status === 'planned' && (
                      <div className="flex gap-3">
                        <dt className="w-28 shrink-0 font-medium text-slate-500">Target date</dt>
                        <dd className="text-slate-800">{fmtDate(selectedRepair.target_date)}</dd>
                      </div>
                    )}
                    {selectedRepair.completed_at && (
                      <div className="flex gap-3">
                        <dt className="w-28 shrink-0 font-medium text-slate-500">Recorded done</dt>
                        <dd className="text-slate-800">{fmtDate(selectedRepair.completed_at)}</dd>
                      </div>
                    )}
                    {selectedRepair.verified_at && (
                      <div className="flex gap-3">
                        <dt className="w-28 shrink-0 font-medium text-slate-500">Confirmed</dt>
                        <dd className="text-slate-800">{fmtDate(selectedRepair.verified_at)}</dd>
                      </div>
                    )}
                  </dl>

                  {/* Before / after: tap either photo to view it full size and flip
                      between the two. The after-photo shows as soon as it is sent. */}
                  {(() => {
                    const after = selectedRepair.verification_photo_url || selectedRepair.work_photo_url;
                    if (!after || !selected.photo_url) return null;
                    const who = selectedRepair.responsible_party === 'lgu' ? 'LGU' : 'contractor';
                    const photos = [
                      { src: selected.photo_url, label: 'Before (your photo)' },
                      { src: after, label: `After (${who} photo on site)` },
                    ];
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          {photos.map((p, i) => (
                            <button
                              key={p.src}
                              type="button"
                              onClick={() => openPhotos(photos, i)}
                              className="group space-y-1 text-left"
                              aria-label={`View ${p.label} full size`}
                            >
                              <span className={`block text-xs font-semibold ${i === 0 ? 'text-slate-600' : 'text-emerald-800'}`}>{p.label}</span>
                              <span className="relative block overflow-hidden rounded-lg">
                                <img
                                  src={p.src}
                                  alt={i === 0 ? 'The condition you reported' : 'The same location after the work'}
                                  className={`h-32 w-full rounded-lg border object-cover transition group-hover:scale-105 ${i === 0 ? 'border-slate-200' : 'border-emerald-200'}`}
                                />
                                <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">Tap to view</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </section>
              )}

              {viewerOpen && (
                <PhotoLightbox
                  photos={viewer.photos}
                  index={viewer.index}
                  onIndex={(i) => setViewer((v) => ({ ...v, index: i }))}
                  onClose={() => setViewer(null)}
                />
              )}

              {/* 6. Final outcome after the work, then the reporter's own check
                   ("Is it actually fixed?") as the last word. */}
              {selected.status === 'resolved' && (
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">Outcome</h3>

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {resolutionTypeLabel(selectedResolution?.resolution_type) && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-700 text-white text-xs font-semibold">
                          {resolutionTypeLabel(selectedResolution.resolution_type)}
                        </span>
                      )}
                      {selectedLguDecision?.decision === 'endorsed' && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold">
                          Endorsed by LGU
                        </span>
                      )}
                      {selectedResolution?.resolved_at && (
                        <span className="text-xs text-emerald-800">
                          {fmtDate(selectedResolution.resolved_at)}
                        </span>
                      )}
                    </div>
                    {resolutionTypeMeaning(selectedResolution?.resolution_type) && (
                      <p className="text-sm font-medium text-emerald-950">
                        {resolutionTypeMeaning(selectedResolution.resolution_type)}
                      </p>
                    )}
                    {selectedResolutionSummary && (
                      <p className="text-sm text-emerald-900">
                        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                          Staff note{' '}
                        </span>
                        {selectedResolutionSummary}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => setShowCertModal(true)}
                    className={buttonClass('primary', 'md', 'w-full')}
                  >
                    <Icons.Document />
                    <span>View Resolution Certificate</span>
                  </button>

                  {FIX_CONFIRMATION_ENABLED && <FixConfirmationCard key={selected.id} reportId={selected.id} client={client} />}
                </section>
              )}
            </div>
          </div>
        </div>
      )}
      {reportStep === 'form' && (
        <div
          className={MODAL_OVERLAY}
          onClick={() => setReportStep('idle')}
        >
          <ModalEffects onClose={() => setReportStep('idle')} closeOnEscape={false} />
          <div
            className={`${MODAL_PANEL_SCROLL} max-w-2xl`}
            role="dialog"
            aria-modal="true"
            aria-label="New location-verified report"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-semibold text-teal-600 uppercase tracking-wider">New Report</p>
                <h3 className="text-lg font-semibold text-slate-900 mt-0.5">Location-Verified Report</h3>
              </div>
              <button onClick={() => setReportStep('idle')} aria-label="Close dialog" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
                <XIcon className="size-4" aria-hidden="true" />
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
    </Shell>
  );
}

export default UserReports;



