/*
 * projectDeadlines.js — "will this project make its deadline?", from data the
 * system already has (target_completion_date, accomplishment, progress updates).
 * Used by Project Management -> Deadlines.
 *
 * Rules (kept deliberately simple so they can be explained to DA staff):
 *   Done        completed (status Completed, 100%, or a completion date)
 *   Overdue     not done and the target date has passed
 *   At risk     <= 30 days left with < 70% done, or <= 90 days left with < 40% done
 *   On track    not done, target date ahead, not at risk
 *   No target   not done and no target date on record
 */

export const DEADLINE_STATES = {
  overdue: { key: 'overdue', label: 'Overdue', rank: 0, pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  at_risk: { key: 'at_risk', label: 'At risk', rank: 1, pill: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  on_track: { key: 'on_track', label: 'On track', rank: 2, pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  no_target: { key: 'no_target', label: 'No target date', rank: 3, pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
};

const DAY = 86400000;

function parseDay(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function isDone(p) {
  const status = String(p.status || '').toLowerCase();
  return status === 'completed' || Number(p.accomplishment) >= 100 || Boolean(p.date_completed);
}

export function classifyDeadline(p, today = new Date()) {
  const day = new Date(today); day.setHours(0, 0, 0, 0);
  const target = parseDay(p.target_completion_date);
  const accomplishment = Math.max(0, Math.min(100, Number(p.accomplishment) || 0));
  if (!target) return { state: 'no_target', target: null, daysLeft: null, accomplishment };
  const daysLeft = Math.round((target - day) / DAY);
  let state = 'on_track';
  if (daysLeft < 0) state = 'overdue';
  else if ((daysLeft <= 30 && accomplishment < 70) || (daysLeft <= 90 && accomplishment < 40)) state = 'at_risk';
  return { state, target, daysLeft, accomplishment };
}

/**
 * Rows for every not-yet-done project, most urgent first:
 * overdue (most days late first), at risk and on track (soonest first), no target last.
 * `updates` are progress_updates rows ({ fmr_project_id, submitted_at }).
 */
export function buildDeadlineRows(projects, updates = [], today = new Date()) {
  const lastUpdate = new Map();
  updates.forEach((u) => {
    const t = u?.submitted_at ? new Date(u.submitted_at).getTime() : NaN;
    if (!Number.isFinite(t)) return;
    const key = String(u.fmr_project_id);
    if (!lastUpdate.has(key) || t > lastUpdate.get(key)) lastUpdate.set(key, t);
  });
  const now = today.getTime();

  return (projects || [])
    .filter((p) => p && !isDone(p))
    .map((p) => {
      const c = classifyDeadline(p, today);
      const last = lastUpdate.get(String(p.id));
      return {
        project: p,
        ...c,
        lastUpdateAt: last ? new Date(last) : null,
        daysSinceUpdate: last ? Math.floor((now - last) / DAY) : null,
      };
    })
    .sort((a, b) => {
      const ra = DEADLINE_STATES[a.state].rank;
      const rb = DEADLINE_STATES[b.state].rank;
      if (ra !== rb) return ra - rb;
      if (a.daysLeft == null || b.daysLeft == null) return String(a.project.project_name).localeCompare(String(b.project.project_name));
      return a.daysLeft - b.daysLeft;
    });
}

export function countDeadlineStates(rows) {
  const counts = { overdue: 0, at_risk: 0, on_track: 0, no_target: 0 };
  rows.forEach((r) => { counts[r.state] += 1; });
  return counts;
}
