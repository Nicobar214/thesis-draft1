/* "Deadline extensions" on a project's page: every extension granted through the
 * delay follow-up, with the old and new target, the days added, the DA's reason
 * and the contractor's reason (project_extension_history, from
 * supabase_delay_evidence_and_extensions.sql). "N evidence" opens the files sent
 * with that request for users allowed to see them (admin, the contractor, the
 * verifier); others just see the count. Shows nothing when there are none, or
 * before that SQL is run.
 *
 *   <ProjectExtensions projectId={project.id} client={supabase} /> */
import { useEffect, useState } from 'react';
import { CalendarPlusIcon, ChevronDownIcon, PaperclipIcon } from 'lucide-react';
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
      // The history has no case ids; the extended cases come back in the same
      // order (closed_at). Row-level security returns none to citizens.
      const cases = await client.from('project_delay_cases').select('id')
        .eq('project_id', Number(projectId)).eq('outcome', 'extended').order('closed_at', { ascending: true });
      const ids = (cases.data || []).map((c) => c.id);
      if (!alive || !ids.length) return;
      const ev = await client.from('project_delay_evidence').select('*').in('case_id', ids).order('created_at', { ascending: true });
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
          return (
            <li key={`${r.new_target}-${i}`} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 text-sm">
              <p className="font-semibold text-slate-900">
                Extension {i + 1}: {fmtDay(r.previous_target)} → {fmtDay(r.new_target)}
                <span className="ml-1.5 font-normal text-slate-500">(+{r.days_added} day{r.days_added === 1 ? '' : 's'}{r.extended_on ? `, granted ${fmtDay(r.extended_on)}` : ''})</span>
              </p>
              {r.contractor_explanation && (
                <p className="mt-1.5 text-slate-700">
                  <span className="font-medium text-slate-500">Contractor&rsquo;s reason ({causeLabel(r.contractor_cause)}): </span>
                  {r.contractor_explanation}
                  {r.evidence_count > 0 && (files.length ? (
                    <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}
                      className="ml-1.5 inline-flex items-center gap-0.5 rounded text-xs font-semibold text-teal-700 hover:underline">
                      <PaperclipIcon className="size-3" aria-hidden="true" />{isOpen ? 'Hide' : 'View'} {r.evidence_count} evidence
                      <ChevronDownIcon className={`size-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-slate-500">
                      <PaperclipIcon className="size-3" aria-hidden="true" />{r.evidence_count} evidence
                    </span>
                  ))}
                </p>
              )}
              {r.da_reason && <p className="mt-1 text-slate-700"><span className="font-medium text-slate-500">DA decision: </span>{r.da_reason}</p>}
              {isOpen && <div className="mt-3"><EvidenceGallery client={client} bucket="delay-evidence" items={files} title="Contractor's evidence" /></div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
