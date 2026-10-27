import { describe, it, expect } from 'vitest';
import {
  actionOwner, canCloseFinished, canEndorse, canMove, deadlineStatus, finishedFollowUps, isFinal, localDateISO, nextStatus, resumeStatus,
  saveDecision, skippedAhead, commitmentProblem, priorityStage, canDrop, snapshotOf,
} from '../priorityDecisions';

describe('decision flow', () => {
  it('walks a new road from ranked to converted, one step at a time', () => {
    expect(nextStatus('gap', 'ranked')).toBe('shortlisted');
    expect(nextStatus('gap', 'shortlisted')).toBe('for_validation');
    expect(nextStatus('gap', 'for_validation')).toBe('endorsed');
    expect(nextStatus('gap', 'endorsed')).toBe('converted');
    expect(nextStatus('gap', 'converted')).toBeNull();
    expect(isFinal('gap', 'converted')).toBe(true);
  });

  it('walks an ongoing project from ranked to prioritized to ended', () => {
    expect(nextStatus('project', 'ranked')).toBe('flagged');
    expect(nextStatus('project', 'flagged')).toBe('closed');
    expect(isFinal('project', 'closed')).toBe(true);
    expect(resumeStatus('project')).toBe('flagged');
  });

  it('drops a road only after the engineer found it not as described', () => {
    const notConfirmed = { status: 'for_validation', validation_result: 'not_confirmed' };
    expect(canMove('gap', 'for_validation', 'dropped', notConfirmed)).toBe(true);
    expect(canMove('gap', 'for_validation', 'dropped', { ...notConfirmed, validation_result: 'confirmed' })).toBe(false);
    expect(canMove('gap', 'for_validation', 'dropped', { status: 'for_validation' })).toBe(false);
    expect(canMove('gap', 'shortlisted', 'dropped', notConfirmed)).toBe(false);
    expect(canMove('project', 'for_validation', 'dropped', notConfirmed)).toBe(false);
    expect(isFinal('gap', 'dropped')).toBe(true);
    expect(canMove('gap', 'dropped', 'deferred')).toBe(false);
    expect(canDrop(notConfirmed)).toBe(true);
  });

  it('asks for a reason code and a note to drop, and a reason to end a priority', async () => {
    const client = { auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) } };
    const decision = { status: 'for_validation', validation_result: 'not_confirmed' };
    const drop = (dropReason, note) => saveDecision(client, { kind: 'gap', id: 1, from: 'for_validation', to: 'dropped', decision, dropReason, note });
    await expect(drop(null, 'The road is already concreted')).rejects.toThrow(/Choose why/);
    await expect(drop('already_paved', 'paved')).rejects.toThrow(/at least 10/);
    await expect(saveDecision(client, { kind: 'project', id: 5, from: 'flagged', to: 'closed', note: '' })).rejects.toThrow(/why the priority ends/);
  });

  it('allows only the next step, never skipping or going back', () => {
    expect(canMove('gap', 'ranked', 'shortlisted')).toBe(true);
    expect(canMove('gap', 'ranked', 'endorsed')).toBe(false);
    expect(canMove('gap', 'endorsed', 'shortlisted')).toBe(false);
    expect(canMove('gap', 'ranked', 'flagged')).toBe(false);
  });

  it('can defer any open step and resume at the first step, but not after the end', () => {
    expect(canMove('gap', 'for_validation', 'deferred')).toBe(true);
    expect(canMove('project', 'flagged', 'deferred')).toBe(true);
    expect(canMove('gap', 'converted', 'deferred')).toBe(false);
    expect(nextStatus('gap', 'deferred')).toBeNull();
    expect(resumeStatus('gap')).toBe('shortlisted');
    expect(canMove('gap', 'deferred', 'shortlisted')).toBe(true);
    expect(canMove('gap', 'deferred', 'endorsed')).toBe(false);
  });
});

describe('roles in the process', () => {
  it('endorses a road only after the engineer confirmed it on site', () => {
    expect(canEndorse({ validation_result: 'confirmed' })).toBe(true);
    expect(canEndorse({ validation_result: 'not_confirmed' })).toBe(false);
    expect(canEndorse(null)).toBe(false);
  });

  it('sends inspections to the site engineer and everything else to the contractor', () => {
    expect(actionOwner('Schedule site inspection')).toBe('site_engineer');
    expect(actionOwner('Expedite contractor')).toBe('contractor');
  });
});

describe('site validation deadline', () => {
  const today = new Date(2026, 9, 22, 15, 30); // Oct 22, 2026, afternoon

  it('counts whole calendar days, whatever the time of day', () => {
    expect(deadlineStatus('2026-10-29', today)).toMatchObject({ days: 7, tone: 'ok' });
    expect(deadlineStatus('2026-10-24', today)).toMatchObject({ days: 2, tone: 'soon' });
    expect(deadlineStatus('2026-10-23', today).text).toMatch(/^Due tomorrow/);
    expect(deadlineStatus('2026-10-22', today).text).toMatch(/^Due today/);
    expect(deadlineStatus('2026-10-20', today)).toMatchObject({ days: -2, tone: 'overdue' });
    expect(deadlineStatus('2026-10-21', today).text).toMatch(/^Overdue by 1 day /);
    expect(deadlineStatus(null, today)).toBeNull();
  });

  it('builds local YYYY-MM-DD dates', () => {
    expect(localDateISO(today)).toBe('2026-10-22');
    expect(localDateISO(today, 10)).toBe('2026-11-01');
  });

  it('will not send a road for validation without a future deadline', async () => {
    const client = { auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) } };
    const send = (dueDate) => saveDecision(client, { kind: 'gap', id: 1, from: 'shortlisted', to: 'for_validation', assignedEngineerId: 'eng', dueDate });
    await expect(send(null)).rejects.toThrow(/date/);
    await expect(send('2000-01-01')).rejects.toThrow(/past/);
  });
});

describe('skipping ahead of higher-ranked roads', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((rank) => ({ kind: 'gap', id: rank * 10, rank, title: `Road ${rank}`, score: 100 - rank }));
  const decided = (...pairs) => new Map(pairs.map(([id, status]) => [`gap:${id}`, { candidate_kind: 'gap', candidate_id: String(id), status }]));

  it('lets the top tier act in any order', () => {
    expect(skippedAhead(rows[2], rows, decided())).toEqual([]);
  });

  it('lists the higher-ranked roads still waiting, best rank first', () => {
    const waiting = skippedAhead(rows[4], rows, decided([10, 'shortlisted'], [30, 'deferred']));
    expect(waiting.map((w) => w.rank)).toEqual([2, 4]);
    expect(waiting[0]).toEqual({ id: 20, rank: 2, title: 'Road 2', score: 98 });
  });

  it('does not warn once everything above has been acted on, or after the first step', () => {
    const all = decided([10, 'shortlisted'], [20, 'deferred'], [30, 'for_validation'], [40, 'endorsed']);
    expect(skippedAhead(rows[4], rows, all)).toEqual([]);
    expect(skippedAhead(rows[5], rows, decided([60, 'shortlisted']))).toEqual([]);
  });

  it('keeps the two groups apart', () => {
    const project = { kind: 'project', id: 99, rank: 5, title: 'Ongoing 5', score: 40 };
    expect(skippedAhead(project, [...rows, project], decided())).toEqual([]);
  });
});

describe('follow-ups that are followed up', () => {
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) } };

  it('no longer offers a recorded action for new priorities', async () => {
    await expect(saveDecision(client, { kind: 'project', id: 5, from: 'flagged', to: 'action_recorded', action: 'Expedite contractor', replyDueDate: '2099-01-01' }))
      .rejects.toThrow(/Cannot move/);
  });

  it('lists open follow-ups whose project is no longer on-going, and lets them close early', () => {
    const decisions = new Map([
      ['project:1', { candidate_kind: 'project', candidate_id: '1', status: 'flagged' }],
      ['project:2', { candidate_kind: 'project', candidate_id: '2', status: 'action_recorded' }],
      ['project:3', { candidate_kind: 'project', candidate_id: '3', status: 'closed' }],
    ]);
    const projects = [{ id: 1, status: 'Completed' }, { id: 2, status: 'On-Going' }, { id: 3, status: 'Completed' }];
    const out = finishedFollowUps(decisions, projects, (p) => p.status === 'On-Going');
    expect(out.map((x) => x.project.id)).toEqual([1]);
    expect(canCloseFinished('project', 'flagged')).toBe(true);
    expect(canCloseFinished('gap', 'shortlisted')).toBe(false);
  });
});

describe('priority commitment and result', () => {
  const today = '2026-10-27';
  const base = { candidate_kind: 'project', action: 'Add a second crew' };

  it('asks for a real commitment: what, and a done-by date from tomorrow to 90 days', () => {
    expect(commitmentProblem('short', '2026-11-10', today)).toMatch(/at least 10/);
    expect(commitmentProblem('Add a second crew now', '', today)).toMatch(/date/);
    expect(commitmentProblem('Add a second crew now', today, today)).toMatch(/after today/);
    expect(commitmentProblem('Add a second crew now', '2027-01-26', today)).toMatch(/90 days/);
    expect(commitmentProblem('Add a second crew now', '2027-01-25', today)).toBeNull();
    expect(commitmentProblem('Add a second crew now', '2026-10-28', today)).toBeNull();
  });

  it('follows the action from reply needed to the result', () => {
    expect(priorityStage({ ...base, status: 'action_recorded' }, today).stage).toBe('action');
    expect(priorityStage({ ...base, status: 'action_recorded', responded_at: '2026-10-20', committed_by: '2026-11-01' }, today).stage).toBe('committed');
    expect(priorityStage({ ...base, status: 'action_recorded', responded_at: '2026-10-20', committed_by: '2026-10-26' }, today).stage).toBe('decision_due');
    expect(priorityStage({ ...base, status: 'closed', outcome: 'not_done', outcome_at: '2026-10-20T03:00:00Z' }, today).stage).toBe('not_done');
  });

  it('shows a prioritized project with the rank and reason from when the DA prioritized it', () => {
    const snap = snapshotOf({ rank: 2, score: 81, G: 1, M: 2, R: 3, C: 4, F: 5, reason: 'Rank #2 — 1.8 km still to build.' });
    expect(priorityStage({ candidate_kind: 'project', status: 'flagged', score_snapshot: snap }, today))
      .toEqual({ stage: 'priority', rank: 2, reason: 'Rank #2 — 1.8 km still to build.', asOf: snap.taken_at });
    expect(priorityStage({ candidate_kind: 'project', status: 'flagged' }, today)).toMatchObject({ stage: 'priority', rank: null });
  });

  it('shows how a priority ended for 30 days', () => {
    const ended = { candidate_kind: 'project', status: 'closed', outcome_note: 'Project completed 10 days ahead of schedule.' };
    expect(priorityStage({ ...ended, outcome_at: '2026-10-20T03:00:00Z' }, today)).toEqual({ stage: 'ended', note: ended.outcome_note });
    expect(priorityStage({ ...ended, outcome_at: '2026-08-01T03:00:00Z' }, today)).toBeNull();
  });

  it('shows a result for 30 days, and ignores gaps and plain closes', () => {
    expect(priorityStage({ ...base, status: 'closed', outcome: 'done', outcome_at: '2026-08-01T03:00:00Z' }, today)).toBeNull();
    expect(priorityStage({ ...base, status: 'closed' }, today)).toBeNull();
    expect(priorityStage({ ...base, candidate_kind: 'gap', status: 'action_recorded' }, today)).toBeNull();
  });
});
