/* contractorHistory.js — reading project_contractor_history (supabase_overdue_v2.sql):
 * one period per contractor who held a project, so lateness stays with whoever
 * held it. Pure helpers, used by components/fmrProjects/ContractorHistory.jsx.
 */
import { daysBetween, manilaToday, parseTargetDate } from './delayCases';

/** Show the card only when there is something to tell (a delay, a reassignment, a late finish). */
export function historyWorthShowing(terms) {
  if (!Array.isArray(terms) || !terms.length) return false;
  return terms.length > 1 || terms.some((t) => (t.delays || []).length > 0 || Number(t.days_late) > 0 || t.status === 'terminated');
}

/** One line per delay: "Typhoon Kristine: +14 days (act of nature, not counted)". */
export function delayLine(d) {
  const days = d.days_added != null ? `+${d.days_added} day${d.days_added === 1 ? '' : 's'}` : null;
  if (d.kind === 'act_of_nature') return `${d.event_name || 'Act of nature'}${days ? `: ${days}` : ''} (act of nature, not counted)`;
  if (d.outcome === 'no_reply') return `Offense ${d.offense_no}: no reply by the deadline`;
  if (d.outcome === 'terminated') return `Offense ${d.offense_no ?? 4}: terminated`;
  return `Offense ${d.offense_no}${days ? `: ${days}` : ''} (manpower)`;
}

/**
 * The whole project, once there is more than one period:
 * { overallDays, gapDays } — days past the FIRST contractor's target at the end
 * (or today while open), and the days nobody held it between periods.
 */
export function projectSummary(terms, today = manilaToday()) {
  if (!Array.isArray(terms) || terms.length < 2) return null;
  const first = parseTargetDate(terms[0].target_date);
  const last = terms[terms.length - 1];
  const end = parseTargetDate(last.ended_on) || today;
  let gapDays = 0;
  for (let i = 1; i < terms.length; i += 1) {
    const prevEnd = parseTargetDate(terms[i - 1].ended_on);
    const start = parseTargetDate(terms[i].started_on);
    if (prevEnd && start) gapDays += Math.max(0, daysBetween(prevEnd, start));
  }
  return { overallDays: first ? Math.max(0, daysBetween(first, end)) : null, gapDays, finished: last.status === 'completed' };
}
