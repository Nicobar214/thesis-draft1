// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ result: { data: [], error: null }, eq: vi.fn() }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (col, value) => {
          mocks.eq(col, value);
          return { order: () => ({ limit: () => Promise.resolve(mocks.result) }) };
        },
      }),
    }),
  },
}));

import ProjectProgressTimeline from '../ProjectProgressTimeline';

const flush = () => act(async () => {});
const update = (id, accomplishment, approved_at, extra = {}) => ({
  id,
  project_id: 7,
  accomplishment,
  is_certified: true,
  photo_url: null,
  period_start: null,
  period_end: null,
  approved_at,
  ...extra,
});

beforeEach(() => {
  mocks.result = { data: [], error: null };
  mocks.eq.mockReset();
});
afterEach(cleanup);

describe('ProjectProgressTimeline', () => {
  it('asks only for the project it was given', async () => {
    render(<ProjectProgressTimeline projectId={7} />);
    await flush();
    expect(mocks.eq).toHaveBeenCalledWith('project_id', 7);
  });

  it('lists approved updates with their verified percentage and change', async () => {
    mocks.result = {
      data: [
        update('b', '42.5', '2026-10-06T00:00:00Z', { period_start: '2026-10-01', period_end: '2026-10-31' }),
        update('a', '30', '2026-09-07T00:00:00Z', { period_start: '2026-09-01', period_end: '2026-09-30' }),
      ],
      error: null,
    };
    render(<ProjectProgressTimeline projectId={7} />);
    await flush();

    expect(screen.getByText('Oct 2026')).toBeTruthy();
    expect(screen.getByText('Sep 2026')).toBeTruthy();
    expect(screen.getByText('+12.5 pts')).toBeTruthy();
  });

  it('tells citizens who vouched for each figure', async () => {
    mocks.result = {
      data: [
        update('b', '40', '2026-10-06T00:00:00Z'),
        update('a', '30', '2026-09-07T00:00:00Z', { is_certified: false }),
      ],
      error: null,
    };
    render(<ProjectProgressTimeline projectId={7} />);
    await flush();

    expect(screen.getByText('Verified by site engineer')).toBeTruthy();
    expect(screen.getByText('Reported by contractor, approved by DA')).toBeTruthy();
  });

  it('shows a progress photo only when one exists', async () => {
    mocks.result = {
      data: [
        update('b', '40', '2026-10-06T00:00:00Z', { photo_url: 'https://cdn.test/site.jpg' }),
        update('a', '30', '2026-09-07T00:00:00Z'),
      ],
      error: null,
    };
    render(<ProjectProgressTimeline projectId={7} />);
    await flush();

    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('explains plainly when nothing has been published yet', async () => {
    render(<ProjectProgressTimeline projectId={7} />);
    await flush();
    expect(screen.getByText(/no progress updates have been published/i)).toBeTruthy();
  });

  it('renders nothing at all until the view exists', async () => {
    mocks.result = { data: null, error: { message: 'relation does not exist' } };
    const { container } = render(<ProjectProgressTimeline projectId={7} />);
    await flush();
    expect(container.innerHTML).toBe('');
  });

  it('folds older updates away and lets the reader expand them', async () => {
    mocks.result = {
      data: Array.from({ length: 6 }, (_, i) => update(`u${i}`, String(10 + i * 5), `2026-0${i + 1}-15T00:00:00Z`)),
      error: null,
    };
    render(<ProjectProgressTimeline projectId={7} />);
    await flush();

    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByText('Show 2 earlier updates'));
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    fireEvent.click(screen.getByText('Show fewer'));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});
