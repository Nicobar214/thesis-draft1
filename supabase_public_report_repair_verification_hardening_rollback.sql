-- Rolls back supabase_public_report_repair_verification_hardening.sql
--
-- Step 1: run this file (drops the 7-argument verify function).
-- Step 2: re-run supabase_public_report_repair_actions.sql, which recreates the
--         original 6-argument verify_public_report_repair and its grants.
--
-- The verification_captured_at column is left in place: it is nullable and
-- unused by the original function, so keeping it loses nothing.

begin;

drop function if exists public.verify_public_report_repair(uuid, text, double precision, double precision, double precision, text, timestamptz);

commit;
