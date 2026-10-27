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
const baseCase = { id: 'c1', project_id: 7, target_date_at_open: iso(-6), opened_at: new Date().toISOString() };

describe('DelayExplanationPanel', () => {
  it('says so plainly when the contractor has no late projects', async () => {
    render(<DelayExplanationPanel client={fakeClient({})} userId="u1" />);
    expect(await screen.findByText('None of your projects is late')).toBeTruthy();
  });

  it('asks for an explanation with the DA note and sends it through delay_submit_explanation', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const client = fakeClient({
      project_delay_cases: [{ ...baseCase, status: 'awaiting_explanation', reply_by: iso(3) }],
      fmr_projects: [project],
      project_delay_case_events: [{ case_id: 'c1', event_type: 'explanation_requested', payload: { note: 'Include your crew plan.' } }],
    }, rpc);
    render(<DelayExplanationPanel client={client} userId="u1" />);

    expect(await screen.findByText('Explain the delay')).toBeTruthy();
    expect(screen.getByText(/Include your crew plan/)).toBeTruthy();
    expect(screen.getByText(/6 day\(s\) late/)).toBeTruthy();
    expect(screen.queryByText(/Work done/)).toBeNull();      // progress is not asked: it comes from certified updates

    // Too short: nothing is sent, the problems are listed.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'weather' } });
    fireEvent.change(screen.getByPlaceholderText(/heavy rain/), { target: { value: 'Rain' } });
    fireEvent.click(screen.getByRole('button', { name: /Send explanation/ }));
    expect(await screen.findByText(/at least 10 characters/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/heavy rain/), { target: { value: '  Two weeks of heavy rain.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send explanation/ }));
    // The review card shows what will be sent; nothing goes until "Yes, send it".
    expect(await screen.findByText('Send this explanation to the DA?')).toBeTruthy();
    expect(screen.getAllByText('Two weeks of heavy rain.').length).toBeGreaterThan(0);
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Yes, send it/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('delay_submit_explanation', expect.objectContaining({
      p_case: 'c1', p_cause: 'weather', p_explanation: 'Two weeks of heavy rain.', p_claimed_percent: null,
    }));
  });

  it('marks a final notice and starts a revision from the earlier answer', async () => {
    const client = fakeClient({
      project_delay_cases: [
        { ...baseCase, status: 'final_notice', reply_by: iso(0) },
        { ...baseCase, id: 'c2', status: 'revision_requested', reply_by: iso(5), cause: 'materials', explanation: 'Cement shortage in Iloilo.' },
      ],
      fmr_projects: [project],
    });
    render(<DelayExplanationPanel client={client} userId="u1" />);
    // Most urgent first: the final notice (due today) is open, the revision is listed below it.
    expect(await screen.findByText('Final notice: reply now')).toBeTruthy();
    expect(screen.getAllByText('Reply due today').length).toBeGreaterThan(0);
    expect(screen.getByText(/can only suspend or terminate/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /To answer\s*2/ })).toBeTruthy();
    // Opening the revision starts from the earlier answer.
    fireEvent.click(screen.getAllByRole('button', { name: /Brgy\. Tabucan FMR/ })[1]);
    expect(await screen.findByDisplayValue('Cement shortage in Iloilo.')).toBeTruthy();
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
    await screen.findByText('Explain the delay');
    fireEvent.change(screen.getByPlaceholderText(/heavy rain/), { target: { value: 'Half typed note' } });
    fireEvent.click(screen.getByRole('button', { name: /Brgy\. Agboy FMR/ }));
    await waitFor(() => expect(screen.queryByDisplayValue('Half typed note')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Brgy\. Tabucan FMR/ }));
    expect(await screen.findByDisplayValue('Half typed note')).toBeTruthy();
  });

  it('shows waiting and recently closed follow-ups without a form', async () => {
    const client = fakeClient({
      project_delay_cases: [
        { ...baseCase, status: 'awaiting_verification', verification_due: iso(4) },
        { ...baseCase, id: 'c3', status: 'closed', outcome: 'extended', new_target_date: iso(40), outcome_reason: 'Rain confirmed on site.', closed_at: new Date().toISOString() },
      ],
      fmr_projects: [project],
    });
    render(<DelayExplanationPanel client={client} userId="u1" />);
    // Nothing to answer, so it opens on "Waiting on DA".
    expect(await screen.findByText(/field engineer is checking/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Decided/ }));
    expect((await screen.findAllByText('Extended')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Rain confirmed on site/)).toBeTruthy();
  });
});
