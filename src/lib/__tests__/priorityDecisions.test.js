import { describe, it, expect } from 'vitest';
import {
  actionOwner, canEndorse, canMove, deadlineStatus, isFinal, localDateISO, nextStatus, resumeStatus, saveDecision,
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

  it('walks an ongoing project from ranked to closed', () => {
    expect(nextStatus('project', 'ranked')).toBe('flagged');
    expect(nextStatus('project', 'flagged')).toBe('action_recorded');
    expect(nextStatus('project', 'action_recorded')).toBe('closed');
    expect(isFinal('project', 'closed')).toBe(true);
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
    expect(actionOwner('Prioritize fund release')).toBe('contractor');
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
