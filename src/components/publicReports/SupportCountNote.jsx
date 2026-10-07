import { useEffect, useState } from 'react';
import { supabaseAdminPortal as defaultClient } from '../../lib/supabase';

/**
 * Staff-side, read-only: how many other residents say they see the same problem
 * (written by SupportReportControl on the citizen side). A priority signal for
 * triage - it never shows who. Renders nothing until someone has backed the report,
 * and nothing if the table has not been created yet.
 *
 * Render with key={reportId} so switching reports starts from a clean state.
 */
export default function SupportCountNote({ reportId, client = defaultClient }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!reportId) return undefined;

    (async () => {
      const { data, error } = await client
        .from('public_report_support_counts')
        .select('support_count')
        .eq('report_id', reportId)
        .maybeSingle();
      if (alive && !error && data) setCount(Number(data.support_count) || 0);
    })();

    return () => {
      alive = false;
    };
  }, [reportId, client]);

  if (count < 1) return null;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
      <p className="font-semibold">
        {count === 1 ? '1 other resident' : `${count} other residents`} say they see this problem too
      </p>
      <p className="mt-0.5 opacity-80">More people affected can justify a higher priority.</p>
    </div>
  );
}
