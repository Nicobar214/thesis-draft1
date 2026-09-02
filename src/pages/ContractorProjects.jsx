/* ContractorProjects.jsx – Table of fmr_projects assigned to this contractor
 * Each row shows status, physical accomplishment, funds released and the latest
 * submission. Clicking a row opens the full project detail (description,
 * schedule, submission history); the Submit Update action stays inline.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import ContractorProgressForm from './ContractorProgressForm';
import ContractorProjectDetailModal from '../components/contractor/ContractorProjectDetailModal';
import { getProjectBudgetSummary, formatPeso } from '../lib/budgetEstimate';
import { getPaginationRange } from '../lib/paginationUtils';
import { getWorkflowMeta } from '../lib/progressWorkflow';

const ROWS_PER_PAGE = 10;

const thClass = 'px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500';

const fmtShortDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── FMR status badge ─────────────────────────────────────────
function FmrStatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  let cls = 'bg-sky-50 text-sky-700 border-sky-200';
  let label = status || 'Proposed';
  if (s.includes('complet')) { cls = 'bg-emerald-50 text-emerald-700 border-emerald-200'; label = 'Completed'; }
  else if (s.includes('going') || s.includes('ongoing')) { cls = 'bg-amber-50 text-amber-700 border-amber-200'; label = 'On-Going'; }
  else if (s.includes('proposed')) { cls = 'bg-sky-50 text-sky-700 border-sky-200'; label = 'Proposed'; }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
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
  const [page, setPage] = useState(1);

  // ── Auth ─────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { navigate('/signin'); return; }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
      if (prof?.role !== 'contractor') { navigate('/signin'); return; }
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
        .select('id, project_name, municipality, province, location, status, accomplishment, project_length_km, total_budget, funds_released, funding_source, contract_amount, remarks, year_funded, date_started, target_completion_date, date_completed')
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

  const totalPages = Math.max(1, Math.ceil(projects.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginatedProjects = useMemo(
    () => projects.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE),
    [projects, safePage]
  );

  const handleFormClose = () => {
    setSelectedProject(null);
    fetchData();
  };

  /* Opening the submit form from inside the detail modal: close the detail
     first so the two dialogs never stack. */
  const handleSubmitFromDetail = (project) => {
    setDetailProject(null);
    setSelectedProject(project);
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
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Projects</h1>
          <p className="text-sm text-slate-500 mt-1">{projects.length} project{projects.length !== 1 ? 's' : ''} assigned to you</p>
        </div>

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
        ) : (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    <th className={thClass}>Project</th>
                    <th className={thClass}>Status</th>
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
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 bg-slate-100 rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-teal-500 transition-all duration-500"
                                style={{ width: `${Math.min(accomplishment, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-slate-700 font-mono w-11 text-right">
                              {accomplishment.toFixed(0)}%
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
                              : `${financialPct.toFixed(0)}% of ${formatPeso(budget.totalBudget)}`}
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
                                    {Number(latest.reported_accomplishment ?? 0).toFixed(0)}% claimed
                                    {latest.certified_accomplishment != null && (
                                      <span className="text-teal-700 font-semibold">
                                        {' '}· {Number(latest.certified_accomplishment).toFixed(0)}% certified
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
                <span className="font-bold text-slate-700">{Math.min(safePage * ROWS_PER_PAGE, projects.length)}</span> of{' '}
                <span className="font-bold text-slate-700">{projects.length}</span>
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
      </div>

      {/* Project detail (opened by clicking a row) */}
      {detailProject && (
        <ContractorProjectDetailModal
          project={detailProject}
          tranches={tranchesByProjectId[detailProject.id] || []}
          onClose={() => setDetailProject(null)}
          onSubmitUpdate={handleSubmitFromDetail}
        />
      )}

      {/* Progress Update Modal */}
      {selectedProject && (
        <ContractorProgressForm
          project={selectedProject}
          user={user}
          onClose={handleFormClose}
        />
      )}
    </ContractorLayout>
  );
}
