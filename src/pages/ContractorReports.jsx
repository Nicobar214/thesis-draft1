/* ContractorReports.jsx – Operations page for contractor progress history
 * and public reports linked to assigned projects.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';

// ── Status badge ─────────────────────────────────────────────
function ReportStatusBadge({ status }) {
  const map = {
    pending:  'bg-amber-50 text-amber-700 border-amber-200',
    reviewed: 'bg-blue-50 text-blue-700 border-blue-200',
    resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const cls = map[status] || 'bg-slate-50 text-slate-600 border-slate-200';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

function ProgressStatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50 text-red-700 border-red-200',
  };
  const cls = map[status] || 'bg-slate-50 text-slate-600 border-slate-200';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

function SummaryCard({ value, label, tone }) {
  return (
    <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
      <p className={`text-3xl font-bold ${tone}`}>{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  );
}

export default function ContractorReports() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [publicReports, setPublicReports] = useState([]);
  const [progressHistory, setProgressHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [remarkState, setRemarkState] = useState({}); // { [reportId]: { open, text, saving } }
  const [notification, setNotification] = useState(null);

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
      const rawProjectIds = (projs || []).map((p) => p.id);
      const reportProjectIds = rawProjectIds.map((id) => `fmr-${id}`);

      if (rawProjectIds.length === 0) {
        setPublicReports([]);
        setProgressHistory([]);
        setLastSyncedAt(new Date());
        return;
      }

      const [{ data: reportRows, error: reportErr }, { data: progressRows, error: progressErr }] = await Promise.all([
        supabase
          .from('public_reports')
          .select('id, project_name, description, category, status, created_at, contractor_remark, contractor_remark_at, verification, municipality, barangay, photo_url, project_id')
          .in('project_id', reportProjectIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('progress_updates')
          .select('id, fmr_project_id, reported_accomplishment, remarks, photo_url, status, submitted_at, reviewed_at, fmr_projects(project_name, municipality, accomplishment, status)')
          .eq('contractor_id', user.id)
          .in('fmr_project_id', rawProjectIds)
          .order('submitted_at', { ascending: false })
      ]);

      if (reportErr) throw reportErr;
      if (progressErr) throw progressErr;

      setPublicReports(reportRows || []);
      setProgressHistory(progressRows || []);
      setLastSyncedAt(new Date());
    } catch (err) {
      console.error('ContractorReports fetch error:', err);
      setNotification({ message: `Failed to refresh data: ${err.message}`, type: 'error' });
      setTimeout(() => setNotification(null), 3500);
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_updates' }, () => fetchData(false))
        .subscribe();

      return () => {
        supabase.removeChannel(ch);
      };
    }
  }, [user, fetchData]);

  // ── Remark helpers ───────────────────────────────────────────
  const openRemark = (reportId, existing) => {
    setRemarkState((prev) => ({
      ...prev,
      [reportId]: { open: true, text: existing || '', saving: false },
    }));
  };

  const closeRemark = (reportId) => {
    setRemarkState((prev) => ({ ...prev, [reportId]: { ...prev[reportId], open: false } }));
  };

  const saveRemark = async (reportId) => {
    const text = remarkState[reportId]?.text || '';
    setRemarkState((prev) => ({ ...prev, [reportId]: { ...prev[reportId], saving: true } }));
    try {
      const { error } = await supabase
        .from('public_reports')
        .update({
          contractor_remark:    text.trim(),
          contractor_remark_at: new Date().toISOString(),
        })
        .eq('id', reportId);
      if (error) throw error;
      setNotification({ message: 'Remark saved.', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      await fetchData(false);
      closeRemark(reportId);
    } catch (err) {
      console.error('Save remark error:', err);
      setNotification({ message: `Failed: ${err.message}`, type: 'error' });
      setTimeout(() => setNotification(null), 3000);
      setRemarkState((prev) => ({ ...prev, [reportId]: { ...prev[reportId], saving: false } }));
    }
  };

  const fmtDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

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
      {/* Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
          notification.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          {notification.message}
        </div>
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Operations Reports</h1>
            <p className="text-sm text-slate-500 mt-1">
              Review your submission history and public reports linked to assigned projects.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Last synced</p>
              <p className="text-sm text-slate-600">{lastSyncedAt ? fmtDateTime(lastSyncedAt) : 'Not yet synced'}</p>
            </div>
            <button
              onClick={() => fetchData(false)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.023 9.348h4.992V4.356m-1.336 14.292A9 9 0 1 1 21 12.75" />
              </svg>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <SummaryCard value={progressHistory.length} label="Total Submissions" tone="text-slate-900" />
          <SummaryCard value={progressHistory.filter((item) => item.status === 'pending').length} label="Pending Review" tone="text-amber-700" />
          <SummaryCard value={progressHistory.filter((item) => item.status === 'approved').length} label="Approved" tone="text-emerald-700" />
          <SummaryCard value={progressHistory.filter((item) => item.status === 'rejected').length} label="Rejected" tone="text-red-600" />
          <SummaryCard value={publicReports.length} label="Linked Public Reports" tone="text-sky-700" />
        </div>

        <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Progress Submission History</h2>
              <p className="text-sm text-slate-500 mt-1">Every contractor update, its review outcome, and the current project progress.</p>
            </div>
            <span className="text-sm font-medium text-slate-500">{progressHistory.length} record{progressHistory.length !== 1 ? 's' : ''}</span>
          </div>

          {progressHistory.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-base font-bold text-slate-900">No submission history yet</p>
              <p className="text-sm text-slate-500 mt-1">Your approved, pending, and rejected progress updates will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-200">
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Project</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Submitted %</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Current Project %</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Submitted At</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Reviewed At</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Remarks</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Photo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {progressHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors align-top">
                      <td className="px-5 py-4 max-w-xs">
                        <p className="text-sm font-semibold text-slate-900 line-clamp-2">{item.fmr_projects?.project_name || `Project ${item.fmr_project_id}`}</p>
                        {item.fmr_projects?.municipality && <p className="text-xs text-slate-500 mt-0.5">{item.fmr_projects.municipality}</p>}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm font-bold text-slate-900 font-mono">{Number(item.reported_accomplishment || 0).toFixed(2)}%</td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm font-semibold text-slate-700 font-mono">{Number(item.fmr_projects?.accomplishment || 0).toFixed(2)}%</td>
                      <td className="px-5 py-4"><ProgressStatusBadge status={item.status} /></td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm text-slate-600">{fmtDateTime(item.submitted_at)}</td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm text-slate-600">{item.status === 'pending' ? 'Awaiting review' : fmtDateTime(item.reviewed_at)}</td>
                      <td className="px-5 py-4 max-w-xs"><p className="text-xs text-slate-600 line-clamp-3">{item.remarks || '—'}</p></td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        {item.photo_url ? (
                          <a href={item.photo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">View</a>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

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
            <div className="px-6 py-5 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Linked Public Reports</h2>
                <p className="text-sm text-slate-500 mt-1">Citizen-submitted reports tied to your assigned projects.</p>
              </div>
              <span className="text-sm font-medium text-slate-500">{publicReports.length} report{publicReports.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-200">
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Report</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Category</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Reported</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Your Remark</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {publicReports.map((rpt) => {
                    const rstate = remarkState[rpt.id] || { open: false, text: rpt.contractor_remark || '', saving: false };
                    return (
                      <tr key={rpt.id} className="hover:bg-slate-50/60 transition-colors align-top">
                        {/* Report description */}
                        <td className="px-5 py-4 max-w-xs">
                          <p className="text-sm font-semibold text-slate-900 line-clamp-2">
                            {rpt.project_name || `${rpt.barangay || ''}, ${rpt.municipality || ''}`}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{rpt.description}</p>
                          {rpt.photo_url && (
                            <a
                              href={rpt.photo_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 mt-1 text-xs text-teal-600 hover:text-teal-700 font-medium"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                              View Photo
                            </a>
                          )}
                        </td>

                        {/* Category */}
                        <td className="px-5 py-4">
                          <span className="text-sm text-slate-600 capitalize">{rpt.category || '—'}</span>
                        </td>

                        {/* Reported at */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className="text-sm text-slate-600">{fmtDate(rpt.created_at)}</span>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          <ReportStatusBadge status={rpt.status} />
                        </td>

                        {/* Contractor remark */}
                        <td className="px-5 py-4 max-w-xs">
                          {rstate.open ? (
                            <div className="space-y-2">
                              <textarea
                                value={rstate.text}
                                onChange={(e) => setRemarkState((prev) => ({
                                  ...prev,
                                  [rpt.id]: { ...prev[rpt.id], text: e.target.value },
                                }))}
                                rows={3}
                                placeholder="Enter your remark…"
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none resize-none"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveRemark(rpt.id)}
                                  disabled={rstate.saving}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 transition-colors"
                                >
                                  {rstate.saving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={() => closeRemark(rpt.id)}
                                  disabled={rstate.saving}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              {rpt.contractor_remark ? (
                                <p className="text-xs text-slate-700 line-clamp-3">{rpt.contractor_remark}</p>
                              ) : (
                                <p className="text-xs text-slate-400 italic">No remark yet</p>
                              )}
                              {rpt.contractor_remark_at && (
                                <p className="text-xs text-slate-400 mt-0.5">{fmtDate(rpt.contractor_remark_at)}</p>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Action */}
                        <td className="px-5 py-4">
                          {!rstate.open && (
                            <button
                              onClick={() => openRemark(rpt.id, rpt.contractor_remark)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 transition-colors whitespace-nowrap"
                            >
                              {rpt.contractor_remark ? 'Edit Remark' : 'Add Remark'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ContractorLayout>
  );
}
