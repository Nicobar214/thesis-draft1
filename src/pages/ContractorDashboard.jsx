/* ContractorDashboard.jsx – Landing page for contractors.
 * Reading order, most urgent first:
 *   1. four headline numbers;
 *   2. "Needs your attention" and the portfolio overview, beside where
 *      submissions are in review and the next citizen-report repair jobs;
 *   3. My projects (full width): progress and deadline per project, most
 *      urgent first; a row opens the project.
 * The full submission history lives on My Projects (no duplicate here).
 */
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  BuildingIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  GaugeIcon,
  HammerIcon,
  HardHatIcon,
  MessageSquareWarningIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  UserXIcon,
} from 'lucide-react';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import HierarchyKpis from '../components/ui/HierarchyKpis';
import SeverityIcon from '../components/SeverityIcon';
import { formatPercentage } from '../lib/percentageFormat';
import { useContractorSummaryContext } from '../lib/contractorSummaryContext';
import { resolveCategory, resolveSpecificProblem, workOrderStage, WORK_STAGES } from '../lib/publicReportStatus';
import Icons from '../components/Icons';
import PriorityTasksPanel from '../components/priority/PriorityTasksPanel';
import { HALTED_STATUS_STYLES, haltedStatusLabel, isHaltedStatus } from '../lib/delayCases';

const statusKey = (s) => {
  const halted = haltedStatusLabel(s);
  if (halted) return halted;
  const v = String(s || '').toLowerCase();
  if (v.includes('complete')) return 'Completed';
  if (v.includes('going') || v.includes('progress')) return 'On-Going';
  return 'Proposed';
};

const STATUS_TONE = {
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'On-Going': 'bg-amber-50 text-amber-700 border-amber-200',
  Proposed: 'bg-sky-50 text-sky-700 border-sky-200',
  Suspended: HALTED_STATUS_STYLES.Suspended.border,
  Terminated: HALTED_STATUS_STYLES.Terminated.border,
};

const DAY_MS = 86400000;
function daysUntil(dateIso) {
  if (!dateIso) return null;
  const target = new Date(`${String(dateIso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / DAY_MS);
}

function deadlineText(project) {
  if (statusKey(project.status) === 'Completed') return { text: 'Completed', tone: 'text-emerald-700' };
  const d = daysUntil(project.target_completion_date);
  if (d === null) return { text: 'No target date', tone: 'text-slate-400' };
  if (d < 0) return { text: `${Math.abs(d)} days overdue`, tone: 'font-semibold text-red-600' };
  if (d <= 30) return { text: `${d} days left`, tone: 'font-semibold text-amber-700' };
  return { text: `${d} days left`, tone: 'text-slate-600' };
}

function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-xs ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkCls = 'inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800';

export default function ContractorDashboard() {
  return (
    <ContractorLayout>
      <DashboardBody />
    </ContractorLayout>
  );
}

function DashboardBody() {
  const navigate = useNavigate();
  const summary = useContractorSummaryContext();
  const [openReports, setOpenReports] = useState(null);
  const [repairJobs, setRepairJobs] = useState([]);
  const [userId, setUserId] = useState(null);

  // The portal is contractor-only: anyone else is sent back to sign in.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/contractor/login'); return; }
      setUserId(user.id);
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (prof?.role !== 'contractor') navigate('/contractor/login');
    })();
  }, [navigate]);

  const projectKey = summary.projects.map((p) => p.id).join(',');
  useEffect(() => {
    if (!projectKey) return undefined;
    let alive = true;
    (async () => {
      const [reports, jobs] = await Promise.all([
        supabase
          .from('public_reports')
          .select('id', { count: 'exact', head: true })
          .in('project_id', projectKey.split(',').map((id) => `fmr-${id}`))
          .eq('status', 'pending'),
        // Open citizen-report repair jobs (RLS: only this contractor's).
        supabase
          .from('public_report_repair_actions')
          .select('id, report_id, status, target_date, accepted_at, started_at, work_date, public_reports(project_name, barangay, severity_category, specific_problem, description)')
          .eq('responsible_party', 'contractor')
          .eq('status', 'planned')
          .order('target_date', { ascending: true })
          .limit(4),
      ]);
      if (!alive) return;
      setOpenReports(reports.count || 0);
      setRepairJobs(jobs.error ? [] : jobs.data || []);
    })();
    return () => { alive = false; };
  }, [projectKey, summary.repairsToDo]);

  if (summary.loading) {
    return <HierarchyKpis loading lead={{}} items={[]} />;
  }

  const { projects, awaitingEngineer, awaitingAdmin, withoutEngineer, approvedThisMonth, needsFix, needingUpdate } = summary;
  const repairsToDo = summary.repairsToDo || 0;

  const avgAccomplishment = projects.length
    ? projects.reduce((s, p) => s + Number(p.accomplishment || 0), 0) / projects.length
    : 0;
  const byStatus = projects.reduce((acc, p) => { const k = statusKey(p.status); if (k in acc) acc[k] += 1; return acc; }, { Completed: 0, 'On-Going': 0, Proposed: 0 });
  const overdueProjects = projects.filter((p) => statusKey(p.status) !== 'Completed' && !isHaltedStatus(p.status) && (daysUntil(p.target_completion_date) ?? 1) < 0);
  const inReview = awaitingEngineer.length + awaitingAdmin.length;

  // Everything waiting on the contractor, most urgent first.
  const actions = [
    needsFix.length > 0 && { key: 'fix', icon: RotateCcwIcon, label: 'Progress updates returned for correction', count: needsFix.length, to: '/contractor/projects?history=1', tone: 'bg-slate-100 text-slate-600' },
    repairsToDo > 0 && { key: 'repairs', icon: HammerIcon, label: 'Citizen report repairs assigned to you', count: repairsToDo, to: '/contractor/reports', tone: 'bg-slate-100 text-slate-600' },
    overdueProjects.length > 0 && { key: 'overdue', icon: CalendarClockIcon, label: 'Projects past their target date', count: overdueProjects.length, to: '/contractor/projects?status=Overdue', tone: 'bg-slate-100 text-slate-600' },
    withoutEngineer.length > 0 && { key: 'eng', icon: UserXIcon, label: 'Projects without a site engineer', count: withoutEngineer.length, to: '/contractor/projects', tone: 'bg-slate-100 text-slate-600' },
    needingUpdate.length > 0 && { key: 'upd', icon: ClipboardListIcon, label: 'No approved progress update this month', count: needingUpdate.length, to: '/contractor/projects', tone: 'bg-slate-100 text-slate-600' },
    openReports > 0 && { key: 'reports', icon: MessageSquareWarningIcon, label: 'New citizen reports on your roads', count: openReports, to: '/contractor/reports', tone: 'bg-slate-100 text-slate-600' },
  ].filter(Boolean);

  // Projects that most need attention first: overdue, then nearest deadline.
  const projectRows = [...projects].sort((a, b) => {
    const done = (p) => (statusKey(p.status) === 'Completed' ? 1 : 0);
    if (done(a) !== done(b)) return done(a) - done(b);
    return (daysUntil(a.target_completion_date) ?? 99999) - (daysUntil(b.target_completion_date) ?? 99999);
  });

  // Portfolio overview figures.
  const totalKm = projects.reduce((sum, p) => sum + (Number(p.project_length_km) || 0), 0);
  const dueSoon = projects.filter((p) => {
    const d = daysUntil(p.target_completion_date);
    return statusKey(p.status) !== 'Completed' && d !== null && d >= 0 && d <= 30;
  }).length;
  const statusSegments = [
    { key: 'Completed', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
    { key: 'On-Going', bar: 'bg-amber-400', dot: 'bg-amber-400' },
    { key: 'Proposed', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  ];

  const tiles = [
    { icon: <Icons.Road />, label: 'Assigned projects', value: projects.length, hint: `${byStatus['On-Going']} on-going · ${byStatus.Completed} completed`, chip: 'bg-slate-100 text-slate-600', to: '/contractor/projects' },
    { icon: <GaugeIcon className="size-4" aria-hidden="true" />, label: 'Average progress', value: projects.length ? formatPercentage(avgAccomplishment) : '0%', hint: overdueProjects.length ? `${overdueProjects.length} past target date` : 'Across your projects', chip: 'bg-slate-100 text-slate-600', to: '/contractor/projects', bar: Math.min(100, avgAccomplishment) },
    { icon: <ShieldCheckIcon className="size-4" aria-hidden="true" />, label: 'Updates in review', value: inReview, hint: `${approvedThisMonth} approved this month`, chip: 'bg-slate-100 text-slate-600', to: '/contractor/projects?history=1' },
    { icon: <HammerIcon className="size-4" aria-hidden="true" />, label: 'Repairs to do', value: repairsToDo, hint: 'From citizen reports', chip: 'bg-slate-100 text-slate-600', to: '/contractor/reports' },
  ];

  const pipeline = [
    { icon: HardHatIcon, label: 'With site engineer', hint: 'Being checked on site', value: awaitingEngineer.length, tone: 'bg-slate-100 text-slate-600' },
    { icon: BuildingIcon, label: 'With DA for approval', hint: 'Certified, awaiting approval', value: awaitingAdmin.length, tone: 'bg-slate-100 text-slate-600' },
    { icon: CheckCircle2Icon, label: 'Approved this month', hint: 'Accepted by the DA', value: approvedThisMonth, tone: 'bg-slate-100 text-slate-600' },
  ];

  return (
    <div className="space-y-6">
      {/* What the DA's prioritization asks of this contractor (only when there is something). */}
      <div id="priority-tasks">
        <PriorityTasksPanel client={supabase} userId={userId} role="contractor" compact />
      </div>

      {/* 1. Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.label}
            to={t.to}
            className="group flex flex-col rounded-2xl border border-slate-200/70 bg-white p-4 shadow-xs transition hover:border-slate-300 hover:shadow-sm"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className={`grid size-8 place-items-center rounded-lg ${t.chip}`}>{t.icon}</span>
                <span className="text-xs font-medium text-slate-500">{t.label}</span>
              </span>
              <ChevronRightIcon className="size-4 text-slate-300 transition group-hover:text-slate-500" aria-hidden="true" />
            </span>
            <span className="mt-3 text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{t.value}</span>
            {t.bar !== undefined && (
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-teal-500" style={{ width: `${t.bar}%` }} />
              </span>
            )}
            <span className="mt-1.5 truncate text-xs text-slate-400">{t.hint}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* 2. What needs the contractor */}
          <Panel title="Needs your attention">
            {actions.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-emerald-800">
                <CheckCircle2Icon className="size-5 text-emerald-600" aria-hidden="true" />
                You&rsquo;re all caught up. Nothing is waiting on you.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <li key={a.key}>
                      <Link to={a.to} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${a.tone}`}>
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{a.label}</span>
                        <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-bold tabular-nums text-white">{a.count}</span>
                        <ChevronRightIcon className="size-4 text-slate-300 group-hover:text-slate-500" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* 3. Portfolio overview: status mix and key figures */}
          <Panel title="Portfolio overview">
            <div className="space-y-5 p-5">
              <div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                  {statusSegments.map((seg) => (byStatus[seg.key] > 0 ? (
                    <span key={seg.key} className={seg.bar} style={{ width: `${(byStatus[seg.key] / Math.max(1, projects.length)) * 100}%` }} />
                  ) : null))}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                  {statusSegments.map((seg) => (
                    <span key={seg.key} className="inline-flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${seg.dot}`} />
                      {seg.key} <span className="font-semibold tabular-nums text-slate-900">{byStatus[seg.key]}</span>
                    </span>
                  ))}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Road length', value: `${totalKm.toLocaleString('en-US', { maximumFractionDigits: 2 })} km` },
                  { label: 'With site engineer', value: `${projects.length - withoutEngineer.length} of ${projects.length}` },
                  { label: 'Due in 30 days', value: dueSoon },
                  { label: 'Overdue', value: overdueProjects.length, alert: overdueProjects.length > 0 },
                ].map((f) => (
                  <div key={f.label} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                    <dt className="text-[11px] font-medium text-slate-500">{f.label}</dt>
                    <dd className={`mt-0.5 text-lg font-bold tabular-nums ${f.alert ? 'text-red-600' : 'text-slate-900'}`}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {/* 4a. Where submissions are in review */}
          <Panel title="Progress updates" action={<Link to="/contractor/projects?history=1" className={linkCls}>History <ChevronRightIcon className="size-3.5" aria-hidden="true" /></Link>}>
            <ol className="space-y-1 p-3">
              {pipeline.map((step, i) => {
                const Icon = step.icon;
                return (
                  <li key={step.label}>
                    <Link to="/contractor/projects?history=1" className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${step.tone}`}>
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800">{i + 1}. {step.label}</span>
                        <span className="block text-xs text-slate-400">{step.hint}</span>
                      </span>
                      <span className="text-lg font-bold tabular-nums text-slate-900">{step.value}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Panel>

          {/* 4b. Next repair jobs from citizen reports */}
          <Panel className="flex flex-1 flex-col" title="Repair jobs" action={<Link to="/contractor/reports" className={linkCls}>Open <ChevronRightIcon className="size-3.5" aria-hidden="true" /></Link>}>
            {repairJobs.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
                  <HammerIcon className="size-5" aria-hidden="true" />
                </span>
                <p className="text-sm font-medium text-slate-700">No repair jobs right now</p>
                <p className="text-xs text-slate-400">Jobs the DA assigns from citizen reports appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {repairJobs.map((job) => {
                  const report = job.public_reports || {};
                  const left = daysUntil(job.target_date);
                  return (
                    <li key={job.id}>
                      <Link to="/contractor/reports" className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                        <span className="mt-0.5"><SeverityIcon category={resolveCategory(report)} className="size-4 text-slate-500" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{resolveSpecificProblem(report)?.label || 'Road repair'}</span>
                          <span className="block truncate text-xs text-slate-500">{report.project_name}{report.barangay ? ` · ${report.barangay}` : ''}</span>
                          <span className="mt-1 block text-[11px] font-semibold text-slate-600">{WORK_STAGES[workOrderStage(job)]?.label}</span>
                        </span>
                        {left !== null && (
                          <span className={`shrink-0 text-xs ${left < 0 ? 'font-semibold text-red-600' : left <= 3 ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>
                            {left < 0 ? `${Math.abs(left)}d late` : `${left}d left`}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* 5. Projects at a glance: most urgent first; a row opens the project */}
      <Panel title={`My projects (${projects.length})`} action={<Link to="/contractor/projects" className={linkCls}>All projects <ChevronRightIcon className="size-3.5" aria-hidden="true" /></Link>}>
        {projects.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No projects assigned to you yet.</p>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_1.5rem] gap-4 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 md:grid">
              <span>Project</span><span>Site engineer</span><span>Progress</span><span className="text-right">Deadline</span><span />
            </div>
            <ul className="divide-y divide-slate-100">
              {projectRows.slice(0, 8).map((p) => {
                const status = statusKey(p.status);
                const deadline = deadlineText(p);
                const pct = Math.min(100, Math.round(Number(p.accomplishment || 0)));
                return (
                  <li key={p.id}>
                    <Link
                      to={`/contractor/projects?project=${p.id}`}
                      className="group grid grid-cols-1 gap-2 px-5 py-3.5 transition-colors hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_1.5rem] md:items-center md:gap-4"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-teal-700">{p.project_name}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${STATUS_TONE[status]}`}>{status}</span>
                          <span className="truncate">{p.municipality}</span>
                        </span>
                      </span>
                      <span className={`text-xs ${p.site_engineer_id ? 'text-slate-600' : 'font-semibold text-amber-700'}`}>
                        {p.site_engineer_id ? 'Assigned' : 'Not assigned'}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span className={`block h-full rounded-full ${status === 'Completed' ? 'bg-emerald-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-700">{pct}%</span>
                      </span>
                      <span className={`text-xs md:text-right ${deadline.tone}`}>{deadline.text}</span>
                      <ChevronRightIcon className="hidden size-4 text-slate-300 group-hover:text-slate-500 md:block" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {projects.length > 8 && (
              <Link to="/contractor/projects" className="block border-t border-slate-100 px-5 py-2.5 text-center text-xs font-semibold text-teal-700 hover:bg-slate-50">
                View all {projects.length} projects
              </Link>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
