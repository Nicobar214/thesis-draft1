/* "Completed 10 days ahead of schedule" on a completed project's page, from its
 * completion and target dates (lib/projectDeadlines.js completionTiming). The
 * target already includes approved extensions; their days are added to the note
 * (project_extension_history). Shows nothing when a date is missing.
 *
 *   <CompletionTiming project={project} client={supabase} /> */
import { useEffect, useState } from 'react';
import { CalendarCheckIcon } from 'lucide-react';
import { supabase as defaultClient } from '../../lib/supabase';
import { COMPLETION_TONES, completionTiming } from '../../lib/projectDeadlines';

export default function CompletionTiming({ project, client = defaultClient, className = '' }) {
  const [extendedDays, setExtendedDays] = useState(0);
  const timing = completionTiming(project, extendedDays);
  const projectId = project?.id;
  const hasTiming = Boolean(timing);

  useEffect(() => {
    if (projectId == null || !hasTiming) return undefined;
    let alive = true;
    client.rpc('project_extension_history', { p_project: Number(projectId) })
      .then(({ data, error }) => {
        if (alive) setExtendedDays(error ? 0 : (data || []).reduce((sum, r) => sum + (Number(r.days_added) || 0), 0));
      });
    return () => { alive = false; };
  }, [client, projectId, hasTiming]);

  if (!timing) return null;
  return (
    <p className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${COMPLETION_TONES[timing.tone]} ${className}`}>
      <CalendarCheckIcon className="size-3.5" aria-hidden="true" />
      {timing.text}
    </p>
  );
}
