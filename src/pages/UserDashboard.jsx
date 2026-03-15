import { Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';

import Icons from '../components/Icons';
import UserLayout from '../components/UserLayout';
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Icon Components - Clean, consistent 24x24 icons
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Stat Card - Displays a single metric with icon
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function StatCard({ icon, value, label, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-100 text-teal-600',
    amber: 'bg-amber-100 text-amber-600',
    sky: 'bg-sky-100 text-sky-600',
    violet: 'bg-violet-100 text-violet-600',
  };

  return (
    <article className="bg-white rounded-2xl p-6 border border-slate-200/60 hover:border-zinc-300 transition-colors">
      <div className={`inline-flex items-center justify-center size-10 rounded-xl mb-4 ${variants[variant]}`}>
        {icon}
      </div>
      <p className="text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </article>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Project Card - Displays project info with progress
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function ProjectCard({ project }) {
  const status = project.status || 'Pending';
  const name = project.projectName || project.project_name || 'Untitled';
  
  const statusStyles = {
    'Completed': { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
    'On-Going': { badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
    'In Progress': { badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
    'Proposed': { badge: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' },
    'Pending': { badge: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' },
  };
  
  const style = statusStyles[status] || statusStyles['Pending'];

  return (
    <article className="p-4 hover:bg-slate-50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-slate-900 truncate">{name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Icons.MapPin />
            <span className="truncate">{project.municipality}, {project.province}</span>
          </p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${style.badge}`}>
          {status}
        </span>
      </div>
      
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${project.progress || 0}%` }} />
        </div>
        <span className="text-xs font-medium text-slate-600 tabular-nums w-10 text-right">
          {project.progress || 0}%
        </span>
      </div>
    </article>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Loading Skeletons
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function StatSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200/60 animate-pulse">
      <div className="size-10 bg-zinc-200 rounded-xl mb-4" />
      <div className="h-8 w-12 bg-zinc-200 rounded mb-2" />
      <div className="h-4 w-20 bg-zinc-200 rounded" />
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="p-4 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="h-5 w-3/4 bg-zinc-200 rounded mb-2" />
          <div className="h-4 w-1/2 bg-zinc-200 rounded" />
        </div>
        <div className="h-6 w-20 bg-zinc-200 rounded-full" />
      </div>
      <div className="mt-3 h-1.5 bg-zinc-200 rounded-full" />
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Main Dashboard Component
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function UserDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, completed: 0, ongoing: 0, pending: 0 });
  const [projects, setProjects] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [userLabel, setUserLabel] = useState('there');
  const [userMunicipality, setUserMunicipality] = useState('');
  const [activityFeed, setActivityFeed] = useState([]);
  const [submissions, setSubmissions] = useState({ reportsSubmitted: 0, reportsResolved: 0, reportsPending: 0, feedbackSubmitted: 0 });
  const [municipalityTableCollapsed, setMunicipalityTableCollapsed] = useState(false);
  const [dismissedStatusAlert, setDismissedStatusAlert] = useState(false);

  const statusAlias = {
    completed: 'Completed',
    'on-going': 'On-Going',
    ongoing: 'On-Going',
    'in progress': 'On-Going',
    proposed: 'Pending',
    planning: 'Pending',
    pending: 'Pending',
  };

  const normalizeFmrStatus = (status) => {
    const key = String(status || '').trim().toLowerCase();
    return statusAlias[key] || status || 'Pending';
  };

  const getProjectDateCandidates = (project) => {
    const status = normalizeFmrStatus(project?.status);
    // Prefer project timeline dates so seeded/imported rows don't look newly updated.
    if (status === 'Completed') {
      return [project?.date_completed, project?.target_completion_date, project?.updated_at, project?.created_at];
    }
    return [project?.target_completion_date, project?.updated_at, project?.created_at, project?.date_completed];
  };

  const getProjectSortTimestamp = (project) => {
    const dateCandidates = getProjectDateCandidates(project);
    for (const value of dateCandidates) {
      if (!value) continue;
      const parsed = new Date(value).getTime();
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  };

  const getProjectRecencyTimestamp = (project) => {
    const candidates = [project?.updated_at, project?.created_at];
    for (const value of candidates) {
      if (!value) continue;
      const parsed = new Date(value).getTime();
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  };

  const formatProjectDate = (project) => {
    const dateCandidates = getProjectDateCandidates(project);
    for (const value of dateCandidates) {
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }
    }
    return 'No date';
  };

  // Data fetching with realtime
  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, fetchData)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    const mobileCollapsedDefault = window.innerWidth < 768;
    setMunicipalityTableCollapsed(mobileCollapsedDefault);
  }, []);

  async function fetchData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const label = user?.user_metadata?.full_name || user?.email?.split('@')?.[0] || 'there';
      setUserLabel(label);

      let municipality = String(user?.user_metadata?.municipality || '').trim();
      if (user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('municipality')
          .eq('id', user.id)
          .maybeSingle();

        municipality = String(profile?.municipality || municipality).trim();
      }
      setUserMunicipality(municipality);

      const { data } = await supabase
        .from('fmr_projects')
        .select('*')
        .order('year_funded', { ascending: false });

      if (data) {
        const normalizedProjects = data
          .map((project) => ({
            ...project,
            projectName: project.project_name || 'Untitled FMR Project',
            municipality: project.municipality || 'Unspecified municipality',
            province: project.province || 'Iloilo',
            barangay: project.location || '',
            status: normalizeFmrStatus(project.status),
            progress: Number(project.accomplishment) || 0,
          }))
          .sort((a, b) => {
            const recencyDiff = getProjectRecencyTimestamp(b) - getProjectRecencyTimestamp(a);
            if (recencyDiff !== 0) return recencyDiff;
            return getProjectSortTimestamp(b) - getProjectSortTimestamp(a);
          });

        const recentProjects = normalizedProjects.filter((project) => getProjectRecencyTimestamp(project) > 0);
        const fmrProjectNameSet = new Set(normalizedProjects.map((project) => String(project.projectName || '').trim().toLowerCase()));

        setAllProjects(normalizedProjects);
        setProjects(recentProjects.slice(0, 5));
        setStats({
          total: normalizedProjects.length,
          completed: normalizedProjects.filter((p) => p.status === 'Completed').length,
          ongoing: normalizedProjects.filter((p) => p.status === 'On-Going').length,
          pending: normalizedProjects.filter((p) => p.status === 'Pending').length,
        });

        const [{ data: reportsData }, { data: feedbackData }] = await Promise.all([
          supabase
            .from('public_reports')
            .select('id, created_at, project_name, municipality, status, user_id')
            .order('created_at', { ascending: false })
            .limit(12),
          supabase
            .from('feedbacks')
            .select('id, created_at, project_name, user_id')
            .order('created_at', { ascending: false })
            .limit(12),
        ]);

        const projectActivity = normalizedProjects
          .filter((project) => project.updated_at)
          .slice(0, 10)
          .map((project) => ({
            id: `project-${project.id}`,
            type: 'update',
            label: `${project.projectName} was updated`,
            timestamp: project.updated_at,
          }));

        const reportActivity = (reportsData || [])
          .filter((report) => {
            const key = String(report.project_name || '').trim().toLowerCase();
            return key && fmrProjectNameSet.has(key);
          })
          .map((report) => ({
            id: `report-${report.id}`,
            type: 'report',
            label: `New report filed for ${report.project_name}`,
            timestamp: report.created_at,
          }));

        const feedbackActivity = (feedbackData || [])
          .filter((feedback) => {
            const key = String(feedback.project_name || '').trim().toLowerCase();
            return key && fmrProjectNameSet.has(key);
          })
          .map((feedback) => ({
            id: `feedback-${feedback.id}`,
            type: 'feedback',
            label: `Feedback submitted for ${feedback.project_name}`,
            timestamp: feedback.created_at,
          }));

        const combinedActivity = [...projectActivity, ...reportActivity, ...feedbackActivity]
          .filter((item) => item.timestamp)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 7);
        setActivityFeed(combinedActivity);

        if (user?.id) {
          const myReports = (reportsData || []).filter((report) => report.user_id === user.id);
          const myFeedback = (feedbackData || []).filter((feedback) => feedback.user_id === user.id);

          setSubmissions({
            reportsSubmitted: myReports.length,
            reportsResolved: myReports.filter((report) => report.status === 'resolved').length,
            reportsPending: myReports.filter((report) => report.status !== 'resolved').length,
            feedbackSubmitted: myFeedback.length,
          });
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const donutData = useMemo(
    () => [
      { name: 'Completed', value: stats.completed, color: '#14b8a6' },
      { name: 'On-Going', value: stats.ongoing, color: '#f59e0b' },
      { name: 'Pending', value: stats.pending, color: '#94a3b8' },
    ],
    [stats.completed, stats.ongoing, stats.pending]
  );

  const nearbyProjects = useMemo(() => {
    if (!userMunicipality) return allProjects.slice(0, 5);
    const key = userMunicipality.toLowerCase();
    return allProjects
      .filter((project) => String(project.municipality || '').toLowerCase() === key)
      .slice(0, 5);
  }, [allProjects, userMunicipality]);

  const municipalityProgressRows = useMemo(() => {
    const map = allProjects.reduce((acc, project) => {
      const municipality = project.municipality || 'Unspecified';
      if (!acc[municipality]) {
        acc[municipality] = { municipality, total: 0, completed: 0 };
      }
      acc[municipality].total += 1;
      if (project.status === 'Completed') acc[municipality].completed += 1;
      return acc;
    }, {});

    return Object.values(map)
      .map((row) => ({
        ...row,
        completionPct: row.total ? (row.completed / row.total) * 100 : 0,
      }))
      .sort((a, b) => b.completionPct - a.completionPct);
  }, [allProjects]);

  const areaStatusAlert = useMemo(() => {
    if (!userMunicipality || dismissedStatusAlert) return null;
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const recent = nearbyProjects.find((project) => {
      const t = new Date(project.updated_at || project.created_at || 0).getTime();
      if (!t || Number.isNaN(t)) return false;
      return now - t <= sevenDaysMs;
    });

    if (!recent) return null;
    const tone = recent.status === 'Completed' ? 'teal' : 'amber';
    return { project: recent, tone };
  }, [nearbyProjects, userMunicipality, dismissedStatusAlert]);

  const hasSubmissions = submissions.reportsSubmitted > 0 || submissions.feedbackSubmitted > 0;

  const formatActivityTime = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown time';
    return parsed.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <UserLayout>
      <div className="space-y-8">
        {/* Page Title */}
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-slate-500">Welcome back, {userLabel}. Track FMR projects in your community.</p>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          ) : (
            <>
              <StatCard icon={<Icons.Folder />} value={stats.total} label="Total FMR Projects" variant="sky" />
              <StatCard icon={<Icons.CheckCircle />} value={stats.completed} label="Completed" variant="emerald" />
              <StatCard icon={<Icons.Clock />} value={stats.ongoing} label="On-Going" variant="amber" />
              <StatCard icon={<Icons.Document />} value={stats.pending} label="Pending" variant="violet" />
            </>
          )}
        </section>

        {areaStatusAlert && (
          <section
            className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
              areaStatusAlert.tone === 'teal'
                ? 'bg-teal-50 border-teal-200 text-teal-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <p className="text-sm font-medium">
              {areaStatusAlert.project.projectName} was marked {areaStatusAlert.project.status} on {formatProjectDate(areaStatusAlert.project)}.
            </p>
            <button
              onClick={() => setDismissedStatusAlert(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-current/20 hover:bg-white/40 transition-colors self-start sm:self-auto"
            >
              Dismiss
            </button>
          </section>
        )}

        <section className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-semibold text-slate-900">In Your Area</h2>
                <p className="text-sm text-slate-500">{userMunicipality ? 'Projects near your saved municipality' : 'Latest FMR projects while location is not set'}</p>
              </div>
              {!userMunicipality ? (
                <Link to="/user/profile" className="text-sm font-medium text-teal-600 hover:text-teal-700">
                  Set your location
                </Link>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200">{userMunicipality}</span>
              )}
            </header>

            {nearbyProjects.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No nearby projects found for {userMunicipality} yet.</div>
            ) : (
              <div className="p-4 overflow-x-auto">
                {!userMunicipality && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 mb-4">
                    Set your municipality in your profile to personalize this strip to your area.
                  </div>
                )}
                <div className="flex gap-4 min-w-max">
                  {nearbyProjects.map((project) => {
                    const status = project.status || 'Pending';
                    const statusStyles = {
                      Completed: 'bg-emerald-100 text-emerald-700',
                      'On-Going': 'bg-amber-100 text-amber-700',
                      Pending: 'bg-sky-100 text-sky-700',
                    };
                    return (
                      <article key={project.id} className="w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-medium text-slate-900 line-clamp-2">{project.projectName}</h3>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyles[status] || statusStyles.Pending}`}>
                            {status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500 truncate">{project.barangay || 'Barangay not specified'}</p>
                        <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${status === 'Completed' ? 'bg-emerald-500' : status === 'On-Going' ? 'bg-amber-500' : 'bg-sky-500'}`}
                            style={{ width: `${project.progress || 0}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{project.progress || 0}%</span>
                          <span>Date {formatProjectDate(project)}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
            <h2 className="font-semibold text-slate-900">Project Progress Breakdown</h2>
            <p className="text-sm text-slate-500 mt-1">Completed, on-going, and pending mix</p>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" innerRadius={52} outerRadius={78} paddingAngle={2}>
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value, name) => [`${value}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="-mt-32 text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Total</p>
                <p className="text-3xl font-semibold text-slate-900">{stats.total}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              {donutData.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5 text-slate-600">
                  <span className="inline-block size-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Content Grid */}
        <section className="grid lg:grid-cols-3 gap-6">
          {/* Projects List */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-semibold text-slate-900">Recent Projects</h2>
                <p className="text-sm text-slate-500">Latest FMR projects by recent activity</p>
              </div>
              <Link to="/user/fmr-projects" className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700">
                View all <Icons.ArrowRight />
              </Link>
            </header>

            <div className="divide-y divide-zinc-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <ProjectSkeleton key={i} />)
              ) : projects.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="mx-auto size-14 bg-slate-100 rounded-xl grid place-items-center text-slate-400 mb-3">
                    <Icons.Folder />
                  </div>
                  <p className="font-medium text-slate-900">No projects yet</p>
                  <p className="text-sm text-slate-500">Projects will appear here</p>
                </div>
              ) : (
                projects.map((p) => (
                  <div key={p.id}>
                    <ProjectCard project={p} />
                    <p className="px-4 pb-4 text-xs text-slate-500">Project date: {formatProjectDate(p)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Dashboard Sidebar Cards */}
          <aside className="space-y-4">
            {/* Submit Feedback CTA */}
            <Link
              to="/user/feedback"
              className="flex items-center gap-4 p-5 bg-teal-600 hover:bg-teal-700 rounded-2xl transition-colors text-white"
            >
              <div className="size-11 bg-white/15 rounded-xl grid place-items-center">
                <Icons.Plus />
              </div>
              <div>
                <p className="font-semibold">Give Feedback</p>
                <p className="text-sm text-emerald-100">Share photos & concerns</p>
              </div>
            </Link>

            {/* Submit Report CTA */}
            <Link
              to="/user/reports"
              className="flex items-center gap-4 p-5 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200/60 transition-colors"
            >
              <div className="size-11 bg-slate-100 rounded-xl grid place-items-center text-slate-500">
                <Icons.Document />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Submit Report</p>
                <p className="text-sm text-slate-500">Report issues or updates</p>
              </div>
            </Link>

            {/* Map View CTA */}
            <Link
              to="/user/map"
              className="flex items-center gap-4 p-5 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200/60 transition-colors"
            >
              <div className="size-11 bg-sky-100 rounded-xl grid place-items-center text-sky-600 shrink-0">
                <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Map View</p>
                <p className="text-sm text-slate-500">See project locations on map</p>
              </div>
            </Link>

            {/* Info Card */}
            <div className="p-5 bg-sky-50 rounded-2xl border border-sky-100">
              <p className="font-medium text-sky-900 mb-1">Your voice matters</p>
              <p className="text-sm text-sky-700 leading-relaxed">
                Help improve transparency by reporting project updates and issues in your community.
              </p>
            </div>
          </aside>
        </section>

        <section className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-semibold text-slate-900">Recent Activity</h2>
                <p className="text-sm text-slate-500">Latest reports, updates, and feedback across the system</p>
              </div>
              <Link to="/user/reports" className="text-sm font-medium text-teal-600 hover:text-teal-700">View all activity</Link>
            </header>

            <div className="divide-y divide-slate-100">
              {activityFeed.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No recent activity yet.</div>
              ) : (
                activityFeed.slice(0, 7).map((item) => (
                  <div key={item.id} className="px-5 py-4 flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">
                      {item.type === 'report' ? '📋' : item.type === 'update' ? '🔄' : '💬'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">{item.label}</p>
                      <p className="text-xs text-slate-500 mt-1">{formatActivityTime(item.timestamp)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {hasSubmissions && (
            <div className="bg-white rounded-2xl border border-slate-200/60 p-5 space-y-4">
              <h2 className="font-semibold text-slate-900">My Submissions</h2>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-medium text-slate-900">Your Reports</p>
                <p className="text-xs text-slate-500 mt-1">{submissions.reportsSubmitted} submitted · {submissions.reportsResolved} resolved · {submissions.reportsPending} pending</p>
                <Link to="/user/reports?mine=1" className="mt-3 inline-flex text-sm font-medium text-teal-600 hover:text-teal-700">
                  Open Reports
                </Link>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-medium text-slate-900">Your Feedback</p>
                <p className="text-xs text-slate-500 mt-1">{submissions.feedbackSubmitted} submitted</p>
                <Link to="/user/feedback?mine=1" className="mt-3 inline-flex text-sm font-medium text-teal-600 hover:text-teal-700">
                  Open Feedback
                </Link>
              </div>
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
          <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Municipality Progress</h2>
              <p className="text-sm text-slate-500">Completion ranking across municipalities</p>
            </div>
            <button
              onClick={() => setMunicipalityTableCollapsed((prev) => !prev)}
              className="text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              {municipalityTableCollapsed ? 'Show table' : 'Hide table'}
            </button>
          </header>

          {!municipalityTableCollapsed && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Municipality</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Total Projects</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Completion %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {municipalityProgressRows.map((row) => {
                    const isUserMunicipality = userMunicipality && row.municipality.toLowerCase() === userMunicipality.toLowerCase();
                    return (
                      <tr key={row.municipality} className={isUserMunicipality ? 'bg-teal-50/60' : 'bg-white'}>
                        <td className="px-5 py-3 text-sm font-medium text-slate-800">{row.municipality}</td>
                        <td className="px-5 py-3 text-sm text-slate-600">{row.total}</td>
                        <td className="px-5 py-3 text-sm text-slate-600">{row.completed}</td>
                        <td className="px-5 py-3 text-sm text-slate-700 font-medium">{row.completionPct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </UserLayout>
  );
}



