/**
 * Read community feedback without ever receiving other people's identity.
 *
 * public.feedbacks stores each author's user_id and user_email, so the app must
 * never select those columns for rows that are not the viewer's own. The safe way
 * to share feedback is public.feedbacks_community_view (see
 * supabase_feedbacks_community_view.sql): it exposes only public columns plus an
 * `is_current_user_feedback` flag.
 *
 * Until that migration has been run, this helper falls back to reading the table
 * with the same safe column list and works out the flag from a query for the
 * viewer's own row ids, so callers behave identically before and after.
 *
 *   const { data } = await selectCommunityFeedback(supabase, (q) =>
 *     q.eq('project_id', id).order('created_at', { ascending: false }));
 */

const VIEW = 'feedbacks_community_view';

const BASE_COLUMNS =
  'id, project_id, project_name, type, message, photo_urls, latitude, longitude, geo_accuracy, status, created_at, updated_at';
const LINKED_COLUMNS = `${BASE_COLUMNS}, public_report_id, source`;

export async function selectCommunityFeedback(client, apply = (query) => query) {
  const viewResult = await apply(client.from(VIEW).select(`${LINKED_COLUMNS}, is_current_user_feedback`));
  if (!viewResult.error) return viewResult;

  // Fallback: the view is not installed yet.
  let result = await apply(client.from('feedbacks').select(LINKED_COLUMNS));
  if (result.error) result = await apply(client.from('feedbacks').select(BASE_COLUMNS));
  if (result.error || !result.data) return result;

  const { data: auth } = await client.auth.getUser();
  const userId = auth?.user?.id;
  let ownIds = new Set();
  if (userId) {
    const { data: own } = await client.from('feedbacks').select('id').eq('user_id', userId);
    ownIds = new Set((own || []).map((row) => row.id));
  }
  return {
    ...result,
    data: result.data.map((row) => ({ ...row, is_current_user_feedback: ownIds.has(row.id) })),
  };
}
