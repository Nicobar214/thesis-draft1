-- ============================================================
-- KalsaTrack - Phase 1: Work Plan quantity reporting foundation
-- Department of Agriculture - RAED Region VI
--
-- Scope:
--   * Add Work Plan tables and foundation columns.
--   * Preserve legacy progress workflows.
--   * Add new controlled RPCs for future quantity-based flows.
--   * Do not harden public.progress_updates RLS in this phase.
-- ============================================================

-- 1. Work Plan status -------------------------------------------------------

ALTER TABLE public.fmr_projects
  ADD COLUMN IF NOT EXISTS work_plan_status text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fmr_projects_work_plan_status_check'
  ) THEN
    ALTER TABLE public.fmr_projects
      ADD CONSTRAINT fmr_projects_work_plan_status_check
      CHECK (work_plan_status IN ('none', 'draft', 'finalized'));
  END IF;
END $$;

-- 2. Work Plan items --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.work_plan_items (
  id bigserial PRIMARY KEY,
  fmr_project_id bigint NOT NULL REFERENCES public.fmr_projects(id) ON DELETE CASCADE,
  activity_name text NOT NULL,
  unit text NOT NULL DEFAULT '',
  planned_quantity numeric(12,4) NOT NULL,
  sort_order integer,
  remarks text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_plan_items_activity_name_not_blank
    CHECK (btrim(activity_name) <> ''),
  CONSTRAINT work_plan_items_planned_quantity_positive
    CHECK (planned_quantity > 0),
  CONSTRAINT work_plan_items_unit_length
    CHECK (char_length(unit) <= 50)
);

CREATE INDEX IF NOT EXISTS idx_work_plan_items_project_sort
  ON public.work_plan_items (fmr_project_id, sort_order);

-- 3. Progress update items --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.progress_update_items (
  id bigserial PRIMARY KEY,
  progress_update_id uuid NOT NULL REFERENCES public.progress_updates(id) ON DELETE CASCADE,
  work_plan_item_id bigint NOT NULL REFERENCES public.work_plan_items(id) ON DELETE RESTRICT,
  contractor_reported_quantity numeric(12,4) NOT NULL,
  engineer_validated_quantity numeric(12,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT progress_update_items_contractor_quantity_nonnegative
    CHECK (contractor_reported_quantity >= 0),
  CONSTRAINT progress_update_items_engineer_quantity_nonnegative
    CHECK (engineer_validated_quantity IS NULL OR engineer_validated_quantity >= 0),
  CONSTRAINT progress_update_items_update_plan_item_unique
    UNIQUE (progress_update_id, work_plan_item_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_update_items_progress_update
  ON public.progress_update_items (progress_update_id);

CREATE INDEX IF NOT EXISTS idx_progress_update_items_work_plan_item
  ON public.progress_update_items (work_plan_item_id);

-- 4. Contractor certification timestamp ------------------------------------

ALTER TABLE public.progress_updates
  ADD COLUMN IF NOT EXISTS contractor_certified_at timestamptz;

-- 5. Finalized Work Plan direct-mutation protection ------------------------

CREATE OR REPLACE FUNCTION public.prevent_finalized_work_plan_item_mutation()
RETURNS trigger AS $$
DECLARE
  v_project_id bigint;
  v_status text;
BEGIN
  v_project_id := COALESCE(NEW.fmr_project_id, OLD.fmr_project_id);

  SELECT work_plan_status INTO v_status
  FROM public.fmr_projects
  WHERE id = v_project_id;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'This Work Plan is finalized and cannot be modified.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_finalized_work_plan_item_mutation
  ON public.work_plan_items;

CREATE TRIGGER trg_prevent_finalized_work_plan_item_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.work_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_finalized_work_plan_item_mutation();

-- 6. Extend approved progress immutability with contractor_certified_at -----

CREATE OR REPLACE FUNCTION public.protect_approved_progress_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    IF NEW.reported_accomplishment  IS DISTINCT FROM OLD.reported_accomplishment
       OR NEW.certified_accomplishment IS DISTINCT FROM OLD.certified_accomplishment
       OR NEW.certification_status  IS DISTINCT FROM OLD.certification_status
       OR NEW.certification_remarks IS DISTINCT FROM OLD.certification_remarks
       OR NEW.certified_by          IS DISTINCT FROM OLD.certified_by
       OR NEW.certified_at          IS DISTINCT FROM OLD.certified_at
       OR NEW.contractor_certified_at IS DISTINCT FROM OLD.contractor_certified_at
       OR NEW.reviewed_by           IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at           IS DISTINCT FROM OLD.reviewed_at
       OR NEW.approval_remarks      IS DISTINCT FROM OLD.approval_remarks
       OR NEW.status                IS DISTINCT FROM OLD.status
       OR NEW.contractor_id         IS DISTINCT FROM OLD.contractor_id
       OR NEW.fmr_project_id        IS DISTINCT FROM OLD.fmr_project_id
    THEN
      RAISE EXCEPTION
        'This progress update has already been approved; its audit record cannot be modified. Submit a new progress update instead.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. One pending progress update per contractor/project --------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_updates_one_pending_per_contractor_project
  ON public.progress_updates (fmr_project_id, contractor_id)
  WHERE status = 'pending';

-- 8. RLS for new tables -----------------------------------------------------

ALTER TABLE public.work_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_update_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_plan_items_select_authorized
  ON public.work_plan_items;
CREATE POLICY work_plan_items_select_authorized
  ON public.work_plan_items
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_role() IN ('admin', 'field_engineer')
    OR EXISTS (
      SELECT 1
      FROM public.fmr_projects p
      WHERE p.id = work_plan_items.fmr_project_id
        AND p.contractor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS progress_update_items_select_authorized
  ON public.progress_update_items;
CREATE POLICY progress_update_items_select_authorized
  ON public.progress_update_items
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_role() IN ('admin', 'field_engineer')
    OR EXISTS (
      SELECT 1
      FROM public.progress_updates pu
      WHERE pu.id = progress_update_items.progress_update_id
        AND pu.contractor_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.work_plan_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.progress_update_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_plan_items TO authenticated;
GRANT SELECT ON public.progress_update_items TO authenticated;

-- 9. Admin Work Plan draft RPC ---------------------------------------------

CREATE OR REPLACE FUNCTION public.save_work_plan_draft(
  p_fmr_project_id bigint,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_status text;
  v_item jsonb;
  v_item_id bigint;
  v_activity_name text;
  v_unit text;
  v_planned_quantity numeric(12,4);
  v_sort_order integer;
  v_remarks text;
  v_payload_ids bigint[] := ARRAY[]::bigint[];
  v_preserved_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can save Work Plan drafts';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Work Plan items must be a JSON array';
  END IF;

  SELECT work_plan_status INTO v_status
  FROM public.fmr_projects
  WHERE id = p_fmr_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'A finalized Work Plan cannot be edited';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each Work Plan item must be an object';
    END IF;

    v_item_id := NULLIF(v_item->>'id', '')::bigint;
    v_activity_name := btrim(COALESCE(v_item->>'activity_name', ''));
    v_unit := COALESCE(v_item->>'unit', '');
    v_planned_quantity := NULLIF(v_item->>'planned_quantity', '')::numeric(12,4);
    v_sort_order := NULLIF(v_item->>'sort_order', '')::integer;
    v_remarks := NULLIF(v_item->>'remarks', '');

    IF v_activity_name = '' THEN
      RAISE EXCEPTION 'Activity name is required';
    END IF;

    IF v_planned_quantity IS NULL OR v_planned_quantity <= 0 THEN
      RAISE EXCEPTION 'Planned quantity must be greater than zero';
    END IF;

    IF char_length(v_unit) > 50 THEN
      RAISE EXCEPTION 'Unit must be 50 characters or fewer';
    END IF;

    IF v_item_id IS NOT NULL THEN
      IF v_item_id = ANY(v_payload_ids) THEN
        RAISE EXCEPTION 'Duplicate Work Plan item id: %', v_item_id;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.work_plan_items
        WHERE id = v_item_id
          AND fmr_project_id = p_fmr_project_id
      ) THEN
        RAISE EXCEPTION 'Work Plan item % does not belong to this project', v_item_id;
      END IF;

      v_payload_ids := array_append(v_payload_ids, v_item_id);
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::bigint;
    v_activity_name := btrim(COALESCE(v_item->>'activity_name', ''));
    v_unit := COALESCE(v_item->>'unit', '');
    v_planned_quantity := NULLIF(v_item->>'planned_quantity', '')::numeric(12,4);
    v_sort_order := NULLIF(v_item->>'sort_order', '')::integer;
    v_remarks := NULLIF(v_item->>'remarks', '');

    IF v_item_id IS NULL THEN
      INSERT INTO public.work_plan_items (
        fmr_project_id,
        activity_name,
        unit,
        planned_quantity,
        sort_order,
        remarks,
        created_by
      )
      VALUES (
        p_fmr_project_id,
        v_activity_name,
        v_unit,
        v_planned_quantity,
        v_sort_order,
        v_remarks,
        auth.uid()
      )
      RETURNING id INTO v_item_id;

      v_payload_ids := array_append(v_payload_ids, v_item_id);
    ELSE
      UPDATE public.work_plan_items
      SET activity_name = v_activity_name,
          unit = v_unit,
          planned_quantity = v_planned_quantity,
          sort_order = v_sort_order,
          remarks = v_remarks
      WHERE id = v_item_id
        AND fmr_project_id = p_fmr_project_id;
    END IF;
  END LOOP;

  DELETE FROM public.work_plan_items wpi
  WHERE wpi.fmr_project_id = p_fmr_project_id
    AND NOT (wpi.id = ANY(v_payload_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.progress_update_items pui
      WHERE pui.work_plan_item_id = wpi.id
    );

  SELECT COALESCE(array_agg(wpi.id ORDER BY wpi.id), ARRAY[]::bigint[])
    INTO v_preserved_ids
  FROM public.work_plan_items wpi
  WHERE wpi.fmr_project_id = p_fmr_project_id
    AND NOT (wpi.id = ANY(v_payload_ids));

  IF v_status = 'none' THEN
    UPDATE public.fmr_projects
    SET work_plan_status = 'draft',
        updated_at = now()
    WHERE id = p_fmr_project_id;
  ELSE
    UPDATE public.fmr_projects
    SET updated_at = now()
    WHERE id = p_fmr_project_id;
  END IF;

  RETURN jsonb_build_object(
    'project_id', p_fmr_project_id,
    'work_plan_status', CASE WHEN v_status = 'none' THEN 'draft' ELSE v_status END,
    'submitted_item_count', jsonb_array_length(p_items),
    'preserved_history_item_ids', COALESCE(to_jsonb(v_preserved_ids), '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

-- 10. Finalize Work Plan RPC ------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_work_plan(
  p_fmr_project_id bigint
)
RETURNS void AS $$
DECLARE
  v_status text;
  v_valid_item_count integer;
BEGIN
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can finalize Work Plans';
  END IF;

  SELECT work_plan_status INTO v_status
  FROM public.fmr_projects
  WHERE id = p_fmr_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'This Work Plan is already finalized';
  END IF;

  SELECT count(*) INTO v_valid_item_count
  FROM public.work_plan_items
  WHERE fmr_project_id = p_fmr_project_id
    AND btrim(activity_name) <> ''
    AND planned_quantity > 0
    AND char_length(unit) <= 50;

  IF v_valid_item_count = 0 THEN
    RAISE EXCEPTION 'At least one valid Work Plan item is required before finalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.work_plan_items
    WHERE fmr_project_id = p_fmr_project_id
      AND (btrim(activity_name) = '' OR planned_quantity <= 0 OR char_length(unit) > 50)
  ) THEN
    RAISE EXCEPTION 'All Work Plan items must be valid before finalization';
  END IF;

  UPDATE public.fmr_projects
  SET work_plan_status = 'finalized',
      updated_at = now()
  WHERE id = p_fmr_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

-- 11. Contractor quantity submission RPC -----------------------------------

CREATE OR REPLACE FUNCTION public.submit_progress_update_with_quantities(
  p_fmr_project_id bigint,
  p_period_start date,
  p_period_end date,
  p_remarks text,
  p_items jsonb,
  p_contractor_certified boolean,
  p_photo_url text DEFAULT NULL,
  p_amount_this_billing numeric DEFAULT NULL,
  p_remaining_scope text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_contractor_id uuid := auth.uid();
  v_project record;
  v_item jsonb;
  v_item_id bigint;
  v_quantity numeric(12,4);
  v_item_ids bigint[] := ARRAY[]::bigint[];
  v_plan_count integer;
  v_submitted_count integer;
  v_sum_percent numeric;
  v_reported_accomplishment numeric;
  v_progress_update_id uuid;
BEGIN
  IF public.current_profile_role() <> 'contractor' THEN
    RAISE EXCEPTION 'Only contractors can submit quantity progress updates';
  END IF;

  IF v_contractor_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated contractor identity is required';
  END IF;

  SELECT * INTO v_project
  FROM public.fmr_projects
  WHERE id = p_fmr_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF v_project.contractor_id IS DISTINCT FROM v_contractor_id THEN
    RAISE EXCEPTION 'You are not assigned to this project';
  END IF;

  IF v_project.work_plan_status <> 'finalized' THEN
    RAISE EXCEPTION 'A finalized Work Plan is required before quantity progress can be submitted';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'A valid reporting period is required';
  END IF;

  IF COALESCE(btrim(p_remarks), '') = '' THEN
    RAISE EXCEPTION 'Remarks are required';
  END IF;

  IF p_contractor_certified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Contractor certification acknowledgement is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Progress items must be a JSON array';
  END IF;

  SELECT count(*) INTO v_plan_count
  FROM public.work_plan_items
  WHERE fmr_project_id = p_fmr_project_id;

  v_submitted_count := jsonb_array_length(p_items);

  IF v_submitted_count <> v_plan_count THEN
    RAISE EXCEPTION 'Submitted quantities must match the finalized Work Plan item set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.progress_updates
    WHERE fmr_project_id = p_fmr_project_id
      AND contractor_id = v_contractor_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending progress update already exists for this project';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each progress item must be an object';
    END IF;

    v_item_id := NULLIF(v_item->>'work_plan_item_id', '')::bigint;
    v_quantity := NULLIF(v_item->>'contractor_reported_quantity', '')::numeric(12,4);

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Work Plan item id is required';
    END IF;

    IF v_item_id = ANY(v_item_ids) THEN
      RAISE EXCEPTION 'Duplicate Work Plan item id: %', v_item_id;
    END IF;

    IF v_quantity IS NULL OR v_quantity < 0 THEN
      RAISE EXCEPTION 'Contractor reported quantity must be zero or greater';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.work_plan_items
      WHERE id = v_item_id
        AND fmr_project_id = p_fmr_project_id
    ) THEN
      RAISE EXCEPTION 'Work Plan item % does not belong to this project', v_item_id;
    END IF;

    v_item_ids := array_append(v_item_ids, v_item_id);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.work_plan_items wpi
    WHERE wpi.fmr_project_id = p_fmr_project_id
      AND NOT (wpi.id = ANY(v_item_ids))
  ) THEN
    RAISE EXCEPTION 'Submitted quantities must include every finalized Work Plan item';
  END IF;

  WITH submitted AS (
    SELECT
      (value->>'work_plan_item_id')::bigint AS work_plan_item_id,
      (value->>'contractor_reported_quantity')::numeric AS qty
    FROM jsonb_array_elements(p_items)
  ),
  previous AS (
    SELECT
      pui.work_plan_item_id,
      sum(pui.contractor_reported_quantity) AS qty
    FROM public.progress_update_items pui
    JOIN public.progress_updates pu ON pu.id = pui.progress_update_id
    WHERE pu.fmr_project_id = p_fmr_project_id
      AND pu.contractor_id = v_contractor_id
      AND pu.status = 'approved'
    GROUP BY pui.work_plan_item_id
  ),
  checked AS (
    SELECT
      wpi.id,
      wpi.planned_quantity,
      COALESCE(previous.qty, 0) + submitted.qty AS cumulative_qty
    FROM public.work_plan_items wpi
    JOIN submitted ON submitted.work_plan_item_id = wpi.id
    LEFT JOIN previous ON previous.work_plan_item_id = wpi.id
    WHERE wpi.fmr_project_id = p_fmr_project_id
  )
  SELECT avg((cumulative_qty / planned_quantity) * 100)
    INTO v_reported_accomplishment
  FROM checked;

  IF EXISTS (
    WITH submitted AS (
      SELECT
        (value->>'work_plan_item_id')::bigint AS work_plan_item_id,
        (value->>'contractor_reported_quantity')::numeric AS qty
      FROM jsonb_array_elements(p_items)
    ),
    previous AS (
      SELECT
        pui.work_plan_item_id,
        sum(pui.contractor_reported_quantity) AS qty
      FROM public.progress_update_items pui
      JOIN public.progress_updates pu ON pu.id = pui.progress_update_id
      WHERE pu.fmr_project_id = p_fmr_project_id
        AND pu.contractor_id = v_contractor_id
        AND pu.status = 'approved'
      GROUP BY pui.work_plan_item_id
    )
    SELECT 1
    FROM public.work_plan_items wpi
    JOIN submitted ON submitted.work_plan_item_id = wpi.id
    LEFT JOIN previous ON previous.work_plan_item_id = wpi.id
    WHERE wpi.fmr_project_id = p_fmr_project_id
      AND COALESCE(previous.qty, 0) + submitted.qty > wpi.planned_quantity
  ) THEN
    RAISE EXCEPTION 'Cumulative contractor reported quantity cannot exceed planned quantity';
  END IF;

  INSERT INTO public.progress_updates (
    fmr_project_id,
    contractor_id,
    reported_accomplishment,
    remarks,
    photo_url,
    status,
    submitted_at,
    certification_status,
    period_start,
    period_end,
    amount_this_billing,
    work_items,
    remaining_scope,
    contractor_certified_at
  )
  VALUES (
    p_fmr_project_id,
    v_contractor_id,
    v_reported_accomplishment,
    p_remarks,
    p_photo_url,
    'pending',
    now(),
    'pending_certification',
    p_period_start,
    p_period_end,
    p_amount_this_billing,
    '[]'::jsonb,
    p_remaining_scope,
    now()
  )
  RETURNING id INTO v_progress_update_id;

  INSERT INTO public.progress_update_items (
    progress_update_id,
    work_plan_item_id,
    contractor_reported_quantity
  )
  SELECT
    v_progress_update_id,
    (value->>'work_plan_item_id')::bigint,
    (value->>'contractor_reported_quantity')::numeric(12,4)
  FROM jsonb_array_elements(p_items);

  RETURN v_progress_update_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

-- 12. Engineer quantity certification RPC ----------------------------------

CREATE OR REPLACE FUNCTION public.certify_progress_with_quantities(
  p_progress_update_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_remarks text DEFAULT NULL,
  p_dispute boolean DEFAULT false,
  p_engineer_acknowledged boolean DEFAULT false
)
RETURNS void AS $$
DECLARE
  upd record;
  v_project record;
  v_role text;
  v_item jsonb;
  v_item_id bigint;
  v_quantity numeric(12,4);
  v_item_ids bigint[] := ARRAY[]::bigint[];
  v_update_item_count integer;
  v_certified_accomplishment numeric;
BEGIN
  v_role := public.current_profile_role();

  IF COALESCE(v_role, '') NOT IN ('field_engineer', 'admin') THEN
    RAISE EXCEPTION 'Only field engineers or admins can certify quantity progress updates';
  END IF;

  SELECT * INTO upd
  FROM public.progress_updates
  WHERE id = p_progress_update_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Progress update not found';
  END IF;

  IF COALESCE(upd.status, '') <> 'pending' THEN
    RAISE EXCEPTION 'This progress update is already % and can no longer be certified', upd.status;
  END IF;

  IF upd.contractor_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot certify your own progress submission';
  END IF;

  SELECT * INTO v_project
  FROM public.fmr_projects
  WHERE id = upd.fmr_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF p_dispute THEN
    IF COALESCE(btrim(p_remarks), '') = '' THEN
      RAISE EXCEPTION 'Remarks are required when disputing a quantity progress update';
    END IF;

    UPDATE public.progress_update_items
    SET engineer_validated_quantity = NULL
    WHERE progress_update_id = p_progress_update_id;

    UPDATE public.progress_updates
    SET certification_status     = 'disputed',
        certification_remarks    = p_remarks,
        certified_by             = auth.uid(),
        certified_at             = now(),
        certified_accomplishment = NULL,
        status                   = 'rejected',
        reviewed_at              = now()
    WHERE id = p_progress_update_id;

    RETURN;
  END IF;

  IF p_engineer_acknowledged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Engineer certification acknowledgement is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Certification items must be a JSON array';
  END IF;

  SELECT count(*) INTO v_update_item_count
  FROM public.progress_update_items
  WHERE progress_update_id = p_progress_update_id;

  IF jsonb_array_length(p_items) <> v_update_item_count THEN
    RAISE EXCEPTION 'Engineer quantities must match the submitted progress item set';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each certification item must be an object';
    END IF;

    v_item_id := NULLIF(v_item->>'work_plan_item_id', '')::bigint;
    v_quantity := NULLIF(v_item->>'engineer_validated_quantity', '')::numeric(12,4);

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Work Plan item id is required';
    END IF;

    IF v_item_id = ANY(v_item_ids) THEN
      RAISE EXCEPTION 'Duplicate Work Plan item id: %', v_item_id;
    END IF;

    IF v_quantity IS NULL OR v_quantity < 0 THEN
      RAISE EXCEPTION 'Engineer validated quantity must be zero or greater';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.progress_update_items pui
      JOIN public.work_plan_items wpi ON wpi.id = pui.work_plan_item_id
      WHERE pui.progress_update_id = p_progress_update_id
        AND pui.work_plan_item_id = v_item_id
        AND wpi.fmr_project_id = upd.fmr_project_id
    ) THEN
      RAISE EXCEPTION 'Work Plan item % is not part of this progress update', v_item_id;
    END IF;

    v_item_ids := array_append(v_item_ids, v_item_id);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.progress_update_items pui
    WHERE pui.progress_update_id = p_progress_update_id
      AND NOT (pui.work_plan_item_id = ANY(v_item_ids))
  ) THEN
    RAISE EXCEPTION 'Engineer quantities must include every submitted progress item';
  END IF;

  IF EXISTS (
    WITH submitted AS (
      SELECT
        (value->>'work_plan_item_id')::bigint AS work_plan_item_id,
        (value->>'engineer_validated_quantity')::numeric AS qty
      FROM jsonb_array_elements(p_items)
    ),
    previous AS (
      SELECT
        pui.work_plan_item_id,
        sum(pui.engineer_validated_quantity) AS qty
      FROM public.progress_update_items pui
      JOIN public.progress_updates pu ON pu.id = pui.progress_update_id
      WHERE pu.fmr_project_id = upd.fmr_project_id
        AND pu.status = 'approved'
      GROUP BY pui.work_plan_item_id
    )
    SELECT 1
    FROM public.work_plan_items wpi
    JOIN submitted ON submitted.work_plan_item_id = wpi.id
    LEFT JOIN previous ON previous.work_plan_item_id = wpi.id
    WHERE wpi.fmr_project_id = upd.fmr_project_id
      AND COALESCE(previous.qty, 0) + submitted.qty > wpi.planned_quantity
  ) THEN
    RAISE EXCEPTION 'Cumulative engineer validated quantity cannot exceed planned quantity';
  END IF;

  -- Thesis/system calculation: unweighted average of all Work Plan activity
  -- percentages because cost-weighted activity data is not represented.
  WITH submitted AS (
    SELECT
      (value->>'work_plan_item_id')::bigint AS work_plan_item_id,
      (value->>'engineer_validated_quantity')::numeric AS qty
    FROM jsonb_array_elements(p_items)
  ),
  previous AS (
    SELECT
      pui.work_plan_item_id,
      sum(pui.engineer_validated_quantity) AS qty
    FROM public.progress_update_items pui
    JOIN public.progress_updates pu ON pu.id = pui.progress_update_id
    WHERE pu.fmr_project_id = upd.fmr_project_id
      AND pu.status = 'approved'
    GROUP BY pui.work_plan_item_id
  ),
  checked AS (
    SELECT
      wpi.id,
      wpi.planned_quantity,
      COALESCE(previous.qty, 0) + submitted.qty AS cumulative_qty
    FROM public.work_plan_items wpi
    JOIN submitted ON submitted.work_plan_item_id = wpi.id
    LEFT JOIN previous ON previous.work_plan_item_id = wpi.id
    WHERE wpi.fmr_project_id = upd.fmr_project_id
  )
  SELECT avg((cumulative_qty / planned_quantity) * 100)
    INTO v_certified_accomplishment
  FROM checked;

  UPDATE public.progress_update_items pui
  SET engineer_validated_quantity = submitted.qty
  FROM (
    SELECT
      (value->>'work_plan_item_id')::bigint AS work_plan_item_id,
      (value->>'engineer_validated_quantity')::numeric(12,4) AS qty
    FROM jsonb_array_elements(p_items)
  ) submitted
  WHERE pui.progress_update_id = p_progress_update_id
    AND pui.work_plan_item_id = submitted.work_plan_item_id;

  UPDATE public.progress_updates
  SET certification_status     = 'certified',
      certified_accomplishment = v_certified_accomplishment,
      certification_remarks    = p_remarks,
      certified_by             = auth.uid(),
      certified_at             = now()
  WHERE id = p_progress_update_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

-- 13. New RPC execute grants ------------------------------------------------

REVOKE ALL ON FUNCTION public.save_work_plan_draft(bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_work_plan(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_progress_update_with_quantities(bigint, date, date, text, jsonb, boolean, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.certify_progress_with_quantities(uuid, jsonb, text, boolean, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_work_plan_draft(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_work_plan(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_progress_update_with_quantities(bigint, date, date, text, jsonb, boolean, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.certify_progress_with_quantities(uuid, jsonb, text, boolean, boolean) TO authenticated;

-- Keep sequence usage available only where needed through controlled RPCs.
REVOKE ALL ON SEQUENCE public.work_plan_items_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.progress_update_items_id_seq FROM PUBLIC, anon, authenticated;

-- ============================================================
-- End Phase 1.
-- ============================================================
