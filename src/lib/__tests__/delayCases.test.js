import { describe, it, expect } from 'vitest';
import {
  parseTargetDate, isHaltedStatus, haltedStatusLabel, manilaToday, toISODate,
  caseDue, adminActions, caseBucket, friendlyDelayError, reasonOk,
} from '../delayCases';

const day = (s) => parseTargetDate(s);

describe('parseTargetDate (same formats as _delay_parse_date)', () => {
  it.each([
    ['2026-10-17', '2026-10-17'],
    ['August 10, 2025', '2025-08-10'],
    ['Sept. 26, 2025', '2025-09-26'],
    ['Sep 26, 2025', '2025-09-26'],
    ['Aug. 5, 2025', '2025-08-05'],
    ['  July   02,  2025 ', '2025-07-02'],
    ['December 13 , 2025', '2025-12-13'],
  ])('%s -> %s', (input, iso) => {
    expect(toISODate(parseTargetDate(input))).toBe(iso);
  });

  it.each([null, undefined, '', '   ', 'TBD', '2026-02-30', '2026-13-01', '2026-01-01x', 'Feb 30, 2025', 'Augst 10, 2025'])(
    'rejects %s', (input) => {
      expect(parseTargetDate(input)).toBeNull();
    },
  );
});

describe('halted statuses', () => {
  it('Suspended and Terminated (any case) are halted; others are not', () => {
    expect(isHaltedStatus('Suspended')).toBe(true);
    expect(isHaltedStatus(' terminated ')).toBe(true);
    expect(isHaltedStatus('On-Going')).toBe(false);
    expect(isHaltedStatus(null)).toBe(false);
    expect(haltedStatusLabel('SUSPENDED')).toBe('Suspended');
    expect(haltedStatusLabel('Completed')).toBeNull();
  });
});

describe('manilaToday', () => {
  it('uses the Manila date, not UTC (16:30 UTC is already the next day in Manila)', () => {
    expect(toISODate(manilaToday(new Date('2026-10-26T16:30:00Z')))).toBe('2026-10-27');
    expect(toISODate(manilaToday(new Date('2026-10-26T15:59:00Z')))).toBe('2026-10-26');
  });
});

describe('caseDue', () => {
  const today = day('2026-10-26');
  it('names the due date by state and flags it once passed', () => {
    expect(caseDue({ status: 'awaiting_request', request_due: '2026-10-25' }, today)).toMatchObject({ label: 'Action overdue', overdue: true });
    expect(caseDue({ status: 'awaiting_decision', decision_due: '2026-10-25' }, today)).toMatchObject({ label: 'Decision overdue', overdue: true });
    expect(caseDue({ status: 'awaiting_explanation', reply_by: '2026-10-30' }, today)).toMatchObject({ label: 'Reply by', overdue: false, daysLeft: 4 });
    expect(caseDue({ status: 'awaiting_decision', decision_due: '2026-10-26' }, today)).toMatchObject({ overdue: false, daysLeft: 0 });
    expect(caseDue({ status: 'closed' }, today)).toBeNull();
  });
});

describe('adminActions (mirrors the database rules)', () => {
  const project = { contractor_id: 'c1' };
  it('new case: ask, or close directly', () => {
    const a = adminActions({ status: 'awaiting_request' }, project);
    expect(a).toMatchObject({ ask: true, extend: false, verify: false, completedLate: true, suspend: true, terminate: true });
  });
  it('no contractor: ask disabled with a reason, can still close', () => {
    const a = adminActions({ status: 'awaiting_request' }, { contractor_id: null });
    expect(a.ask).toBe(false);
    expect(a.reasons.ask).toBe('Assign a contractor first');
    expect(a.completedLate).toBe(true);
  });
  it('ready to decide: everything except asking again', () => {
    expect(adminActions({ status: 'awaiting_decision', revision_count: 0 }, project, 0))
      .toMatchObject({ ask: false, verify: true, revise: true, finalNotice: true, extend: true, completedLate: true });
  });
  it('one revision and two extensions at most', () => {
    const a = adminActions({ status: 'awaiting_decision', revision_count: 1 }, project, 2);
    expect(a.revise).toBe(false);
    expect(a.extend).toBe(false);
    expect(a.reasons.extend).toMatch(/2 extensions/);
  });
  it('missed final notice: only Suspend or Terminate', () => {
    const a = adminActions({ status: 'awaiting_decision', final_notice_issued: true, final_notice_missed: true }, project, 0);
    expect(a).toMatchObject({ verify: false, revise: false, finalNotice: false, extend: false, completedLate: false, suspend: true, terminate: true });
  });
  it('waiting on someone else: no admin buttons', () => {
    const a = adminActions({ status: 'awaiting_explanation' }, project);
    expect(Object.values(a).filter((v) => v === true)).toHaveLength(0);
  });
});

describe('caseBucket / reasons / errors', () => {
  const today = day('2026-10-26');
  it('buckets cases for the filter chips', () => {
    expect(caseBucket({ status: 'awaiting_request', request_due: '2026-10-20' }, today)).toBe('overdue_action');
    expect(caseBucket({ status: 'no_response', decision_due: '2026-10-28' }, today)).toBe('needs_you');
    expect(caseBucket({ status: 'awaiting_verification', verification_due: '2026-10-28' }, today)).toBe('waiting');
    expect(caseBucket({ status: 'closed' }, today)).toBe('closed');
  });
  it('reasons need 10+ characters after trimming', () => {
    expect(reasonOk('   short   ')).toBe(false);
    expect(reasonOk('Ten chars!')).toBe(true);
  });
  it('explains the target-date lock in plain words', () => {
    expect(friendlyDelayError({ message: 'This project has an open delay case. Its target date can only be changed with Grant extension (Project Management > Overdue).' }))
      .toMatch(/Grant extension/);
    expect(friendlyDelayError({ message: 'Only one revision is allowed per case' })).toBe('Only one revision is allowed per case');
  });
});
