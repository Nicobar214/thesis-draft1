import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';

/* ─────────────────────────────────────────────────────────────
   Icon Components - Clean, consistent 24x24 icons
───────────────────────────────────────────────────────────── */
const Icons = {
  Folder: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  ),
  Clock: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  CheckCircle: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  Document: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  ),
  ArrowRight: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  ),
  MapPin: () => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  ),
  Menu: () => (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  ),
  X: () => (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  ),
  Plus: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  ),
  Logout: () => (
    <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
    </svg>
  ),
};

/* ─────────────────────────────────────────────────────────────
   Stat Card - Displays a single metric with icon
───────────────────────────────────────────────────────────── */
function StatCard({ icon, value, label, variant = 'default' }) {
  const variants = {
    default: 'bg-zinc-100 text-zinc-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    sky: 'bg-sky-100 text-sky-600',
    violet: 'bg-violet-100 text-violet-600',
  };

  return (
    <article className="bg-white rounded-2xl p-6 border border-zinc-200/60 hover:border-zinc-300 transition-colors">
      <div className={`inline-flex items-center justify-center size-10 rounded-xl mb-4 ${variants[variant]}`}>
        {icon}
      </div>
      <p className="text-3xl font-semibold tracking-tight text-zinc-900">{value}</p>
      <p className="mt-1 text-sm text-zinc-500">{label}</p>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────
   Project Card - Displays project info with progress
───────────────────────────────────────────────────────────── */
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
    <article className="p-4 hover:bg-zinc-50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-zinc-900 truncate">{name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
            <Icons.MapPin />
            <span className="truncate">{project.municipality}, {project.province}</span>
          </p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${style.badge}`}>
          {status}
        </span>
      </div>
      
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${project.progress || 0}%` }} />
        </div>
        <span className="text-xs font-medium text-zinc-600 tabular-nums w-10 text-right">
          {project.progress || 0}%
        </span>
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────
   Loading Skeletons
───────────────────────────────────────────────────────────── */
function StatSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-6 border border-zinc-200/60 animate-pulse">
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

/* ─────────────────────────────────────────────────────────────
   Main Dashboard Component
───────────────────────────────────────────────────────────── */
export default function UserDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, inProgress: 0, completed: 0, reports: 0 });
  const [projects, setProjects] = useState([]);

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
      const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (data) {
        setProjects(data.slice(0, 5));
        setStats({
          total: data.length,
          inProgress: data.filter(p => p.status === 'In Progress').length,
          completed: data.filter(p => p.status === 'Completed').length,
          reports: 0,
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
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
          <p className="mt-1 text-zinc-500">Track FMR projects in your community</p>
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
          <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-200/60 overflow-hidden">
            <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div>
                <h2 className="font-semibold text-zinc-900">Recent Projects</h2>
                <p className="text-sm text-zinc-500">Latest updates</p>
              </div>
              <Link to="/user/projects" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700">
                View all <Icons.ArrowRight />
              </Link>
            </header>

            <div className="divide-y divide-zinc-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <ProjectSkeleton key={i} />)
              ) : projects.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
                    <Icons.Folder />
                  </div>
                  <p className="font-medium text-zinc-900">No projects yet</p>
                  <p className="text-sm text-zinc-500">Projects will appear here</p>
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
              className="flex items-center gap-4 p-5 bg-emerald-600 hover:bg-emerald-700 rounded-2xl transition-colors text-white"
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
              className="flex items-center gap-4 p-5 bg-white hover:bg-zinc-50 rounded-2xl border border-zinc-200/60 transition-colors"
            >
              <div className="size-11 bg-zinc-100 rounded-xl grid place-items-center text-zinc-500">
                <Icons.Document />
              </div>
              <div>
                <p className="font-semibold text-zinc-900">Submit Report</p>
                <p className="text-sm text-zinc-500">Report issues or updates</p>
              </div>
            </Link>

            {/* Browse Projects CTA */}
            <Link
              to="/user/projects"
              className="flex items-center gap-4 p-5 bg-white hover:bg-zinc-50 rounded-2xl border border-zinc-200/60 transition-colors"
            >
              <div className="size-11 bg-zinc-100 rounded-xl grid place-items-center text-zinc-500">
                <Icons.Folder />
              </div>
              <div>
                <p className="font-semibold text-zinc-900">Browse Projects</p>
                <p className="text-sm text-zinc-500">View all FMR projects</p>
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
