import { describe, it, expect } from 'vitest';
import { proposalNameKey, isSameRoad, findBlockingDuplicate } from '../proposalDuplicates';

// 0.001 degrees of latitude is about 111 m.
const road = (lat1, lng1, lat2, lng2, extra = {}) => ({
  start_latitude: lat1, start_longitude: lng1, end_latitude: lat2, end_longitude: lng2, ...extra,
});

describe('proposalNameKey', () => {
  it('ignores the kind of work, road words, Brgy. and punctuation', () => {
    expect(proposalNameKey('Concreting of Brgy. Tabuc FMR')).toBe('tabuc');
    expect(proposalNameKey('Tabuc Farm-to-Market Road')).toBe('tabuc');
    expect(proposalNameKey('Rehabilitation of Tabuc - Bucari FMR')).toBe('tabuc bucari');
  });

  it('is empty when the name is only filler words', () => {
    expect(proposalNameKey('Concreting of FMR')).toBe('');
  });
});

describe('isSameRoad', () => {
  it('matches the same two ends, in either direction', () => {
    const a = road(10.8, 122.4, 10.81, 122.41);
    expect(isSameRoad(a, road(10.8005, 122.4, 10.8105, 122.41))).toBe(true);
    expect(isSameRoad(a, road(10.81, 122.41, 10.8, 122.4))).toBe(true);
  });

  it('does not match a road sharing only one end, or with missing points', () => {
    const a = road(10.8, 122.4, 10.81, 122.41);
    expect(isSameRoad(a, road(10.8, 122.4, 10.85, 122.45))).toBe(false);
    expect(isSameRoad(a, { start_latitude: 10.8 })).toBe(false);
    expect(isSameRoad({ ...a, end_latitude: '' }, a)).toBe(false);
  });
});

describe('findBlockingDuplicate', () => {
  const projects = [{ id: 'p1', project_name: 'Concreting of Brgy. Tabuc FMR', municipality: 'Leon', ...road(10.8, 122.4, 10.81, 122.41) }];

  it('blocks a proposal with the same name as an existing project', () => {
    const hit = findBlockingDuplicate({ form: { project_name: 'Tabuc Farm-to-Market Road' }, municipality: 'Leon', projects });
    expect(hit).toMatchObject({ kind: 'project', reason: 'name' });
  });

  it('blocks a differently named proposal on the same road', () => {
    const hit = findBlockingDuplicate({ form: { project_name: 'Lower Tabuc Access', ...road(10.81, 122.41, 10.8, 122.4) }, municipality: 'Leon', projects });
    expect(hit).toMatchObject({ kind: 'project', reason: 'road' });
  });

  it('ignores other municipalities, rejected proposals and the proposal being edited', () => {
    expect(findBlockingDuplicate({ form: { project_name: 'Tabuc FMR' }, municipality: 'Alimodian', projects })).toBeNull();
    const proposals = [
      { id: 'x', project_name: 'Bucari FMR', municipality: 'Leon', status: 'Rejected' },
      { id: 'y', project_name: 'Bucari FMR', municipality: 'Leon', status: 'Submitted' },
    ];
    expect(findBlockingDuplicate({ form: { project_name: 'Bucari Road' }, municipality: 'Leon', proposals, editingId: 'y' })).toBeNull();
    expect(findBlockingDuplicate({ form: { project_name: 'Bucari Road' }, municipality: 'Leon', proposals }))
      .toMatchObject({ kind: 'proposal', reason: 'name' });
  });

  it('allows a genuinely new road', () => {
    expect(findBlockingDuplicate({ form: { project_name: 'Bucari FMR', ...road(10.9, 122.3, 10.91, 122.31) }, municipality: 'Leon', projects })).toBeNull();
  });
});
