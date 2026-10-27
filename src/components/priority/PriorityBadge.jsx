/* The DA-priority badge on a contractor's project (My Projects, project details):
 * where the DA's priority action stands (lib/priorityDecisions.js priorityStage).
 *
 *   <PriorityBadge stage={priorityStage(decision)} /> */
import { CheckCircle2Icon, ClipboardCheckIcon, StarIcon, TriangleAlertIcon, XCircleIcon } from 'lucide-react';

const LOOK = {
  priority: { text: 'DA priority', tone: 'border-amber-500 bg-amber-500 text-white', Icon: StarIcon },
  ended: { text: 'DA priority · ended', tone: 'border-slate-200 bg-slate-50 text-slate-600', Icon: CheckCircle2Icon },
  action: { text: 'DA priority · reply needed', tone: 'border-teal-600 bg-teal-600 text-white', Icon: ClipboardCheckIcon },
  committed: { text: 'DA priority · committed', tone: 'border-teal-200 bg-teal-50 text-teal-800', Icon: ClipboardCheckIcon },
  decision_due: { text: 'DA priority · result pending', tone: 'border-amber-200 bg-amber-50 text-amber-800', Icon: TriangleAlertIcon },
  done: { text: 'Priority · done', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', Icon: CheckCircle2Icon },
  not_done: { text: 'Priority · not met', tone: 'border-rose-200 bg-rose-50 text-rose-700', Icon: XCircleIcon },
};

export default function PriorityBadge({ stage, className = '' }) {
  const look = stage ? LOOK[stage.stage] : null;
  if (!look) return null;
  const { Icon } = look;
  const text = stage.stage === 'priority' && stage.rank ? `${look.text} #${stage.rank}` : look.text;
  return (
    <span
      title={stage.action ? `DA action: ${stage.action}` : stage.reason || stage.note || undefined}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${look.tone} ${className}`}
    >
      <Icon className="size-3" aria-hidden="true" /> {text}
    </span>
  );
}
