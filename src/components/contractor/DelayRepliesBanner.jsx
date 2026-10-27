/* A one-line reminder on the dashboard and My Projects when the DA is waiting for
 * a delay explanation; the replies themselves are on Delay Follow-ups
 * (/contractor/delays). Shows nothing when there is nothing to answer. */
import { Link } from 'react-router-dom';
import { CalendarClockIcon, ChevronRightIcon } from 'lucide-react';
import { useContractorSummaryContext } from '../../lib/contractorSummaryContext';

export default function DelayRepliesBanner() {
  const { delayReplies = 0 } = useContractorSummaryContext();
  if (!delayReplies) return null;
  return (
    <Link
      to="/contractor/delays"
      className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 transition hover:bg-red-100"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-red-600 text-white">
        <CalendarClockIcon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {delayReplies} late project{delayReplies === 1 ? ' needs' : 's need'} your explanation
        </span>
        <span className="block text-xs text-red-800">The DA is waiting for your reply. Open Delay Follow-ups to answer.</span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-red-700" aria-hidden="true" />
    </Link>
  );
}
