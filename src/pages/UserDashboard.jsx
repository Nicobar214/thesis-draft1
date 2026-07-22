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
function StatCard({ icon, value, label, variant = 'default', badgeText }) {
  const variants = {
    default: { bg: 'bg-slate-100 text-slate-700', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-700' },
    emerald: { bg: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-200', badge: 'bg-emerald-50 text-emerald-800' },
    amber: { bg: 'bg-amber-100 text-amber-800', border: 'border-amber-200', badge: 'bg-amber-50 text-amber-800' },
    sky: { bg: 'bg-sky-100 text-sky-800', border: 'border-sky-200', badge: 'bg-sky-50 text-sky-800' },
    violet: { bg: 'bg-indigo-100 text-indigo-800', border: 'border-indigo-200', badge: 'bg-indigo-50 text-indigo-800' },
  };

  const v = variants[variant] || variants.default;

  return (
    <article className={`bg-white rounded-2xl p-5 border ${v.border} shadow-xs hover:border-slate-300 transition-colors flex flex-col justify-between`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`inline-flex items-center justify-center size-10 rounded-xl ${v.bg}`}>
          {icon}
        </div>
        {badgeText && (
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${v.badge}`}>
            {badgeText}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">{label}</p>
      </div>
    </article>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Project Card - Displays project info with progress
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function ProjectCard({ project }) {
  const status = project.status || 'Proposed';
  const name = project.projectName || project.project_name || 'Untitled FMR Road';
  
  const statusStyles = {
    'Completed': { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', bar: 'bg-emerald-500' },
    'On-Going': { badge: 'bg-amber-100 text-amber-800 border-amber-200', bar: 'bg-amber-500' },
    'In Progress': { badge: 'bg-amber-100 text-amber-800 border-amber-200', bar: 'bg-amber-500' },
    'Proposed': { badge: 'bg-sky-100 text-sky-800 border-sky-200', bar: 'bg-sky-500' },
  };
  
  const style = statusStyles[status] || statusStyles['Proposed'];

  return (
    <article className="p-4 hover:bg-slate-50/80 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate">{name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <Icons.MapPin />
            <span className="truncate">{project.barangay ? `${project.barangay}, ` : ''}{project.municipality}, {project.province}</span>
          </p>
        </div>
        <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-extrabold border uppercase tracking-wider ${style.badge}`}>
          {status}
        </span>
      </div>
      
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/50">
          <div className={`h-full rounded-full ${style.bar} transition-all duration-500`} style={{ width: `${project.progress || 0}%` }} />
        </div>
        <span className="text-xs font-extrabold text-slate-700 tabular-nums w-12 text-right">
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
  const [showAllRecentProjects, setShowAllRecentProjects] = useState(false);
  const [showAllRecentActivity, setShowAllRecentActivity] = useState(false);

  const statusAlias = {
    completed: 'Completed',
    'on-going': 'On-Going',
    ongoing: 'On-Going',
    'in progress': 'On-Going',
    proposed: 'Proposed',
    planning: 'Proposed',
    pending: 'Proposed',
  };

  const normalizeFmrStatus = (status) => {
    const key = String(status || '').trim().toLowerCase();
    return statusAlias[key] || status || 'Proposed';
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
        // Keep a larger local list so UI can collapse/expand without extra fetches.
        setProjects(recentProjects.slice(0, 12));
        setStats({
          total: normalizedProjects.length,
          completed: normalizedProjects.filter((p) => p.status === 'Completed').length,
          ongoing: normalizedProjects.filter((p) => p.status === 'On-Going').length,
          proposed: normalizedProjects.filter((p) => p.status === 'Proposed').length,
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
      { name: 'Proposed', value: stats.proposed, color: '#3b82f6' },
    ],
    [stats.completed, stats.ongoing, stats.proposed]
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
  const recentProjectsLimit = 3;
  const recentActivityLimit = 4;
  const visibleRecentProjects = showAllRecentProjects ? projects : projects.slice(0, recentProjectsLimit);
  const visibleRecentActivity = showAllRecentActivity ? activityFeed : activityFeed.slice(0, recentActivityLimit);

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
      <div className="space-y-8 font-sans">
        {/* Clean Hero Banner */}
        <section className="bg-slate-900 text-white rounded-2xl p-6 sm:p-7 border border-slate-800 shadow-sm">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-xl">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-900/60 border border-emerald-700/60 text-emerald-300 text-xs font-semibold">
                <Icons.Sprout />
                <span>DA Region VI Agricultural Oversight</span>
              </span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Welcome back, <span className="text-emerald-400">{userLabel}</span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
                Track Farm-to-Market Road progress, inspect municipal connectivity stats, and report road issues directly to engineers.
              </p>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap gap-3 w-full lg:w-auto">
              <Link
                to="/user/reports?action=new"
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors shadow-xs"
              >
                <Icons.Warning />
                <span>Report Road Issue</span>
              </Link>
              <Link
                to="/user/feedback"
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs sm:text-sm transition-colors shadow-xs"
              >
                <Icons.Plus />
                <span>Give Feedback</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          ) : (
            <>
              <StatCard icon={<Icons.Folder />} value={stats.total} label="Total FMR Projects" variant="sky" badgeText="Catalog" />
              <StatCard icon={<Icons.CheckCircle />} value={stats.completed} label="Completed Roads" variant="emerald" badgeText="Passed" />
              <StatCard icon={<Icons.Clock />} value={stats.ongoing} label="Active Construction" variant="amber" badgeText="In Progress" />
              <StatCard icon={<Icons.Document />} value={stats.proposed} label="Proposed / Planning" variant="violet" badgeText="Approved" />
            </>
          )}
        </section>

        {areaStatusAlert && (
          <section
            className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
              areaStatusAlert.tone === 'teal' || areaStatusAlert.tone === 'emerald'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <p className="text-xs sm:text-sm font-semibold flex items-center gap-2">
              <Icons.Warning />
              <span><strong>{areaStatusAlert.project.projectName}</strong> was marked {areaStatusAlert.project.status} on {formatProjectDate(areaStatusAlert.project)}.</span>
            </p>
            <button
              onClick={() => setDismissedStatusAlert(true)}
              className="text-xs font-semibold px-3 py-1 rounded-lg border border-current/20 hover:bg-white/40 transition-colors self-start sm:self-auto"
            >
              Dismiss
            </button>
          </section>
        )}

        <section className="grid lg:grid-cols-3 gap-6">
          {/* Nearby Projects Card */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col justify-between">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-900 text-base">In Your Municipality</h2>
                <p className="text-xs text-slate-500 mt-0.5">{userMunicipality ? `Projects linked to ${userMunicipality}` : 'Latest FMR projects in Region VI'}</p>
              </div>
              {!userMunicipality ? (
                <Link to="/user/profile" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                  Set location
                </Link>
              ) : (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">{userMunicipality}</span>
              )}
            </header>

            {nearbyProjects.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs sm:text-sm">No nearby FMR projects found for {userMunicipality} yet.</div>
            ) : (
              <div className="p-4 overflow-x-auto">
                <div className="flex gap-4 min-w-max">
                  {nearbyProjects.map((project) => {
                    const status = project.status || 'Proposed';
                    const statusStyles = {
                      Completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
                      'On-Going': 'bg-amber-100 text-amber-800 border-amber-200',
                      Proposed: 'bg-sky-100 text-sky-800 border-sky-200',
                    };
                    return (
                      <article key={project.id} className="w-72 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white p-4 transition-all space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-slate-900 text-sm line-clamp-2">{project.projectName}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusStyles[status] || statusStyles.Proposed}`}>
                            {status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate font-medium flex items-center gap-1">
                          <Icons.MapPin />
                          <span>{project.barangay || 'Barangay Not Specified'}</span>
                        </p>
                        
                        <div className="space-y-1">
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${status === 'Completed' ? 'bg-emerald-600' : status === 'On-Going' ? 'bg-amber-500' : 'bg-sky-500'}`}
                              style={{ width: `${project.progress || 0}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                            <span>{project.progress || 0}% Complete</span>
                            <span className="text-slate-400">{formatProjectDate(project)}</span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Donut Progress Chart */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <h2 className="font-bold text-slate-900 text-base">Project Status Breakdown</h2>
              <p className="text-xs text-slate-500 mt-0.5">Ratio of completed vs ongoing infrastructure</p>
            </div>

            <div className="mt-4 h-48 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" innerRadius={50} outerRadius={72} paddingAngle={2}>
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} stroke="#ffffff" strokeWidth={2} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value, name) => [`${value} Projects`, name]} contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Total FMRs</p>
                <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-semibold">
              {donutData.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5 text-slate-700 bg-slate-50 p-1.5 rounded-lg border border-slate-100 justify-center">
                  <span className="inline-block size-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Content Grid */}
        <section className="grid grid-cols-1 gap-6">
          {/* Projects List */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-900 text-base">Recent Projects Activity</h2>
                <p className="text-xs text-slate-500 mt-0.5">Latest Farm-to-Market Road progress updates across Iloilo</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {projects.length > recentProjectsLimit && (
                  <button
                    onClick={() => setShowAllRecentProjects((prev) => !prev)}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    {showAllRecentProjects ? 'Show less' : `Show more (${projects.length - recentProjectsLimit})`}
                  </button>
                )}
                <Link to="/user/fmr-projects" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800">
                  View all <Icons.ArrowRight />
                </Link>
              </div>
            </header>

            <div className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <ProjectSkeleton key={i} />)
              ) : projects.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mx-auto size-12 bg-emerald-50 text-emerald-700 rounded-xl grid place-items-center mb-2">
                    <Icons.Folder />
                  </div>
                  <p className="font-semibold text-slate-900 text-sm">No projects listed yet</p>
                  <p className="text-xs text-slate-500">Projects will appear here once loaded from DA</p>
                </div>
              ) : (
                visibleRecentProjects.map((p) => (
                  <div key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <ProjectCard project={p} />
                    <p className="px-4 pb-3 text-[11px] text-slate-500 font-medium">Updated: {formatProjectDate(p)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Activity & Submissions Grid */}
        <section className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-900 text-base">System Activity Stream</h2>
                <p className="text-xs text-slate-500 mt-0.5">Real-time inspections, citizen reports, and feedback</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {activityFeed.length > recentActivityLimit && (
                  <button
                    onClick={() => setShowAllRecentActivity((prev) => !prev)}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    {showAllRecentActivity ? 'Show less' : `Show more (${activityFeed.length - recentActivityLimit})`}
                  </button>
                )}
                <Link to="/user/reports" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800">View activity</Link>
              </div>
            </header>

            <div className="divide-y divide-slate-100">
              {activityFeed.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">No recent activity logged yet.</div>
              ) : (
                visibleRecentActivity.map((item) => (
                  <div key={item.id} className="px-5 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition-colors">
                    <span className="p-2 rounded-lg bg-slate-100 text-slate-700 shrink-0 border border-slate-200">
                      {item.type === 'report' ? <Icons.Document /> : item.type === 'update' ? <Icons.Road /> : <Icons.Feedback />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-semibold text-slate-800 leading-snug">{item.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 font-medium">{formatActivityTime(item.timestamp)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {hasSubmissions && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <h2 className="font-bold text-slate-900 text-base">My Account Submissions</h2>

              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-bold text-slate-900">Road Reports</p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">{submissions.reportsPending} Pending</span>
                </div>
                <p className="text-xs text-slate-500">{submissions.reportsSubmitted} submitted · {submissions.reportsResolved} resolved</p>
                <Link to="/user/reports?mine=1" className="inline-flex text-xs font-semibold text-emerald-700 hover:text-emerald-800 pt-1">
                  View My Reports →
                </Link>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-2">
                <p className="text-xs font-bold text-slate-900">Community Feedback</p>
                <p className="text-xs text-slate-500">{submissions.feedbackSubmitted} submitted entries</p>
                <Link to="/user/feedback?mine=1" className="inline-flex text-xs font-semibold text-emerald-700 hover:text-emerald-800 pt-1">
                  View My Feedback →
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Municipality Ranking Table */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900 text-base">Municipality Progress Rankings</h2>
              <p className="text-xs text-slate-500 mt-0.5">Percentage of completed Farm-to-Market roads per municipality</p>
            </div>
            <button
              onClick={() => setMunicipalityTableCollapsed((prev) => !prev)}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              {municipalityTableCollapsed ? 'Show Table' : 'Hide Table'}
            </button>
          </header>

          {!municipalityTableCollapsed && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold uppercase tracking-wider">Municipality</th>
                    <th className="px-5 py-3 text-left font-semibold uppercase tracking-wider">Total FMR Projects</th>
                    <th className="px-5 py-3 text-left font-semibold uppercase tracking-wider">Completed</th>
                    <th className="px-5 py-3 text-left font-semibold uppercase tracking-wider">Completion Ratio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {municipalityProgressRows.map((row) => {
                    const isUserMunicipality = userMunicipality && row.municipality.toLowerCase() === userMunicipality.toLowerCase();
                    return (
                      <tr key={row.municipality} className={isUserMunicipality ? 'bg-emerald-50/60 font-semibold' : 'hover:bg-slate-50/60 transition-colors'}>
                        <td className="px-5 py-3 font-semibold text-slate-900 flex items-center gap-2">
                          <span>{row.municipality}</span>
                          {isUserMunicipality && (
                            <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[9px] font-bold uppercase tracking-wider">My Area</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-700 font-medium">{row.total}</td>
                        <td className="px-5 py-3 text-slate-700 font-medium">{row.completed}</td>
                        <td className="px-5 py-3 font-bold text-emerald-800">{row.completionPct.toFixed(1)}%</td>
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



