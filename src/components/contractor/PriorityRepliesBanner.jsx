/* A one-line reminder on the dashboard when a DA priority action waits for the
 * contractor's reply; the tasks themselves are on Priority Tasks
 * (/contractor/priority). Shows nothing when there is nothing to answer. */
import { Link } from 'react-router-dom';
import { ChevronRightIcon, ClipboardCheckIcon } from 'lucide-react';
import { useContractorSummaryContext } from '../../lib/contractorSummaryContext';

export default function PriorityRepliesBanner() {
  const { priorityReplies = 0 } = useContractorSummaryContext();
  if (!priorityReplies) return null;
  return (
    <Link
      to="/contractor/priority"
      className="flex items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 transition hover:bg-teal-100"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-teal-600 text-white">
        <ClipboardCheckIcon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {priorityReplies} priority task{priorityReplies === 1 ? '' : 's'} from the DA need{priorityReplies === 1 ? 's' : ''} your reply
        </span>
        <span className="block text-xs text-teal-800">Open Priority Tasks to say what you will do and by when.</span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-teal-700" aria-hidden="true" />
    </Link>
  );
}
