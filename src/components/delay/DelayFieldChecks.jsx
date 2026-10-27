/* DelayFieldChecks.jsx — the field engineer's part of the overdue process
 * (supabase_overdue_v2.sql): the DA sends an act-of-nature claim, or a final
 * (Offense 3) commitment, for an on-site check. The engineer confirms or not,
 * with a note and a KalsaTrack-camera photo taken at the road. The DA can only
 * approve those after a "Confirmed" check. Shown on top of Priority Tasks.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2Icon, CloudLightningIcon, HardHatIcon, XCircleIcon } from 'lucide-react';
import { notify } from '../../lib/toast';
import { confirm as confirmDialog } from '../../lib/confirm';
import { buildRoutePoints } from '../../lib/mapRouteUtils';
import { uploadGeotagPhotos } from '../../lib/geotagPhoto';
import { MAX_DISTANCE_M } from '../../lib/onSiteLocation';
import {
  caseDue, causeLabel, fmtDay, friendlyDelayError, manilaToday, MAX_OFFENSES, MIN_REASON, offenseLabel, reasonOk,
} from '../../lib/delayCases';
import GeotagCamera from '../camera/GeotagCamera';
import GeotagPhotoPreview from '../camera/GeotagPhotoPreview';
import EvidenceGallery from '../evidence/EvidenceGallery';
import { NatureEvidenceGallery } from './NatureEvidence';

export default function DelayFieldChecks({ client, userId, onCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!client || !userId) return;
    try {
      const { data: cases, error } = await client.from('project_delay_cases').select('*')
        .eq('verifier_id', userId).eq('status', 'awaiting_verification').order('verification_due', { ascending: true });
      if (error) throw error;
      const list = cases || [];
      if (!list.length) { setItems([]); return; }
      const ids = [...new Set(list.map((c) => c.project_id))];
      const caseIds = list.map((c) => c.id);
      const [p, r, ev, notes] = await Promise.all([
        client.from('fmr_projects').select('id, project_name, municipality, barangay, accomplishment, start_latitude, start_longitude, end_latitude, end_longitude').in('id', ids),
        client.from('project_routes').select('*').in('project_id', ids),
        client.from('project_delay_evidence').select('*').in('case_id', caseIds).order('created_at', { ascending: true }),
        client.from('project_delay_case_events').select('case_id, payload, created_at').in('case_id', caseIds).eq('event_type', 'verification_requested'),
      ]);
      const routes = new Map((r.data || []).map((x) => [String(x.project_id), x]));
      const projects = new Map((p.data || []).map((x) => [String(x.id), { ...x, line: buildRoutePoints(x, routes.get(String(x.id)) || null).points }]));
      const evidence = {};
      (ev.data || []).forEach((x) => { (evidence[x.case_id] = evidence[x.case_id] || []).push(x); });
      const daNote = {};
      (notes.data || []).forEach((x) => { daNote[x.case_id] = x.payload?.note || ''; });
      setItems(list.map((c) => ({ c, project: projects.get(String(c.project_id)), evidence: evidence[c.id] || [], note: daNote[c.id] })));
    } catch {
      setItems([]);   // not set up yet, or offline: the rest of the page still works
    } finally {
      setLoading(false);
    }
  }, [client, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { onCountChange?.(items.length); }, [items.length, onCountChange]);
  useEffect(() => {
    if (!client?.channel || !userId) return undefined;
    const channel = client.channel(`delay-field-checks-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_delay_cases' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_delay_evidence' }, () => load())
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, userId, load]);

  if (loading || !items.length) return null;
  return (
    <section id="delay-field-checks" aria-label="Overdue project site checks" className="scroll-mt-24 space-y-3">
      <div>
        <h2 className="text-base font-bold text-slate-900">Overdue project site checks</h2>
        <p className="text-sm text-slate-500">The DA needs your on-site check before deciding. Your answer is final for this round.</p>
      </div>
      {items.map((item) => <CheckCard key={item.c.id} {...item} client={client} onDone={load} />)}
    </section>
  );
}

function CheckCard({ c, project, evidence, note, client, onDone }) {
  const [verdict, setVerdict] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const today = manilaToday();
  const due = caseDue(c, today);
  const nature = c.kind === 'act_of_nature';
  const place = project?.project_name || 'the road';
  const ready = verdict && reasonOk(text) && photos.length > 0;
  const ask = useMemo(() => (nature
    ? `Was work really stopped by ${c.event_name || 'the event'} for about ${c.stopped_days} day(s)? Check the damage and site conditions.`
    : `This is the contractor's FINAL chance (Offense ${MAX_OFFENSES} of ${MAX_OFFENSES}). Is the remaining work realistic to finish by ${fmtDay(c.proposed_date)}? Check the crew and progress on site.`),
  [nature, c.event_name, c.stopped_days, c.proposed_date]);

  const submit = async () => {
    const ok = await confirmDialog({
      title: verdict === 'agree' ? 'Confirm the contractor’s claim?' : 'Report that it is not confirmed?',
      message: `${place}\n“${text.trim()}”\nThe DA decides next. You cannot change this after sending.`,
      confirmLabel: 'Send check',
      tone: verdict === 'agree' ? 'primary' : 'danger',
    });
    if (!ok) return;
    setBusy(true);
    let uploaded = [];
    try {
      uploaded = await uploadGeotagPhotos(client, { bucket: 'progress-photos', folder: 'priority', recordId: c.id, photos: photos.slice(0, 1) });
      const { error } = await client.rpc('delay_submit_verification', {
        p_case: c.id, p_verdict: verdict, p_note: text.trim(), p_photo_url: uploaded[0]?.url || null,
      });
      if (error) throw error;
      notify('Your site check was sent to the DA.', 'success');
      await onDone?.();
    } catch (err) {
      if (uploaded.length) await client.storage.from('progress-photos').remove(uploaded.map((x) => x.path));
      notify(friendlyDelayError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-2xl border border-sky-200 bg-white p-5 shadow-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{place}</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {[project?.barangay, project?.municipality].filter(Boolean).join(', ')}
            {project?.accomplishment != null ? ` · ${Number(project.accomplishment)}% on record` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${nature ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {nature ? <CloudLightningIcon className="size-3" aria-hidden="true" /> : <HardHatIcon className="size-3" aria-hidden="true" />}
            {offenseLabel(c)}
          </span>
          {due && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${due.overdue ? 'bg-red-600 text-white' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'}`}>{due.label} {fmtDay(due.date)}</span>}
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">
        <p className="font-semibold">What to check</p>
        <p className="mt-1">{ask}</p>
        {note && <p className="mt-2 border-l-2 border-current/30 pl-2 italic">DA: “{note}”</p>}
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-slate-500">Contractor&rsquo;s cause</dt>
        <dd className="text-slate-800">{causeLabel(c.cause)}{nature && c.event_name ? ` · ${c.event_name}, ${c.stopped_days} day(s) stopped` : ''}</dd>
        <dt className="text-slate-500">What they said</dt><dd className="whitespace-pre-line text-slate-800">{c.explanation}</dd>
        <dt className="text-slate-500">New finish date</dt><dd className="text-slate-800">{fmtDay(c.proposed_date)}</dd>
      </dl>
      {evidence.length > 0 && (
        <div className="mt-4">
          {nature
            ? <NatureEvidenceGallery client={client} rows={evidence} />
            : <EvidenceGallery client={client} bucket="delay-evidence" items={evidence} title="Contractor's evidence" />}
        </div>
      )}

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-700">Your finding</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[
            { v: 'agree', label: 'Confirmed', hint: nature ? 'The event really stopped the work.' : 'The plan is realistic on site.', Icon: CheckCircle2Icon, on: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20' },
            { v: 'disagree', label: 'Not confirmed', hint: nature ? 'The site does not show it.' : 'The plan is not realistic.', Icon: XCircleIcon, on: 'border-rose-500 bg-rose-50 ring-2 ring-rose-500/20' },
          ].map((opt) => {
            const OptIcon = opt.Icon;
            return (
              <label key={opt.v} className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 transition ${verdict === opt.v ? opt.on : 'border-slate-200 hover:border-slate-300'}`}>
                <input type="radio" name={`verdict-${c.id}`} value={opt.v} checked={verdict === opt.v} onChange={() => setVerdict(opt.v)} disabled={busy} className="mt-1" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><OptIcon className="size-4" aria-hidden="true" />{opt.label}</span>
                  <span className="block text-xs text-slate-500">{opt.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-4 block text-sm">
        <span className="font-medium text-slate-700">What you found on site</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} disabled={busy} placeholder={nature ? 'e.g. Flood marks on the culvert; site was under water Oct 20–24.' : 'e.g. 8 workers on site; 120 m of the 300 m left, doable by the date.'} className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20" />
        <span className={`mt-1 block text-right text-xs ${reasonOk(text) ? 'text-emerald-700' : 'text-slate-400'}`}>{text.trim().length}/{MIN_REASON} characters minimum</span>
      </label>

      <div className="mt-2 space-y-2">
        <p className="text-xs font-semibold text-slate-700">
          Site photo <span className="text-rose-500">*</span>
          <span className="ml-1 font-normal text-slate-400">KalsaTrack camera · within {MAX_DISTANCE_M} m of the road</span>
        </p>
        {photos.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {photos.map((ph) => <GeotagPhotoPreview key={ph.preview} photo={ph} place={place} onRemove={busy ? null : () => setPhotos([])} className="" />)}
          </div>
        )}
        {!photos.length && (
          <GeotagCamera
            roadPoints={project?.line || []}
            kind="field_inspection"
            label={`Overdue site check · ${place}`}
            place={place}
            disabled={busy}
            captureText="Open the KalsaTrack camera"
            onCaptured={(photo) => setPhotos([photo])}
          />
        )}
      </div>

      <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
        <button type="button" onClick={submit} disabled={!ready || busy} className="h-11 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Sending…' : 'Send site check'}
        </button>
      </div>
    </article>
  );
}
