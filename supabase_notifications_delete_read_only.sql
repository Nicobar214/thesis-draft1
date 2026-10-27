-- =============================================================================
-- Notifications can be deleted only after they were opened. REPLACES ONE POLICY.
--
-- The bell (NotificationBell.jsx) lets every user swipe a notification away or
-- "Clear read". A notification that was never opened (is_read = false) cannot be
-- deleted, so nothing is lost unseen. This makes the database refuse it too,
-- whatever the app sends. Still only your own notifications (user_id).
--
-- The sidebar badges are not affected by deleting: they count the actual work
-- (pending reviews, replies due, repairs), not notifications.
-- Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = auth.uid() and is_read);

-- Check (read-only): should mention is_read.
-- select qual from pg_policies where tablename = 'notifications' and policyname = 'notifications_delete_own';
