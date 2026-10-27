import { CheckCircle2Icon, RotateCwIcon, TriangleAlertIcon, XCircleIcon, ZapIcon } from 'lucide-react';
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { computePriority, PRIORITY_CRITERIA, PRIORITY_WEIGHTS, FARMER_RADIUS_M, REPORT_RADIUS_M } from '../../lib/priorityScoring';
import { PLACEMENT_LABELS } from '../../lib/gapGeometry';
import { normalizeRouteStatus } from '../../lib/mapRouteUtils';
import {
  actionOwner, canEndorse, canMove, DEADLINE_TONES, deadlineStatus, DECISION_LABELS, decisionFor, DEFAULT_REPLY_DAYS, DEFAULT_VALIDATION_DAYS, finishedFollowUps,
  isFinal, loadDecisions, localDateISO, nextStatus, ONGOING_ACTIONS, resumeStatus, saveDecision, skippedAhead, snapshotOf, STEP_ACTIONS,
  closeWithOutcome, OUTCOME_LABELS, priorityStage, canDrop, DROP_REASONS, MIN_REASON,
} from '../../lib/priorityDecisions';
import { completionTiming } from '../../lib/projectDeadlines';
import { confirm as confirmDialog } from '../../lib/confirm';
import { SentPhotos } from '../priority/PriorityTasksPanel';
import { boundsFromPoints, getRouteStatusTheme } from '../../lib/mapRouteUtils';
import { GAP_PATH_OPTIONS, gapEndcapIcon } from '../map/routeMarkerIcons';
import { pinGlyph } from '../../lib/mapMarkerIcons';

const roadPinIcon = new L.DivIcon({
  className: 'prio-road-pin-marker',
  html: '<div style="background:#0f766e;color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:14px;box-shadow:0 2px 5px rgba(0,0,0,0.3)">' + pinGlyph(14) + '</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/* Fits once per road, without animation: the cards re-render on every realtime
 * reload (new `points` arrays), and an animated zoom still running when a card
 * re-sorts or unmounts crashes Leaflet (_leaflet_pos of undefined). */
function FitBoundsComponent({ points }) {
  const map = useMap();
  const key = Array.isArray(points) ? JSON.stringify(points) : '';
  useEffect(() => {
    const pts = key ? JSON.parse(key) : [];
    const bounds = pts.length > 0 ? boundsFromPoints(pts) : null;
    if (!bounds || !bounds.flat().every(Number.isFinite)) return;
    if (!map.getContainer()?.isConnected) return;
    try {
      map.invalidateSize({ animate: false });
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17, animate: false });
    } catch {
      // The map was torn down between render and effect; nothing to fit.
    }
  }, [map, key]);
  return null;
}

/* A mini map that fails (Leaflet throws while many maps mount at once, e.g.
   switching to "Ongoing projects") stays inside its card instead of taking the
   whole tab down; React's retry of the crashed map was what then reported
   "Map container is being reused by another instance". */
class MiniMapBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('Priority mini map failed', error);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/* True once the element is near the screen. The ongoing list has a map per card
   (20+); drawing them as they scroll in keeps a group switch from starting every
   Leaflet map at once. */
function useNearScreen() {
  const ref = useRef(null);
  // Without IntersectionObserver (old browsers, tests) every map is drawn at once.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return undefined;
    const io = new IntersectionObserver((items) => {
      if (items.some((i) => i.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}

/* The candidate's line: a gap's surveyed unpaved section (dashed red), or an
 * ongoing project's route (its status color). Nothing is drawn without real
 * geometry. */
function PriorityRoadMiniMap({ entry, onViewOnMap }) {
  const { points, gap, project, kind } = entry;
  const [frameRef, near] = useNearScreen();
  if (!points || points.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
        No mapped geometry for this road yet.
      </div>
    );
  }
  const isGap = kind === 'gap';
  const km = Number(entry.lengthKm);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-500">
          {isGap ? (entry.geometry?.placement === 'partly-mapped' ? 'Road to concrete (mapped part only)' : 'Road to concrete') : 'Project route'}
        </span>
        {onViewOnMap && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onViewOnMap(project); }}
            className="shrink-0 text-xs font-semibold text-teal-700 hover:text-teal-900"
          >
            View on map
          </button>
        )}
      </div>

      <div ref={frameRef} className="h-44 w-full relative z-0 bg-slate-100">
        {near && (
        <MiniMapBoundary
          fallback={(
            <div className="grid h-full place-items-center px-3 text-center text-xs text-slate-500">
              Map could not load here.{onViewOnMap ? ' Use "View on map" above.' : ''}
            </div>
          )}
        >
        <MapContainer center={points[0]} zoom={14} style={{ width: '100%', height: '100%' }} scrollWheelZoom={false} className="z-0">
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Polyline positions={points} pathOptions={{ color: '#ffffff', weight: 7, opacity: 0.75 }} />
          <Polyline
            positions={points}
            pathOptions={isGap ? GAP_PATH_OPTIONS : { color: getRouteStatusTheme(project?.status).line, weight: 4, opacity: 0.95 }}
          />
          {[points[0], points[points.length - 1]].map((position, index) => (
            <Marker key={index} position={position} icon={gapEndcapIcon} />
          ))}
          <Marker position={points[0]} icon={roadPinIcon}>
            <Popup>
              <div className="text-xs p-1 space-y-0.5">
                <p className="font-bold text-slate-900">{entry.title}</p>
                <p>
                  {gap?.barangay || project?.barangay || 'Barangay not resolved'}
                  {gap?.barangay_end || project?.barangay_end ? ` → ${gap?.barangay_end || project?.barangay_end}` : ''}, {entry.municipality}
                </p>
                {Number.isFinite(km) && <p>{km.toFixed(2)} km {isGap ? 'gap length' : 'still to build'}</p>}
              </div>
            </Popup>
          </Marker>
          <FitBoundsComponent points={points} />
        </MapContainer>
        </MiniMapBoundary>
        )}
      </div>
    </div>
  );
}

// One definition of the five criteria and their weights, from the scorer.
const pct = (w) => `${Math.round(w * 100)}%`;
const FACTORS = PRIORITY_CRITERIA.map((c) => ({ ...c, weight: pct(PRIORITY_WEIGHTS[c.key]) }));

const GROUPS = [
  { key: 'newRoads', label: 'New road suggestions', hint: 'Surveyed barangay roads with gravel/earth stretches to concrete, not FMR projects yet' },
  { key: 'ongoing', label: 'Ongoing projects', hint: 'FMR projects still under construction' },
];

// Priority tier from the score. Color appears only here and in the gap line on
// the map; everything else on the card is neutral.
function priorityTier(score) {
  if (score >= 70) return { label: 'High priority', cls: 'bg-rose-50 text-rose-700 ring-rose-200' };
  if (score >= 40) return { label: 'Medium priority', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label: 'Low priority', cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
}

/* A card opens its project only on a deliberate click on the card itself:
 * not when the click comes from the mini-map (panning, its popup), a control,
 * or the end of a drag / text selection, which browsers also report as a click. */
const NO_OPEN = '.leaflet-container, button, a, input, select, textarea, label, [role="group"], [role="dialog"]';
function isDeliberateCardClick(event, pressedAt) {
  const inside = event.target instanceof Element ? event.target.closest(NO_OPEN) : null;
  if (inside && event.currentTarget.contains(inside)) return false;
  if (pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > 6) return false;
  const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (selection && String(selection).trim()) return false;
  return true;
}

const formatDay = (iso) => new Date(`${iso}T00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
/* "Nov 18, 2026" from a stored date ('YYYY-MM-DD' or written out); as stored if unreadable. */
const plainDay = (value) => {
  const s = String(value || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

function formatTimestamp(value) {
  if (!value) return 'Not calculated yet';
  return value.toLocaleString();
}

const STEP_REMINDERS = {
  shortlisted: 'The DA evaluates this road next. Nothing is funded yet.',
  for_validation: 'Send a field engineer to confirm the gap on the ground (length, surface, who it serves) before going further.',
  endorsed: 'The site validation confirmed this road. The LGU is told that an FMR project will start in their municipality.',
  converted: 'Opens the Add Project form filled in from this gap. The project stays private until its Work Plan is finalized.',
  dropped: 'The road leaves the ranking for good. The reason, the engineer\'s answer and the photos stay in the record.',
  flagged: 'The project becomes a DA priority: the contractor sees a DA PRIORITY badge and finds it under "Do These First". Nothing else is asked of them.',
  action_recorded: 'Records the action the DA decided for this project.',
  closed: 'Ends the DA priority on this project. The decision stays in the record.',
};

/* The decision step for one ranked road: current status, and the one next
 * action (plus defer / resume). */
/* "roads" / "projects", for the out-of-order wording. */
const groupNoun = (kind) => (kind === 'gap' ? 'roads' : 'projects');
const listSkipped = (skipped, max = 3) => {
  const shown = skipped.slice(0, max).map((s) => `#${s.rank} ${s.title} (score ${s.score})`).join(', ');
  return skipped.length > max ? `${shown}, and ${skipped.length - max} more` : shown;
};

/* "#1, #2, #4 +2" */
const skippedRanks = (skipped, max = 4) =>
  `${skipped.slice(0, max).map((s) => `#${s.rank}`).join(', ')}${skipped.length > max ? ` +${skipped.length - max}` : ''}`;

function DecisionBlock({ entry, decision, busy, onStep, onOutcome, fieldEngineers = [], skipped = [] }) {
  const [note, setNote] = useState('');
  const [dropReason, setDropReason] = useState('');
  const [action, setAction] = useState(ONGOING_ACTIONS[0]);
  const [engineerId, setEngineerId] = useState('');
  const [dueDate, setDueDate] = useState(() => localDateISO(new Date(), DEFAULT_VALIDATION_DAYS));
  const [replyDue, setReplyDue] = useState(() => localDateISO(new Date(), DEFAULT_REPLY_DAYS));
  const replyDeadline = deadlineStatus(decision?.reply_due_date);
  const today = localDateISO();
  const deadline = deadlineStatus(decision?.due_date);
  const status = decision?.status || 'ranked';
  const next = nextStatus(entry.kind, status);
  const finished = isFinal(entry.kind, status);
  const deferred = status === 'deferred';
  const engineerName = (id) => {
    const e = fieldEngineers.find((x) => x.id === id);
    return e?.full_name || e?.email || 'the field engineer';
  };
  // Notifying the LGU needs the engineer's on-site confirmation first.
  const droppable = entry.kind === 'gap' && canDrop(decision);
  const blockedReason = next === 'endorsed' && !canEndorse(decision)
    ? (droppable ? 'The engineer did not confirm this road. Drop it with a reason, or put it on hold.' : 'Waiting for the site validation.')
    : next === 'for_validation' && !engineerId ? 'Choose a field engineer.'
      : next === 'for_validation' && (!dueDate || dueDate < today) ? 'Set a visit deadline from today on.'
      : next === 'action_recorded' && (!replyDue || replyDue < today) ? 'Set a reply date from today on.'
        : entry.kind === 'project' && next === 'closed' && note.trim().length < MIN_REASON ? `Write why the priority ends (at least ${MIN_REASON} characters).`
          : skipped.length > 0 && !note.trim() ? `Write why this one goes ahead of higher-ranked ${groupNoun(entry.kind)}.` : null;
  const dropBlocked = !dropReason ? 'Choose a reason.' : note.trim().length < MIN_REASON ? `Write a note (at least ${MIN_REASON} characters).` : null;
  const prioritized = priorityStage(decision);

  // The END of a project's action: the DA marks the result (supabase_priority_commitment_outcome.sql).
  const awaitingResult = entry.kind === 'project' && status === 'action_recorded';
  const stage = priorityStage(decision)?.stage;
  const fmtDay = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  const stop = (event) => event.stopPropagation();

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3" onClick={stop} onKeyDown={stop} role="group" aria-label="Decision">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">Decision</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          status === 'dropped' ? 'bg-rose-100 text-rose-800' : finished ? 'bg-emerald-100 text-emerald-800' : deferred ? 'bg-slate-200 text-slate-700' : status === 'ranked' ? 'bg-white text-slate-600 ring-1 ring-slate-200' : 'bg-teal-100 text-teal-800'
        }`}>
          {DECISION_LABELS[status]}
        </span>
      </div>

      {decision?.action && <p className="text-[11px] text-slate-600">Action: <span className="font-semibold">{decision.action}</span></p>}
      {prioritized?.stage === 'priority' && (
        <p className="text-[11px] text-teal-800">
          The contractor sees this as <span className="font-semibold">DA priority{prioritized.rank ? ` #${prioritized.rank}` : ''}</span> under &ldquo;Do These First&rdquo;.
        </p>
      )}
      {decision?.note && <p className="line-clamp-2 text-[11px] text-slate-500">“{decision.note}”</p>}

      {/* What the field engineer / contractor did with it */}
      {status === 'for_validation' && (
        decision?.validated_at ? (
          <div className={`rounded-md px-2 py-1 text-[11px] ${decision.validation_result === 'confirmed' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            <span className="font-semibold">{decision.validation_result === 'confirmed' ? 'Confirmed on site' : 'Not as described'}</span>
            {' by '}{engineerName(decision.assigned_engineer_id)}: {decision.validation_note}
            <SentPhotos photos={decision.validation_photos} />
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[11px] text-amber-700">Waiting for {engineerName(decision?.assigned_engineer_id)} to check it on site.</p>
            {deadline && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${DEADLINE_TONES[deadline.tone]}`}>{deadline.text}</span>
            )}
          </div>
        )
      )}
      {status === 'action_recorded' && (
        decision?.responded_at ? (
          <div className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
            <span className="font-semibold">{decision.committed_by ? 'Contractor committed' : `Reply from the ${actionOwner(decision.action) === 'site_engineer' ? 'site engineer' : 'contractor'}`}:</span> {decision.response_note}
            {decision.committed_by && <span className="font-semibold"> · done by {fmtDay(decision.committed_by)}</span>}
            <SentPhotos photos={decision.response_photos} />
            {stage === 'decision_due' && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Decision due</p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[11px] text-amber-700">Waiting for the {actionOwner(decision?.action) === 'site_engineer' ? 'site engineer' : 'contractor'} to reply.</p>
            {replyDeadline && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${DEADLINE_TONES[replyDeadline.tone]}`}>Reply: {replyDeadline.text}</span>
            )}
          </div>
        )
      )}

      {status === 'dropped' ? (
        <p className="flex items-start gap-1 text-[11px] font-medium text-rose-700">
          <XCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Dropped: {DROP_REASONS[decision?.drop_reason] || 'no reason recorded'}. This road&rsquo;s decision is final.
        </p>
      ) : finished ? (
        <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
          {entry.kind === 'gap'
            ? `FMR project${decision?.fmr_project_id ? ` #${decision.fmr_project_id}` : ''} created. Next: its Work Plan.`
            : decision?.outcome
              ? `Result: ${OUTCOME_LABELS[decision.outcome]}${decision.outcome_note ? ` · “${decision.outcome_note}”` : ''}`
              : `DA priority ended${decision?.outcome_note || decision?.note ? `: ${decision.outcome_note || decision.note}` : '.'}`}
        </p>
      ) : droppable ? (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-600">The engineer found this road not as described. Drop it, or put it on hold to look at it again later.</p>
          <select
            value={dropReason}
            onChange={(e) => setDropReason(e.target.value)}
            disabled={busy}
            aria-label="Why the road is dropped"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
          >
            <option value="">Reason for dropping…</option>
            {Object.entries(DROP_REASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder={`Note (at least ${MIN_REASON} characters)`}
            aria-label="Note on the decision"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || Boolean(dropBlocked)}
              title={dropBlocked || undefined}
              onClick={() => onStep({ entry, from: status, to: 'dropped', note, dropReason, decision }).then((ok) => { if (ok) { setNote(''); setDropReason(''); } })}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              <XCircleIcon className="size-3.5" aria-hidden="true" /> {STEP_ACTIONS.dropped}
            </button>
            <button
              type="button"
              disabled={busy || note.trim().length === 0}
              title={note.trim() ? 'Put on hold with this note' : 'Write a note first'}
              onClick={() => onStep({ entry, from: status, to: 'deferred', note }).then((ok) => ok && setNote(''))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Put on hold
            </button>
          </div>
        </div>
      ) : awaitingResult ? (
        <div className="space-y-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="Note to the contractor (required for Not done)"
            aria-label="Result note"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onOutcome({ entry, decision, outcome: 'done', note }).then((ok) => ok && setNote(''))}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2Icon className="size-3.5" aria-hidden="true" /> Done
            </button>
            <button
              type="button"
              disabled={busy || note.trim().length < 10}
              title={note.trim().length < 10 ? 'Write why it was not done (10+ characters)' : undefined}
              onClick={() => onOutcome({ entry, decision, outcome: 'not_done', note }).then((ok) => ok && setNote(''))}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              <XCircleIcon className="size-3.5" aria-hidden="true" /> Not done
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            {decision?.responded_at ? 'Mark the result to finish this follow-up. The contractor is told.' : 'No reply yet. You can still mark the result to finish it.'}
          </p>
        </div>
      ) : (
        <>
          {next === 'for_validation' && (
            <select
              value={engineerId}
              onChange={(e) => setEngineerId(e.target.value)}
              disabled={busy}
              aria-label="Field engineer to validate on site"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              <option value="">Field engineer to validate on site…</option>
              {fieldEngineers.map((e) => <option key={e.id} value={e.id}>{e.full_name || e.email}</option>)}
            </select>
          )}
          {next === 'for_validation' && (
            <label className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Visit the road by</span>
              <input
                type="date"
                value={dueDate}
                min={today}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={busy}
                aria-label="Deadline for the site validation"
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              />
            </label>
          )}
          {next === 'action_recorded' && (
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              disabled={busy}
              aria-label="Action decided"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              {ONGOING_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {next === 'action_recorded' && (
            <label className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Reply by</span>
              <input
                type="date"
                value={replyDue}
                min={today}
                onChange={(e) => setReplyDue(e.target.value)}
                disabled={busy}
                aria-label="Date the reply is due"
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              />
            </label>
          )}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder={deferred ? 'Why resume? (optional)'
              : entry.kind === 'project' && next === 'closed' ? `Why the priority ends (at least ${MIN_REASON} characters)`
                : skipped.length > 0 ? 'Reason (required)' : 'Note (needed to put on hold)'}
            aria-label={skipped.length > 0 ? 'Reason for prioritizing out of rank order' : 'Decision note'}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400"
          />
          {skipped.length > 0 && !deferred && (
            <div role="note" className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
              <span title={listSkipped(skipped, skipped.length)}>
                {skipped.length} higher-ranked still waiting ({skippedRanks(skipped)}). Add a reason to continue.
              </span>
            </div>
          )}
          {blockedReason && next !== 'for_validation' && !(skipped.length > 0 && !note.trim()) && <p className="text-[11px] text-slate-500">{blockedReason}</p>}
          <div className="flex gap-2">
            {deferred ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onStep({ entry, from: status, to: resumeStatus(entry.kind), note }).then((ok) => ok && setNote(''))}
                className="flex-1 rounded-md bg-teal-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                Resume
              </button>
            ) : next && (
              <button
                type="button"
                disabled={busy || Boolean(blockedReason)}
                title={blockedReason || undefined}
                onClick={() => onStep({
                  entry, from: status, to: next, note,
                  action: next === 'action_recorded' ? action : null,
                  assignedEngineerId: next === 'for_validation' ? engineerId : null,
                  dueDate: next === 'for_validation' ? dueDate : null,
                  replyDueDate: next === 'action_recorded' ? replyDue : null,
                  engineerLabel: next === 'for_validation' ? engineerName(engineerId) : null,
                  skipped,
                }).then((ok) => ok && setNote(''))}
                className="flex-1 rounded-md bg-teal-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {STEP_ACTIONS[next]}
              </button>
            )}
            {!deferred && canMove(entry.kind, status, 'deferred') && (
              <button
                type="button"
                disabled={busy || !note.trim()}
                title={note.trim() ? 'Put on hold with this note' : 'Write a note first'}
                onClick={() => onStep({ entry, from: status, to: 'deferred', note }).then((ok) => ok && setNote(''))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Put on hold
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function PriorityTab({
  projects, roadGaps = [], reports, farmers = [], markets = [], routesByProjectId = {}, client, fieldEngineers = [], proposals = [],
  onViewReports, onViewProjectDetail, onViewOnMap, onCreateProjectFromGap, showNotification,
}) {
  const [group, setGroup] = useState('newRoads');
  const [decisions, setDecisions] = useState(new Map());
  const [decisionsError, setDecisionsError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [calcTick, setCalcTick] = useState(0);
  const [lastCalculated, setLastCalculated] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const refreshDecisions = useCallback(async () => {
    if (!client) return;
    try {
      setDecisions(await loadDecisions(client));
      setDecisionsError('');
    } catch (err) {
      setDecisionsError(/priority_decisions/.test(err?.message || '')
        ? 'Decisions are not set up yet: run supabase_priority_decisions.sql.'
        : 'Could not load decisions.');
    }
  }, [client]);

  useEffect(() => { refreshDecisions(); }, [refreshDecisions]);

  // Live: validations, replies and other admins' steps appear without a reload.
  useEffect(() => {
    if (!client?.channel) return undefined;
    const channel = client
      .channel('admin-priority-decisions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'priority_decisions' }, () => refreshDecisions())
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, refreshDecisions]);

  // Overdue site validations and replies: remind the assignee and the admins
  // (at most once a day per item; the database also runs this every morning).
  useEffect(() => {
    if (!client?.rpc) return;
    client.rpc('priority_notify_overdue').then(({ error }) => {
      if (error && !/priority_notify_overdue/.test(error.message || '')) console.warn('[priority] overdue check:', error.message);
    });
  }, [client]);

  const replyDueRef = useRef(null);
  const pressAt = useRef(null); // where the last press on a card started (drag check)

  // Follow-ups whose project finished meanwhile: no longer ranked, still open.
  const finished = useMemo(
    () => finishedFollowUps(decisions, projects, (p) => normalizeRouteStatus(p.status) === 'On-Going'),
    [decisions, projects],
  );
  // Days added to a project's target by approved extensions (for "target extended by").
  const extensionDays = async (projectId) => {
    try {
      const { data, error } = await client.from('project_time_extensions').select('days_granted').eq('project_id', projectId);
      if (error) return 0;
      return (data || []).reduce((sum, r) => sum + (Number(r.days_granted) || 0), 0);
    } catch {
      return 0;
    }
  };

  const closeFinished = async ({ decision, project }) => {
    const ok = await confirmDialog({
      title: `End the DA priority on ${project.project_name}?`,
      message: `The project is now ${project.status || 'no longer on-going'}, so it has left the ranking. This ends the DA priority (${DECISION_LABELS[decision.status]})${normalizeRouteStatus(project.status) === 'Completed' ? ' and records whether it finished ahead of schedule' : ''}. The contractor and the site engineer are told, and the decision stays in the record.`,
      confirmLabel: 'End priority',
      tone: 'primary',
    });
    if (!ok) return;
    setBusyKey(`project:${project.id}`);
    try {
      const completed = normalizeRouteStatus(project.status) === 'Completed';
      if (decision.status === 'action_recorded') {
        // A recorded action ends with a result: a completed project counts as done.
        const reason = `Closed: the project is now ${String(project.status || 'finished').toLowerCase()}.`;
        await closeWithOutcome(client, decision.id, completed ? 'done' : 'not_done', reason);
      } else {
        // A prioritized project ends with its schedule result, kept on the record.
        const timing = completed ? completionTiming(project, await extensionDays(project.id)) : null;
        const reason = completed
          ? `Project completed${project.date_completed ? ` ${plainDay(project.date_completed)}` : ''}${timing ? `, ${timing.text.replace(/^Completed /, '')}` : ''}.`
          : `The project is now ${String(project.status || 'no longer on-going').toLowerCase()}.`;
        await saveDecision(client, { kind: 'project', id: project.id, from: decision.status, to: 'closed', finishedClose: true, note: reason, outcomeNote: reason });
      }
      await refreshDecisions();
      showNotification?.(`${project.project_name}: DA priority ended.`);
    } catch (err) {
      showNotification?.(err?.message || 'Could not end the priority.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  // A gap that became an FMR project, or was dropped, leaves the New group.
  const convertedGapIds = useMemo(
    () => [...decisions.values()].filter((d) => d.candidate_kind === 'gap' && (d.status === 'converted' || d.status === 'dropped')).map((d) => d.candidate_id),
    [decisions],
  );
  const droppedRoads = useMemo(() => {
    const byId = new Map((roadGaps || []).map((g) => [String(g.id), g]));
    return [...decisions.values()]
      .filter((d) => d.candidate_kind === 'gap' && d.status === 'dropped')
      .map((d) => ({ decision: d, gap: byId.get(String(d.candidate_id)) || null }));
  }, [decisions, roadGaps]);
  const lguCountRef = useRef(null); // LGU accounts the "Notify LGU" notice reaches

  const result = useMemo(
    () => computePriority({ gaps: roadGaps, projects, routesByProjectId, reports, farmers, markets, proposals, excludeGapIds: convertedGapIds }),
    // calcTick re-runs it on "Recalculate"
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roadGaps, projects, routesByProjectId, reports, farmers, markets, proposals, convertedGapIds, calcTick],
  );
  const rankings = result[group];

  useEffect(() => {
    setLastCalculated(new Date());
  }, [result]);
  useEffect(() => { setCurrentPage(1); }, [group]);

  const topCrops = (result.topCommodities.leon || Object.values(result.topCommodities)[0] || []).map((t) => t.crop);

  // Who hears about each step (supabase_priority_roles.sql sends the notifications).
  const whoIsTold = (entry, to, action, engineerLabel, dueDate) => {
    if (to === 'for_validation') return `${engineerLabel || 'The field engineer'} is notified to check the road on site${dueDate ? ` by ${new Date(`${dueDate}T00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. The date is shown on their task.`;
    if (to === 'endorsed') {
      const town = entry.municipality || 'Leon';
      const count = lguCountRef.current;
      if (count === 0) return `No LGU account is set up for ${town}, so nobody will be notified. You can still continue.`;
      return `The LGU of ${town}${count ? ` (${count} account${count === 1 ? '' : 's'})` : ''} is notified that an FMR project will start in their municipality.`;
    }
    if (to === 'flagged') return 'The contractor and the site engineer are notified.';
    if (to === 'action_recorded') return `The ${actionOwner(action) === 'site_engineer' ? 'site engineer' : 'contractor'} is notified and asked to reply${replyDueRef.current ? ` by ${formatDay(replyDueRef.current)}` : ''}. If it is late, they and the admins get a daily reminder.`;
    if (to === 'closed') return 'The contractor and the site engineer are told the DA priority ended.';
    return '';
  };

  const handleStep = async ({ entry, from, to, note = '', action = null, assignedEngineerId = null, dueDate = null, replyDueDate = null, engineerLabel = null, skipped = [], dropReason = null, decision = null }) => {
    const label = to === 'deferred' ? 'Put on hold' : from === 'deferred' ? 'Resume' : STEP_ACTIONS[to];
    replyDueRef.current = replyDueDate;
    if (to === 'endorsed') {
      // How many LGU accounts the notice reaches (null when it cannot be checked).
      const { data, error } = await client.rpc('priority_lgu_recipients', { p_municipality: entry.municipality || 'Leon' });
      lguCountRef.current = error || typeof data !== 'number' ? null : data;
    }
    // Out of rank order: a friendly warning, and the reason goes on record.
    const outOfOrder = skipped.length > 0 && to !== 'deferred' && from === 'ranked';
    const ok = outOfOrder ? await confirmDialog({
      title: `Prioritize ahead of higher-ranked ${groupNoun(entry.kind)}?`,
      message: `${entry.title} is rank #${entry.rank} (score ${entry.score}/100).

Still waiting: ${listSkipped(skipped)}.

`
        + `The ranking is the DA's evidence-based order. You can go ahead, but your reason is saved with this decision for the audit trail: "${note.trim()}"`
        + `${STEP_REMINDERS[to] ? `

${STEP_REMINDERS[to]}` : ''}${whoIsTold(entry, to, action, engineerLabel, dueDate) ? `

${whoIsTold(entry, to, action, engineerLabel, dueDate)}` : ''}`,
      confirmLabel: 'Prioritize anyway',
      tone: 'warning',
    }) : await confirmDialog({
      title: `${label}: ${entry.title}?`,
      message: `Rank #${entry.rank}, score ${entry.score}/100.${action ? ` Action: ${action}.` : ''}\n\n${
        to === 'deferred' ? `It leaves the active process until resumed. Reason: "${note.trim()}"`
          : to === 'dropped' ? `${STEP_REMINDERS.dropped}\n\nReason: ${DROP_REASONS[dropReason] || '—'}. "${note.trim()}"`
            : (STEP_REMINDERS[to] || '')
      }${whoIsTold(entry, to, action, engineerLabel, dueDate) ? `\n\n${whoIsTold(entry, to, action, engineerLabel, dueDate)}` : ''}`,
      confirmLabel: label,
      tone: to === 'deferred' ? 'warning' : to === 'dropped' ? 'danger' : 'primary',
    });
    if (!ok) return false;

    const key = `${entry.kind}:${entry.id}`;
    setBusyKey(key);
    try {
      if (to === 'converted') {
        // The Add Project form saves the decision once the project exists.
        onCreateProjectFromGap?.(entry.gap, async (fmrProjectId) => {
          await saveDecision(client, { kind: entry.kind, id: entry.id, from, to, note, snapshot: snapshotOf(entry), fmrProjectId });
          await refreshDecisions();
        });
        return true;
      }
      const snapshot = outOfOrder
        ? { ...snapshotOf(entry), skipped_ahead_of: skipped.map(({ id, rank, title, score }) => ({ id, rank, title, score })) }
        : snapshotOf(entry);
      // Ending a priority by hand: the reason is also what the contractor sees for a while.
      const outcomeNote = entry.kind === 'project' && to === 'closed' ? `Priority removed: ${note.trim()}` : null;
      await saveDecision(client, { kind: entry.kind, id: entry.id, from, to, note, action, assignedEngineerId, dueDate, replyDueDate, snapshot, decision, dropReason, outcomeNote });
      await refreshDecisions();
      showNotification?.(`${entry.title}: ${DECISION_LABELS[to]}.`);
      return true;
    } catch (err) {
      showNotification?.(err?.message || 'Could not save the decision.', 'error');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  // Commitments whose done-by date has passed: the DA owes a result.
  const decisionsDue = useMemo(() => [...decisions.values()]
    .filter((d) => priorityStage(d)?.stage === 'decision_due')
    .map((d) => ({ d, name: (projects || []).find((p) => String(p.id) === String(d.candidate_id))?.project_name || `Project #${d.candidate_id}` })),
  [decisions, projects]);

  // The END of a project's action: Done / Not done, with a confirmation.
  const handleOutcome = async ({ entry, decision, outcome, note = '' }) => {
    const done = outcome === 'done';
    const ok = await confirmDialog({
      title: done ? `Mark "${entry.title}" as done?` : `Mark "${entry.title}" as not done?`,
      message: done
        ? `The "${decision?.action}" follow-up is finished and the contractor is told it is done.`
        : `The follow-up ends here as not done. The contractor is told why: “${note.trim()}”. If the project falls behind its schedule, the Overdue process takes over.`,
      confirmLabel: done ? 'Mark as done' : 'Mark as not done',
      tone: done ? 'primary' : 'danger',
    });
    if (!ok) return false;
    const key = `${entry.kind}:${entry.id}`;
    setBusyKey(key);
    try {
      await closeWithOutcome(client, decision.id, outcome, note);
      await refreshDecisions();
      showNotification?.(`${entry.title}: ${done ? 'done' : 'not done'}. The contractor was told.`);
      return true;
    } catch (err) {
      showNotification?.(/close_priority_action/.test(err?.message || '')
        ? 'Run supabase_priority_commitment_outcome.sql first to enable Done / Not done.'
        : err?.message || 'Could not save the result.', 'error');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  if (!projects || projects.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-lg font-semibold text-slate-800">No FMR projects found. Add projects first.</p>
        <p className="text-sm text-slate-500 mt-2">Priority rankings appear once projects are available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {decisionsDue.length > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">Decision due on {decisionsDue.length} priority action{decisionsDue.length === 1 ? '' : 's'}</p>
            <p className="mt-0.5 text-xs text-red-800">
              The contractor&rsquo;s done-by date has passed. Mark each one Done or Not done on its card in Ongoing projects:{' '}
              {decisionsDue.map(({ d, name }, i) => (
                <span key={d.id}>{i > 0 && '; '}<span className="font-semibold">{name}</span> (by {new Date(`${d.committed_by}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })})</span>
              ))}
            </p>
          </div>
        </div>
      )}

      {/* Header: one module, two separate groups */}
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-900 to-slate-900 p-6 text-white shadow-md">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/30 mb-2">
              Decision support
            </span>
            <h2 className="text-xl font-bold tracking-tight">FMR Prioritization: 5 criteria</h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              New road suggestions and ongoing projects are ranked separately, each from gap length, market access,
              citizen reports, the area&rsquo;s top commodities and farmer density.
            </p>
          </div>
          <div className="flex items-center bg-slate-800/80 p-1.5 rounded-xl border border-slate-700" role="tablist" aria-label="Priority group">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={group === g.key}
                title={g.hint}
                onClick={() => setGroup(g.key)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  group === g.key ? 'bg-teal-500 text-slate-950 shadow-md' : 'text-slate-300 hover:text-white'
                }`}
              >
                {g.label} ({result[g.key].length})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Slim toolbar: the weights, the commodities that count, recalculation. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 text-sm text-slate-500">
          <p>
            <span className="font-medium text-slate-700">{rankings.length} ranked</span>
            <span className="mx-2 text-slate-300">|</span>
            {FACTORS.map((f) => `${f.label} ${f.weight}`).join(' · ')}
          </p>
          <p className="text-xs">
            Top commodities (LGU farmer registry): <span className="font-medium text-slate-700">{topCrops.length ? topCrops.join(', ') : 'no farmer data'}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            farms within {FARMER_RADIUS_M / 1000} km, reports within {REPORT_RADIUS_M} m of the road
          </p>
          {decisionsError && <p className="text-xs text-amber-700">{decisionsError}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400" title="Re-ranks by itself when projects, routes, reports, farmers, markets, proposals or decisions change">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Live · updated {formatTimestamp(lastCalculated)}
          </span>
          <button
            type="button"
            onClick={() => { setCalcTick((t) => t + 1); refreshDecisions(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCwIcon className="size-3.5" aria-hidden="true" />
            Recalculate
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {rankings.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            {group === 'newRoads' ? 'No surveyed roads left to concrete.' : 'No ongoing projects to rank.'}
          </div>
        )}
        {rankings.slice((currentPage - 1) * itemsPerPage, (currentPage - 1) * itemsPerPage + itemsPerPage).map((entry) => {
          const { project, gap, bySeverity, score, rank } = entry;
          const isGap = entry.kind === 'gap';
          const tier = priorityTier(score);
          const place = [
            entry.municipality,
            [gap?.barangay || project.barangay, gap?.barangay_end || project.barangay_end].filter(Boolean).join(' → '),
          ].filter(Boolean).join(' · ');
          const decision = decisionFor(decisions, entry);
          const toMarket = entry.marketKm != null ? `${entry.marketKm.toFixed(1)} km` : '—';
          const geo = entry.geometry;

          const facts = isGap
            ? [
                // The 5 criteria, in PRIORITY_CRITERIA order.
                { label: 'Gap length', value: Number.isFinite(entry.lengthKm) ? `${entry.lengthKm.toFixed(2)} km` : '—' },
                { label: 'Market access', value: entry.marketKm != null ? `${toMarket} to market` : toMarket },
                { label: 'Citizen reports', value: entry.reportCount },
                { label: 'Top commodities', value: `${entry.topCropFarmers} farmers` },
                { label: 'Farmer density', value: `${entry.farmersNear} farmers` },
              ]
            : [
                { label: 'Still to build', value: Number.isFinite(entry.lengthKm) ? `${entry.lengthKm.toFixed(2)} km` : '—' },
                { label: 'Accomplishment', value: `${Math.round(entry.accomplishment || 0)}%` },
                { label: 'To market', value: toMarket },
                { label: 'Farmers nearby', value: `${entry.farmersNear} (${entry.topCropFarmers} top crops)` },
              ];
          const severityChips = [
            { key: 'structural', label: 'Structural' },
            { key: 'obstruction', label: 'Obstruction' },
            { key: 'road_damage', label: 'Road damage' },
            { key: 'roadside', label: 'Signs & safety' },
          ].filter((item) => bySeverity[item.key] > 0);
          const canOpen = !isGap || Boolean(project.id);

          return (
            <article
              key={`${entry.kind}-${entry.id}`}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => { pressAt.current = { x: event.clientX, y: event.clientY }; }}
              onClick={(event) => {
                if (canOpen && onViewProjectDetail && isDeliberateCardClick(event, pressAt.current)) onViewProjectDetail(project);
              }}
              onKeyDown={(event) => {
                // Only when the card itself has focus, not a field or the map inside it.
                if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget && canOpen && onViewProjectDetail) {
                  event.preventDefault();
                  onViewProjectDetail(project);
                }
              }}
              className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-teal-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
                <div className="min-w-0 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold tabular-nums text-white">
                      {rank}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-teal-800">{entry.title}</h3>
                      <p className="text-sm text-slate-500">{place}</p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    {facts.map((f) => (
                      <div key={f.label} className="min-w-0">
                        <dt className="text-xs text-slate-500">{f.label}</dt>
                        <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900">{f.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {isGap && geo && (
                    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
                      <p>
                        <span className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                          geo.placement === 'partly-mapped' || geo.placement === 'stored-line'
                            ? 'bg-amber-50 text-amber-800 ring-amber-200'
                            : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                        }`}>
                          {PLACEMENT_LABELS[geo.placement]}
                        </span>
                        {geo.note}
                      </p>
                      {entry.pendingProposals?.length > 0 && (
                        <p className="font-medium text-sky-800">
                          LGU proposal pending: {entry.pendingProposals.map((pp) => `${pp.name} (${pp.status})`).join('; ')}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-slate-500">{entry.reason}</p>

                  {severityChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {severityChips.map((chip) => (
                        <span key={chip.key} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {chip.label} <span className="tabular-nums text-slate-900">{bySeverity[chip.key]}</span>
                        </span>
                      ))}
                      {severityChips.length > 0 && entry.reportCount > 2 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          <ZapIcon className="size-3" aria-hidden="true" />Repeated reports
                        </span>
                      )}
                    </div>
                  )}

                  <PriorityRoadMiniMap entry={entry} onViewOnMap={onViewOnMap} />
                </div>

                <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-500">Priority score</p>
                      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
                        {score}<span className="text-base font-medium text-slate-400">/100</span>
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tier.cls}`}>{tier.label}</span>
                  </div>

                  <div className="space-y-2.5">
                    {FACTORS.map((f) => {
                      const value = Math.min(100, Math.max(0, Number(entry[f.key]) || 0));
                      return (
                        <div key={f.key}>
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="text-slate-600">{f.label} <span className="text-slate-400">{f.weight}</span></span>
                            <span className="font-semibold tabular-nums text-slate-900">{value}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-teal-600" style={{ width: `${value}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {client && (
                    <DecisionBlock
                      entry={entry}
                      decision={decision}
                      fieldEngineers={fieldEngineers}
                      busy={busyKey === `${entry.kind}:${entry.id}`}
                      onStep={handleStep}
                      onOutcome={handleOutcome}
                      skipped={skippedAhead(entry, rankings, decisions)}
                    />
                  )}

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewReports && onViewReports(project);
                    }}
                    className="mt-auto w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    View reports{entry.reportCount > 0 ? ` (${entry.reportCount})` : ''}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {group === 'ongoing' && finished.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm font-semibold text-amber-900">
              {finished.length} DA priorit{finished.length > 1 ? 'ies' : 'y'} on project{finished.length > 1 ? 's' : ''} no longer on-going: end {finished.length > 1 ? 'them' : 'it'} to record the result
            </p>
            <ul className="mt-2 space-y-2">
              {finished.map(({ decision, project }) => (
                <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-amber-100">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{project.project_name}</span>
                    <span className="text-slate-500"> · now {project.status || 'finished'} · {DECISION_LABELS[decision.status]}</span>
                    {completionTiming(project) && (
                      <span className="block text-xs text-slate-500">{completionTiming(project).text}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={busyKey === `project:${project.id}`}
                    onClick={() => closeFinished({ decision, project })}
                    className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    End priority
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {group === 'newRoads' && result.covered.length > 0 && (
          <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">
              {result.covered.length} concreting need{result.covered.length > 1 ? 's' : ''} not ranked: already covered by an FMR project
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {result.covered.map((c) => (
                <li key={c.id}>
                  <span className="font-medium text-slate-800">{c.title}</span>
                  {' '}is {Math.round(c.coveredBy.share * 100)}% on <span className="font-medium">{c.coveredBy.name}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {group === 'newRoads' && droppedRoads.length > 0 && (
          <details className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-rose-800">
              {droppedRoads.length} road{droppedRoads.length > 1 ? 's' : ''} dropped after site validation
            </summary>
            <ul className="mt-2 space-y-2 text-xs text-slate-600">
              {droppedRoads.map(({ decision: d, gap }) => (
                <li key={d.id} className="rounded-lg bg-rose-50/50 px-3 py-2 ring-1 ring-rose-100">
                  <span className="font-medium text-slate-800">{gap?.source_road_name || gap?.gap_code || `Road gap #${d.candidate_id}`}</span>
                  {gap?.barangay && <span className="text-slate-500"> · {[gap.barangay, gap.barangay_end].filter(Boolean).join(' → ')}</span>}
                  <span className="block">
                    <span className="font-semibold text-rose-700">{DROP_REASONS[d.drop_reason] || 'Dropped'}</span>
                    {d.note && <> · &ldquo;{d.note}&rdquo;</>}
                    {d.updated_at && <span className="text-slate-400"> · {plainDay(d.updated_at)}</span>}
                  </span>
                  {d.validation_note && <span className="block text-slate-500">Engineer: &ldquo;{d.validation_note}&rdquo;</span>}
                  <SentPhotos photos={d.validation_photos} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {/* Pagination controls */}
        {rankings.length > itemsPerPage && (
          <div className="flex items-center justify-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50"
            >
              Previous
            </button>
            <div className="text-sm text-slate-600">Page {currentPage} of {Math.ceil(rankings.length / itemsPerPage)}</div>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(Math.ceil(rankings.length / itemsPerPage), p + 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
