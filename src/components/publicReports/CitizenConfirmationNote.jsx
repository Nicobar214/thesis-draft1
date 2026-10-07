import { useEffect, useState } from 'react';
import { supabaseAdminPortal as defaultClient } from '../../lib/supabase';

/**
 * Staff-side, read-only view of the reporter's "Is it actually fixed?" answer
 * (written by FixConfirmationCard on the citizen side).
 *
 * A "still a problem" answer is shown as a warning because it means a repair the
 * DA recorded may not have held. Renders nothing until the citizen has answered,
 * and nothing if the table has not been created yet.
 */
export default function CitizenConfirmationNote({ reportId, client = defaultClient }) {
  const [answer, setAnswer] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!reportId) return undefined;

    (async () => {
      const { data, error } = await client
        .from('public_report_citizen_confirmations')
        .select('is_fixed, comment, updated_at')
        .eq('report_id', reportId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alive && !error && data) setAnswer(data);
    })();

    return () => {
      alive = false;
    };
  }, [reportId, client]);

  if (!answer) return null;

  const fixed = answer.is_fixed;
  const when = answer.updated_at
    ? new Date(answer.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div
      role={fixed ? 'status' : 'alert'}
      className={`rounded-lg border p-3 text-xs space-y-1 ${
        fixed ? 'border-emerald-200 bg-white text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'
      }`}
    >
      <p className="font-semibold">
        {fixed ? 'Reporter confirms it is fixed' : 'Reporter says it is still a problem'}
        {when && <span className="font-normal opacity-70"> &middot; {when}</span>}
      </p>
      {answer.comment && <p>&ldquo;{answer.comment}&rdquo;</p>}
      {!fixed && <p className="opacity-80">Consider re-checking this repair on site.</p>}
    </div>
  );
}
