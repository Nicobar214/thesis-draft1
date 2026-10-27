/* A one-line reminder on the dashboard when the DA made one of the contractor's
 * projects a priority (or an older priority action waits for a reply); the list
 * itself is on Do These First (/contractor/priority). Shows nothing when there
 * is nothing there. */
import { Link } from 'react-router-dom';
import { ChevronRightIcon, StarIcon } from 'lucide-react';
import { useContractorSummaryContext } from '../../lib/contractorSummaryContext';

export default function PriorityRepliesBanner() {
  const { priorityReplies = 0 } = useContractorSummaryContext();
  if (!priorityReplies) return null;
  return (
    <Link
      to="/contractor/priority"
      className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:bg-amber-100"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500 text-white">
        <StarIcon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {priorityReplies} of your projects {priorityReplies === 1 ? 'is a DA priority' : 'are DA priorities'}
        </span>
        <span className="block text-xs text-amber-800">Open Do These First to see which to work on first, and why.</span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-amber-700" aria-hidden="true" />
    </Link>
  );
}
