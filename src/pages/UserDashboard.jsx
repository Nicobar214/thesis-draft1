import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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
    'In Progress': { badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
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
  const [stats, setStats] = useState({ total: 0, inProgress: 0, completed: 0, reports: 0 });
  const [fmrStats, setFmrStats] = useState({ total: 0, ongoing: 0, completed: 0, proposed: 0 });
  const [projects, setProjects] = useState([]);
  const [userLabel, setUserLabel] = useState('there');

  // Data fetching with realtime
  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, fetchData)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id || null;
      const label = user?.user_metadata?.full_name || user?.email?.split('@')?.[0] || 'there';
      setUserLabel(label);

      const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
      const reportCount = currentUserId
        ? (await supabase
            .from('public_reports')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', currentUserId)).count
        : 0;

      if (data) {
        setProjects(data.slice(0, 5));
        setStats({
          total: data.length,
          inProgress: data.filter(p => p.status === 'In Progress').length,
          completed: data.filter(p => p.status === 'Completed').length,
          reports: reportCount || 0,
        });
      }
      // Also fetch FMR stats
      const { data: fmrData } = await supabase.from('fmr_projects').select('status');
      if (fmrData) {
        setFmrStats({
          total: fmrData.length,
          ongoing: fmrData.filter(p => p.status === 'On-Going').length,
          completed: fmrData.filter(p => p.status === 'Completed').length,
          proposed: fmrData.filter(p => p.status === 'Proposed').length,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

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
              <StatCard icon={<Icons.Folder />} value={stats.total} label="Total Projects" variant="emerald" />
              <StatCard icon={<Icons.Clock />} value={stats.inProgress} label="In Progress" variant="amber" />
              <StatCard icon={<Icons.CheckCircle />} value={stats.completed} label="Completed" variant="sky" />
              <StatCard icon={<Icons.Document />} value={stats.reports} label="My Reports" variant="violet" />
            </>
          )}
        </section>

        {/* Content Grid */}
        <section className="grid lg:grid-cols-3 gap-6">
          {/* Projects List */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-semibold text-slate-900">Recent Projects</h2>
                <p className="text-sm text-slate-500">Latest updates</p>
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
                projects.map(p => <ProjectCard key={p.id} project={p} />)
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

            {/* Browse FMR Projects CTA */}
            <Link
              to="/user/fmr-projects"
              className="flex items-center gap-4 p-5 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200/60 transition-colors"
            >
              <div className="size-11 bg-slate-100 rounded-xl grid place-items-center text-slate-500">
                <Icons.Folder />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Browse FMR Projects</p>
                <p className="text-sm text-slate-500">View all FMR projects</p>
              </div>
            </Link>

            {/* FMR Projects CTA */}
            <Link
              to="/user/fmr-projects"
              className="flex items-center gap-4 p-5 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200/60 transition-colors"
            >
              <div className="size-11 bg-emerald-100 rounded-xl grid place-items-center text-teal-600 shrink-0">
                <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-slate-900">DA FMR Projects</p>
                <p className="text-sm text-slate-500">
                  {fmrStats.total > 0 ? `${fmrStats.ongoing} on-going, ${fmrStats.completed} completed` : 'View DA road projects'}
                </p>
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
      </div>
    </UserLayout>
  );
}



