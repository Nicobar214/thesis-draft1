// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NotificationBell from '../NotificationBell';

vi.mock('../../lib/confirm', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('../../lib/supabase', () => ({ supabase: null }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

const rows = [
  { id: 'n1', type: 'project_assigned', title: 'Read one', message: 'Opened before', is_read: true, created_at: new Date().toISOString() },
  { id: 'n2', type: 'delay_explanation_requested', title: 'Unread one', message: 'Not opened yet', is_read: false, created_at: new Date().toISOString() },
];

/* A stand-in Supabase client: selects resolve to `rows`; deletes are recorded. */
function fakeClient() {
  const deleted = [];
  const chain = (result) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, in: () => q,
      update: () => q,
      delete: () => ({ in: (_col, ids) => ({ eq: async (col, val) => { deleted.push({ ids, col, val }); return { error: null }; } }) }),
      then: (ok, bad) => Promise.resolve(result).then(ok, bad),
    };
    return q;
  };
  return {
    deleted,
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => chain({ data: rows, error: null }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: vi.fn(),
  };
}

async function openBell(client) {
  render(<NotificationBell client={client} />);
  await waitFor(() => expect(screen.getByLabelText(/Notifications, 1 unread/)).toBeTruthy());
  fireEvent.click(screen.getByLabelText(/Notifications, 1 unread/));
  await screen.findByText('Read one');
}

describe('NotificationBell deleting', () => {
  it('cannot delete a notification that was not opened yet', async () => {
    const client = fakeClient();
    await openBell(client);
    expect(screen.getByLabelText('Open this notification before deleting it').disabled).toBe(true);
  });

  it('deletes a read one with an undo, and only deletes it after the undo window', async () => {
    const client = fakeClient();
    await openBell(client);
    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText('Delete notification'));
    expect(screen.getByText('Deleted')).toBeTruthy();
    fireEvent.click(screen.getByText('Undo'));
    expect(screen.getByText('Read one')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Delete notification'));
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(client.deleted).toEqual([{ ids: ['n1'], col: 'is_read', val: true }]);
  });

  it('Select mode: tick read ones and delete only those; unread ones cannot be ticked', async () => {
    const client = fakeClient();
    await openBell(client);
    fireEvent.click(screen.getByText('Select'));
    expect(screen.getByLabelText('"Unread one" is not opened yet').disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Delete selected/ }).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Select "Read one"'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }));
    await waitFor(() => expect(client.deleted).toEqual([{ ids: ['n1'], col: 'is_read', val: true }]));
    expect(screen.getByText('Unread one')).toBeTruthy();
    expect(screen.queryByText('Select all read')).toBeNull(); // back to the normal list
  });

  it('"Clear read" removes only the read ones', async () => {
    const client = fakeClient();
    await openBell(client);
    fireEvent.click(screen.getByText('Clear read'));
    await waitFor(() => expect(client.deleted).toEqual([{ ids: ['n1'], col: 'is_read', val: true }]));
    expect(screen.getByText('Unread one')).toBeTruthy();
    expect(screen.queryByText('Read one')).toBeNull();
  });
});
