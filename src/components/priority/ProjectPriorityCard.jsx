/* The DA priority follow-up on one project, start to end, for the contractor's
 * project details: the DA's action, the contractor's commitment, the result.
 * Nothing shows when the project has no priority follow-up in view
 * (lib/priorityDecisions.js priorityStage). */
import { Link } from 'react-router-dom';
import { priorityStage, OUTCOME_LABELS } from '../../lib/priorityDecisions';
import PriorityBadge from './PriorityBadge';

const fmtDay = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function Step({ label, done, children }) {
  return (
    <li className="relative pl-6">
      <span className={`absolute left-0 top-1 size-3 rounded-full border-2 ${done ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white'}`} aria-hidden="true" />
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm text-slate-700">{children}</div>
    </li>
  );
}

export default function ProjectPriorityCard({ decision }) {
  const stage = priorityStage(decision);
  if (!stage) return null;

  // A DA priority: nothing to answer, only why it matters and how it ended.
  if (stage.stage === 'priority' || stage.stage === 'ended') {
    return (
      <section className={`rounded-xl border p-4 ${stage.stage === 'priority' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">DA priority project</h3>
          <PriorityBadge stage={stage} />
        </div>
        {stage.stage === 'priority' ? (
          <>
            <p className="text-sm text-slate-700">
              The DA ranked this among the most valuable roads to finish. Please give it priority in your work.
            </p>
            {stage.reason && <p className="mt-1 text-xs text-slate-600">{stage.reason.replace(/^Rank #\d+ — /, 'Why: ')}</p>}
            {decision.note && <p className="mt-1 text-xs text-slate-500">DA: &ldquo;{decision.note}&rdquo;</p>}
          </>
        ) : (
          <p className="text-sm text-slate-700">{stage.note}</p>
        )}
      </section>
    );
  }
  const replied = Boolean(decision.responded_at);
  const outcome = decision.outcome;

  return (
    <section className="rounded-xl border border-teal-100 bg-teal-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">DA priority follow-up</h3>
        <PriorityBadge stage={stage} />
      </div>
      <ol className="space-y-3 border-l border-slate-200 pl-0 [&>li]:-ml-[6px]">
        <Step label="DA action" done>
          {decision.action}
          {decision.note && <span className="block text-xs text-slate-500">“{decision.note}”</span>}
        </Step>
        <Step label="Your commitment" done={replied}>
          {replied ? (
            <>
              “{decision.response_note}”
              {decision.committed_by && <span className="block text-xs font-semibold text-slate-600">Done by {fmtDay(decision.committed_by)}</span>}
            </>
          ) : (
            <Link to="/contractor/priority" className="font-semibold text-teal-700 hover:underline">Reply on Do These First →</Link>
          )}
        </Step>
        <Step label="Result" done={Boolean(outcome)}>
          {outcome ? (
            <span className={outcome === 'done' ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
              {OUTCOME_LABELS[outcome]}
              <span className="font-normal text-slate-500"> · {fmtDay(decision.outcome_at)}</span>
              {decision.outcome_note && <span className="block text-xs font-normal text-slate-600">DA: “{decision.outcome_note}”</span>}
            </span>
          ) : stage.stage === 'decision_due' ? (
            <span className="text-amber-700">Your done-by date has passed. The DA will mark the result.</span>
          ) : (
            <span className="text-slate-500">The DA marks Done or Not done after your done-by date.</span>
          )}
        </Step>
      </ol>
    </section>
  );
}
