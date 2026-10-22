import { CheckCircle2Icon, RotateCwIcon, ZapIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { computePriority, PRIORITY_CRITERIA, PRIORITY_WEIGHTS, FARMER_RADIUS_M, REPORT_RADIUS_M } from '../../lib/priorityScoring';
import {
  actionOwner, canEndorse, canMove, DEADLINE_TONES, deadlineStatus, DECISION_LABELS, decisionFor, DEFAULT_VALIDATION_DAYS,
  isFinal, loadDecisions, localDateISO, nextStatus, ONGOING_ACTIONS, resumeStatus, saveDecision, snapshotOf, STEP_ACTIONS,
} from '../../lib/priorityDecisions';
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

function FitBoundsComponent({ points }) {
  const map = useMap();
  useEffect(() => {
    if (Array.isArray(points) && points.length > 0) {
      const bounds = boundsFromPoints(points);
      if (bounds) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [map, points]);
  return null;
}

/* The candidate's line: a gap's surveyed unpaved section (dashed red), or an
 * ongoing project's route (its status color). Nothing is drawn without real
 * geometry. */
function PriorityRoadMiniMap({ entry, onViewOnMap }) {
  const { points, gap, project, kind } = entry;
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
        <span className="text-xs font-medium text-slate-500">{isGap ? 'Unpaved section' : 'Project route'}</span>
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

      <div className="h-44 w-full relative z-0">
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
                {Number.isFinite(km) && <p>{km.toFixed(2)} km {isGap ? 'unpaved' : 'still to build'}</p>}
                {gap?.source_surface_summary && <p className="text-slate-600">{gap.source_surface_summary}</p>}
              </div>
            </Popup>
          </Marker>
          <FitBoundsComponent points={points} />
        </MapContainer>
      </div>
    </div>
  );
}

// One definition of the five criteria and their weights, from the scorer.
const pct = (w) => `${Math.round(w * 100)}%`;
const FACTORS = PRIORITY_CRITERIA.map((c) => ({ ...c, weight: pct(PRIORITY_WEIGHTS[c.key]) }));

const GROUPS = [
  { key: 'newRoads', label: 'New road suggestions', hint: 'Surveyed unpaved gaps that are not FMR projects yet' },
  { key: 'ongoing', label: 'Ongoing projects', hint: 'FMR projects still under construction' },
];

// Priority tier from the score. Color appears only here and in the gap line on
// the map; everything else on the card is neutral.
function priorityTier(score) {
  if (score >= 70) return { label: 'High priority', cls: 'bg-rose-50 text-rose-700 ring-rose-200' };
  if (score >= 40) return { label: 'Medium priority', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label: 'Low priority', cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
}

function formatTimestamp(value) {
  if (!value) return 'Not calculated yet';
  return value.toLocaleString();
}

const STEP_REMINDERS = {
  shortlisted: 'It joins the shortlist the DA will act on. Nothing is funded yet.',
  for_validation: 'Send a field engineer to confirm the gap on the ground (length, surface, who it serves) before endorsing it.',
  endorsed: 'Only endorse after the site validation confirms the gap. This marks it as recommended for funding.',
  converted: 'Opens the Add Project form filled in from this gap. The project stays private until its Work Plan is finalized.',
  flagged: 'Marks this ongoing project as needing DA attention.',
  action_recorded: 'Records the action the DA decided for this project.',
  closed: 'Ends the follow-up for this project. The decision stays in the record.',
};

/* The decision step for one ranked road: current status, and the one next
 * action (plus defer / resume). */
function DecisionBlock({ entry, decision, busy, onStep, fieldEngineers = [] }) {
  const [note, setNote] = useState('');
  const [action, setAction] = useState(ONGOING_ACTIONS[0]);
  const [engineerId, setEngineerId] = useState('');
  const [dueDate, setDueDate] = useState(() => localDateISO(new Date(), DEFAULT_VALIDATION_DAYS));
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
  // Endorsing needs the engineer's on-site confirmation first.
  const blockedReason = next === 'endorsed' && !canEndorse(decision)
    ? (decision?.validation_result === 'not_confirmed' ? 'The engineer did not confirm this road. Defer it, or resume to send it again.' : 'Waiting for the site validation.')
    : next === 'for_validation' && !engineerId ? 'Choose a field engineer.'
      : next === 'for_validation' && (!dueDate || dueDate < today) ? 'Set a visit deadline from today on.' : null;

  const stop = (event) => event.stopPropagation();

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3" onClick={stop} onKeyDown={stop} role="group" aria-label="Decision">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">Decision</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          finished ? 'bg-emerald-100 text-emerald-800' : deferred ? 'bg-slate-200 text-slate-700' : status === 'ranked' ? 'bg-white text-slate-600 ring-1 ring-slate-200' : 'bg-teal-100 text-teal-800'
        }`}>
          {DECISION_LABELS[status]}
        </span>
      </div>

      {decision?.action && <p className="text-[11px] text-slate-600">Action: <span className="font-semibold">{decision.action}</span></p>}
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
            <span className="font-semibold">Reply from the {actionOwner(decision.action) === 'site_engineer' ? 'site engineer' : 'contractor'}:</span> {decision.response_note}
            <SentPhotos photos={decision.response_photos} />
          </div>
        ) : (
          <p className="text-[11px] text-amber-700">Waiting for the {actionOwner(decision?.action) === 'site_engineer' ? 'site engineer' : 'contractor'} to reply.</p>
        )
      )}

      {finished ? (
        <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
          {entry.kind === 'gap'
            ? `FMR project${decision?.fmr_project_id ? ` #${decision.fmr_project_id}` : ''} created. Next: its Work Plan.`
            : 'Follow-up closed.'}
        </p>
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
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder={deferred ? 'Why resume? (optional)' : 'Note (needed to defer)'}
            aria-label="Decision note"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400"
          />
          {blockedReason && next !== 'for_validation' && <p className="text-[11px] text-slate-500">{blockedReason}</p>}
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
                  engineerLabel: next === 'for_validation' ? engineerName(engineerId) : null,
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
                title={note.trim() ? 'Defer with this note' : 'Write a note first'}
                onClick={() => onStep({ entry, from: status, to: 'deferred', note }).then((ok) => ok && setNote(''))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Defer
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function PriorityTab({
  projects, roadGaps = [], reports, farmers = [], markets = [], routesByProjectId = {}, client, fieldEngineers = [],
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

  // A gap that became an FMR project leaves the New group.
  const convertedGapIds = useMemo(
    () => [...decisions.values()].filter((d) => d.candidate_kind === 'gap' && d.status === 'converted').map((d) => d.candidate_id),
    [decisions],
  );

  const result = useMemo(
    () => computePriority({ gaps: roadGaps, projects, routesByProjectId, reports, farmers, markets, excludeGapIds: convertedGapIds }),
    // calcTick re-runs it on "Recalculate"
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roadGaps, projects, routesByProjectId, reports, farmers, markets, convertedGapIds, calcTick],
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
    if (to === 'flagged') return 'The contractor and the site engineer are notified.';
    if (to === 'action_recorded') return `The ${actionOwner(action) === 'site_engineer' ? 'site engineer' : 'contractor'} is notified and asked to reply.`;
    if (to === 'closed') return 'The contractor and the site engineer are told it is closed.';
    return '';
  };

  const handleStep = async ({ entry, from, to, note = '', action = null, assignedEngineerId = null, dueDate = null, engineerLabel = null }) => {
    const label = to === 'deferred' ? 'Defer' : from === 'deferred' ? 'Resume' : STEP_ACTIONS[to];
    const ok = await confirmDialog({
      title: `${label}: ${entry.title}?`,
      message: `Rank #${entry.rank}, score ${entry.score}/100.${action ? ` Action: ${action}.` : ''}\n\n${
        to === 'deferred' ? `It leaves the active process until resumed. Reason: "${note.trim()}"` : (STEP_REMINDERS[to] || '')
      }${whoIsTold(entry, to, action, engineerLabel, dueDate) ? `\n\n${whoIsTold(entry, to, action, engineerLabel, dueDate)}` : ''}`,
      confirmLabel: label,
      tone: to === 'deferred' ? 'warning' : 'primary',
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
      await saveDecision(client, { kind: entry.kind, id: entry.id, from, to, note, action, assignedEngineerId, dueDate, snapshot: snapshotOf(entry) });
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
          <span className="text-xs text-slate-400">Updated {formatTimestamp(lastCalculated)}</span>
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
            {group === 'newRoads' ? 'No surveyed road gaps left to rank.' : 'No ongoing projects to rank.'}
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

          const facts = isGap
            ? [
                { label: 'Unpaved length', value: `${Number(entry.lengthKm || 0).toFixed(2)} km` },
                { label: 'To market', value: toMarket },
                { label: 'Reports nearby', value: entry.reportCount },
                { label: 'Farmers nearby', value: `${entry.farmersNear} (${entry.topCropFarmers} top crops)` },
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
              onClick={() => canOpen && onViewProjectDetail && onViewProjectDetail(project)}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && canOpen && onViewProjectDetail) {
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
        {group === 'newRoads' && result.covered.length > 0 && (
          <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">
              {result.covered.length} road gap{result.covered.length > 1 ? 's' : ''} not ranked: already covered by an FMR project
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
