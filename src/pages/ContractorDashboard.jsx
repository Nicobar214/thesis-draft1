/* ContractorDashboard.jsx – Landing page for contractors.
 * Reading order: what needs the contractor first, then where their submissions are in the
 * review pipeline, then the headline numbers, then history.
 */
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import { formatPercentage } from '../lib/percentageFormat';
import { useContractorSummaryContext } from '../lib/contractorSummaryContext';
import { ArrowRightIcon, CircleCheckIcon, RefreshCwIcon, TriangleAlertIcon, UserRoundXIcon } from 'lucide-react';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function SectionLabel({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** One row of the "needs your action" list. */
// eslint-disable-next-line no-unused-vars -- icon is rendered as a JSX tag below
function ActionRow({ tone, icon: Icon, title, detail, to, cta }) {
  const tones = {
    rose: 'border-rose-200 bg-rose-50/60 text-rose-700',
    amber: 'border-amber-200 bg-amber-50/60 text-amber-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  };
  return (
    <li className={`flex items-start gap-3 rounded-xl border p-3.5 ${tones[tone] || tones.slate}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {detail && <p className="mt-0.5 text-xs text-slate-600 break-words">{detail}</p>}
      </div>
      {to && (
        <Link to={to} className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50">
          {cta} <ArrowRightIcon className="size-3" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

/** A pipeline stage: count on top, what it means underneath. */
function PipelineStep({ n, label, hint, count, tone, to }) {
  const tones = {
    amber: 'text-amber-700 border-amber-200',
    sky: 'text-sky-700 border-sky-200',
    emerald: 'text-emerald-700 border-emerald-200',
  };
  return (
    <Link to={to} className={`group flex-1 rounded-2xl border bg-white p-4 shadow-xs transition hover:shadow-md ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        <span className="grid size-5 place-items-center rounded-full bg-slate-100 text-slate-600">{n}</span>
        {label}
      </div>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${tones[tone].split(' ')[0]}`}>{count}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Link>
  );
}

function KpiTile({ value, label }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
      <p className="text-2xl font-bold leading-none tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{label}</p>
    </div>
  );
}

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
  const [refreshing, setRefreshing] = useState(false);

  // The portal is contractor-only: anyone else is sent back to sign in.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/signin'); return; }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (prof?.role !== 'contractor') navigate('/signin');
    })();
  }, [navigate]);

  const projectKey = summary.projects.map((p) => p.id).join(',');
  useEffect(() => {
    if (!projectKey) return;
    let alive = true;
    (async () => {
      const { count } = await supabase
        .from('public_reports')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectKey.split(',').map((id) => `fmr-${id}`))
        .eq('status', 'pending');
      if (alive) setOpenReports(count || 0);
    })();
    return () => { alive = false; };
  }, [projectKey]);

  const refresh = async () => {
    setRefreshing(true);
    await summary.reload();
    setRefreshing(false);
  };

  if (summary.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  const { projects, updates, needsFix, awaitingEngineer, awaitingAdmin, needingUpdate, withoutEngineer, busyProjectIds, approvedThisMonth } = summary;

  // Updates the contractor can act on now: has an engineer, nothing already in review.
  const dueNow = needingUpdate.filter((p) => p.site_engineer_id && !busyProjectIds.has(p.id));
  const hasActions = needsFix.length + withoutEngineer.length + dueNow.length > 0;

  return (
    <div className="space-y-8">
      {/* 1. What needs the contractor */}
      <section className="space-y-3">
        <SectionLabel
          title="Needs your action"
          subtitle={hasActions ? 'Do these first. Everything else is waiting on someone else.' : 'You are up to date.'}
          action={(
            <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCwIcon className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          )}
        />
        {hasActions ? (
          <ul className="space-y-2">
            {needsFix.map((u) => (
              <ActionRow
                key={u.id}
                tone="rose"
                icon={TriangleAlertIcon}
                title={`${u.fmr_projects?.project_name || `Project ${u.fmr_project_id}`}: ${u.stage.label.toLowerCase()}`}
                detail={u.certification_remarks || u.approval_remarks || u.stage.helper}
                to="/contractor/projects"
                cta="Correct and resubmit"
              />
            ))}
            {withoutEngineer.map((p) => (
              <ActionRow
                key={`noeng-${p.id}`}
                tone="amber"
                icon={UserRoundXIcon}
                title={`${p.project_name}: no site engineer assigned`}
                detail="You cannot submit progress until the DA office assigns a site engineer to this project."
              />
            ))}
            {dueNow.map((p) => (
              <ActionRow
                key={`due-${p.id}`}
                tone="slate"
                icon={ArrowRightIcon}
                title={`${p.project_name}: no approved update this month`}
                detail="Report your latest accomplishment so the site engineer can validate it."
                to="/contractor/projects"
                cta="Submit progress"
              />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            <CircleCheckIcon className="size-4" aria-hidden="true" />
            Nothing needs your action right now.
          </p>
        )}
      </section>

      {/* 2. Where the submissions are */}
      <section className="space-y-3">
        <SectionLabel title="Your submissions in review" subtitle="Each update is validated by your site engineer, then approved by the DA office." />
        <div className="flex flex-col gap-3 md:flex-row">
          <PipelineStep n="1" label="Site engineer" count={awaitingEngineer.length} tone="amber" to="/contractor/reports" hint="Being checked against the site" />
          <PipelineStep n="2" label="DA approval" count={awaitingAdmin.length} tone="sky" to="/contractor/reports" hint="Certified, waiting for approval" />
          <PipelineStep n="3" label="Approved" count={approvedThisMonth} tone="emerald" to="/contractor/reports" hint="Approved this month" />
        </div>
      </section>

      {/* 3. Headline numbers */}
      <section className="space-y-3">
        <SectionLabel title="Overview" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile value={projects.length} label="Assigned projects" />
          <KpiTile value={projects.length - withoutEngineer.length} label="With a site engineer" />
          <KpiTile value={projects.length ? formatPercentage(projects.reduce((s, p) => s + Number(p.accomplishment || 0), 0) / projects.length) : '-'} label="Average accomplishment" />
          <KpiTile value={openReports ?? '-'} label="Open public reports on my projects" />
        </div>
      </section>

      {/* 4. History */}
      <section className="space-y-3">
        <SectionLabel
          title="Recent submissions"
          action={<Link to="/contractor/reports" className="text-xs font-semibold text-teal-700 hover:text-teal-800">See all →</Link>}
        />
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          {updates.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-slate-700">No submissions yet</p>
              <p className="text-xs text-slate-500 mt-1">Open My Projects and submit your first progress update.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {updates.slice(0, 5).map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{u.fmr_projects?.project_name || `Project ${u.fmr_project_id}`}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {fmtDate(u.submitted_at)}
                      {u.fmr_projects?.municipality ? ` · ${u.fmr_projects.municipality}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-bold text-slate-700">{formatPercentage(u.reported_accomplishment)}</span>
                  <span className={`shrink-0 inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold ${u.stage.badge}`}>{u.stage.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

