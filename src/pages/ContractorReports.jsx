/* ContractorReports.jsx – citizen reports on the contractor's roads: the
 * repairs the DA assigned to them and the full list of linked reports.
 * (Progress submission history lives on My Projects.)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import { toast } from '../lib/toast';
import Pagination, { usePagination } from '../components/ui/Pagination';
import FilterToolbar from '../components/ui/FilterToolbar';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import SeverityIcon from '../components/SeverityIcon';
import HandlerReportsPanel from '../components/publicReports/HandlerReportsPanel';
import { buildHandlerQueue, handlerReportStatus, useHandlerFollowUps } from '../lib/handlerFollowUps';
import { SEVERITY_TAXONOMY, handlerFor, resolveCategory, resolveSpecificProblem } from '../lib/publicReportStatus';
import { PhotoViewButton } from '../components/ui/ZoomablePhoto';
import ContractorReportDetailModal from '../components/contractor/ContractorReportDetailModal';

export default function ContractorReports() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [publicReports, setPublicReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState(null); // report open in the detail window
  const [projectsByRef, setProjectsByRef] = useState({}); // 'fmr-<id>' -> the contractor's project

  // ── Public reports filters ──────────────────────────────────
  // Every report on the contractor's roads; collapsed so the page leads with the repairs.
  const [showLinkedReports, setShowLinkedReports] = useState(false);
  const [reportSearch, setReportSearch] = useState('');
  const [reportStatusFilter, setReportStatusFilter] = useState('All');
  const [reportProjectFilter, setReportProjectFilter] = useState('All');
  const [reportCategoryFilter, setReportCategoryFilter] = useState('All');

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

  // ── Fetch reports + progress history ────────────────────────
  const fetchData = useCallback(async (showSpinner = true) => {
    if (!user) return;
    if (showSpinner) setLoading(true);
    else setRefreshing(true);
    try {
      const { data: projs } = await supabase
        .from('fmr_projects')
        .select('id, project_name, municipality, accomplishment, status')
        .eq('contractor_id', user.id);
      setProjectsByRef(Object.fromEntries((projs || []).map((p) => [`fmr-${p.id}`, p])));
      const rawProjectIds = (projs || []).map((p) => p.id);
      const reportProjectIds = rawProjectIds.map((id) => `fmr-${id}`);

      if (rawProjectIds.length === 0) {
        setPublicReports([]);
        setLastSyncedAt(new Date());
        return;
      }

      const { data: reportRows, error: reportErr } = await supabase
        .from('public_reports')
        .select('*')
        .in('project_id', reportProjectIds)
        .order('created_at', { ascending: false });

      if (reportErr) throw reportErr;

      // Only the problems the contractor fixes; obstructions and signs go to the LGU.
      setPublicReports((reportRows || []).filter((r) => handlerFor(r) === 'contractor'));
      setLastSyncedAt(new Date());
    } catch (err) {
      console.error('ContractorReports fetch error:', err);
      toast.error(`Failed to refresh data: ${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData();
      const ch = supabase
        .channel('contractor-reports-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, () => fetchData(false))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, () => fetchData(false))
        .subscribe();

      return () => {
        supabase.removeChannel(ch);
      };
    }
  }, [user, fetchData]);

  // ── Remark (edited in the report detail window) ────────────
  const saveRemark = async (reportId, text) => {
    const { error } = await supabase
      .from('public_reports')
      .update({ contractor_remark: text, contractor_remark_at: new Date().toISOString() })
      .eq('id', reportId);
    if (error) {
      console.error('Save remark error:', error);
      toast.error(`Failed to save remark: ${error.message}`);
      return;
    }
    toast.success('Remark saved.');
    await fetchData(false);
  };

  const openProject = (project) => {
    if (project?.id) navigate(`/contractor/projects?project=${project.id}`);
  };

  const fmtDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  // ── Repairs the DA assigned to this contractor ──────────────
  const reportIds = useMemo(() => publicReports.map((r) => r.id), [publicReports]);
  const followUps = useHandlerFollowUps(supabase, reportIds);
  const repairQueue = useMemo(() => buildHandlerQueue(publicReports, 'contractor', followUps.actions), [publicReports, followUps.actions]);

  // ── Filtered + paginated public reports ─────────────────────
  const filteredPublicReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return publicReports.filter((rpt) => {
      if (reportStatusFilter !== 'All' && rpt.status !== reportStatusFilter) return false;
      if (reportProjectFilter !== 'All' && (rpt.project_name || '') !== reportProjectFilter) return false;
      if (reportCategoryFilter !== 'All' && resolveCategory(rpt) !== reportCategoryFilter) return false;
      if (q) {
        const hay = `${rpt.project_name || ''} ${rpt.description || ''} ${rpt.barangay || ''} ${rpt.municipality || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [publicReports, reportSearch, reportStatusFilter, reportProjectFilter, reportCategoryFilter]);
  const reportsPager = usePagination(filteredPublicReports, `${reportSearch}|${reportStatusFilter}|${reportProjectFilter}|${reportCategoryFilter}`);

  const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const reportProjectOptions = uniqueSorted(publicReports.map((r) => r.project_name));
  const reportCategoryOptions = uniqueSorted(publicReports.map((r) => resolveCategory(r)));

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
        {/* Sync status (the page title lives in the shared header) */}
        <div className="-mt-2 flex items-center justify-end gap-3">
          <span className="text-xs text-slate-400">Synced {lastSyncedAt ? fmtDateTime(lastSyncedAt) : '—'}</span>
          <button
            onClick={() => fetchData(false)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <svg className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.023 9.348h4.992V4.356m-1.336 14.292A9 9 0 1 1 21 12.75" />
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* Citizen-reported damage the DA assigned to you after inspecting it. */}
        {publicReports.length > 0 && (
          <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-slate-900">Citizen Report Repairs</h2>
            <HandlerReportsPanel
              queue={repairQueue}
              findings={followUps.findings}
              loading={followUps.loading}
              party="contractor"
              client={supabase}
              onChanged={(message, tone) => {
                if (message) (tone === 'error' ? toast.error : toast.success)(message);
                followUps.reload();
              }}
            />
          </div>
        )}

        {publicReports.length === 0 ? (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm py-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-base font-bold text-slate-900">No reports yet</p>
            <p className="text-sm text-slate-500 mt-1">Public reports linked to your projects will appear here.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
            <div className={showLinkedReports ? 'border-b border-slate-200/60' : ''}>
              <button
                type="button"
                onClick={() => setShowLinkedReports((v) => !v)}
                aria-expanded={showLinkedReports}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50/60"
              >
                <span className="text-base font-bold text-slate-900">
                  Linked Public Reports <span className="font-semibold text-slate-400">({publicReports.length})</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
                  {showLinkedReports ? 'Hide' : 'Show'}
                  <ChevronDownIcon className={`size-4 transition-transform ${showLinkedReports ? 'rotate-180' : ''}`} aria-hidden="true" />
                </span>
              </button>
              {showLinkedReports && (
              <FilterToolbar
                embedded
                ariaLabel="Filter public reports"
                noun="report"
                shown={filteredPublicReports.length}
                total={publicReports.length}
                search={{ value: reportSearch, onChange: setReportSearch, placeholder: 'Search project, description or barangay', ariaLabel: 'Search reports' }}
                selects={[
                  {
                    key: 'status', label: 'Status', value: reportStatusFilter, onChange: setReportStatusFilter, allLabel: 'All statuses',
                    options: [{ value: 'pending', label: 'Pending' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'resolved', label: 'Resolved' }],
                  },
                  ...(reportCategoryOptions.length > 1 ? [{
                    key: 'category', label: 'Issue type', value: reportCategoryFilter, onChange: setReportCategoryFilter, allLabel: 'All issue types',
                    options: reportCategoryOptions.map((c) => ({ value: c, label: SEVERITY_TAXONOMY[c]?.label || c })),
                  }] : []),
                  ...(reportProjectOptions.length > 1 ? [{
                    key: 'project', label: 'Project', value: reportProjectFilter, onChange: setReportProjectFilter, allLabel: 'All projects',
                    options: reportProjectOptions.map((n) => ({ value: n, label: n })),
                  }] : []),
                ]}
              />
              )}
            </div>
            {showLinkedReports && (filteredPublicReports.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-base font-bold text-slate-900">No reports match these filters</p>
                <button
                  onClick={() => { setReportSearch(''); setReportStatusFilter('All'); setReportProjectFilter('All'); setReportCategoryFilter('All'); }}
                  className="mt-2 text-sm font-semibold text-teal-700 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-200">
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Report</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Project</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Issue</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Your remark</th>
                    <th className="px-5 py-3.5" aria-label="Open" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportsPager.pageItems.map((rpt) => {
                    const project = projectsByRef[rpt.project_id];
                    const status = handlerReportStatus(rpt, followUps.actions[rpt.id]);
                    const category = resolveCategory(rpt);
                    return (
                      <tr
                        key={rpt.id}
                        onClick={() => setSelectedReportId(rpt.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedReportId(rpt.id); } }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open report ${String(rpt.id).slice(0, 8).toUpperCase()}`}
                        className="group cursor-pointer align-top transition-colors hover:bg-teal-50/40 focus:bg-teal-50/40 focus:outline-none"
                      >
                        <td className="px-5 py-4">
                          <p className="font-mono text-xs font-semibold text-slate-500">#{String(rpt.id).slice(0, 8).toUpperCase()}</p>
                          <p className="mt-0.5 text-sm text-slate-700">{fmtDate(rpt.created_at)}</p>
                          <p className="text-xs text-slate-500">{[rpt.barangay, rpt.municipality].filter(Boolean).join(', ')}</p>
                        </td>
                        <td className="max-w-[14rem] px-5 py-4">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openProject(project); }}
                            disabled={!project}
                            className="text-left text-sm font-semibold text-slate-900 underline-offset-2 hover:text-teal-700 hover:underline disabled:no-underline disabled:hover:text-slate-900"
                          >
                            {project?.project_name || rpt.project_name || 'Unlinked road'}
                          </button>
                          {project && (
                            <p className="mt-0.5 text-xs text-slate-500">{project.status || 'No status'} · {Math.round(Number(project.accomplishment || 0))}% done</p>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_TAXONOMY[category]?.color || ''}`}>
                            <SeverityIcon category={category} />
                            {resolveSpecificProblem(rpt)?.label || SEVERITY_TAXONOMY[category]?.label}
                          </span>
                          {rpt.photo_url && (
                            <span onClick={(e) => e.stopPropagation()} className="mt-1.5 block">
                              <PhotoViewButton src={rpt.photo_url} label="Citizen's on-site photo" className="text-xs font-medium text-teal-600 hover:text-teal-700">
                                View photo
                              </PhotoViewButton>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                        </td>
                        <td className="max-w-[14rem] px-5 py-4">
                          {rpt.contractor_remark
                            ? <p className="line-clamp-2 text-xs text-slate-700">{rpt.contractor_remark}</p>
                            : <p className="text-xs italic text-slate-400">No remark yet</p>}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 opacity-70 transition group-hover:opacity-100">
                            Details <ChevronRightIcon className="size-4" aria-hidden="true" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            ))}
            {showLinkedReports && filteredPublicReports.length > 0 && (
              <div className="px-6 py-4 border-t border-slate-100">
                <Pagination pager={reportsPager} noun="report" />
              </div>
            )}
          </div>
        )}
      </div>

      {(() => {
        const rpt = publicReports.find((r) => r.id === selectedReportId);
        if (!rpt) return null;
        return (
          <ContractorReportDetailModal
            key={rpt.id}
            client={supabase}
            report={rpt}
            project={projectsByRef[rpt.project_id]}
            action={followUps.actions[rpt.id]}
            finding={followUps.findings[rpt.id]}
            onClose={() => setSelectedReportId(null)}
            onOpenProject={openProject}
            onSaveRemark={saveRemark}
          />
        );
      })()}
    </ContractorLayout>
  );
}
