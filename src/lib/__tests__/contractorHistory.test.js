import { describe, it, expect } from 'vitest';
import { delayLine, historyWorthShowing, projectSummary } from '../contractorHistory';
import { parseTargetDate } from '../delayCases';

describe('contractor history', () => {
  const first = { term_no: 1, status: 'terminated', target_date: '2026-03-01', started_on: '2025-03-01', ended_on: '2026-06-30', days_late: 121, delays: [] };
  const second = { term_no: 2, status: 'completed', target_date: '2026-10-31', started_on: '2026-07-05', ended_on: '2026-12-10', days_late: 40, delays: [] };

  it('shows only when there is something to tell', () => {
    expect(historyWorthShowing([])).toBe(false);
    expect(historyWorthShowing([{ ...first, status: 'holding', days_late: null }])).toBe(false);
    expect(historyWorthShowing([{ ...first, status: 'holding', days_late: null, delays: [{ kind: 'offense' }] }])).toBe(true);
    expect(historyWorthShowing([first, second])).toBe(true);
  });

  it('reads each delay in one line', () => {
    expect(delayLine({ kind: 'act_of_nature', event_name: 'Typhoon Kristine', days_added: 14 })).toBe('Typhoon Kristine: +14 days (act of nature, not counted)');
    expect(delayLine({ kind: 'offense', offense_no: 1, outcome: 'extended', days_added: 20 })).toBe('Offense 1: +20 days (manpower)');
    expect(delayLine({ kind: 'offense', offense_no: 2, outcome: 'no_reply' })).toMatch(/no reply/);
  });

  it('splits the whole project: overall days past the first target, and the reassignment gap', () => {
    expect(projectSummary([first])).toBeNull();
    expect(projectSummary([first, second], parseTargetDate('2027-01-01'))).toEqual({ overallDays: 284, gapDays: 5, finished: true });
  });
});
