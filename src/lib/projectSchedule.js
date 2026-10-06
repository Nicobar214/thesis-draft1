/*
 * Schedule status for an FMR project: one calculation shared by the admin filters and the
 * printed progress report, so the two can never disagree.
 *
 * Rules (stated on the report as well):
 *   Completed         official progress is 100%, or the project status is Completed
 *   Not Started       the project is still Proposed
 *   Delayed           the target completion date has passed, or (when a start date is
 *                     recorded) progress is more than BEHIND_TOLERANCE points behind a
 *                     straight-line schedule from start to target
 *   Nearly Completed  progress is at least NEARLY_THRESHOLD and not delayed
 *   On Time           everything else that has a target date
 *   Unscheduled       no target date is recorded, so nothing can be said about timing
 *
 * "Behind a straight-line schedule" assumes steady work, which real road projects are not;
 * it is a screening signal for the admin, not a contractual finding.
 */
export const NEARLY_THRESHOLD = 80;
export const BEHIND_TOLERANCE = 10;

const DAY_MS = 86_400_000;

export const SCHEDULE_STATUS = {
  completed: { key: 'completed', label: 'Completed', tone: 'emerald' },
  not_started: { key: 'not_started', label: 'Not Started', tone: 'slate' },
  delayed: { key: 'delayed', label: 'Delayed', tone: 'red' },
  nearly_completed: { key: 'nearly_completed', label: 'Nearly Completed', tone: 'sky' },
  on_time: { key: 'on_time', label: 'On Time', tone: 'teal' },
  unscheduled: { key: 'unscheduled', label: 'Unscheduled', tone: 'slate' },
};

function parseDay(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

const fmt = (d) => d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

/** @returns {{ key, label, tone, reason, expectedProgress: number|null }} */
export function scheduleStatus(project, now = Date.now()) {
  const progress = Number(project?.accomplishment) || 0;
  const rawStatus = String(project?.status || '').toLowerCase().replace(/[-\s]/g, '');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = parseDay(project?.target_completion_date);
  const start = parseDay(project?.date_started);

  const make = (s, reason, expectedProgress = null) => ({ ...SCHEDULE_STATUS[s], reason, expectedProgress });

  if (rawStatus === 'completed' || progress >= 100) return make('completed', 'Official progress is 100%.');
  if (rawStatus === 'proposed') return make('not_started', 'The project is still at the proposed stage.');
  if (!target) {
    return progress >= NEARLY_THRESHOLD
      ? make('nearly_completed', `Progress is ${progress}%. No target date is recorded.`)
      : make('unscheduled', 'No target completion date is recorded.');
  }

  if (target < today) return make('delayed', `The target date, ${fmt(target)}, has passed.`);

  let expected = null;
  if (start && start < target) {
    expected = Math.min(100, Math.max(0, ((today - start) / (target - start)) * 100));
    if (progress < expected - BEHIND_TOLERANCE) {
      return make(
        'delayed',
        `Progress is ${progress}% but about ${Math.round(expected)}% would be expected by now (${fmt(start)} to ${fmt(target)}).`,
        expected,
      );
    }
  }

  if (progress >= NEARLY_THRESHOLD) return make('nearly_completed', `Progress is ${progress}%, ahead of the ${fmt(target)} target.`, expected);

  const daysLeft = Math.ceil((target - today) / DAY_MS);
  return make(
    'on_time',
    expected === null
      ? `The target date, ${fmt(target)}, is ${daysLeft} day${daysLeft === 1 ? '' : 's'} away. No start date is recorded, so pace was not checked.`
      : `Progress is ${progress}% against about ${Math.round(expected)}% expected by now.`,
    expected,
  );
}

/** The five filters the DA asked for. `match` receives a project. */
export const PROJECT_FILTERS = [
  { value: 'All', label: 'All Projects', match: () => true },
  { value: 'On-Going', label: 'In Progress', match: (p, norm) => norm(p.status) === 'On-Going' },
  { value: 'Delayed', label: 'Delayed', match: (p) => scheduleStatus(p).key === 'delayed' },
  { value: 'Nearly Completed', label: 'Nearly Completed', match: (p) => scheduleStatus(p).key === 'nearly_completed' },
  { value: 'Completed', label: 'Completed', match: (p, norm) => norm(p.status) === 'Completed' },
  { value: 'Proposed', label: 'Proposed', match: (p, norm) => norm(p.status) === 'Proposed' },
];
