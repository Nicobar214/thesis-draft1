/** How a farm-to-market road project's status is named and coloured for citizens. */

export function normalizeUserProjectStatus(status) {
  const lower = String(status || '').toLowerCase().replace(/[-\s]/g, '');
  if (lower === 'ongoing') return 'On-Going';
  if (lower === 'proposed' || lower === 'pending') return 'Proposed';
  if (lower === 'completed') return 'Completed';
  return status || 'Proposed';
}

export function getStatusStyle(status) {
  const styles = {
    'Completed':  { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
    'On-Going':   { badge: 'bg-amber-100 text-amber-700',     bar: 'bg-amber-500',   dot: 'bg-amber-500' },
    'Proposed':   { badge: 'bg-sky-100 text-sky-700',          bar: 'bg-sky-500',     dot: 'bg-sky-500' },
  };
  return styles[status] || styles['Proposed'];
}

export function parseDateOnly(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    return new Date(y, mo, d);
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function getDaysDeltaFromToday(targetDateValue) {
  const targetDate = parseDateOnly(targetDateValue);
  if (!targetDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function isProjectOverdue(project) {
  const status = normalizeUserProjectStatus(project?.status);
  if (status === 'Completed') return false;
  const delta = getDaysDeltaFromToday(project?.target_completion_date);
  return typeof delta === 'number' && delta < 0;
}
