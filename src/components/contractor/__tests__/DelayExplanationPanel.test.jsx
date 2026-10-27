// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DelayExplanationPanel from '../DelayExplanationPanel';
import { addDays, manilaToday, toISODate } from '../../../lib/delayCases';

vi.mock('../../../lib/confirm', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('../../../lib/toast', () => ({ notify: vi.fn() }));

afterEach(cleanup);

const today = manilaToday();
const iso = (days) => toISODate(addDays(today, days));

/* A stand-in for the Supabase client: every query on a table resolves to its rows. */
function fakeClient(tables, rpc = vi.fn(async () => ({ error: null }))) {
  const query = (rows) => {
    const q = { select: () => q, order: () => q, in: () => q, eq: () => q, then: (ok, bad) => Promise.resolve({ data: rows, error: null }).then(ok, bad) };
    return q;
  };
  return {
    from: (t) => query(tables[t] || []),
    rpc,
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: vi.fn(),
  };
}

const project = { id: 7, project_name: 'Brgy. Tabucan FMR', barangay: 'Tabucan', municipality: 'Leon', accomplishment: 64, status: 'On-Going' };
const baseCase = { id: 'c1', project_id: 7, target_date_at_open: iso(-6), opened_at: new Date().toISOString(), offense_no: 1 };

describe('DelayExplanationPanel', () => {
  it('says so plainly when the contractor has no late projects', async () => {
    render(<DelayExplanationPanel client={fakeClient({})} userId="u1" />);
    expect(await screen.findByText('None of your projects is late')).toBeTruthy();
  });

  it('a manpower commitment: the date is locked to the offense window and sent through delay_submit_commitment', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const client = fakeClient({
      project_delay_cases: [{ ...baseCase, offense_no: 2, status: 'awaiting_explanation', reply_by: iso(3) }],
      fmr_projects: [project],
      project_delay_case_events: [{ case_id: 'c1', event_type: 'explanation_requested', payload: { note: 'Include your crew plan.' } }],
    }, rpc);
    const { container } = render(<DelayExplanationPanel client={client} userId="u1" />);

    expect(await screen.findByText('Commit a new finish date')).toBeTruthy();
    expect(screen.getByText(/Include your crew plan/)).toBeTruthy();
    expect(screen.getAllByText('Offense 2 of 3').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: /Manpower/ }));
    const date = container.querySelector('input[type="date"]');
    expect(date.getAttribute('min')).toBe(iso(1));
    expect(date.getAttribute('max')).toBe(iso(45));     // Offense 2: 45 days, no later

    // One day past the limit: refused, nothing sent.
    fireEvent.change(date, { target: { value: iso(46) } });
    fireEvent.change(screen.getByPlaceholderText(/second crew/), { target: { value: 'Short of six workers; second crew Monday.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send commitment/ }));
    expect(await screen.findByText(/must be from .* \(45 days max\)/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.change(date, { target: { value: iso(45) } });
    fireEvent.click(screen.getByRole('button', { name: /Send commitment/ }));
    expect(await screen.findByText('Send this commitment to the DA?')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Yes, send it/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('delay_submit_commitment', expect.objectContaining({
      p_case: 'c1', p_cause: 'manpower', p_new_date: iso(45), p_event_name: null, p_stopped_days: null,
    }));
  });

  it('an act of nature needs the event, days stopped and proof, and its window is the days stopped', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const client = fakeClient({ project_delay_cases: [{ ...baseCase, status: 'awaiting_explanation', reply_by: iso(3) }], fmr_projects: [project] }, rpc);
    const { container } = render(<DelayExplanationPanel client={client} userId="u1" />);
    await screen.findByText('Commit a new finish date');
    fireEvent.click(screen.getByRole('radio', { name: /Act of nature/ }));
    fireEvent.change(screen.getByPlaceholderText(/Typhoon Kristine/), { target: { value: 'Typhoon Kristine' } });
    fireEvent.change(screen.getByPlaceholderText('1–30'), { target: { value: '5' } });
    const date = container.querySelector('input[type="date"]');
    expect(date.getAttribute('max')).toBe(iso(5));
    fireEvent.change(date, { target: { value: iso(5) } });
    fireEvent.change(screen.getByPlaceholderText(/typhoon flooded/), { target: { value: 'The site was flooded for 5 days.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send commitment/ }));
    expect(await screen.findByText(/Attach proof/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('the final offense is marked strict, and after 3 offenses only an act of nature is offered', async () => {
    const client = fakeClient({
      project_delay_cases: [
        { ...baseCase, offense_no: 3, status: 'awaiting_explanation', reply_by: iso(1) },
        { ...baseCase, id: 'c2', project_id: 8, offense_no: 4, status: 'awaiting_explanation', reply_by: iso(5) },
      ],
      fmr_projects: [project, { ...project, id: 8, project_name: 'Brgy. Agboy FMR' }],
    });
    render(<DelayExplanationPanel client={client} userId="u1" />);
    expect(await screen.findByText(/FINAL CHANCE/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Brgy\. Agboy FMR/ }));
    expect(await screen.findByText(/Your 3 chances are used/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Act of nature/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Manpower/ })).toBeNull();
  });

  it('keeps a typed draft when switching between projects', async () => {
    const client = fakeClient({
      project_delay_cases: [
        { ...baseCase, status: 'awaiting_explanation', reply_by: iso(2) },
        { ...baseCase, id: 'c2', project_id: 8, status: 'awaiting_explanation', reply_by: iso(6) },
      ],
      fmr_projects: [project, { ...project, id: 8, project_name: 'Brgy. Agboy FMR' }],
    });
    render(<DelayExplanationPanel client={client} userId="u1" />);
    await screen.findByText('Commit a new finish date');
    fireEvent.change(screen.getByPlaceholderText(/second crew/), { target: { value: 'Half typed note' } });
    fireEvent.click(screen.getByRole('button', { name: /Brgy\. Agboy FMR/ }));
    await waitFor(() => expect(screen.queryByDisplayValue('Half typed note')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Brgy\. Tabucan FMR/ }));
    expect(await screen.findByDisplayValue('Half typed note')).toBeTruthy();
  });

  it('shows waiting and recently decided follow-ups without a form', async () => {
    const client = fakeClient({
      project_delay_cases: [
        { ...baseCase, status: 'awaiting_verification', verification_due: iso(4) },
        { ...baseCase, id: 'c3', status: 'closed', outcome: 'extended', kind: 'offense', new_target_date: iso(40), outcome_reason: 'Crew plan checked.', closed_at: new Date().toISOString() },
      ],
      fmr_projects: [project],
    });
    render(<DelayExplanationPanel client={client} userId="u1" />);
    expect(await screen.findByText(/field engineer is checking/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Decided/ }));
    expect((await screen.findAllByText('Approved')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Crew plan checked/)).toBeTruthy();
  });
});
