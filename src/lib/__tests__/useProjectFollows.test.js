// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  countsResult: { data: [], error: null },
  insert: vi.fn(),
  deleteEq: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: (table) => {
      if (table === 'project_follow_counts') {
        return { select: () => Promise.resolve(mocks.countsResult) };
      }
      return {
        insert: (row) => mocks.insert(row),
        delete: () => ({ eq: (col, value) => mocks.deleteEq(col, value) }),
      };
    },
  },
}));
vi.mock('../toast', () => ({ notify: mocks.notify }));

import { useProjectFollows } from '../useProjectFollows';

const flush = () => act(async () => {});

beforeEach(() => {
  mocks.countsResult = {
    data: [
      { project_id: 1, follower_count: 3, i_follow: true },
      { project_id: 2, follower_count: 1, i_follow: false },
    ],
    error: null,
  };
  mocks.insert.mockReset().mockResolvedValue({ error: null });
  mocks.deleteEq.mockReset().mockResolvedValue({ error: null });
  mocks.notify.mockReset();
});

afterEach(cleanup);

describe('useProjectFollows: loading', () => {
  it('reads follower counts and which projects the viewer follows', async () => {
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    expect(result.current.available).toBe(true);
    expect(result.current.isFollowing(1)).toBe(true);
    expect(result.current.isFollowing(2)).toBe(false);
    expect(result.current.countFor(1)).toBe(3);
    expect(result.current.countFor(99)).toBe(0);
    expect(result.current.followingCount).toBe(1);
  });

  it('stays unavailable until the follow tables exist', async () => {
    mocks.countsResult = { data: null, error: { message: 'relation does not exist' } };
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    expect(result.current.available).toBe(false);
    expect(result.current.followProps(1).available).toBe(false);
  });

  it('is available but empty when nobody follows anything yet', async () => {
    mocks.countsResult = { data: [], error: null };
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    expect(result.current.available).toBe(true);
    expect(result.current.followingCount).toBe(0);
  });
});

describe('useProjectFollows: following and unfollowing', () => {
  it('follows a project, updates the count straight away, and confirms to the user', async () => {
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    await act(async () => { await result.current.toggle(2); });

    expect(mocks.insert).toHaveBeenCalledWith({ project_id: 2 });
    expect(result.current.isFollowing(2)).toBe(true);
    expect(result.current.countFor(2)).toBe(2);
    expect(mocks.notify).toHaveBeenCalledWith(expect.stringMatching(/notified/i), 'success');
  });

  it('unfollows a project the viewer follows', async () => {
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    await act(async () => { await result.current.toggle(1); });

    expect(mocks.deleteEq).toHaveBeenCalledWith('project_id', 1);
    expect(result.current.isFollowing(1)).toBe(false);
    expect(result.current.countFor(1)).toBe(2);
  });

  it('puts things back and tells the user when saving fails', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    await act(async () => { await result.current.toggle(2); });

    expect(result.current.isFollowing(2)).toBe(false);
    expect(result.current.countFor(2)).toBe(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.stringMatching(/could not follow/i), 'error');
  });

  it('treats "already following" as success rather than an error', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    await act(async () => { await result.current.toggle(2); });

    expect(result.current.isFollowing(2)).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('ignores a second tap while the first is still saving', async () => {
    let finish;
    mocks.insert.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ error: null }); }));
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    let first;
    act(() => { first = result.current.toggle(2); });
    await act(async () => { await result.current.toggle(2); }); // second tap, ignored
    await act(async () => { finish(); await first; });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(result.current.countFor(2)).toBe(2);
  });

  it('does nothing when the feature is unavailable', async () => {
    mocks.countsResult = { data: null, error: { message: 'missing' } };
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    await act(async () => { await result.current.toggle(1); });

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.deleteEq).not.toHaveBeenCalled();
  });

  it('hands the dialog everything it needs, including a working toggle', async () => {
    const { result } = renderHook(() => useProjectFollows());
    await flush();

    const props = result.current.followProps(2);
    expect(props).toMatchObject({ available: true, following: false, count: 1, busy: false });

    await act(async () => { await props.onToggle(); });
    expect(mocks.insert).toHaveBeenCalledWith({ project_id: 2 });
  });
});
