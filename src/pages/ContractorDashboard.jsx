/* ContractorDashboard.jsx – Main landing page for contractors
 * KPI stat cards + quick-action + recent activity list
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';

// ── Status badge styles ──────────────────────────────────────
const UPDATE_STATUS = {
  pending:  { label: 'Pending',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
};

function StatusBadge({ status }) {
  const s = UPDATE_STATUS[status] || { label: status || 'Unknown', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ── KPI card ──────────────────────────────────────────────────
function StatCard({ icon, value, label, accent }) {
  return (
    <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${accent}`}>
        {icon}
      </div>
      <p className="text-3xl font-bold text-slate-900 font-mono tracking-tight">{value}</p>
      <p className="text-sm text-slate-500 mt-1 font-medium">{label}</p>
    </div>
  );
}

export default function ContractorDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const isFirstLoadRef = useRef(true);

  // KPI data
  const [totalProjects, setTotalProjects]     = useState(0);
  const [pendingUpdates, setPendingUpdates]   = useState(0);
  const [openReports, setOpenReports]         = useState(0);
  const [recentActivity, setRecentActivity]   = useState([]);

  // ── Auth check ──────────────────────────────────────────────
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

  // ── Fetch KPIs ──────────────────────────────────────────────
  const fetchKPIs = useCallback(async () => {
    if (!user) return;
    if (isFirstLoadRef.current) {
      setLoading(true);
      isFirstLoadRef.current = false;
    } else {
      setRefreshing(true);
    }
    try {
      // 1. Total assigned projects
      const { count: projCount } = await supabase
        .from('fmr_projects')
        .select('id', { count: 'exact', head: true })
        .eq('contractor_id', user.id);
      setTotalProjects(projCount || 0);

      // 2. Projects with no approved update this month
      const { data: myProjects } = await supabase
        .from('fmr_projects')
        .select('id')
        .eq('contractor_id', user.id);
      const projectIds = (myProjects || []).map((p) => p.id);

      let pendingCount = 0;
      if (projectIds.length > 0) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const { data: approvedThisMonth } = await supabase
          .from('progress_updates')
          .select('fmr_project_id')
          .eq('contractor_id', user.id)
          .eq('status', 'approved')
          .gte('submitted_at', startOfMonth.toISOString())
          .in('fmr_project_id', projectIds);
        const approvedIds = new Set((approvedThisMonth || []).map((u) => u.fmr_project_id));
        pendingCount = projectIds.filter((id) => !approvedIds.has(id)).length;
      }
      setPendingUpdates(pendingCount);

      // 3. Open (pending) public reports near my projects
      if (projectIds.length > 0) {
        const fmrIds = projectIds.map((id) => `fmr-${id}`);
        const { count: rptCount } = await supabase
          .from('public_reports')
          .select('id', { count: 'exact', head: true })
          .in('project_id', fmrIds)
          .eq('status', 'pending');
        setOpenReports(rptCount || 0);
      } else {
        setOpenReports(0);
      }

      // 4. Recent activity (last 5 progress updates)
      const { data: recent } = await supabase
        .from('progress_updates')
        .select('id, fmr_project_id, reported_accomplishment, remarks, status, submitted_at, fmr_projects(project_name, municipality)')
        .eq('contractor_id', user.id)
        .order('submitted_at', { ascending: false })
        .limit(5);
      setRecentActivity(recent || []);
      setLastSyncedAt(new Date());
    } catch (err) {
      console.error('ContractorDashboard KPI error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchKPIs();
      const channel = supabase
        .channel('contractor-dashboard-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_updates' }, fetchKPIs)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, fetchKPIs)
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, fetchKPIs]);

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
      <div className="space-y-8">
        {/* Page title */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contractor Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1">Overview of your projects, submission workload, and current field activity.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Last synced</p>
              <p className="text-sm text-slate-600">{lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet synced'}</p>
            </div>
            <button
              onClick={fetchKPIs}
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

        {/* KPI stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <StatCard
            value={totalProjects}
            label="Total Assigned Projects"
            accent="bg-teal-50"
            icon={
              <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
          />
          <StatCard
            value={pendingUpdates}
            label="Projects Needing Update This Month"
            accent="bg-amber-50"
            icon={
              <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            value={openReports}
            label="Open Public Reports on My Projects"
            accent="bg-sky-50"
            icon={
              <svg className="w-6 h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
          />
        </div>

        {/* Quick-action card */}
        <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Ready to submit a progress update?</h2>
            <p className="text-sm text-slate-500 mt-1">Pick a project and report your latest accomplishment percentage.</p>
          </div>
          <Link
            to="/contractor/projects"
            className="shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 shadow-lg shadow-teal-500/25 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Submit Progress Update
          </Link>
        </div>

        {/* Recent activity */}
        <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-7 py-5 border-b border-slate-200/60 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Recent Submissions</h2>
            <Link to="/contractor/projects" className="text-sm text-teal-600 hover:text-teal-700 font-medium">
              View all projects →
            </Link>
          </div>

          {recentActivity.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-slate-700">No submissions yet</p>
              <p className="text-xs text-slate-500 mt-1">Your progress updates will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivity.map((item) => {
                const projectName =
                  item.fmr_projects?.project_name || `Project ${item.fmr_project_id}`;
                const municipality = item.fmr_projects?.municipality || '';
                return (
                  <div key={item.id} className="px-7 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{projectName}</p>
                      {municipality && (
                        <p className="text-xs text-slate-500 mt-0.5">{municipality}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(item.submitted_at).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                        {item.remarks && ` — ${item.remarks.slice(0, 60)}${item.remarks.length > 60 ? '…' : ''}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold text-slate-700 font-mono">
                        {item.reported_accomplishment}%
                      </span>
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ContractorLayout>
  );
}
