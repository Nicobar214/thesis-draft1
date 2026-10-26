/* What the DA's prioritization asks of a field engineer or a contractor, and
 * where they answer it (supabase_priority_roles.sql):
 *
 *   Field engineer: confirm a road gap on site (Confirmed / Not as described),
 *                   and reply to a "Schedule site inspection" action on a
 *                   project where they are the site engineer.
 *   Contractor:     see that their project was flagged, and reply to
 *                   "Expedite contractor" / "Prioritize fund release".
 *
 * Answered items stay visible (with the answer) until the DA moves them on. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClockIcon, CameraIcon, CheckCircle2Icon, ClipboardCheckIcon, MapPinIcon } from 'lucide-react';
import {
  actionOwner, DEADLINE_TONES, deadlineStatus, DECISION_LABELS, MAX_PRIORITY_PHOTOS, needsPhotos, respondToAction, submitValidation,
} from '../../lib/priorityDecisions';
import { confirm as confirmDialog } from '../../lib/confirm';
import { buildRoutePoints } from '../../lib/mapRouteUtils';
import { PLACEMENT_LABELS, resolveGapGeometry } from '../../lib/gapGeometry';
import { MAX_DISTANCE_M } from '../../lib/onSiteLocation';
import GeotagCamera from '../camera/GeotagCamera';
import GeotagPhotoPreview from '../camera/GeotagPhotoPreview';
import ZoomablePhoto from '../ui/ZoomablePhoto';
import PriorityTaskMap from './PriorityTaskMap';
import { PRIORITY_CRITERIA } from '../../lib/priorityScoring';

const num = (v, digits = 2) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(digits));

/* Why the DA ranked this road, from the scores saved with the decision. */
function PriorityWhy({ snapshot }) {
  if (!snapshot || snapshot.score == null) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
      <p className="text-[11px] font-semibold text-slate-600">
        DA priority: rank #{snapshot.rank} · score {snapshot.score}/100
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
        {PRIORITY_CRITERIA.map((c) => {
          const v = Math.max(0, Math.min(100, Number(snapshot[c.key]) || 0));
          return (
            <div key={c.key}>
              <div className="flex justify-between text-[10px] text-slate-500"><span>{c.label}</span><span className="font-semibold text-slate-800">{v}</span></div>
              <div className="mt-0.5 h-1 rounded-full bg-slate-200"><div className="h-1 rounded-full bg-teal-600" style={{ width: `${v}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Facts({ items }) {
  const shown = items.filter((f) => f.value != null && f.value !== '');
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
      {shown.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-[11px] text-slate-500">{f.label}</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900" title={String(f.value)}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* Photos already sent with an answer (stored URLs), small and tappable. */
export function SentPhotos({ photos }) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {photos.map((ph) => (
        <ZoomablePhoto
          key={ph.path || ph.url}
          src={ph.url}
          alt="Site photo"
          label="Engineer's site photo"
          wrapperClassName="rounded-lg"
          className="size-20 rounded-lg border border-slate-200 object-cover"
        />
      ))}
    </div>
  );
}

/* Up to MAX_PRIORITY_PHOTOS KalsaTrack-camera photos for one answer. */
function PhotoEvidence({ task, photos, setPhotos, busy }) {
  const place = task.kind === 'validation' ? 'the road to concrete' : 'the project road';
  const remove = (i) => setPhotos((list) => {
    if (list[i]?.preview) URL.revokeObjectURL(list[i].preview);
    return list.filter((_, j) => j !== i);
  });
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-700">
        Site photos <span className="text-rose-500">*</span>
        <span className="ml-1 font-normal text-slate-400">KalsaTrack camera · 1 to {MAX_PRIORITY_PHOTOS} · within {MAX_DISTANCE_M} m of {place}</span>
      </p>
      {photos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {photos.map((ph, i) => (
            <GeotagPhotoPreview key={ph.preview} photo={ph} place={place} onRemove={busy ? null : () => remove(i)} className="" />
          ))}
        </div>
      )}
      {photos.length < MAX_PRIORITY_PHOTOS && (
        <GeotagCamera
          roadPoints={task.roadPoints}
          kind={task.kind === 'validation' ? 'priority_validation' : 'priority_inspection'}
          label={`${task.kind === 'validation' ? 'Concreting need validation' : 'Priority inspection'} · ${task.title}`}
          place={place}
          disabled={busy}
          captureText={photos.length ? `Add photo ${photos.length + 1}` : 'Open the KalsaTrack camera'}
          onCaptured={(photo) => setPhotos((list) => [...list, photo])}
        />
      )}
    </div>
  );
}

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function TaskCard({ task, role, busy, onValidate, onReply }) {
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const { decision, kind, title, place, detail, needsAnswer, answer } = task;
  const photosNeeded = needsPhotos(kind, role);
  const photosReady = !photosNeeded || (photos.length > 0 && photos.every((p) => p.check?.ok));
  const photoProblem = photosNeeded && !photosReady
    ? (photos.length === 0 ? 'Take at least one site photo first.' : 'Remove the photo that was not taken on site.')
    : null;
  const ready = note.trim() && photosReady;

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">{task.label}</p>
          <h3 className="mt-0.5 font-semibold text-slate-900">{title}</h3>
          {place && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <MapPinIcon className="size-3.5" aria-hidden="true" />{place}
            </p>
          )}
        </div>
        <span className="text-[11px] text-slate-400">{fmtDate(decision.updated_at)}</span>
      </div>
      {needsAnswer && (kind === 'validation' || kind === 'reply') && (() => {
        // Validation: visit the road by due_date. Reply: answer the DA by reply_due_date.
        const deadline = deadlineStatus(kind === 'validation' ? decision.due_date : decision.reply_due_date);
        if (!deadline) return null;
        return (
          <p className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${DEADLINE_TONES[deadline.tone]}`}>
            <CalendarClockIcon className="size-3.5" aria-hidden="true" />
            {kind === 'validation' ? 'Visit the road' : 'Reply'}: {deadline.text}
          </p>
        );
      })()}
      {detail && <p className="mt-2 text-sm text-slate-700">{detail}</p>}
      {decision.note && <p className="mt-1 text-xs text-slate-500">DA note: “{decision.note}”</p>}

      <div className="mt-3 space-y-3">
        <Facts items={task.facts || []} />
        <PriorityWhy snapshot={decision.score_snapshot} />
        <details open={needsAnswer} className="group rounded-lg border border-slate-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-700">Map and directions</summary>
          <div className="border-t border-slate-100 p-3">
            <PriorityTaskMap points={task.roadPoints} title={title} kind={task.mapKind} status={task.status} />
          </div>
        </details>
      </div>

      {answer ? (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <p className="flex items-start gap-1.5">
            <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{answer} The DA has been notified.</span>
          </p>
          <SentPhotos photos={kind === 'validation' ? decision.validation_photos : decision.response_photos} />
        </div>
      ) : needsAnswer && (
        <div className="mt-3 space-y-2">
          {photosNeeded && <PhotoEvidence task={task} photos={photos} setPhotos={setPhotos} busy={busy} />}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder={kind === 'validation' ? 'What you found on site (length, surface, who uses it)…' : 'Your reply: what you will do and by when…'}
            aria-label="Your answer"
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
          {photoProblem && photos.length > 0 && <p className="text-[11px] text-rose-600">{photoProblem}</p>}
          {kind === 'validation' ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !ready}
                title={photoProblem || undefined}
                onClick={() => onValidate(task, 'confirmed', note, photos)}
                className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                Confirmed on site
              </button>
              <button
                type="button"
                disabled={busy || !ready}
                title={photoProblem || undefined}
                onClick={() => onValidate(task, 'not_confirmed', note, photos)}
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                Not as described
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || !ready}
              title={photoProblem || undefined}
              onClick={() => onReply(task, note, photos)}
              className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              Send reply
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * role: 'field_engineer' | 'contractor'. client: that portal's Supabase client.
 * onCountChange(n): how many items still need this user's answer.
 */
export default function PriorityTasksPanel({ client, userId, role, showNotification, onCountChange, compact = false }) {
  const [rows, setRows] = useState([]);
  const [gaps, setGaps] = useState(new Map());
  const [projects, setProjects] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!client || !userId) return;
    setLoading(true);
    try {
      const { data, error } = await client
        .from('priority_decisions')
        .select('*')
        .in('status', ['for_validation', 'flagged', 'action_recorded']);
      if (error) throw error;
      const list = data || [];
      const gapIds = list.filter((d) => d.candidate_kind === 'gap').map((d) => d.candidate_id);
      const projectIds = list.filter((d) => d.candidate_kind === 'project').map((d) => d.candidate_id);
      const [g, p] = await Promise.all([
        gapIds.length ? client.from('road_network_gaps').select('id, gap_code, source_road_name, municipality, barangay, barangay_end, gap_km, gap_type, source_surface_summary, gap_points, start_latitude, start_longitude, end_latitude, end_longitude, market_distance_km, surface_condition, from_project_id').in('id', gapIds) : { data: [] },
        projectIds.length ? client.from('fmr_projects').select('id, project_name, municipality, barangay, contractor_id, site_engineer_id, accomplishment, start_latitude, start_longitude, end_latitude, end_longitude, barangay_end, status, project_length_km, target_completion_date, year_funded').in('id', projectIds) : { data: [] },
      ]);
      // A gap is shown on its own surveyed road (gapGeometry.js), so fetch those roads too.
      const parentIds = [...new Set((g.data || []).map((x) => x.from_project_id).filter((id) => id != null))];
      const [parents, routeRows] = await Promise.all([
        parentIds.length ? client.from('fmr_projects').select('id, start_latitude, start_longitude, end_latitude, end_longitude').in('id', parentIds) : { data: [] },
        // Project road lines, to check where inspection photos were taken.
        [...projectIds, ...parentIds].length
          ? client.from('project_routes').select('*').in('project_id', [...new Set([...projectIds, ...parentIds.map(String)])])
          : { data: [] },
      ]);
      const routeById = new Map((routeRows.data || []).map((r) => [String(r.project_id), r]));
      const parentById = new Map((parents.data || []).map((x) => [String(x.id), x]));
      setRows(list);
      setGaps(new Map((g.data || []).map((x) => {
        const parent = parentById.get(String(x.from_project_id)) || null;
        const geometry = resolveGapGeometry(x, parent, parent ? routeById.get(String(parent.id)) || null : null);
        return [String(x.id), { ...x, line: geometry.points, geometry }];
      })));
      setProjects(new Map((p.data || []).map((x) => [String(x.id), { ...x, line: buildRoutePoints(x, routeById.get(String(x.id)) || null).points }])));
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [client, userId]);

  useEffect(() => { load(); }, [load]);

  // Only what is addressed to this user.
  const tasks = useMemo(() => rows.map((d) => {
    if (d.candidate_kind === 'gap') {
      if (role !== 'field_engineer' || d.assigned_engineer_id !== userId || d.status !== 'for_validation') return null;
      const gap = gaps.get(String(d.candidate_id)) || {};
      return {
        id: d.id, decision: d, kind: 'validation',
        roadPoints: gap.line || [],
        mapKind: 'gap',
        facts: [
          { label: 'Gap length', value: num(gap.gap_km) ? `${num(gap.gap_km)} km` : null },
          { label: 'From → to', value: [gap.barangay, gap.barangay_end].filter(Boolean).join(' → ') || null },
          { label: 'Mapping', value: gap.geometry ? PLACEMENT_LABELS[gap.geometry.placement] : null },
        ],
        label: 'Site validation request',
        title: gap.source_road_name || gap.gap_code || 'Road gap',
        place: [gap.barangay, gap.barangay_end].filter(Boolean).join(' → ') || gap.municipality,
        detail: `Confirm on site the gap length: ${gap.gap_km ?? '?'} km. ${gap.geometry?.note || ''}${gap.geometry && gap.geometry.placement !== 'whole-road' ? ' Your site photos and note show which part still needs concreting.' : ''}`.trim(),
        needsAnswer: !d.validated_at,
        answer: d.validated_at ? `You answered: ${d.validation_result === 'confirmed' ? 'Confirmed on site' : 'Not as described'} — “${d.validation_note}”.` : null,
      };
    }
    const project = projects.get(String(d.candidate_id));
    if (!project) return null;
    const mine = role === 'contractor' ? project.contractor_id === userId : project.site_engineer_id === userId;
    if (!mine) return null;
    const ownsAction = d.status === 'action_recorded' && actionOwner(d.action) === (role === 'contractor' ? 'contractor' : 'site_engineer');
    if (d.status === 'action_recorded' && !ownsAction) {
      // The action is for the other party: still show it, read-only.
      return {
        id: d.id, decision: d, kind: 'info', label: `DA action: ${d.action}`,
        roadPoints: project.line || [], mapKind: 'project', status: project.status,
        title: project.project_name, place: project.municipality,
        detail: `The DA asked the ${actionOwner(d.action) === 'site_engineer' ? 'site engineer' : 'contractor'} to act on this project.`,
        needsAnswer: false, answer: null,
      };
    }
    const projectFacts = [
      { label: 'Status', value: project.status || null },
      { label: 'Accomplishment', value: project.accomplishment != null ? `${Math.round(Number(project.accomplishment))}%` : null },
      { label: 'Length', value: num(project.project_length_km) ? `${num(project.project_length_km)} km` : null },
      { label: 'Target completion', value: project.target_completion_date || null },
      { label: 'Barangays', value: [project.barangay, project.barangay_end].filter(Boolean).join(' → ') || null },
      { label: 'Funded', value: project.year_funded ? `FY ${project.year_funded}` : null },
    ];
    return {
      id: d.id, decision: d, kind: d.status === 'flagged' ? 'info' : 'reply',
      roadPoints: project.line || [],
      mapKind: 'project',
      status: project.status,
      facts: projectFacts,
      label: d.status === 'flagged' ? DECISION_LABELS.flagged : `DA action: ${d.action}`,
      title: project.project_name,
      place: project.municipality,
      detail: d.status === 'flagged'
        ? 'The DA put this project on its priority list. A specific action will follow.'
        : role === 'contractor'
          ? `The DA decided: ${d.action}. Reply with what you will do and by when.`
          : 'The DA asks you to inspect this project. Reply with what you found and when you went.',
      needsAnswer: d.status === 'action_recorded' && !d.responded_at,
      answer: d.responded_at ? `You replied: “${d.response_note}”.` : null,
    };
  }).filter(Boolean), [rows, gaps, projects, role, userId]);

  const openCount = tasks.filter((t) => t.needsAnswer).length;
  useEffect(() => { onCountChange?.(openCount); }, [openCount, onCountChange]);

  const run = async (task, fn, success) => {
    setBusyId(task.id);
    try {
      await fn();
      showNotification?.(success);
      await load();
    } catch (err) {
      showNotification?.(err?.message || 'Could not send your answer.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onValidate = async (task, result, note, photos = []) => {
    const ok = await confirmDialog({
      title: result === 'confirmed' ? 'Confirm this road on site?' : 'Report that the road is not as described?',
      message: `${task.title}\n“${note.trim()}”\n${photos.length} site photo${photos.length === 1 ? '' : 's'} attached.\n\nThe DA uses your answer to decide whether to endorse it for funding.`,
      confirmLabel: result === 'confirmed' ? 'Confirm' : 'Send answer',
      tone: result === 'confirmed' ? 'primary' : 'warning',
    });
    if (ok) await run(task, () => submitValidation(client, task.id, result, note, photos), 'Your site validation was sent to the DA.');
  };

  const onReply = async (task, note, photos = []) => {
    const ok = await confirmDialog({
      title: 'Send your reply to the DA?',
      message: `${task.title}\n“${note.trim()}”`,
      confirmLabel: 'Send reply',
    });
    if (ok) await run(task, () => respondToAction(client, task.id, note, photos), 'Your reply was sent to the DA.');
  };

  if (loading) return <div className="h-24 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />;
  if (unavailable) return null;
  if (compact && tasks.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Priority tasks">
      <div className="flex items-center gap-2">
        <ClipboardCheckIcon className="size-4 text-teal-700" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-900">Priority tasks from the DA</h2>
        {openCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{openCount} to answer</span>}
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Nothing from the DA&rsquo;s prioritization needs you right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} role={role} busy={busyId === t.id} onValidate={onValidate} onReply={onReply} />
          ))}
        </ul>
      )}
    </section>
  );
}
