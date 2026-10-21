import { useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { buttonClass } from '../ui/Button';

import { supabaseAdminPortal as defaultClient } from '../../lib/supabase';
import {
  assignPublicReportWork,
  cancelPublicReportRepair,
  reopenPublicReportRepair,
  requestPublicReportWorkCheck,
} from '../../services/publicReportWorkflow';
import { WORK_STAGES, friendlyReportError, isRepairOverdue, workOrderStage } from '../../lib/publicReportStatus';
import ZoomablePhoto from '../ui/ZoomablePhoto';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const partyName = (party) => (party === 'lgu' ? 'LGU' : 'contractor');

/**
 * Admin: send the job to the LGU (minor issue, no inspection needed) or to the
 * contractor (major issue, after the engineer's findings are validated).
 * `returned` is a job the handler sent back, shown so the admin sees why.
 */
export function SendWorkForm({ report, party, client = defaultClient, onNotify, onChanged, returned = null, costEstimate = null }) {
  const [targetDate, setTargetDate] = useState(addDays(party === 'lgu' ? 7 : 14));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await assignPublicReportWork(client, { reportId: report.id, party, targetDate, note: note.trim() || null });
      onNotify?.(`Sent to the ${partyName(party)}. They were notified.`);
      setNote('');
      onChanged?.();
    } catch (err) {
      onNotify?.(friendlyReportError(err, 'Could not send the job.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {returned?.cancel_reason && (
        <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
          {returned.cancel_reason} ({fmtDate(returned.returned_at)}). Send it again, or close the report if it cannot be fixed.
        </p>
      )}
      {costEstimate && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold text-slate-500">Engineer&rsquo;s estimated repair cost</p>
          <p className="text-sm font-bold text-slate-900">{costEstimate}</p>
          <p className="text-[11px] text-slate-400">Estimate only, not a payment. The {partyName(party)} sees it on the job.</p>
        </div>
      )}
      <label htmlFor="work-target" className="block text-[11px] font-semibold text-slate-600">
        Target date <span className="text-red-600">*</span>
      </label>
      <input
        id="work-target"
        type="date"
        value={targetDate}
        min={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setTargetDate(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
      />
      <label htmlFor="work-note" className="block text-[11px] font-semibold text-slate-600">
        Instructions <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <textarea
        id="work-note"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={party === 'lgu' ? 'e.g. Clear the fallen tree near the culvert' : 'e.g. Patch the 3 potholes the engineer marked'}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
      />
      <button type="button" onClick={send} disabled={busy || !targetDate} className={buttonClass('primary', 'md', 'w-full')}>
        {busy ? 'Sending...' : `Send to ${party === 'lgu' ? 'LGU' : 'Contractor'}`}
      </button>
    </div>
  );
}

/**
 * Admin view of an LGU or contractor job: where it is, what they sent, and
 * the admin's options (send back, ask the engineer to check, cancel).
 * Resolving the report happens in the action area that renders this.
 */
export default function WorkOrderPanel({ action, report, client = defaultClient, onNotify, onChanged, readOnly = false }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // 'reopen' | 'cancel'
  const [reason, setReason] = useState('');

  if (!action) return null;
  const stage = workOrderStage(action);
  const who = partyName(action.responsible_party);
  const overdue = isRepairOverdue(action);
  const checkPending = action.status === 'completed' && action.engineer_check_requested_at;

  const run = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      onNotify?.(message);
      setMode(null);
      setReason('');
      onChanged?.();
    } catch (err) {
      onNotify?.(friendlyReportError(err, 'That did not work. Please try again.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { key: 'assigned', label: `Sent to ${who}`, date: action.planned_at, done: true },
    { key: 'accepted', label: 'Accepted', date: action.accepted_at, extra: action.work_date ? `work date ${fmtDate(action.work_date)}` : null, done: Boolean(action.accepted_at) },
    { key: 'started', label: 'Work started', date: action.started_at, extra: action.start_note, done: Boolean(action.started_at) },
    { key: 'photo', label: 'After-photo sent', date: action.work_submitted_at, done: Boolean(action.work_submitted_at) },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{who} job</p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
          {checkPending ? 'Engineer checking on site' : WORK_STAGES[stage]?.staff}
        </span>
      </div>

      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2">
            <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${step.done ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white'}`}>
              {step.done && <CheckIcon className="size-3" aria-hidden="true" />}
            </span>
            <span className={step.done ? 'text-slate-800' : 'text-slate-400'}>
              <span className="font-semibold">{step.label}</span>
              {step.done && step.date ? ` · ${fmtDate(step.date)}` : ''}
              {step.done && step.extra ? ` · ${step.extra}` : ''}
            </span>
          </li>
        ))}
      </ol>

      {action.target_date && action.status === 'planned' && (
        <p className={overdue ? 'font-semibold text-red-700' : 'text-slate-500'}>
          Target {fmtDate(action.target_date)}{overdue ? ' · overdue' : ''}
        </p>
      )}
      {action.planning_note && <p className="rounded-md bg-slate-50 p-2 text-slate-600"><span className="font-semibold">Your note: </span>{action.planning_note}</p>}
      {action.work_note && <p className="rounded-md bg-slate-50 p-2 text-slate-600"><span className="font-semibold">{who === 'LGU' ? 'LGU' : 'Contractor'}: </span>{action.work_note}</p>}

      {action.work_photo_url && (
        <div className="grid grid-cols-2 gap-2">
          {(() => {
            const pair = [
              report?.photo_url && { src: report.photo_url, label: 'Before (citizen)' },
              { src: action.work_photo_url, label: `After (${who})` },
            ].filter(Boolean);
            return (
              <>
                <figure className="space-y-1">
                  <figcaption className="text-[11px] font-semibold text-slate-600">Before (citizen)</figcaption>
                  {report?.photo_url
                    ? <ZoomablePhoto src={report.photo_url} alt="Reported condition" photos={pair} index={0} wrapperClassName="w-full" className="h-28 w-full rounded-md border border-slate-200 object-cover" />
                    : <div className="h-28 rounded-md border border-dashed border-slate-200" />}
                </figure>
                <figure className="space-y-1">
                  <figcaption className="text-[11px] font-semibold text-emerald-800">
                    After ({who}) {Number.isFinite(Number(action.work_distance_m)) ? `· ${Math.round(Number(action.work_distance_m))} m from site` : ''}
                  </figcaption>
                  <ZoomablePhoto src={action.work_photo_url} alt="After-photo of the finished work" photos={pair} index={pair.length - 1} wrapperClassName="w-full" className="h-28 w-full rounded-md border border-emerald-200 object-cover" />
                </figure>
              </>
            );
          })()}
        </div>
      )}

      {action.status === 'verified' && action.verified_at && !readOnly && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
          The field engineer confirmed the repair on site {fmtDate(action.verified_at)}. You can resolve the report.
        </p>
      )}

      {!readOnly && (
        <div className="space-y-2">
          {action.status === 'completed' && action.responsible_party === 'contractor' && !action.engineer_check_requested_at && report?.assigned_engineer_id && !mode && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => requestPublicReportWorkCheck(client, { actionId: action.id }), 'The field engineer was asked to check the repair on site.')}
              className={buttonClass('secondary', 'sm', 'w-full')}
            >
              Ask the field engineer to check on site
            </button>
          )}

          {['completed', 'verified'].includes(action.status) && action.work_submitted_by && !mode && (
            <button type="button" onClick={() => setMode('reopen')} className={buttonClass('secondary', 'sm', 'w-full')}>
              Send back to the {who}
            </button>
          )}
          {action.status === 'planned' && !mode && (
            <button type="button" onClick={() => setMode('cancel')} className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-800">
              Cancel this job
            </button>
          )}

          {mode && (
            <div className="space-y-2">
              <label htmlFor="work-reason" className="block text-[11px] font-semibold text-slate-600">
                {mode === 'reopen' ? 'What still needs to be done?' : 'Why cancel?'} <span className="text-red-600">*</span>
              </label>
              <textarea
                id="work-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={mode === 'reopen' ? 'e.g. Branches are still on the road shoulder' : 'e.g. Sent to the wrong office'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setMode(null); setReason(''); }} disabled={busy} className={buttonClass('secondary', 'sm')}>
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  onClick={() => (mode === 'reopen'
                    ? run(() => reopenPublicReportRepair(client, { actionId: action.id, reason: reason.trim() }), `Sent back to the ${who}.`)
                    : run(() => cancelPublicReportRepair(client, { actionId: action.id, reason: reason.trim() }), 'Job cancelled.'))}
                  className={buttonClass(mode === 'reopen' ? 'warning' : 'danger', 'sm')}
                >
                  {busy ? 'Saving...' : mode === 'reopen' ? 'Send back' : 'Cancel job'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
