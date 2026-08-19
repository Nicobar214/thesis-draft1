-- ============================================================
-- KalsaTrack – VERIFY the progress workflow gate
--
-- Run this in the Supabase SQL Editor AFTER running
-- supabase_progress_workflow_integrity_migration.sql
--
-- It proves, against your real database, that:
--   1. an admin CANNOT approve an uncertified submission
--   2. an admin CANNOT approve a disputed submission
--   3. after the engineer certifies, approval stores the ENGINEER'S figure
--   4. an already-approved submission cannot be approved twice
--   5. out-of-range certified values are rejected
--
-- It uses your contractor's example: reported 15.5%, certified 11%.
--
-- SAFE: everything runs inside a transaction that ends in ROLLBACK, so no
-- test project, submission or accomplishment is left behind. Read the NOTICE
-- output in the Results pane.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_admin      uuid;
  v_engineer   uuid;
  v_contractor uuid;
  v_project    bigint;
  v_update     uuid;
  v_official   numeric;
  v_msg        text;
  v_pass       int := 0;
  v_fail       int := 0;

  -- Users are impersonated below with set_config('request.jwt.claims', ...),
  -- because Supabase derives auth.uid() from that setting's "sub" claim. The
  -- SQL Editor has no logged-in user of its own, so without this every
  -- SECURITY DEFINER role check would simply fail.
BEGIN
  SELECT id INTO v_admin    FROM public.profiles WHERE role = 'admin'          LIMIT 1;
  SELECT id INTO v_engineer FROM public.profiles WHERE role = 'field_engineer' LIMIT 1;
  SELECT id INTO v_contractor FROM public.profiles WHERE role = 'contractor'   LIMIT 1;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'No admin profile found - cannot run verification';
  END IF;
  IF v_engineer IS NULL THEN
    RAISE EXCEPTION 'No field_engineer profile found - create one first, then re-run';
  END IF;
  -- A contractor is optional; the submission just needs an owner that is not
  -- the engineer (the RPC blocks self-certification).
  IF v_contractor IS NULL THEN v_contractor := v_admin; END IF;

  RAISE NOTICE '--- using admin=% engineer=% ---', v_admin, v_engineer;

  -- Throwaway project
  INSERT INTO public.fmr_projects (project_name, municipality, status, accomplishment, total_budget)
  VALUES ('__WORKFLOW VERIFICATION (rolled back)', 'Leon', 'On-Going', 0, 1000000)
  RETURNING id INTO v_project;

  -- Contractor claims 15.5%
  INSERT INTO public.progress_updates
    (fmr_project_id, contractor_id, reported_accomplishment, remarks, status)
  VALUES (v_project, v_contractor, 15.5, 'verification run', 'pending')
  RETURNING id INTO v_update;

  RAISE NOTICE 'contractor claimed 15.5%% on project %', v_project;

  -- ── TEST 1: admin approves WITHOUT certification -> must fail ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  BEGIN
    PERFORM public.approve_progress_update_admin(v_update);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  1. uncertified submission WAS approved (gate not working)';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'PASS  1. uncertified approval blocked -> %', v_msg;
  END;

  -- ── TEST 2: engineer disputes -> admin still cannot approve ───────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_engineer)::text, true);
  PERFORM public.certify_progress_update_engineer(v_update, NULL, 'Measured far less on site', true);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  BEGIN
    PERFORM public.approve_progress_update_admin(v_update);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  2. DISPUTED submission WAS approved';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'PASS  2. disputed approval blocked -> %', v_msg;
  END;

  -- ── TEST 3: contractor resubmits, engineer certifies 11% ──────────────
  -- (the disputed record is closed, so a corrected update is allowed)
  INSERT INTO public.progress_updates
    (fmr_project_id, contractor_id, reported_accomplishment, remarks, status)
  VALUES (v_project, v_contractor, 15.5, 'corrected submission', 'pending')
  RETURNING id INTO v_update;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_engineer)::text, true);

  -- 3a. out-of-range certification must be rejected
  BEGIN
    PERFORM public.certify_progress_update_engineer(v_update, 150, 'bad value', false);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  3a. certified 150%% was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  3a. out-of-range certification rejected';
  END;

  -- 3b. the real certification: engineer measures 11%
  PERFORM public.certify_progress_update_engineer(v_update, 11, 'Verified on site', false);
  RAISE NOTICE 'engineer certified 11%% (contractor had claimed 15.5%%)';

  -- ── TEST 4: admin approves -> project must show 11, NOT 15.5 ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  PERFORM public.approve_progress_update_admin(v_update);

  SELECT accomplishment INTO v_official FROM public.fmr_projects WHERE id = v_project;

  IF v_official = 11 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  4. official accomplishment = %  (engineer''s figure)', v_official;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  4. official accomplishment = %  (expected 11)', v_official;
  END IF;

  -- both values must still be on the record for the audit trail
  IF EXISTS (SELECT 1 FROM public.progress_updates
             WHERE id = v_update AND reported_accomplishment = 15.5
               AND certified_accomplishment = 11) THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  5. audit trail keeps both 15.5 (claim) and 11 (certified)';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  5. audit trail did not keep both values';
  END IF;

  -- ── TEST 6: duplicate approval must fail ──────────────────────────────
  BEGIN
    PERFORM public.approve_progress_update_admin(v_update);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  6. duplicate approval was allowed';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  6. duplicate approval blocked';
  END;

  RAISE NOTICE '=========================================';
  RAISE NOTICE 'RESULT: % passed, % failed', v_pass, v_fail;
  IF v_fail = 0 THEN
    RAISE NOTICE 'The gate is working: the admin cannot approve without the';
    RAISE NOTICE 'engineer, and the public figure is the engineer''s number.';
  ELSE
    RAISE NOTICE 'Something is wrong - re-run the migration and try again.';
  END IF;
  RAISE NOTICE '=========================================';
END $$;

-- Nothing above is kept.
ROLLBACK;
