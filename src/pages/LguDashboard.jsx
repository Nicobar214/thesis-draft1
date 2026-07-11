import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import LguRouteMap from '../components/lgu/LguRouteMap';
import LguForActionTab from '../components/lgu/LguForActionTab';
import LguAnalyticsTab from '../components/lgu/LguAnalyticsTab';
import RoadInventoryTab from '../components/lgu/RoadInventoryTab';
import RoadConditionManagement from '../components/lgu/RoadConditionManagement';
import roadInventory from '../data/leonRoadInventory.json';

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

function statusTone(status) {
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'reviewed') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  const activeFilterCount = useMemo(() => {
    return [
      barangayFilter !== 'all',
      statusFilter !== 'all',
      projectFilter !== 'all',
      Boolean(dateFrom),
      Boolean(dateTo),
      !showHeat,
    ].filter(Boolean).length;
  }, [barangayFilter, statusFilter, projectFilter, dateFrom, dateTo, showHeat]);

  const roadInventoryStats = useMemo(() => {
    const rows = Array.isArray(roadInventory) ? roadInventory : [];
    const totalKm = rows.reduce((sum, row) => sum + (Number(row.lengthKm) || 0), 0);

    return {
      totalRoads: rows.length,
      totalKm,
      concreteRoads: rows.filter((row) => row.surfaceType === 'Concrete').length,
      highPriority: rows.filter((row) => String(row.condition || '').toLowerCase() === 'poor' || String(row.condition || '').toLowerCase() === 'critical').length,
      preview: rows.slice(0, 5),
    };
  }, []);

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

  const navItems = [
    { id: 'overview', label: 'Overview', description: 'Summary and route map' },
    { id: 'for_action', label: 'For Action', description: 'Items needing LGU action' },
    { id: 'analytics', label: 'Analytics', description: 'Trends and reporting' },
    { id: 'road_inventory', label: 'Road Inventory', description: 'CSV-backed road list' },
    { id: 'road_condition_management', label: 'Road Conditions', description: 'Inspections and history' },
  ];

  const activeSection = navItems.find((item) => item.id === activeTab) || navItems[0];

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 w-80 border-r border-slate-800 bg-slate-900 text-white shadow-2xl transition-transform duration-300 lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-700/60 px-6 py-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">LGU Oversight Portal</p>
                <h1 className="mt-2 text-2xl font-bold text-white">KalsaTrack LGU</h1>
                <p className="mt-2 text-sm text-slate-300">Road inventory and road condition tools for municipal review.</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-300 lg:hidden"
              >
                Close
              </button>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-800/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Scope</p>
              <p className="mt-1 text-sm font-semibold text-white">{municipalityScope || 'All municipalities (RLS controlled)'}</p>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <p className="px-3 pb-3 text-xs font-bold uppercase tracking-[0.25em] text-slate-500">Main Menu</p>
            <div className="space-y-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`flex w-full items-start gap-4 rounded-2xl px-4 py-4 text-left transition-all duration-200 ${activeTab === item.id ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/20' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                >
                  <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${activeTab === item.id ? 'bg-white/20' : 'bg-slate-800'}`}>
                    <span className="text-sm font-bold">{String(item.label || '').slice(0, 1)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-5">{item.label}</p>
                    <p className={`mt-1 text-xs leading-4 ${activeTab === item.id ? 'text-teal-50' : 'text-slate-400'}`}>{item.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </nav>

          <div className="border-t border-slate-700/60 px-4 py-4">
            <button
              onClick={exportPdf}
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Export PDF
            </button>
            <button
              onClick={handleSignOut}
              className="mt-3 w-full rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 hover:bg-red-500/20"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setSidebarOpen((open) => !open)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
                aria-label="Toggle navigation"
              >
                <span className="flex flex-col gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-current" />
                  <span className="h-0.5 w-4 rounded-full bg-current" />
                  <span className="h-0.5 w-4 rounded-full bg-current" />
                </span>
              </button>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">LGU Oversight Portal</p>
                <h2 className="truncate text-lg font-bold text-slate-900">{activeSection.label}</h2>
                <p className="truncate text-sm text-slate-500">{activeSection.description}</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{activeTab.replace(/_/g, ' ')}</span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 lg:px-6">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Total Reports', summary.total, 'default'],
            ['Pending', summary.pending, 'pending'],
            ['Resolved', summary.resolved, 'resolved'],
            ['Escalated', summary.escalated, 'escalated'],
          ].map(([label, value, tone]) => (
            <div key={label} className={`rounded-xl border px-4 py-3 ${cardTone(tone)}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide">{label}</p>
              <p className="mt-1 text-2xl font-bold leading-none">{value}</p>
            </div>
          ))}
          </section>

          <section className="mt-5 rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Report Filters</p>
                <p className="text-xs text-slate-500">
                  {activeFilterCount > 0 ? `${activeFilterCount} active filter${activeFilterCount > 1 ? 's' : ''}` : 'Showing all reports'}
                </p>
              </div>
              <button
                onClick={() => setFiltersOpen((open) => !open)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {filtersOpen ? 'Hide Filters' : 'Show Filters'}
              </button>
            </div>

            {filtersOpen && (
              <div className="grid grid-cols-1 gap-2 border-t border-slate-100 p-3 md:grid-cols-2 xl:grid-cols-6">
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
              </div>
            )}
          </section>

          <section className="mt-5">
            {activeTab === 'overview' && (
              <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Route Map</p>
                        <p className="text-xs text-slate-500">Projects and citizen reports in view.</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{filteredReports.length} reports</span>
                    </div>
                    <LguRouteMap
                      projects={projects}
                      routesByProjectId={routesByProjectId}
                      reports={filteredReports}
                      showHeat={showHeat}
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Reports In Jurisdiction</p>
                      <span className="text-xs font-medium text-slate-500">Latest first</span>
                    </div>
                    <table className="w-full min-w-[680px] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Project</th>
                          <th className="py-2 pr-3">Location</th>
                          <th className="py-2 pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReports.slice(0, 8).map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 pr-3 text-slate-600">{new Date(row.created_at).toLocaleDateString()}</td>
                            <td className="py-2 pr-3 font-medium text-slate-900">{row.project_name || 'N/A'}</td>
                            <td className="py-2 pr-3 text-slate-700">{row.barangay || 'N/A'}, {row.municipality || 'N/A'}</td>
                            <td className="py-2 pr-3">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ${statusTone(row.status)}`}>
                                {row.status || 'pending'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {filteredReports.length === 0 && (
                          <tr>
                            <td className="py-4 text-slate-500" colSpan={4}>No reports match the selected filters.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-white p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Road Inventory</p>
                      <p className="text-xs text-slate-500">Leon barangay roads snapshot from the CSV data.</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('road_inventory')}
                      className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Open
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Roads</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.totalRoads}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Total Km</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.totalKm.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Concrete Roads</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.concreteRoads}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Needs Attention</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.highPriority}</p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-slate-500 border-b border-slate-200">
                          <th className="px-3 py-2">Road</th>
                          <th className="px-3 py-2">Condition</th>
                          <th className="px-3 py-2 text-right">Km</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roadInventoryStats.preview.map((row) => (
                          <tr key={`${row.roadName}-${row.yearConstructed}-${row.lengthKm}`} className="border-t border-slate-100">
                            <td className="px-3 py-2">
                              <p className="font-medium text-slate-900">{row.roadName || 'N/A'}</p>
                              <p className="text-xs text-slate-500">{row.barangay || 'N/A'}</p>
                            </td>
                            <td className="px-3 py-2 text-slate-700">{row.condition || 'N/A'}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{Number(row.lengthKm || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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

            {activeTab === 'road_inventory' && (
              <RoadInventoryTab />
            )}

            {activeTab === 'road_condition_management' && (
              <RoadConditionManagement />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
