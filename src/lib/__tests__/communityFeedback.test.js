import { describe, expect, it } from 'vitest';
import { selectCommunityFeedback } from '../communityFeedback';

/* A stand-in for the Supabase client. `answer(table, columns)` returns what that
 * query should resolve to; the chain is awaitable and supports .eq(). */
function fakeClient(answer, userId = 'me') {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from(table) {
      return {
        select(columns) {
          calls.push({ table, columns });
          const result = Promise.resolve(answer(table, columns));
          return Object.assign(result, { eq: () => result, order: () => result, limit: () => result });
        },
      };
    },
  };
}

const VIEW = 'feedbacks_community_view';

describe('selectCommunityFeedback', () => {
  it('reads the community view when it exists', async () => {
    const rows = [{ id: 1, message: 'hello', is_current_user_feedback: true }];
    const client = fakeClient((table) => (
      table === VIEW ? { data: rows, error: null } : { data: null, error: { message: 'unexpected' } }
    ));
    const result = await selectCommunityFeedback(client);
    expect(result.data).toEqual(rows);
    expect(client.calls.map((c) => c.table)).toEqual([VIEW]);
  });

  it('never asks for author identity columns', async () => {
    const client = fakeClient(() => ({ data: [], error: null }));
    await selectCommunityFeedback(client);
    client.calls.forEach((c) => {
      expect(c.columns).not.toMatch(/user_email|user_id/);
    });
  });

  it("falls back to the table and flags the viewer's own rows when the view is missing", async () => {
    const client = fakeClient((table, columns) => {
      if (table === VIEW) return { data: null, error: { message: 'relation does not exist' } };
      if (columns === 'id') return { data: [{ id: 2 }], error: null }; // ids owned by the viewer
      return { data: [{ id: 1, message: 'a' }, { id: 2, message: 'b' }], error: null };
    });
    const result = await selectCommunityFeedback(client);
    expect(result.data.map((r) => [r.id, r.is_current_user_feedback])).toEqual([[1, false], [2, true]]);
  });

  it("flags nothing as the viewer's own when signed out", async () => {
    const client = fakeClient((table) => (
      table === VIEW ? { data: null, error: { message: 'missing' } } : { data: [{ id: 1 }], error: null }
    ), null);
    const result = await selectCommunityFeedback(client);
    expect(result.data[0].is_current_user_feedback).toBe(false);
  });

  it('retries without the report-link columns on an older database', async () => {
    const client = fakeClient((table, columns) => {
      if (table === VIEW) return { data: null, error: { message: 'missing' } };
      if (columns === 'id') return { data: [], error: null };
      if (columns.includes('public_report_id')) return { data: null, error: { message: 'column does not exist' } };
      return { data: [{ id: 7 }], error: null };
    });
    const result = await selectCommunityFeedback(client);
    expect(result.data).toEqual([{ id: 7, is_current_user_feedback: false }]);
  });
});
