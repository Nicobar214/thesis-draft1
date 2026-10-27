/* "Deadline extensions" on a project's page: every extension granted through the
 * delay follow-up, with the old and new target, the days added, the DA's reason
 * and the contractor's reason (project_extension_history, from
 * supabase_delay_evidence_and_extensions.sql). "View N evidence" opens the files
 * sent with that request, for everyone once supabase_extension_evidence_public.sql
 * is run (before that, staff only; others just see the count). Shows nothing when
 * there are none, or before the first SQL is run.
 * An act of nature shows a one-line summary; its official documents stay private
 * (only the count is shown), its photos are public (supabase_overdue_v2_patch3.sql).
 *
 *   <ProjectExtensions projectId={project.id} client={supabase} /> */
import { useEffect, useState } from 'react';
import { CalendarPlusIcon, ChevronDownIcon, CloudLightningIcon, LockIcon, PaperclipIcon } from 'lucide-react';
import { supabase as defaultClient } from '../../lib/supabase';
import { causeLabel, fmtDay } from '../../lib/delayCases';
import EvidenceGallery from '../evidence/EvidenceGallery';

export default function ProjectExtensions({ projectId, client = defaultClient, className = '' }) {
  const [rows, setRows] = useState([]);
  const [evidence, setEvidence] = useState([]); // per row, same order as rows
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (projectId == null) return undefined;
    let alive = true;
    (async () => {
      const { data, error } = await client.rpc('project_extension_history', { p_project: Number(projectId) });
      if (!alive) return;
      setRows(error ? [] : data || []);
      // Files of granted extensions are public (supabase_extension_evidence_public.sql),
      // numbered like the history above.
      const pub = await client.rpc('project_extension_evidence', { p_project: Number(projectId) });
      if (!alive) return;
      if (!pub.error) {
        const n = (data || []).length;
        setEvidence(Array.from({ length: n }, (_, i) => (pub.data || []).filter((e) => e.extension_no === i + 1)));
        return;
      }
      // Before that SQL is run: staff only. The history has no case ids; the
      // extended cases come back in the same order (closed_at).
      const cases = await client.from('project_delay_cases').select('id')
        .eq('project_id', Number(projectId)).eq('outcome', 'extended').order('closed_at', { ascending: true });
      if (cases.error) console.warn('Extension evidence: cases', cases.error);
      const ids = (cases.data || []).map((c) => c.id);
      if (!alive || !ids.length) return;
      const ev = await client.from('project_delay_evidence').select('*').in('case_id', ids).or('category.is.null,category.neq.document').order('created_at', { ascending: true });
      if (ev.error) console.warn('Extension evidence: files', ev.error);
      if (alive) setEvidence(ids.map((id) => (ev.data || []).filter((e) => e.case_id === id)));
    })();
    return () => { alive = false; };
  }, [client, projectId]);

  if (!rows.length) return null;
  return (
    <section className={`rounded-2xl border border-slate-200/60 bg-white p-5 ${className}`} aria-label="Deadline extensions">
      <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        <CalendarPlusIcon className="size-4 text-amber-600" aria-hidden="true" />
        Deadline extensions · {rows.length}
      </h4>
      <ol className="space-y-3">
        {rows.map((r, i) => {
          const files = evidence[i] || [];
          const isOpen = open === i;
          const nature = r.kind === 'act_of_nature';
          // Photos only are public; older rows (before patch 3) have no split, so fall back to the total.
          const shown = r.photo_count ?? r.evidence_count;
          return (
            <li key={`${r.new_target}-${i}`} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 text-sm">
              <p className="font-semibold text-slate-900">
                Extension {i + 1}: {fmtDay(r.previous_target)} → {fmtDay(r.new_target)}
                <span className="ml-1.5 font-normal text-slate-500">(+{r.days_added} day{r.days_added === 1 ? '' : 's'}{r.extended_on ? `, granted ${fmtDay(r.extended_on)}` : ''})</span>
              </p>
              {nature && <NatureSummary r={r} />}
              {r.contractor_explanation && (
                <p className="mt-1.5 text-slate-700">
                  <span className="font-medium text-slate-500">Contractor&rsquo;s reason ({causeLabel(r.contractor_cause)}): </span>
                  {r.contractor_explanation}
                  {shown > 0 && (files.length ? (
                    <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}
                      className="ml-1.5 inline-flex items-center gap-0.5 rounded text-xs font-semibold text-teal-700 hover:underline">
                      <PaperclipIcon className="size-3" aria-hidden="true" />{isOpen ? 'Hide' : 'View'} {files.length} {nature ? `photo${files.length === 1 ? '' : 's'}` : 'evidence'}
                      <ChevronDownIcon className={`size-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-slate-500">
                      <PaperclipIcon className="size-3" aria-hidden="true" />{shown} {nature ? `photo${shown === 1 ? '' : 's'}` : 'evidence'}
                    </span>
                  ))}
                </p>
              )}
              {r.da_reason && <p className="mt-1 text-slate-700"><span className="font-medium text-slate-500">DA decision: </span>{r.da_reason}</p>}
              {isOpen && <div className="mt-3"><EvidenceGallery client={client} bucket="delay-evidence" items={files} title={nature ? 'Photos of what happened' : "Contractor's evidence"} /></div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* "Act of nature: Typhoon Kristine, 5 days · 2 official documents checked by the DA
 * (kept private) · site confirmed by Engr. X". */
function NatureSummary({ r }) {
  const docs = Number(r.document_count || 0);
  return (
    <div className="mt-1.5 rounded-lg border border-sky-100 bg-sky-50/70 px-2.5 py-2 text-xs text-sky-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <CloudLightningIcon className="size-3.5 shrink-0" aria-hidden="true" />
        Act of nature{r.event_name ? `: ${r.event_name}` : ''}{r.stopped_days ? `, ${r.stopped_days} day${r.stopped_days === 1 ? '' : 's'} work stopped` : ''} · not counted as an offense
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sky-800">
        {docs > 0 && (
          <span className="inline-flex items-center gap-1">
            <LockIcon className="size-3" aria-hidden="true" />
            {docs} official document{docs === 1 ? '' : 's'} checked by the DA (kept private)
          </span>
        )}
        {docs > 0 && r.field_check === 'confirmed' && <span aria-hidden="true">·</span>}
        {r.field_check === 'confirmed' && <span>Site confirmed{r.checked_by ? ` by ${r.checked_by}` : ' by the field engineer'}</span>}
      </p>
    </div>
  );
}
