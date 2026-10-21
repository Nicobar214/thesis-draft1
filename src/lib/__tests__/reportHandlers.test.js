import { describe, it, expect } from 'vitest';
import {
  SEVERITY_TAXONOMY,
  buildCitizenTrack,
  classifyReport,
  countAdminBuckets,
  getAdminBucket,
  workOrderStage,
  friendlyReportError,
  handlerFor,
  repairCitizenLine,
  resolveCategory,
  resolveSpecificProblem,
} from '../publicReportStatus';
import { buildHandlerQueue, countHandlerStages, handlerStage } from '../handlerFollowUps';

const NEW_TYPES = ['road_damage', 'structural', 'obstruction', 'roadside'];

describe('issue types', () => {
  it('has two contractor types and two LGU types', () => {
    expect(Object.keys(SEVERITY_TAXONOMY)).toEqual(NEW_TYPES);
    const handlers = Object.values(SEVERITY_TAXONOMY).map((t) => t.handler);
    expect(handlers.filter((h) => h === 'contractor')).toHaveLength(2);
    expect(handlers.filter((h) => h === 'lgu')).toHaveLength(2);
  });

  it('uses each problem value once, so a problem alone identifies its type', () => {
    const values = Object.values(SEVERITY_TAXONOMY).flatMap((t) => t.problems.map((p) => p.value));
    expect(new Set(values).size).toBe(values.length);
  });

  it('sends a fallen tree to the LGU and a pothole to the contractor', () => {
    expect(handlerFor({ severity_category: 'obstruction', specific_problem: 'fallen_tree' })).toBe('lgu');
    expect(handlerFor({ severity_category: 'road_damage', specific_problem: 'pothole' })).toBe('contractor');
  });

  it('respects the handler the admin set on the report', () => {
    expect(handlerFor({ severity_category: 'road_damage', handled_by: 'lgu' })).toBe('lgu');
  });
});

describe('old reports', () => {
  it('map old types and problems onto the new types', () => {
    expect(resolveCategory({ severity_category: 'safety', specific_problem: 'fallen_tree' })).toBe('obstruction');
    expect(resolveCategory({ severity_category: 'safety', specific_problem: 'collapsed_road' })).toBe('structural');
    expect(resolveCategory({ severity_category: 'issue', specific_problem: 'pothole' })).toBe('road_damage');
    expect(resolveCategory({ severity_category: 'general', specific_problem: 'no_signage' })).toBe('roadside');
    expect(resolveCategory({ severity_category: 'flood' })).toBe('obstruction');
  });

  it('keeps labels for old problems that left the form', () => {
    expect(resolveSpecificProblem({ severity_category: 'issue', specific_problem: 'dust_gravel' })?.label).toMatch(/gravel/i);
    expect(resolveCategory({ severity_category: 'general', specific_problem: 'project_delay' })).toBe('structural');
  });

  it('match the SQL handler rules for old problems', () => {
    // public_report_handler_for in supabase_report_handlers.sql
    const lgu = ['fallen_tree', 'sharp_debris', 'accident_site', 'road_flooded', 'partial_flood', 'landslide', 'vegetation', 'no_signage', 'poor_lighting', 'other'];
    const contractor = ['collapsed_road', 'missing_guardrail', 'unsafe_bridge', 'blocked_drainage', 'erosion', 'pothole', 'crack', 'missing_pavement', 'broken_curb', 'uneven_surface', 'dust_gravel', 'project_delay', 'quality_concern'];
    lgu.forEach((p) => expect(handlerFor({ severity_category: 'safety', specific_problem: p })).toBe('lgu'));
    contractor.forEach((p) => expect(handlerFor({ severity_category: 'general', specific_problem: p })).toBe('contractor'));
  });

  it('classify untyped descriptions into the new types only', () => {
    expect(classifyReport('Natumba ang kahoy sa daan')).toBe('obstruction');
    expect(classifyReport('Daku nga lubak')).toBe('road_damage');
    expect(classifyReport('The bridge is cracked')).toBe('structural');
    expect(NEW_TYPES).toContain(classifyReport(''));
  });
});

describe('handler queue', () => {
  const reports = [
    { id: 'a', severity_category: 'obstruction', specific_problem: 'fallen_tree', status: 'pending' },
    { id: 'b', severity_category: 'obstruction', specific_problem: 'landslide', status: 'reviewed' },
    { id: 'c', severity_category: 'road_damage', specific_problem: 'pothole', status: 'reviewed' },
    { id: 'd', severity_category: 'roadside', specific_problem: 'no_signage', status: 'reviewed' },
    { id: 'e', severity_category: 'roadside', specific_problem: 'poor_lighting', status: 'resolved' },
  ];
  const actions = {
    b: { status: 'planned', responsible_party: 'lgu', target_date: '2020-01-01' },
    d: { status: 'planned', responsible_party: 'lgu', accepted_at: '2026-01-01', started_at: '2026-01-02' },
    e: { status: 'verified', responsible_party: 'lgu' },
  };

  it('shows the LGU only its own reports, by stage', () => {
    const queue = buildHandlerQueue(reports, 'lgu', actions, new Date('2026-01-01'));
    expect(queue.map((q) => [q.report.id, q.stage])).toEqual([['a', 'checking'], ['b', 'todo'], ['d', 'in_progress'], ['e', 'done']]);
    expect(countHandlerStages(queue)).toMatchObject({ todo: 1, in_progress: 1, checking: 1, done: 1, overdue: 1 });
  });

  it('keeps sent work in "DA reviewing" until the report is resolved', () => {
    expect(handlerStage({ status: 'reviewed' }, { status: 'completed' })).toBe('waiting');
    expect(handlerStage({ status: 'resolved' }, { status: 'verified' })).toBe('done');
    expect(handlerStage({ status: 'reviewed' }, { status: 'cancelled', returned_at: '2026-01-01' })).toBe('done');
  });
});

describe('work order stages', () => {
  it('follows accept -> start -> after-photo -> closed', () => {
    expect(workOrderStage({ status: 'planned' })).toBe('assigned');
    expect(workOrderStage({ status: 'planned', accepted_at: 'x' })).toBe('accepted');
    expect(workOrderStage({ status: 'planned', accepted_at: 'x', started_at: 'y' })).toBe('in_progress');
    expect(workOrderStage({ status: 'completed' })).toBe('done');
    expect(workOrderStage({ status: 'verified' })).toBe('closed');
    expect(workOrderStage({ status: 'cancelled', returned_at: 'z' })).toBe('returned');
  });
});

describe('admin buckets with jobs', () => {
  it('sends an LGU job straight from review to the LGU, skipping the engineer', () => {
    const report = { status: 'reviewed', engineer_status: null };
    expect(getAdminBucket(report, null)).toBe('needs_review');
    expect(getAdminBucket(report, { status: 'planned' })).toBe('with_handler');
    expect(getAdminBucket(report, { status: 'completed' })).toBe('work_done');
    expect(getAdminBucket(report, { status: 'cancelled', returned_at: 'x' })).toBe('needs_review');
  });

  it('puts a validated contractor report in "Ready for Repair Order" until the job is sent', () => {
    const report = { status: 'reviewed', engineer_status: 'validated' };
    expect(getAdminBucket(report, null)).toBe('ready_to_resolve');
    expect(getAdminBucket(report, { status: 'planned' })).toBe('with_handler');
    expect(getAdminBucket(report, { status: 'completed', engineer_check_requested_at: 'x' })).toBe('in_field');
    expect(getAdminBucket(report, { status: 'verified' })).toBe('work_done');
  });

  it('counts finished work as the admin\'s action', () => {
    const counts = countAdminBuckets([{ id: 1, status: 'reviewed' }], { 1: { status: 'completed' } });
    expect(counts.work_done).toBe(1);
    expect(counts.actionNeeded).toBe(1);
  });
});

describe('citizen track', () => {
  it('skips the site inspection for a minor LGU job', () => {
    const track = buildCitizenTrack({
      status: 'reviewed', citizen_status: 'Repair in Progress', citizen_workflow_stage: 'repair_in_progress',
      citizen_handled_by: 'lgu', citizen_repair_started_at: '2026-01-02',
    });
    expect(track.steps.map((s) => s.key)).toEqual(['submitted', 'under_review', 'repair_lgu', 'repair_lgu_work', 'work_checked', 'resolved']);
    expect(track.steps.find((s) => s.active).key).toBe('repair_lgu_work');
  });

  it('runs inspection then contractor repair for a major issue', () => {
    const track = buildCitizenTrack({
      status: 'reviewed', citizen_status: 'Assigned for Repair', citizen_workflow_stage: 'repair_assigned',
      citizen_handled_by: 'contractor', citizen_field_dispatched_at: '2026-01-01',
    });
    expect(track.steps.map((s) => s.key)).toContain('inspection');
    expect(track.steps.find((s) => s.active).key).toBe('repair_contractor');
  });

  it('drops the repair steps when resolved without a repair', () => {
    const track = buildCitizenTrack({ status: 'resolved', citizen_status: 'Resolved', citizen_workflow_stage: 'resolved', citizen_handled_by: 'contractor' });
    expect(track.steps.map((s) => s.key)).not.toContain('repair_contractor');
  });
});

describe('citizen wording and errors', () => {
  it('says who is fixing it', () => {
    expect(repairCitizenLine({ status: 'planned', responsible_party: 'lgu' })).toMatch(/Your LGU has been asked/);
    expect(repairCitizenLine({ status: 'planned', responsible_party: 'contractor', started_at: 'x', accepted_at: 'x' })).toMatch(/contractor is working on it/);
    expect(repairCitizenLine({ status: 'completed', responsible_party: 'lgu' })).toMatch(/DA is checking/);
  });

  it('explains the new server errors', () => {
    expect(friendlyReportError(new Error('Only the assigned LGU or contractor can update this job'))).toMatch(/assigned to someone else/);
    expect(friendlyReportError(new Error('The LGU or contractor has not sent the after-photo yet'))).toMatch(/not sent the after-photo/);
    expect(friendlyReportError(new Error('Could not find the function public.accept_public_report_work(...)'))).toMatch(/supabase_report_handlers\.sql/);
  });
});

describe('handlerReportStatus', () => {
  it('follows the DA steps, then the job', async () => {
    const { handlerReportStatus } = await import('../handlerFollowUps');
    expect(handlerReportStatus({ status: 'pending' }).label).toBe('New, DA reviewing');
    expect(handlerReportStatus({ status: 'reviewed', engineer_status: 'in_progress' }).label).toBe('DA engineer inspecting');
    expect(handlerReportStatus({ status: 'reviewed', engineer_status: 'validated' }).label).toBe('Inspected, awaiting repair order');
    expect(handlerReportStatus({ status: 'reviewed' }, { status: 'planned', accepted_at: 'x', started_at: 'y' }).label).toBe('Repair in progress');
    expect(handlerReportStatus({ status: 'resolved' }, { status: 'verified' }).label).toBe('Resolved');
  });
});
