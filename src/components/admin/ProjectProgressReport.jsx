import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PrinterIcon, XIcon } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { BEHIND_TOLERANCE, NEARLY_THRESHOLD, scheduleStatus } from '../../lib/projectSchedule';
import { MODAL_OVERLAY, MODAL_PANEL, ModalEffects } from '../ui/Modal';

const PRINT_CSS = `
@page { size: A4; margin: 16mm; }
@media print {
  body > *:not(.kt-print-portal) { display: none !important; }
  .kt-print-portal .kt-overlay { position: static !important; display: block !important; background: none !important; padding: 0 !important; backdrop-filter: none !important; }
  .kt-print-portal .kt-panel { max-height: none !important; overflow: visible !important; box-shadow: none !important; border-radius: 0 !important; max-width: none !important; animation: none !important; }
  .kt-print-portal .kt-scroll { overflow: visible !important; }
  .kt-print-portal .kt-no-print { display: none !important; }
  .kt-print-portal .kt-sheet { padding: 0 !important; }
  .kt-print-portal table { page-break-inside: auto; }
  .kt-print-portal tr { page-break-inside: avoid; }
}
`;

const peso = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? 'Not recorded' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
const day = (v) => {
  if (!v) return 'Not recorded';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
};
const pct = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? 'Not recorded' : `${Number(v).toFixed(Number(v) % 1 === 0 ? 0 : 1)}%`);
const who = (p) => (p ? p.full_name || p.email || 'Unknown' : null);

function Row({ label, children }) {
  return (
    <tr className="border-b border-slate-300 align-top">
      <th className="w-56 bg-slate-50 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600">{label}</th>
      <td className="px-3 py-2 text-sm text-slate-900">{children}</td>
    </tr>
  );
}

/**
 * Printable progress report for one FMR project, in the layout the DA asked for. Everything is
 * read from approved and certified records; a missing value prints "Not recorded" instead of a guess.
 * "Print / Save as PDF" uses the browser's print dialog.
 */
export default function ProjectProgressReport({ project, onClose }) {
  const [updates, setUpdates] = useState(null);
  const [people, setPeople] = useState({});
  const [error, setError] = useState('');
  const [generatedAt] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('progress_updates')
        .select('id, reported_accomplishment, certified_accomplishment, certification_status, status, amount_this_billing, period_start, period_end, submitted_at, certified_at, certified_by, reviewed_at, reviewed_by, site_engineer_id, contractor_id')
        .eq('fmr_project_id', project.id)
        .order('submitted_at', { ascending: false });
      if (!alive) return;
      if (err) { setError(err.message); setUpdates([]); return; }
      const rows = data || [];
      const ids = [...new Set([project.contractor_id, project.site_engineer_id, ...rows.flatMap((r) => [r.certified_by, r.reviewed_by, r.site_engineer_id])].filter(Boolean))];
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
        if (alive) setPeople(Object.fromEntries((profs || []).map((p) => [p.id, p])));
      }
      if (alive) setUpdates(rows);
    })();
    return () => { alive = false; };
  }, [project.id, project.contractor_id, project.site_engineer_id]);

  const report = useMemo(() => {
    const rows = updates || [];
    const approved = rows.filter((u) => u.status === 'approved');
    const certified = rows.filter((u) => u.certification_status === 'certified');
    const latestCertified = certified[0] || null;
    const billed = approved.reduce((s, u) => s + Number(u.amount_this_billing || 0), 0);
    const hasBilling = approved.some((u) => u.amount_this_billing != null);
    const waiting = rows.filter((u) => u.status === 'pending').length;
    return { approved, latestCertified, billed: hasBilling ? billed : null, waiting };
  }, [updates]);

  const schedule = scheduleStatus(project, generatedAt.getTime());
  const contract = project.contract_amount != null ? Number(project.contract_amount) : null;
  const latestApproved = report.approved[0] || null;
  const certifiedBy = report.latestCertified ? who(people[report.latestCertified.certified_by]) : null;
  const awaitingApproval = report.latestCertified && report.latestCertified.status !== 'approved';

  return createPortal(
    <div className="kt-print-portal">
      <style>{PRINT_CSS}</style>
      <div className={`${MODAL_OVERLAY} kt-overlay`} onClick={onClose}>
        <ModalEffects onClose={onClose} />
        <div className={`${MODAL_PANEL} kt-panel max-w-4xl`} role="dialog" aria-modal="true" aria-label="Project progress report" onClick={(e) => e.stopPropagation()}>
          <div className="kt-no-print flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
            <p className="text-sm font-semibold text-slate-800">Progress report preview</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => window.print()} disabled={updates === null} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                <PrinterIcon className="size-4" aria-hidden="true" /> Print / Save as PDF
              </button>
              <button type="button" onClick={onClose} aria-label="Close report" className="rounded-lg p-2 text-slate-500 hover:bg-slate-200">
                <XIcon className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="kt-scroll min-h-0 flex-1 overflow-y-auto">
            <article className="kt-sheet mx-auto max-w-3xl bg-white p-8 text-slate-900">
              <header className="border-b-2 border-slate-900 pb-4 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Department of Agriculture · Region VI · Western Visayas</p>
                <h1 className="mt-2 text-xl font-extrabold tracking-wide">FARM-TO-MARKET ROAD PROJECT PROGRESS REPORT</h1>
              </header>

              {updates === null ? (
                <p className="py-16 text-center text-sm text-slate-500">Preparing report…</p>
              ) : (
                <>
                  {error && <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">Some records could not be loaded: {error}</p>}

                  <table className="mt-5 w-full border border-slate-300 text-left">
                    <tbody>
                      <Row label="Project"><strong>{project.project_name}</strong><span className="block text-xs text-slate-500">{[project.location, project.municipality, project.province].filter(Boolean).join(', ')}</span></Row>
                      <Row label="Contractor">{who(people[project.contractor_id]) || 'Not assigned'}</Row>
                      <Row label="Site Engineer">{who(people[project.site_engineer_id]) || 'Not assigned'}</Row>
                      <Row label="Start Date">{day(project.date_started)}</Row>
                      <Row label="Target Completion">{day(project.target_completion_date)}</Row>
                      <Row label="Current Certified Progress"><strong className="text-lg">{pct(project.accomplishment)}</strong> <span className="text-xs text-slate-500">official accomplishment, updated only when the DA Admin approves a certified update</span></Row>
                      <Row label="Status"><strong>{schedule.label}</strong><span className="block text-xs text-slate-500">{schedule.reason}</span></Row>
                      <Row label="Amount Billed">
                        <strong>{peso(report.billed)}</strong>
                        <span className="block text-xs text-slate-500">
                          {report.billed === null ? 'No approved billing is recorded.' : `Total of ${report.approved.length} approved update${report.approved.length === 1 ? '' : 's'}.`}
                          {contract !== null && ` Contract amount ${peso(contract)}${report.billed !== null ? `, ${peso(Math.max(0, contract - report.billed))} remaining` : ''}.`}
                          {contract === null && ' Contract amount is not recorded.'}
                        </span>
                      </Row>
                      <Row label="Certified by">{certifiedBy ? `${certifiedBy} (Site Engineer)` : 'No certified update yet'}</Row>
                      <Row label="Date Certified">{report.latestCertified ? day(report.latestCertified.certified_at) : 'Not recorded'}</Row>
                      <Row label="Approved by">{latestApproved ? `${who(people[latestApproved.reviewed_by]) || 'DA Admin'} (DA Admin), ${day(latestApproved.reviewed_at)}` : 'No approved update yet'}</Row>
                    </tbody>
                  </table>

                  {awaitingApproval && (
                    <p className="mt-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                      The latest certified update ({pct(report.latestCertified.certified_accomplishment)}) has not been approved by the DA Admin yet, so the official progress above does not include it.
                    </p>
                  )}
                  {report.waiting > 0 && !awaitingApproval && (
                    <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {report.waiting} submission{report.waiting === 1 ? ' is' : 's are'} still waiting for the site engineer to certify.
                    </p>
                  )}

                  <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-700">Approved progress updates</h2>
                  {report.approved.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No update has been approved yet.</p>
                  ) : (
                    <table className="mt-2 w-full border border-slate-300 text-xs">
                      <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-2 py-1.5">Period</th>
                          <th className="px-2 py-1.5">Reported</th>
                          <th className="px-2 py-1.5">Certified (this update)</th>
                          <th className="px-2 py-1.5">Billed</th>
                          <th className="px-2 py-1.5">Certified by</th>
                          <th className="px-2 py-1.5">Approved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.approved.map((u) => (
                          <tr key={u.id} className="border-t border-slate-200 align-top">
                            <td className="px-2 py-1.5">{u.period_start ? `${day(u.period_start)} to ${day(u.period_end)}` : day(u.submitted_at)}</td>
                            <td className="px-2 py-1.5">{pct(u.reported_accomplishment)}</td>
                            <td className="px-2 py-1.5">{pct(u.certified_accomplishment)}</td>
                            <td className="px-2 py-1.5">{u.amount_this_billing != null ? peso(u.amount_this_billing) : 'Not recorded'}</td>
                            <td className="px-2 py-1.5">{who(people[u.certified_by]) || 'Not recorded'}<span className="block text-slate-500">{day(u.certified_at)}</span></td>
                            <td className="px-2 py-1.5">{day(u.reviewed_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="mt-10 grid grid-cols-2 gap-10 text-center text-xs">
                    <div><div className="border-t border-slate-900 pt-1 font-semibold">{certifiedBy || 'Site Engineer'}</div><div className="text-slate-500">Certified by, Site Engineer</div></div>
                    <div><div className="border-t border-slate-900 pt-1 font-semibold">{latestApproved ? who(people[latestApproved.reviewed_by]) || 'DA Admin' : 'DA Admin'}</div><div className="text-slate-500">Approved by, DA Admin</div></div>
                  </div>

                  <footer className="mt-8 border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-500">
                    <p>Generated {generatedAt.toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })} by KalsaTrack. Progress figures come from approved updates; a field shows &ldquo;Not recorded&rdquo; when the system holds no value for it.</p>
                    <p className="mt-1">Status rules: Completed at 100%; Delayed when the target date has passed or, with a start date recorded, progress is more than {BEHIND_TOLERANCE} points behind a straight-line schedule; Nearly Completed from {NEARLY_THRESHOLD}%; otherwise On Time. Unscheduled when no target date is recorded.</p>
                  </footer>
                </>
              )}
            </article>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
