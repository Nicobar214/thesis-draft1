import { useEffect, useState } from 'react';
import { RotateCcwIcon } from 'lucide-react';
import { buttonClass } from '../ui/Button';

import { supabaseAdminPortal as defaultClient } from '../../lib/supabase';
import { reopenResolvedPublicReport } from '../../services/publicReportWorkflow';
import { friendlyReportError } from '../../lib/publicReportStatus';

/**
 * Admin, on a resolved report: reopen it when the problem is still there.
 *
 * Shown prominently (red) when the reporter answered "still a problem", with
 * their comment as the starting reason; otherwise a quiet link, since the
 * admin may learn of it another way (site visit, a new report). The admin
 * always decides; a citizen's answer never reopens a report by itself.
 * The job goes back to the same LGU/contractor to send a new after-photo
 * (supabase_report_reopen.sql).
 */
export default function ReopenReportPanel({ report, client = defaultClient, onNotify, onChanged }) {
  const [dispute, setDispute] = useState(null); // the reporter's "not fixed" answer
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!report?.id) return undefined;
    client
      .from('public_report_citizen_confirmations')
      .select('is_fixed, comment, updated_at')
      .eq('report_id', report.id)
      .eq('is_fixed', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => { if (alive && !error) setDispute(data || null); });
    return () => { alive = false; };
  }, [client, report?.id]);

  const start = () => {
    setReason(dispute?.comment ? `Reporter says it is still a problem: "${dispute.comment}"` : '');
    setOpen(true);
  };

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await reopenResolvedPublicReport(client, { reportId: report.id, reason: reason.trim() });
      onNotify?.('Report reopened. The LGU or contractor was asked to fix it again, and the reporter was told.');
      setOpen(false);
      onChanged?.();
    } catch (err) {
      onNotify?.(friendlyReportError(err, 'Could not reopen this report.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    // The reporter's answer itself is shown just above by CitizenConfirmationNote.
    return dispute ? (
      <button type="button" onClick={start} className={buttonClass('danger', 'sm', 'w-full')}>
        <RotateCcwIcon className="size-3.5" aria-hidden="true" /> Reopen for another fix
      </button>
    ) : (
      <button type="button" onClick={start} className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-800">
        Problem came back? Reopen this report
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <label htmlFor="reopen-reason" className="block text-[11px] font-semibold text-slate-600">
        What is still not fixed? <span className="text-red-600">*</span>
      </label>
      <textarea
        id="reopen-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. The canal is clogged again two days after the repair"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass('secondary', 'sm')}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy || !reason.trim()} className={buttonClass('danger', 'sm')}>
          {busy ? 'Reopening...' : 'Reopen report'}
        </button>
      </div>
    </div>
  );
}
