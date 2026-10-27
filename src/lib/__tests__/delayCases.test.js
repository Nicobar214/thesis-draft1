import { describe, it, expect } from 'vitest';
import {
  parseTargetDate, isHaltedStatus, haltedStatusLabel, manilaToday, toISODate,
  caseDue, adminActions, caseBucket, friendlyDelayError, reasonOk, commitmentProblems, commitWindow,
  offenseWindow, offenseLabel, needsFieldCheck, toISODate as iso,
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
  const committed = (extra) => ({ status: 'awaiting_decision', proposed_date: '2026-11-20', kind: 'offense', offense_no: 1, ...extra });
  it('new case: ask, or close as completed late', () => {
    expect(adminActions({ status: 'awaiting_request', offense_no: 1 }, project))
      .toMatchObject({ ask: true, approve: false, completedLate: true, reassign: false });
  });
  it('no contractor: ask disabled with a reason', () => {
    const a = adminActions({ status: 'awaiting_request' }, { contractor_id: null });
    expect(a.ask).toBe(false);
    expect(a.reasons.ask).toBe('Assign a contractor first');
  });
  it('Offense 1 and 2: approve directly, send back once', () => {
    expect(adminActions(committed(), project)).toMatchObject({ approve: true, sendBack: true, verify: true, rejectNature: false });
    const used = adminActions(committed({ offense_no: 2, revision_count: 1 }), project);
    expect(used.sendBack).toBe(false);
    expect(used.reasons.sendBack).toMatch(/once/);
  });
  it('Offense 3 and act of nature: approve only after a confirmed field check', () => {
    for (const c of [committed({ offense_no: 3 }), committed({ kind: 'act_of_nature' })]) {
      expect(adminActions(c, project).approve).toBe(false);
      expect(adminActions(c, project).reasons.approve).toMatch(/field engineer/);
      expect(adminActions({ ...c, verdict: 'disagree' }, project).approve).toBe(false);
      expect(adminActions({ ...c, verdict: 'agree' }, project).approve).toBe(true);
    }
    expect(adminActions(committed({ kind: 'act_of_nature' }), project).rejectNature).toBe(true);
  });
  it('Offense 4: only terminate & reassign (an act of nature is still decided first)', () => {
    expect(adminActions({ status: 'awaiting_request', offense_no: 4 }, project)).toMatchObject({ reassign: true, ask: true });
    expect(adminActions({ status: 'no_response', offense_no: 4, kind: 'offense' }, project)).toMatchObject({ reassign: true, approve: false });
    expect(adminActions(committed({ offense_no: 4, kind: 'act_of_nature' }), project).reassign).toBe(false);
    expect(adminActions(committed({ offense_no: 3 }), project).reassign).toBe(false);
  });
  it('waiting on someone else: no admin buttons', () => {
    const a = adminActions({ status: 'awaiting_explanation', offense_no: 1 }, project);
    expect(Object.values(a).filter((v) => v === true)).toHaveLength(0);
  });
});

describe('offense windows (same numbers as _delay_window)', () => {
  const today = day('2026-11-01');
  it('60 / 45 / 30 days, then none', () => {
    expect([1, 2, 3, 4].map(offenseWindow)).toEqual([60, 45, 30, 0]);
    expect(iso(commitWindow({ offense_no: 1 }, 'manpower', null, today).max)).toBe('2026-12-31');
    expect(iso(commitWindow({ offense_no: 2 }, 'manpower', null, today).max)).toBe('2026-12-16');
    expect(commitWindow({ offense_no: 4 }, 'manpower', null, today)).toBeNull();
    expect(iso(commitWindow({ offense_no: 1 }, 'manpower', null, today).min)).toBe('2026-11-02');
  });
  it('act of nature: the days work stopped, at most 30, at any offense', () => {
    expect(commitWindow({ offense_no: 4 }, 'act_of_nature', 5, today).days).toBe(5);
    expect(commitWindow({ offense_no: 1 }, 'act_of_nature', 45, today).days).toBe(30);
    expect(commitWindow({ offense_no: 1 }, 'act_of_nature', 0, today)).toBeNull();
  });
  it('labels and field-check rule', () => {
    expect(offenseLabel({ offense_no: 2 })).toBe('Offense 2 of 3');
    expect(offenseLabel({ offense_no: 4 })).toMatch(/no chances/);
    expect(offenseLabel({ kind: 'act_of_nature', offense_no: 2 })).toBe('Act of nature');
    expect(needsFieldCheck({ offense_no: 3 })).toBe(true);
    expect(needsFieldCheck({ offense_no: 2 })).toBe(false);
    expect(needsFieldCheck({ kind: 'act_of_nature', offense_no: 1 })).toBe(true);
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
      .toMatch(/Project Management > Overdue/);
    expect(friendlyDelayError({ message: 'Could not find the function public.delay_submit_commitment(p_case, ...) in the schema cache' }))
      .toMatch(/supabase_overdue_v2\.sql/);
    expect(friendlyDelayError({ message: 'Only one revision is allowed per case' })).toBe('Only one revision is allowed per case');
  });
});

describe('commitmentProblems (same checks as delay_submit_commitment)', () => {
  const today = day('2026-11-01');
  const c = { offense_no: 2 };
  const ok = { cause: 'manpower', explanation: 'Short of six workers.', newDate: '2026-12-16' };
  it('accepts a commitment inside the window', () => {
    expect(commitmentProblems(c, ok, today)).toEqual([]);
  });
  it('is strict about the window: no day past the max', () => {
    expect(commitmentProblems(c, { ...ok, newDate: '2026-12-17' }, today)[0]).toMatch(/45 days max/);
    expect(commitmentProblems(c, { ...ok, newDate: '2026-11-01' }, today)).toHaveLength(1);
  });
  it('needs a cause and 10+ characters', () => {
    expect(commitmentProblems(c, { ...ok, cause: '' }, today)[0]).toMatch(/Act of nature or Manpower/);
    expect(commitmentProblems(c, { ...ok, explanation: ' short ' }, today)[0]).toMatch(/10 characters/);
  });
  it('act of nature needs the event, the days stopped and proof', () => {
    const nature = { cause: 'act_of_nature', explanation: 'Typhoon flooded the site.', newDate: '2026-11-06', eventName: 'Typhoon Kristine', stoppedDays: '5' };
    expect(commitmentProblems(c, { ...nature, hasProof: true }, today)).toEqual([]);
    expect(commitmentProblems(c, { ...nature, hasProof: false }, today)[0]).toMatch(/proof/i);
    expect(commitmentProblems(c, { ...nature, hasProof: true, newDate: '2026-11-07' }, today)[0]).toMatch(/5 days max/);
    expect(commitmentProblems(c, { ...nature, hasProof: true, stoppedDays: '31' }, today).some((p) => /1 to 30/.test(p))).toBe(true);
  });
  it('no manpower after 3 offenses, and no act of nature after a rejected claim', () => {
    expect(commitmentProblems({ offense_no: 4 }, ok, today).some((p) => /3 chances/.test(p))).toBe(true);
    expect(commitmentProblems({ offense_no: 2, kind: 'offense' }, { ...ok, cause: 'act_of_nature', eventName: 'Flood', stoppedDays: '3', hasProof: true, newDate: '2026-11-03' }, today)
      .some((p) => /not accepted/.test(p))).toBe(true);
  });
});
