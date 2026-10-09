/*
 * One color language for every admin Review Queue page (Public Reports,
 * Progress Updates, LGU Proposals), so a color means the same thing on all
 * three:
 *
 *   action  amber   -- the admin owes the next step
 *   waiting slate   -- with someone else (engineer, contractor, LGU)
 *   done    emerald -- finished
 *   problem rose    -- disputed, returned, rejected, overdue
 */
export const QUEUE_TONES = {
  action: { bar: 'bg-amber-500', value: 'text-amber-700' },
  waiting: { bar: 'bg-slate-400', value: 'text-slate-700' },
  done: { bar: 'bg-emerald-500', value: 'text-emerald-700' },
  problem: { bar: 'bg-rose-500', value: 'text-rose-700' },
};

/** Status-pill classes in the same four tones (for list rows). */
export const QUEUE_PILL = {
  action: 'bg-amber-50 text-amber-800 border-amber-200',
  waiting: 'bg-slate-100 text-slate-700 border-slate-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  problem: 'bg-rose-50 text-rose-700 border-rose-200',
};

// The selected filter card is marked the same way on every page.
export const QUEUE_ACTIVE_RING = 'ring-teal-500/40 border-teal-400 bg-teal-50/40';
