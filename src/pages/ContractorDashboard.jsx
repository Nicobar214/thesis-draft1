/* ContractorDashboard.jsx – Landing page for contractors.
 * Reading order: one KPI block (projects + what needs action + where each
 * submission is in review), then recent history.
 */
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheckIcon, BuildingIcon, CheckCircle2Icon, MessageSquareWarningIcon, ChevronRightIcon } from 'lucide-react';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import HierarchyKpis from '../components/ui/HierarchyKpis';
import { formatPercentage } from '../lib/percentageFormat';
import { useContractorSummaryContext } from '../lib/contractorSummaryContext';
import Icons from '../components/Icons';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function SectionLabel({ title, action }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
      {action}
    </div>
  );
}

const statusKey = (s) => {
  const v = String(s || '').toLowerCase();
  if (v.includes('complete')) return 'Completed';
  if (v.includes('going') || v.includes('progress')) return 'On-Going';
  return 'Proposed';
};

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
      if (!user) { navigate('/contractor/login'); return; }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (prof?.role !== 'contractor') navigate('/contractor/login');
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
    return <HierarchyKpis loading lead={{}} items={[]} />;
  }

  const { projects, updates, awaitingEngineer, awaitingAdmin, withoutEngineer, approvedThisMonth, needsFix, needingUpdate } = summary;

  const withEngineerCount = projects.length - withoutEngineer.length;
  const avgAccomplishment = projects.length
    ? projects.reduce((s, p) => s + Number(p.accomplishment || 0), 0) / projects.length
    : 0;
  const byStatus = projects.reduce((acc, p) => { acc[statusKey(p.status)] += 1; return acc; }, { Completed: 0, 'On-Going': 0, Proposed: 0 });

  // What the contractor should do next, most urgent first.
  const actions = [
    needsFix.length > 0 && { key: 'fix', label: 'Updates returned for correction', count: needsFix.length, to: '/contractor/reports', tone: 'text-rose-700 bg-rose-50' },
    withoutEngineer.length > 0 && { key: 'eng', label: 'Projects without a site engineer', count: withoutEngineer.length, to: '/contractor/projects', tone: 'text-amber-700 bg-amber-50' },
    needingUpdate.length > 0 && { key: 'upd', label: 'No approved update this month', count: needingUpdate.length, to: '/contractor/projects', tone: 'text-slate-700 bg-slate-100' },
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <HierarchyKpis
        dense
        ariaLabel="Contractor summary"
        lead={{
          label: 'Assigned Projects',
          value: projects.length,
          note: (
            <span>
              <span className="font-semibold text-emerald-700">{projects.length ? formatPercentage(avgAccomplishment) : '0%'} average progress</span>
              {' '}· {withEngineerCount} with a site engineer
            </span>
          ),
          icon: <Icons.Road />,
          iconTone: 'bg-emerald-100 text-emerald-700',
          body: (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Needs your action</p>
              {actions.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-2.5 text-sm text-emerald-800">
                  <CheckCircle2Icon className="size-4" aria-hidden="true" />
                  Nothing waiting on you
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/70">
                  {actions.map((a) => (
                    <li key={a.key}>
                      <Link to={a.to} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm transition-colors hover:bg-slate-50">
                        <span className="truncate font-medium text-slate-800">{a.label}</span>
                        <span className="flex items-center gap-1.5">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${a.tone}`}>{a.count}</span>
                          <ChevronRightIcon className="size-4 text-slate-300" aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
          segments: [
            { label: 'Completed', value: byStatus.Completed, bar: 'bg-emerald-500' },
            { label: 'On-Going', value: byStatus['On-Going'], bar: 'bg-amber-400' },
            { label: 'Proposed', value: byStatus.Proposed, bar: 'bg-sky-500' },
          ].filter((s) => s.value > 0),
        }}
        items={[
          {
            icon: <ShieldCheckIcon className="size-4" aria-hidden="true" />,
            label: 'With Site Engineer',
            value: awaitingEngineer.length,
            hint: 'Step 1 · being checked on site',
            chip: 'bg-amber-50 text-amber-700',
            onClick: () => navigate('/contractor/reports'),
          },
          {
            icon: <BuildingIcon className="size-4" aria-hidden="true" />,
            label: 'With DA for Approval',
            value: awaitingAdmin.length,
            hint: 'Step 2 · certified, awaiting approval',
            chip: 'bg-sky-50 text-sky-700',
            onClick: () => navigate('/contractor/reports'),
          },
          {
            icon: <CheckCircle2Icon className="size-4" aria-hidden="true" />,
            label: 'Approved This Month',
            value: approvedThisMonth,
            hint: 'Step 3 · done',
            chip: 'bg-emerald-50 text-emerald-700',
            onClick: () => navigate('/contractor/reports'),
          },
          {
            icon: <MessageSquareWarningIcon className="size-4" aria-hidden="true" />,
            label: 'Open Public Reports',
            value: openReports ?? '—',
            hint: 'Citizen reports on your roads',
            chip: openReports ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500',
            onClick: () => navigate('/contractor/reports'),
          },
        ]}
      />

      {/* Recent history */}
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
