import { describe, it, expect } from 'vitest';
import { classifyDeadline, buildDeadlineRows, countDeadlineStates, completionTiming } from '../projectDeadlines';

const today = new Date(2026, 9, 11); // Oct 11, 2026

describe('projectDeadlines', () => {
  it('flags a passed target date as overdue with days late', () => {
    const c = classifyDeadline({ target_completion_date: '2026-10-01', accomplishment: 90 }, today);
    expect(c.state).toBe('overdue');
    expect(c.daysLeft).toBe(-10);
  });

  it('marks little progress close to the deadline as at risk', () => {
    expect(classifyDeadline({ target_completion_date: '2026-11-01', accomplishment: 50 }, today).state).toBe('at_risk');
    expect(classifyDeadline({ target_completion_date: '2026-12-31', accomplishment: 20 }, today).state).toBe('at_risk');
  });

  it('keeps enough progress or enough time as on track', () => {
    expect(classifyDeadline({ target_completion_date: '2026-11-01', accomplishment: 80 }, today).state).toBe('on_track');
    expect(classifyDeadline({ target_completion_date: '2027-06-01', accomplishment: 5 }, today).state).toBe('on_track');
  });

  it('reports a missing or unreadable target date instead of guessing', () => {
    expect(classifyDeadline({ target_completion_date: '' }, today).state).toBe('no_target');
    expect(classifyDeadline({ target_completion_date: 'TBA' }, today).state).toBe('no_target');
  });

  it('leaves out finished projects and sorts the rest by urgency', () => {
    const rows = buildDeadlineRows([
      { id: 1, project_name: 'A', status: 'On-Going', target_completion_date: '2027-06-01', accomplishment: 50 },
      { id: 2, project_name: 'B', status: 'On-Going', target_completion_date: '2026-09-01', accomplishment: 60 },
      { id: 3, project_name: 'C', status: 'Completed', target_completion_date: '2026-01-01', accomplishment: 100 },
      { id: 4, project_name: 'D', status: 'On-Going', target_completion_date: '2026-10-20', accomplishment: 30 },
      { id: 5, project_name: 'E', status: 'Proposed', target_completion_date: null },
    ], [{ fmr_project_id: 2, submitted_at: '2026-09-11T00:00:00Z' }], today);
    expect(rows.map((r) => r.project.id)).toEqual([2, 4, 1, 5]);
    expect(countDeadlineStates(rows)).toEqual({ overdue: 1, at_risk: 1, on_track: 1, no_target: 1 });
    expect(rows[0].daysSinceUpdate).toBeGreaterThanOrEqual(29);
  });
});

describe('completion against the target date', () => {
  it('says how many days early, on time or late a project finished', () => {
    expect(completionTiming({ date_completed: '2026-11-18', target_completion_date: '2026-11-28' })).toMatchObject({ tone: 'early', days: 10, text: 'Completed 10 days ahead of schedule' });
    expect(completionTiming({ date_completed: '2026-11-27', target_completion_date: '2026-11-28' }).text).toBe('Completed 1 day ahead of schedule');
    expect(completionTiming({ date_completed: '2026-11-28', target_completion_date: '2026-11-28' })).toMatchObject({ tone: 'on_time', text: 'Completed on schedule' });
    expect(completionTiming({ date_completed: '2026-12-03', target_completion_date: '2026-11-28' })).toMatchObject({ tone: 'late', days: -5, text: 'Completed 5 days late' });
  });

  it('notes an extended target, and reads written-out dates', () => {
    expect(completionTiming({ date_completed: '2026-11-18', target_completion_date: '2026-11-28' }, 30).text).toBe('Completed 10 days ahead of schedule (target extended by 30 days)');
    expect(completionTiming({ date_completed: 'September 1, 2017', target_completion_date: 'September 9, 2017' }).days).toBe(8);
  });

  it('shows nothing when a date is missing, unreadable or a placeholder', () => {
    expect(completionTiming({ date_completed: '', target_completion_date: '2026-11-28' })).toBeNull();
    expect(completionTiming({ date_completed: '2026-11-18', target_completion_date: 'TBA' })).toBeNull();
    expect(completionTiming({ date_completed: '1960-12-31', target_completion_date: '2026-11-28' })).toBeNull();
    expect(completionTiming(null)).toBeNull();
  });
});
