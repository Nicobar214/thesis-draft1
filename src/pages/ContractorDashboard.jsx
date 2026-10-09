/* ContractorDashboard.jsx – Landing page for contractors.
 * Reading order: headline numbers first, then where submissions are in the
 * review pipeline, then history.
 */
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import { formatPercentage } from '../lib/percentageFormat';
import { useContractorSummaryContext } from '../lib/contractorSummaryContext';
import Icons from '../components/Icons';

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

/** Supporting KPI card, smaller and secondary to the lead card -- same visual
 * language as FmrProjectKpis on the admin/farmer/LGU portals. */
function KpiMini({ icon, value, label, chip }) {
  return (
    <article className="flex flex-col rounded-2xl border border-slate-200/60 bg-white p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${chip}`}>{icon}</span>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
    </article>
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

  if (summary.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  const { projects, updates, awaitingEngineer, awaitingAdmin, withoutEngineer, approvedThisMonth } = summary;

  const withEngineerCount = projects.length - withoutEngineer.length;
  const avgAccomplishment = projects.length
    ? projects.reduce((s, p) => s + Number(p.accomplishment || 0), 0) / projects.length
    : 0;

  return (
    <div className="space-y-8">
      {/* 1. Headline numbers first: one lead card, same visual language as the
          admin/farmer/LGU FMR Projects KPI block, plus three smaller
          supporting cards below it. */}
      <section className="space-y-4">
        <SectionLabel title="Overview" />
        <article className="flex flex-col rounded-2xl border border-slate-200/60 bg-white p-6 shadow-xs sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Assigned Projects</p>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">{projects.length}</p>
            <p className="mt-1.5 text-sm text-slate-500">
              <span className="font-semibold text-emerald-700">{withEngineerCount}</span> with a site engineer assigned
            </p>
          </div>
          <div className="mt-4 grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 sm:mt-0">
            <Icons.Road />
          </div>
        </article>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiMini icon={<Icons.ShieldCheck />} value={withEngineerCount} label="With a Site Engineer" chip="bg-emerald-50 text-emerald-600" />
          <KpiMini icon={<Icons.Chart />} value={projects.length ? formatPercentage(avgAccomplishment) : '-'} label="Average Accomplishment" chip="bg-teal-50 text-teal-600" />
          <KpiMini icon={<Icons.AlertTriangle />} value={openReports ?? '-'} label="Open Public Reports" chip="bg-amber-50 text-amber-600" />
        </div>
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

      {/* 3. History */}
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

