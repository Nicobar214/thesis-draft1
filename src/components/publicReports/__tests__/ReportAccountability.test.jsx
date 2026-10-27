// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BeforeAfterCard from '../BeforeAfterCard';
import { accountabilityDetails, repairerName } from '../reportAccountability';

vi.mock('../../../lib/supabase', () => ({ supabase: null }));
afterEach(cleanup);

const report = { id: 'r1', created_at: '2026-10-20T02:00:00Z', municipality: 'Leon', photo_url: 'https://x/before.jpg' };
const finding = { submitted_at: '2026-10-21T02:00:00Z', inspected_by_name: 'Engr. Maria Santos', condition_observed: 'Pothole 1 m wide', recommended_action: 'Patch with concrete' };
const repair = { responsible_party: 'contractor', repaired_by_name: 'ABCD BUILDERS CORP.', work_submitted_at: '2026-10-24T02:00:00Z', verified_at: '2026-10-25T02:00:00Z', verified_by_name: 'Engr. Jose Reyes', work_photo_url: 'https://x/after.jpg' };

describe('who handled a report', () => {
  it('names who did each step of the one timeline', () => {
    const d = accountabilityDetails({ report, finding, repair, isMine: true });
    render(<div>{d.submitted}{d.findings}{d.repair_contractor}{d.work_checked}</div>);
    expect(screen.getByText('you')).toBeTruthy();
    expect(screen.getAllByText('Field engineer').length).toBeGreaterThan(0); // role tag, no initial badge
    expect(screen.getByText('Contractor')).toBeTruthy();
    expect(screen.getByText('Engr. Maria Santos')).toBeTruthy();
    expect(screen.getByText(/Pothole 1 m wide/)).toBeTruthy();
    expect(screen.getByText('ABCD BUILDERS CORP.')).toBeTruthy();
    expect(screen.getByText('Engr. Jose Reyes')).toBeTruthy();
  });

  it('never names the reporter to others, and names the LGU office (not a person)', () => {
    const d = accountabilityDetails({ report, finding: null, repair: { responsible_party: 'lgu' } });
    render(<div>{d.submitted}{d.inspection}</div>);
    expect(screen.getByText('a community member')).toBeTruthy();
    expect(screen.getByText('a DA field engineer')).toBeTruthy();
    // The DA admin account is shown by its name, never as "Engr. …"; no doubled title.
    const admin = accountabilityDetails({ report, repair: { ...repair, verified_by_name: 'Department of Agriculture Region - VI' } });
    render(<div>{admin.work_checked}</div>);
    expect(screen.getByText('Department of Agriculture Region - VI')).toBeTruthy();
    expect(screen.getByText('DA')).toBeTruthy();
    expect(screen.queryByText(/Engr\. Engr\.|Engr\. Department/)).toBeNull();
    expect(repairerName(report, { responsible_party: 'lgu' })).toBe('LGU of Leon');
    expect(repairerName(report, { responsible_party: 'da' })).toBe('Department of Agriculture');
  });

  it('shows before and after side by side, or says the repair photo is not in yet', () => {
    const { rerender } = render(<BeforeAfterCard report={report} repair={repair} isMine />);
    expect(screen.getByAltText('Before: Your photo')).toBeTruthy();
    expect(screen.getByAltText('After: ABCD BUILDERS CORP.')).toBeTruthy();
    expect(screen.getByText('Checked on site')).toBeTruthy();
    rerender(<BeforeAfterCard report={report} repair={null} />);
    expect(screen.getByText('No repair photo yet')).toBeTruthy();
  });
});
