-- ============================================================
-- KalsaTrack - Self-Service Account Deletion RPC
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be logged in to delete this account.';
  END IF;

  -- Guardrail: prevent accidental admin lockout via self-delete button.
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF COALESCE(v_role, '') = 'admin' THEN
    RAISE EXCEPTION 'Admin accounts cannot be deleted from this screen.';
  END IF;

  -- Remove user-linked records where user_id exists.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_reports'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'DELETE FROM public.public_reports WHERE user_id = $1' USING v_uid;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'feedbacks'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'DELETE FROM public.feedbacks WHERE user_id = $1' USING v_uid;
  END IF;

  DELETE FROM public.profiles WHERE id = v_uid;

  -- Finally remove auth account.
  DELETE FROM auth.users WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account record was not found in auth.users.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
