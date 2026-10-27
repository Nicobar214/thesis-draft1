/* Under a project's "Target Completion": where the date came from when it was
 * moved by the delay follow-up — the original target, the days added, and the
 * latest extension's reason (project_extension_history). Shows nothing when the
 * project was never extended.
 *
 *   <TargetCompletionNote projectId={project.id} client={supabase} /> */
import { useEffect, useState } from 'react';
import { supabase as defaultClient } from '../../lib/supabase';
import { causeLabel, daysBetween, fmtDay, parseTargetDate } from '../../lib/delayCases';

export default function TargetCompletionNote({ projectId, client = defaultClient, className = '' }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (projectId == null) return undefined;
    let alive = true;
    client.rpc('project_extension_history', { p_project: Number(projectId) })
      .then(({ data, error }) => { if (alive) setRows(error ? [] : data || []); });
    return () => { alive = false; };
  }, [client, projectId]);

  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const totalDays = daysBetween(parseTargetDate(rows[0].previous_target), parseTargetDate(latest.new_target));
  const reason = latest.contractor_explanation || latest.da_reason;
  return (
    <div className={`mt-1.5 space-y-0.5 text-xs text-slate-600 ${className}`}>
      <p>
        <span className="font-medium text-amber-700">Extended</span> from {fmtDay(rows[0].previous_target)}
        {' '}(+{totalDays} day{totalDays === 1 ? '' : 's'}{rows.length > 1 ? `, ${rows.length} extensions` : ''})
      </p>
      {reason && (
        <p>
          <span className="font-medium text-slate-500">Reason{latest.contractor_cause ? ` (${causeLabel(latest.contractor_cause)})` : ''}: </span>
          {reason}
        </p>
      )}
    </div>
  );
}
