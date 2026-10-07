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
