/* ContractorProjects.jsx – Table of fmr_projects assigned to this contractor
 * Each row shows status, physical accomplishment, funds released and the latest
 * submission. Clicking a row opens the full project detail (description,
 * schedule, submission history); the Submit Update action stays inline.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2Icon, ClipboardListIcon, ClockIcon, GaugeIcon, HardHatIcon } from 'lucide-react';
import HierarchyKpis from '../components/ui/HierarchyKpis';
import FilterToolbar from '../components/ui/FilterToolbar';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import ContractorProgressForm from './ContractorProgressForm';
import ContractorProjectDetailModal from '../components/contractor/ContractorProjectDetailModal';
import ProgressSubmissionHistory from '../components/contractor/ProgressSubmissionHistory';
import { getProjectBudgetSummary, formatPeso } from '../lib/budgetEstimate';
import { getPaginationRange } from '../lib/paginationUtils';
import { getWorkflowMeta } from '../lib/progressWorkflow';
import { formatPercentage } from '../lib/percentageFormat';
import { HALTED_STATUS_STYLES, haltedStatusLabel, isHaltedStatus } from '../lib/delayCases';

const ROWS_PER_PAGE = 10;

const thClass = 'px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500';

const fmtShortDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── FMR status badge ─────────────────────────────────────────
function normalizeFmrStatus(status) {
  const halted = haltedStatusLabel(status);
  if (halted) return halted;
  const s = (status || '').toLowerCase();
  if (s.includes('complet')) return 'Completed';
  if (s.includes('going') || s.includes('ongoing')) return 'On-Going';
  return 'Proposed';
}

const FMR_STATUS_BADGE_CLASS = {
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'On-Going': 'bg-amber-50 text-amber-700 border-amber-200',
  Proposed: 'bg-sky-50 text-sky-700 border-sky-200',
  Suspended: HALTED_STATUS_STYLES.Suspended.border,
  Terminated: HALTED_STATUS_STYLES.Terminated.border,
};

function FmrStatusBadge({ status }) {
  const label = normalizeFmrStatus(status);
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${FMR_STATUS_BADGE_CLASS[label]}`}>
      {label}
    </span>
  );
}


function WorkPlanStatusBadge({ status }) {
  const normalized = status || 'none';
  const styles = {
    none: 'bg-slate-50 text-slate-600 border-slate-200',
    draft: 'bg-amber-50 text-amber-700 border-amber-200',
    finalized: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const labels = { none: 'No Plan', draft: 'Draft', finalized: 'Finalized' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${styles[normalized] || styles.none}`}>
      {labels[normalized] || 'No Plan'}
    </span>
  );
}

/* Past its target date and not finished. */
function isOverdueProject(project) {
  if (normalizeFmrStatus(project.status) === 'Completed' || isHaltedStatus(project.status) || !project.target_completion_date) return false;
  const target = new Date(`${String(project.target_completion_date).slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !Number.isNaN(target.getTime()) && target < today;
}

export default function ContractorProjects() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [latestUpdates, setLatestUpdates] = useState({}); // { [fmr_project_id]: update }
  const [tranchesByProjectId, setTranchesByProjectId] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState(null); // project for the progress form
  const [detailProject, setDetailProject] = useState(null);     // project for the detail modal
  // ?project=<id> (e.g. from a citizen report) opens that project's details.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedProjectId = searchParams.get('project');
  const shownProject = detailProject
    || (linkedProjectId ? projects.find((p) => String(p.id) === String(linkedProjectId)) || null : null);
  const closeDetail = () => {
    setDetailProject(null);
    if (linkedProjectId) {
      const next = new URLSearchParams(searchParams);
      next.delete('project');
      setSearchParams(next, { replace: true });
    }
  };
  const [successMessage, setSuccessMessage] = useState('');
  const [page, setPage] = useState(1);
  // ?status=Overdue (e.g. from the dashboard) starts the list on that status.
  const [statusFilter, setStatusFilter] = useState(() => {
    const fromLink = searchParams.get('status');
    return ['On-Going', 'Completed', 'Proposed', 'Overdue'].includes(fromLink) ? fromLink : 'All';
  });
  const [search, setSearch] = useState('');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [workPlanFilter, setWorkPlanFilter] = useState('All');
  const [engineerFilter, setEngineerFilter] = useState('All');
  const [sortBy, setSortBy] = useState('name');

  // ── Auth ─────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { navigate('/contractor/login'); return; }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
      if (prof?.role !== 'contractor') { navigate('/contractor/login'); return; }
      setUser(u);
    };
    check();
  }, [navigate]);

  // ── Fetch projects + latest update per project ───────────────
  const fetchData = useCallback(async (showSpinner = true) => {
    if (!user) return;
    if (showSpinner) setLoading(true);
    try {
      const { data: projs, error } = await supabase
        .from('fmr_projects')
        .select('id, project_name, municipality, province, location, status, accomplishment, project_length_km, total_budget, funds_released, funding_source, contract_amount, remarks, year_funded, date_started, target_completion_date, date_completed, work_plan_status, work_plan_adoption_baseline, site_engineer_id')
        .eq('contractor_id', user.id)
        .order('project_name', { ascending: true });
      if (error) throw error;
      setProjects(projs || []);

      if (projs && projs.length > 0) {
        const ids = projs.map((p) => p.id);
        const { data: updates } = await supabase
          .from('progress_updates')
          .select('id, fmr_project_id, status, reported_accomplishment, certified_accomplishment, certification_status, submitted_at')
          .eq('contractor_id', user.id)
          .in('fmr_project_id', ids)
          .order('submitted_at', { ascending: false });
        // Keep only the most recent per project
        const map = {};
        for (const upd of updates || []) {
          if (!map[upd.fmr_project_id]) map[upd.fmr_project_id] = upd;
        }
        setLatestUpdates(map);

        const { data: tranches } = await supabase
          .from('project_tranches')
          .select('*')
          .in('project_id', ids)
          .order('tranche_order', { ascending: true });
        const tMap = {};
        (tranches || []).forEach((t) => {
          if (!tMap[t.project_id]) tMap[t.project_id] = [];
          tMap[t.project_id].push(t);
        });
        setTranchesByProjectId(tMap);
      } else {
        setLatestUpdates({});
        setTranchesByProjectId({});
      }
    } catch (err) {
      console.error('ContractorProjects fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData(true);
      const updatesChannel = supabase
        .channel('contractor-projects-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_updates' }, () => fetchData(false))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, () => fetchData(false))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tranches' }, () => fetchData(false))
        .subscribe();

      return () => {
        supabase.removeChannel(updatesChannel);
      };
    }
  }, [user, fetchData]);

  const statusCounts = useMemo(() => {
    const counts = { All: projects.length, Overdue: 0 };
    projects.forEach((p) => {
      const status = normalizeFmrStatus(p.status);
      counts[status] = (counts[status] || 0) + 1;
      if (isOverdueProject(p)) counts.Overdue += 1;
    });
    return counts;
  }, [projects]);

  const municipalityOptions = useMemo(
    () => [...new Set(projects.map((p) => p.municipality).filter(Boolean))].sort(),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (statusFilter === 'Overdue') {
        if (!isOverdueProject(p)) return false;
      } else if (statusFilter !== 'All' && normalizeFmrStatus(p.status) !== statusFilter) return false;
      if (municipalityFilter !== 'All' && p.municipality !== municipalityFilter) return false;
      if (workPlanFilter !== 'All' && (p.work_plan_status || 'none') !== workPlanFilter) return false;
      if (engineerFilter === 'assigned' && !p.site_engineer_id) return false;
      if (engineerFilter === 'none' && p.site_engineer_id) return false;
      if (q && !`${p.project_name || ''} ${p.municipality || ''} ${p.location || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const targetTime = (p) => {
      const t = p.target_completion_date ? new Date(p.target_completion_date).getTime() : NaN;
      return Number.isFinite(t) ? t : Infinity;
    };
    const sorters = {
      name: (a, b) => String(a.project_name || '').localeCompare(String(b.project_name || '')),
      'progress-asc': (a, b) => Number(a.accomplishment || 0) - Number(b.accomplishment || 0),
      'progress-desc': (a, b) => Number(b.accomplishment || 0) - Number(a.accomplishment || 0),
      deadline: (a, b) => targetTime(a) - targetTime(b),
    };
    return [...list].sort(sorters[sortBy] || sorters.name);
  }, [projects, statusFilter, municipalityFilter, workPlanFilter, engineerFilter, search, sortBy]);

  // Any filter change starts the table again from page 1.
  useEffect(() => { setPage(1); }, [search, municipalityFilter, workPlanFilter, engineerFilter, sortBy]);

  const clearProjectFilters = () => {
    setStatusFilter('All');
    setSearch('');
    setMunicipalityFilter('All');
    setWorkPlanFilter('All');
    setEngineerFilter('All');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginatedProjects = useMemo(
    () => filteredProjects.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE),
    [filteredProjects, safePage]
  );

  const handleStatusFilterChange = (next) => {
    setStatusFilter(next);
    setPage(1);
  };

  const handleFormClose = () => {
    setSelectedProject(null);
    fetchData();
  };

  /* Opening the submit form from inside the detail modal: close the detail
     first so the two dialogs never stack. */
  const handleSubmitFromDetail = (project) => {
    if (project.work_plan_status !== 'finalized' || !project.site_engineer_id) return;
    closeDetail();
    setSelectedProject(project);
  };

  const handleSubmitted = () => {
    setSuccessMessage('Progress update submitted successfully. The displayed accomplishment will refresh from the server-calculated result.');
    setSelectedProject(null);
    fetchData(false);
  };

  if (loading) {
    return (
      <ContractorLayout>
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </ContractorLayout>
    );
  }

  return (
    <ContractorLayout>
      <div className="space-y-6">
        {successMessage && (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span>{successMessage}</span>
            <button type="button" onClick={() => setSuccessMessage('')} aria-label="Dismiss success message" className="font-bold text-emerald-700 hover:text-emerald-900">x</button>
          </div>
        )}

        {/* KPI block, same as the admin pages. Status cards filter the table;
            the lead card lists what is stopping progress updates. */}
        {projects.length > 0 && (() => {
          const noWorkPlan = projects.filter((p) => p.work_plan_status !== 'finalized').length;
          const noEngineer = projects.filter((p) => !p.site_engineer_id).length;
          const ready = projects.filter((p) => p.work_plan_status === 'finalized' && p.site_engineer_id).length;
          const avg = projects.reduce((sum, p) => sum + Number(p.accomplishment || 0), 0) / projects.length;
          const blockers = [
            noWorkPlan > 0 && { key: 'plan', label: 'Work plan not finalized', count: noWorkPlan },
            noEngineer > 0 && { key: 'eng', label: 'No site engineer assigned yet', count: noEngineer },
          ].filter(Boolean);
          const toggle = (key) => handleStatusFilterChange(statusFilter === key ? 'All' : key);
          return (
            <HierarchyKpis
              dense
              ariaLabel="My projects summary"
              lead={{
                label: statusFilter === 'All' ? 'Assigned Projects' : `${statusFilter} Projects`,
                value: statusFilter === 'All' ? projects.length : (statusCounts[statusFilter] || 0),
                note: (
                  <span>
                    <span className="font-semibold text-emerald-700">{ready} ready</span> to submit progress updates
                    {statusFilter !== 'All' && <> · <button type="button" onClick={() => handleStatusFilterChange('All')} className="font-medium text-teal-700 hover:underline">show all {projects.length}</button></>}
                  </span>
                ),
                icon: <ClipboardListIcon className="size-6" aria-hidden="true" />,
                iconTone: 'bg-slate-100 text-slate-600',
                body: blockers.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Blocking progress updates</p>
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/70">
                      {blockers.map((b) => (
                        <li key={b.key} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
                          <span className="font-medium text-slate-800">{b.label}</span>
                          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 tabular-nums">{b.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
                segments: [
                  { label: 'Completed', value: statusCounts.Completed || 0, bar: 'bg-emerald-500' },
                  { label: 'On-Going', value: statusCounts['On-Going'] || 0, bar: 'bg-amber-400' },
                  { label: 'Proposed', value: statusCounts.Proposed || 0, bar: 'bg-sky-500' },
                ].filter((seg) => seg.value > 0),
              }}
              items={[
                { icon: <HardHatIcon className="size-4" aria-hidden="true" />, label: 'On-Going', value: statusCounts['On-Going'] || 0, hint: 'Under construction now', chip: 'bg-slate-100 text-slate-600', onClick: () => toggle('On-Going'), active: statusFilter === 'On-Going' },
                { icon: <CheckCircle2Icon className="size-4" aria-hidden="true" />, label: 'Completed', value: statusCounts.Completed || 0, hint: 'Finished', chip: 'bg-slate-100 text-slate-600', onClick: () => toggle('Completed'), active: statusFilter === 'Completed' },
                { icon: <ClockIcon className="size-4" aria-hidden="true" />, label: 'Proposed', value: statusCounts.Proposed || 0, hint: 'Not yet started', chip: 'bg-slate-100 text-slate-600', onClick: () => toggle('Proposed'), active: statusFilter === 'Proposed' },
                { icon: <GaugeIcon className="size-4" aria-hidden="true" />, label: 'Avg. Accomplishment', value: formatPercentage(avg), hint: 'Across your projects', chip: 'bg-slate-100 text-slate-600' },
              ]}
            />
          );
        })()}

        {projects.length > 0 && (
          <FilterToolbar
            ariaLabel="Filter projects"
            noun="project"
            shown={filteredProjects.length}
            total={projects.length}
            search={{ value: search, onChange: setSearch, placeholder: 'Search project, municipality or location', ariaLabel: 'Search projects' }}
            selects={[
              {
                key: 'status', label: 'Status', value: statusFilter, onChange: handleStatusFilterChange, allLabel: 'All statuses',
                options: ['On-Going', 'Completed', 'Proposed', 'Overdue'].map((v) => ({ value: v, label: `${v} (${statusCounts[v] || 0})` })),
                chipLabel: (v) => v,
              },
              ...(municipalityOptions.length > 1 ? [{
                key: 'muni', label: 'Municipality', value: municipalityFilter, onChange: setMunicipalityFilter, allLabel: 'All municipalities',
                options: municipalityOptions.map((m) => ({ value: m, label: m })),
              }] : []),
              {
                key: 'plan', label: 'Work plan', value: workPlanFilter, onChange: setWorkPlanFilter, allLabel: 'Any work plan',
                options: [{ value: 'finalized', label: 'Plan finalized' }, { value: 'draft', label: 'Plan in draft' }, { value: 'none', label: 'No plan yet' }],
              },
              {
                key: 'eng', label: 'Site engineer', value: engineerFilter, onChange: setEngineerFilter, allLabel: 'Any site engineer',
                options: [{ value: 'assigned', label: 'Engineer assigned' }, { value: 'none', label: 'No engineer yet' }],
              },
              {
                key: 'sort', label: 'Sort', value: sortBy, onChange: setSortBy, allValue: 'name', allLabel: 'Name A–Z', chip: false,
                options: [{ value: 'deadline', label: 'Nearest deadline' }, { value: 'progress-asc', label: 'Lowest progress' }, { value: 'progress-desc', label: 'Highest progress' }],
              },
            ]}
          />
        )}

        {projects.length === 0 ? (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm py-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-base font-bold text-slate-900">No projects assigned yet</p>
            <p className="text-sm text-slate-500 mt-1">An administrator will assign projects to you.</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm py-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-base font-bold text-slate-900">No projects match these filters</p>
            <p className="text-sm text-slate-500 mt-1">Try removing a filter above.</p>
            <button
              type="button"
              onClick={clearProjectFilters}
              className="mt-4 inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    <th className={thClass}>Project</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Work Plan</th>
                    <th className={thClass}>Physical</th>
                    <th className={thClass}>Funds Released</th>
                    <th className={thClass}>Latest Submission</th>
                    <th className={`${thClass} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedProjects.map((project) => {
                    const latest = latestUpdates[project.id];
                    const hasPendingUpdate = latest?.status === 'pending';
                    const accomplishment = Number(project.accomplishment || 0);
                    const budget = getProjectBudgetSummary(project, tranchesByProjectId[project.id] || []);
                    const contract = Number(project.contract_amount || project.total_budget || 0);
                    const financialPct = contract > 0
                      ? Math.min(100, (Number(budget.released || 0) / contract) * 100)
                      : null;

                    return (
                      <tr
                        key={project.id}
                        onClick={() => setDetailProject(project)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailProject(project); }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`View details for ${project.project_name}`}
                        className="cursor-pointer transition-colors hover:bg-slate-50/70 focus:outline-none focus:bg-slate-50"
                      >
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-900 leading-snug line-clamp-1">
                            {project.project_name || 'Unnamed Project'}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {project.municipality}{project.province ? `, ${project.province}` : ', Iloilo'}
                            {project.project_length_km ? ` · ${project.project_length_km} km` : ''}
                          </p>
                        </td>

                        <td className="px-5 py-4">
                          <FmrStatusBadge status={project.status} />
                        </td>

                        <td className="px-5 py-4">
                          <WorkPlanStatusBadge status={project.work_plan_status} />
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 bg-slate-100 rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-teal-500 transition-all duration-500"
                                style={{ width: `${Math.min(accomplishment, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-slate-700 font-mono w-11 text-right">
                              {formatPercentage(accomplishment)}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-slate-700">
                            {formatPeso(budget.released)}{budget.utilizationIsEstimated ? ' (est.)' : ''}
                          </p>
                          <p className="text-xs text-slate-400">
                            {financialPct === null
                              ? `of ${formatPeso(budget.totalBudget)}`
                              : `${formatPercentage(financialPct)} of ${formatPeso(budget.totalBudget)}`}
                            {budget.budgetIsEstimated ? ' (est.)' : ''}
                          </p>
                        </td>

                        <td className="px-5 py-4">
                          {latest ? (
                            (() => {
                              const meta = getWorkflowMeta(latest);
                              return (
                                <>
                                  <p className="text-sm text-slate-700">
                                    {formatPercentage(latest.reported_accomplishment)} claimed
                                    {latest.certified_accomplishment != null && (
                                      <span className="text-teal-700 font-semibold">
                                        {' '}· {formatPercentage(latest.certified_accomplishment)} certified
                                      </span>
                                    )}
                                  </p>
                                  <span
                                    title={meta.hint}
                                    className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${meta.tone}`}
                                  >
                                    <span className={`w-1 h-1 rounded-full ${meta.dot}`} />
                                    {meta.short}
                                  </span>
                                  <span className="text-xs text-slate-400 ml-1.5">{fmtShortDate(latest.submitted_at)}</span>
                                </>
                              );
                            })()
                          ) : (
                            <span className="text-xs text-slate-400">No submissions yet</span>
                          )}
                        </td>

                        <td className="px-5 py-4 text-right">
                          {hasPendingUpdate ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Pending Review
                            </span>
                          ) : project.work_plan_status !== 'finalized' ? (
                            <span
                              title="The Admin must finalize this project's Work Plan before progress can be submitted."
                              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-500 border border-slate-200 whitespace-nowrap"
                            >
                              Work Plan required
                            </span>
                          ) : !project.site_engineer_id ? (
                            <span
                              title="The DA office has not assigned a site engineer to this project yet. Your progress is validated by that engineer, so it cannot be submitted until one is assigned."
                              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap"
                            >
                              Awaiting site engineer
                            </span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedProject(project); }}
                              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 shadow-sm transition-colors whitespace-nowrap"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              Submit Update
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-5 py-3.5">
              <p className="text-xs text-slate-500">
                Showing <span className="font-bold text-slate-700">{(safePage - 1) * ROWS_PER_PAGE + 1}</span>–
                <span className="font-bold text-slate-700">{Math.min(safePage * ROWS_PER_PAGE, filteredProjects.length)}</span> of{' '}
                <span className="font-bold text-slate-700">{filteredProjects.length}</span>
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Previous
                  </button>
                  {getPaginationRange(safePage, totalPages).map((p, idx) =>
                    p === '...' ? (
                      <span key={`dots-${idx}`} className="px-1.5 text-xs text-slate-400 select-none">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition ${
                          safePage === p
                            ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Progress history: collapsed by default (opens from a notification
            or ?history=1), so this page stays on the projects. */}
        <ProgressSubmissionHistory
          client={supabase}
          userId={user?.id}
          canOpenProject={(id) => projects.some((p) => String(p.id) === String(id))}
          onOpenProject={(id) => {
            const project = projects.find((p) => String(p.id) === String(id));
            if (project) setDetailProject(project);
          }}
        />
      </div>

      {/* Project detail (opened by clicking a row) */}
      {shownProject && (
        <ContractorProjectDetailModal
          project={shownProject}
          tranches={tranchesByProjectId[shownProject.id] || []}
          onClose={closeDetail}
          onSubmitUpdate={handleSubmitFromDetail}
        />
      )}

      {/* Progress Update Modal */}
      {selectedProject && (
        <ContractorProgressForm
          project={selectedProject}
          user={user}
          onClose={handleFormClose}
          onSubmitted={handleSubmitted}
        />
      )}
    </ContractorLayout>
  );
}
