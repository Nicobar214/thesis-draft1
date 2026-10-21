/* Jobs as the LGU or contractor sees them.
 *
 *   checking    -> the DA is still reviewing / inspecting (read-only for them);
 *   todo        -> assigned or accepted: accept, set a work date, start;
 *   in_progress -> started: fix it and send the on-site after-photo;
 *   waiting     -> after-photo sent, the DA is reviewing it;
 *   done        -> resolved, returned, or closed without a job for them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { handlerFor, isRepairOverdue, workOrderStage } from './publicReportStatus';

export const HANDLER_STAGES = {
  todo: { label: 'To do', hint: 'Accept new jobs and set a work date' },
  in_progress: { label: 'In progress', hint: 'Send the after-photo when the work is done' },
  waiting: { label: 'Sent — DA reviewing', hint: 'The DA is checking your after-photo' },
  checking: { label: 'Being checked by DA', hint: 'Review or site inspection in progress' },
  done: { label: 'Done', hint: 'Resolved or closed' },
};

export function handlerStage(report, action) {
  const reportStatus = String(report?.status || '').toLowerCase();
  if (reportStatus === 'resolved' || reportStatus === 'dismissed') return 'done';
  switch (workOrderStage(action)) {
    case 'assigned':
    case 'accepted':
      return 'todo';
    case 'in_progress':
      return 'in_progress';
    case 'done':
    case 'closed':
      return 'waiting';
    case 'returned':
    case 'cancelled':
      return 'done';
    default:
      return 'checking';
  }
}

/* Reports this handler is responsible for, each with its follow-up and stage. */
export function buildHandlerQueue(reports = [], party, actionsByReport = {}, today = new Date()) {
  return reports
    .filter((r) => handlerFor(r) === party)
    .map((report) => {
      const action = actionsByReport[report.id] || null;
      return {
        report,
        action,
        stage: handlerStage(report, action),
        overdue: isRepairOverdue(action, today),
      };
    });
}

export function countHandlerStages(queue = []) {
  const counts = { todo: 0, in_progress: 0, waiting: 0, checking: 0, done: 0, overdue: 0 };
  queue.forEach((item) => {
    counts[item.stage] += 1;
    if (item.overdue) counts.overdue += 1;
  });
  return counts;
}

/* Loads the follow-ups and engineer findings for the given reports. Row-level
 * security only returns the ones assigned to the signed-in LGU or contractor. */
export function useHandlerFollowUps(client, reportIds = []) {
  const [actions, setActions] = useState({});
  const [findings, setFindings] = useState({});
  const [loading, setLoading] = useState(false);
  const key = useMemo(() => [...reportIds].sort().join(','), [reportIds]);

  const load = useCallback(async () => {
    const ids = key ? key.split(',') : [];
    if (!client || ids.length === 0) {
      setActions({});
      setFindings({});
      return;
    }
    setLoading(true);
    try {
      const [actionRes, findingRes] = await Promise.all([
        client.from('public_report_repair_actions').select('*').in('report_id', ids),
        client
          .from('public_report_field_findings')
          .select('report_id, condition_observed, recommended_action, estimated_cost_range, field_photo_url, site_rating, submitted_at, inspection_number')
          .in('report_id', ids)
          .order('inspection_number', { ascending: true }),
      ]);
      const byReport = {};
      (actionRes.data || []).forEach((a) => { byReport[a.report_id] = a; });
      setActions(byReport);
      // Latest inspection wins.
      const findingByReport = {};
      (findingRes.data || []).forEach((f) => { findingByReport[f.report_id] = f; });
      setFindings(findingByReport);
    } catch (err) {
      console.warn('[follow-ups] could not load:', err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [client, key]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!client) return undefined;
    const channel = client
      .channel(`handler-follow-ups-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_repair_actions' }, () => load())
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, load]);

  return { actions, findings, loading, reload: load };
}

/* One plain status for a report on the handler's road, covering the DA's steps
 * before the job reaches them and the job itself. key: stable id for the
 * progress bar; tone: Tailwind badge classes. */

// The steps a contractor report goes through, for a progress bar.
export const HANDLER_REPORT_STEPS = [
  { label: 'DA review', keys: ['new'] },
  { label: 'Inspection', keys: ['inspecting', 'inspected'] },
  { label: 'Assigned', keys: ['assigned', 'accepted'] },
  { label: 'Repair', keys: ['in_progress'] },
  { label: 'DA check', keys: ['done'] },
  { label: 'Resolved', keys: ['resolved'] },
];
export function handlerReportStatus(report, action) {
  const status = String(report?.status || '').toLowerCase();
  const engineer = String(report?.engineer_status || '').toLowerCase();
  if (status === 'resolved') return { key: 'resolved', label: 'Resolved', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (status === 'dismissed') return { key: 'closed', label: 'Closed by DA', tone: 'bg-slate-100 text-slate-600 border-slate-200' };
  switch (workOrderStage(action)) {
    case 'assigned': return { key: 'assigned', label: 'Assigned to you', tone: 'bg-red-50 text-red-700 border-red-200' };
    case 'accepted': return { key: 'accepted', label: 'Accepted', tone: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'in_progress': return { key: 'in_progress', label: 'Repair in progress', tone: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'done': return { key: 'done', label: 'Photo sent, DA reviewing', tone: 'bg-amber-50 text-amber-800 border-amber-200' };
    default: break;
  }
  if (engineer === 'validated') return { key: 'inspected', label: 'Inspected, awaiting repair order', tone: 'bg-violet-50 text-violet-700 border-violet-200' };
  if (['assigned', 'in_progress', 'inspected', 'rejected'].includes(engineer)) return { key: 'inspecting', label: 'DA engineer inspecting', tone: 'bg-sky-50 text-sky-700 border-sky-200' };
  return { key: 'new', label: 'New, DA reviewing', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
}
