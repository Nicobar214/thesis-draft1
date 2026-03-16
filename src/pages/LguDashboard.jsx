import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import LguRouteMap from '../components/lgu/LguRouteMap';
import LguForActionTab from '../components/lgu/LguForActionTab';
import LguAnalyticsTab from '../components/lgu/LguAnalyticsTab';

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function resolveEffectiveRole(profileRole, metadataRole) {
  const normalizedProfileRole = normalizeRole(profileRole);
  const normalizedMetadataRole = normalizeRole(metadataRole);

  if (normalizedProfileRole && normalizedProfileRole !== 'user') return normalizedProfileRole;
  if (normalizedMetadataRole && normalizedMetadataRole !== 'user') return normalizedMetadataRole;
  return normalizedProfileRole || normalizedMetadataRole || 'user';
}

function cardTone(kind) {
  if (kind === 'pending') return 'bg-amber-50 border-amber-200 text-amber-700';
  if (kind === 'resolved') return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  if (kind === 'escalated') return 'bg-indigo-50 border-indigo-200 text-indigo-700';
  return 'bg-slate-50 border-slate-200 text-slate-700';
}

export default function LguDashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const [reports, setReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [routesByProjectId, setRoutesByProjectId] = useState({});
  const [escalations, setEscalations] = useState([]);
  const [findings, setFindings] = useState([]);

  const [barangayFilter, setBarangayFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showHeat, setShowHeat] = useState(true);

  const municipalityScope = profile?.municipality || user?.user_metadata?.municipality || '';

  const showNotification = (message) => {
    window.alert(message);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/signin');
  };

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      let reportsQuery = supabase.from('public_reports').select('*').order('created_at', { ascending: false });
      let projectsQuery = supabase.from('fmr_projects').select('*').order('project_name', { ascending: true });
      let escalationsQuery = supabase.from('public_report_lgu_escalations').select('*').order('created_at', { ascending: false });

      if (municipalityScope) {
        reportsQuery = reportsQuery.eq('municipality', municipalityScope);
        projectsQuery = projectsQuery.eq('municipality', municipalityScope);
        escalationsQuery = escalationsQuery.eq('municipality', municipalityScope);
      }

      const [reportsRes, projectsRes, escalationsRes, routesRes, findingsRes] = await Promise.all([
        reportsQuery,
        projectsQuery,
        escalationsQuery,
        supabase.from('project_routes').select('*'),
        supabase.from('public_report_field_findings').select('*').order('submitted_at', { ascending: false }),
      ]);

      setReports(reportsRes.data || []);
      setProjects(projectsRes.data || []);
      setEscalations(escalationsRes.data || []);
      setFindings(findingsRes.data || []);

      const nextRoutes = {};
      (routesRes.data || []).forEach((row) => {
        if (!row.project_id) return;
        nextRoutes[row.project_id] = row;
      });
      setRoutesByProjectId(nextRoutes);
    } finally {
      setLoading(false);
    }
  }, [user, municipalityScope]);

  useEffect(() => {
    (async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate('/signin');
        return;
      }

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

      const role = resolveEffectiveRole(prof?.role, currentUser.user_metadata?.role);
      if (role !== 'lgu') {
        navigate('/signin');
        return;
      }

      setUser(currentUser);
      setProfile(prof || { id: currentUser.id, role: 'lgu', full_name: currentUser.email });
    })();
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    fetchAll();

    const channels = [
      supabase.channel('lgu-reports').on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, fetchAll).subscribe(),
      supabase.channel('lgu-escalations').on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_lgu_escalations' }, fetchAll).subscribe(),
      supabase.channel('lgu-decisions').on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_lgu_decisions' }, fetchAll).subscribe(),
    ];

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [user, fetchAll]);

  const filteredReports = useMemo(() => {
    return (reports || []).filter((row) => {
      if (barangayFilter !== 'all' && row.barangay !== barangayFilter) return false;
      if (projectFilter !== 'all' && row.project_name !== projectFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;

      const created = row.created_at ? new Date(row.created_at) : null;
      if (dateFrom && created && created < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && created && created > new Date(`${dateTo}T23:59:59`)) return false;

      return true;
    });
  }, [reports, barangayFilter, projectFilter, statusFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    return {
      total: filteredReports.length,
      pending: filteredReports.filter((r) => r.status === 'pending').length,
      resolved: filteredReports.filter((r) => r.status === 'resolved').length,
      escalated: escalations.filter((r) => ['for_action', 'endorsed', 'rejected', 'more_info_requested'].includes(r.escalation_status)).length,
    };
  }, [filteredReports, escalations]);

  const uniqueBarangays = useMemo(() => ['all', ...Array.from(new Set((reports || []).map((r) => r.barangay).filter(Boolean)))], [reports]);
  const uniqueProjects = useMemo(() => ['all', ...Array.from(new Set((reports || []).map((r) => r.project_name).filter(Boolean)))], [reports]);

  const handleDecision = async (row, decision, remarks) => {
    const now = new Date().toISOString();

    await supabase.from('public_report_lgu_decisions').insert({
      escalation_id: row.id,
      report_id: row.report_id,
      decision,
      remarks,
      lgu_user_id: user.id,
      lgu_name: profile?.full_name || profile?.email || user.email,
      municipality: row.municipality || municipalityScope || null,
      created_at: now,
    });

    await supabase
      .from('public_report_lgu_escalations')
      .update({
        escalation_status: decision,
        decision_at: now,
        decision_by: profile?.full_name || profile?.email || user.email,
        decision_remarks: remarks,
      })
      .eq('id', row.id);

    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
    if (Array.isArray(admins) && admins.length > 0) {
      const rows = admins.map((adm) => ({
        user_id: adm.id,
        type: 'lgu_decision',
        title: 'LGU decision received',
        message: `LGU marked report ${String(row.report_id || '').slice(0, 8)} as ${decision.replace(/_/g, ' ')}.`,
        report_id: row.report_id,
        is_read: false,
        created_at: now,
      }));
      await supabase.from('notifications').insert(rows);
    }

    showNotification('LGU decision recorded.');
    await fetchAll();
  };

  const exportPdf = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">LGU Oversight Portal</p>
            <h1 className="text-lg font-bold text-slate-900">KalsaTrack LGU Dashboard</h1>
            <p className="text-xs text-slate-500">Municipality scope: {municipalityScope || 'All municipalities (RLS controlled)'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportPdf} className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50">Export PDF</button>
            <button onClick={handleSignOut} className="px-3 py-2 rounded-lg border border-red-200 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100">Sign Out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Total Reports', summary.total, 'default'],
            ['Pending', summary.pending, 'pending'],
            ['Resolved', summary.resolved, 'resolved'],
            ['Escalated to LGU', summary.escalated, 'escalated'],
          ].map(([label, value, tone]) => (
            <div key={label} className={`rounded-2xl border p-4 ${cardTone(tone)}`}>
              <p className="text-xs uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-bold mt-1">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
          <select value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {uniqueBarangays.map((value) => <option key={value} value={value}>{value === 'all' ? 'All Barangays' : value}</option>)}
          </select>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {uniqueProjects.map((value) => <option key={value} value={value}>{value === 'all' ? 'All Projects' : value}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} />
            Heatmap
          </label>
        </section>

        <section className="flex flex-wrap gap-2">
          {[
            ['overview', 'Overview'],
            ['for_action', 'For Action'],
            ['analytics', 'Analytics'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold ${activeTab === id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </section>

        {activeTab === 'overview' && (
          <section className="space-y-3">
            <LguRouteMap
              projects={projects}
              routesByProjectId={routesByProjectId}
              reports={filteredReports}
              showHeat={showHeat}
            />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto">
              <p className="text-sm font-semibold text-slate-900 mb-2">Reports In Jurisdiction</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2">Date</th>
                    <th className="py-2">Project</th>
                    <th className="py-2">Location</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-2">{new Date(row.created_at).toLocaleDateString()}</td>
                      <td className="py-2">{row.project_name || 'N/A'}</td>
                      <td className="py-2">{row.barangay || 'N/A'}, {row.municipality || 'N/A'}</td>
                      <td className="py-2 capitalize">{row.status || 'pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'for_action' && (
          <LguForActionTab
            escalations={escalations}
            findings={findings}
            loading={loading}
            onDecision={handleDecision}
          />
        )}

        {activeTab === 'analytics' && (
          <LguAnalyticsTab
            reports={reports}
            escalations={escalations}
            projects={projects}
            findings={findings}
          />
        )}
      </main>
    </div>
  );
}
