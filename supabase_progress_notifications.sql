-- Notifications for the contractor / site engineer / admin progress workflow.
-- Run once in the Supabase SQL editor, after supabase_site_engineer_routing.sql. Safe to re-run.
--
-- Before this, nothing wrote a notification when a progress update changed hands, so the
-- bell stayed empty for contractors. Now:
--   contractor submits          -> the project's site engineer is told there is something to validate
--   engineer certifies          -> the contractor is told, and every admin is told it awaits approval
--   engineer disputes           -> the contractor is told, with the engineer's remarks
--   admin approves / returns    -> the contractor is told
--   contractor assigned         -> the contractor is told
--   site engineer assigned      -> the engineer and the contractor are told
--
-- Notifications are written by triggers, so they cannot be skipped by any screen.

-- --------------------------------------------------------------------- links
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS progress_update_id uuid REFERENCES public.progress_updates(id) ON DELETE SET NULL;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS project_id bigint REFERENCES public.fmr_projects(id) ON DELETE SET NULL;

-- ------------------------------------------------- progress update lifecycle
CREATE OR REPLACE FUNCTION public.notify_progress_update_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
DECLARE
  v_name text;
  v_admin record;
BEGIN
  SELECT project_name INTO v_name FROM public.fmr_projects WHERE id = NEW.fmr_project_id;
  v_name := COALESCE(v_name, 'a project');

  IF TG_OP = 'INSERT' THEN
    IF NEW.site_engineer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, progress_update_id, project_id)
      VALUES (
        NEW.site_engineer_id,
        'progress_update_submitted',
        'Progress to validate',
        format('The contractor reported %s%% on %s. Check it against site conditions, then certify or dispute it.',
               round(COALESCE(NEW.reported_accomplishment, 0), 1), v_name),
        NEW.id, NEW.fmr_project_id
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Certification outcome
  IF NEW.certification_status IS DISTINCT FROM OLD.certification_status THEN
    IF NEW.certification_status = 'certified' THEN
      INSERT INTO public.notifications (user_id, type, title, message, progress_update_id, project_id)
      VALUES (
        NEW.contractor_id,
        'progress_update_certified',
        'Site engineer certified your update',
        format('%s was certified at %s%%. It now waits for DA admin approval.',
               v_name, round(COALESCE(NEW.certified_accomplishment, 0), 1)),
        NEW.id, NEW.fmr_project_id
      );

      FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
        INSERT INTO public.notifications (user_id, type, title, message, progress_update_id, project_id)
        VALUES (
          v_admin.id,
          'progress_update_awaiting_approval',
          'Certified progress awaiting approval',
          format('The site engineer certified %s%% on %s. Review and approve it.',
                 round(COALESCE(NEW.certified_accomplishment, 0), 1), v_name),
          NEW.id, NEW.fmr_project_id
        );
      END LOOP;

    ELSIF NEW.certification_status = 'disputed' THEN
      INSERT INTO public.notifications (user_id, type, title, message, progress_update_id, project_id)
      VALUES (
        NEW.contractor_id,
        'progress_update_disputed',
        'Site engineer disputed your update',
        format('%s: %s Correct the figures and submit a new update.',
               v_name, COALESCE(NULLIF(btrim(NEW.certification_remarks), ''), 'No remarks were given.')),
        NEW.id, NEW.fmr_project_id
      );
    END IF;
  END IF;

  -- Admin decision
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      INSERT INTO public.notifications (user_id, type, title, message, progress_update_id, project_id)
      VALUES (
        NEW.contractor_id,
        'progress_update_approved',
        'Progress update approved',
        format('Your update on %s was approved and the official accomplishment was updated.', v_name),
        NEW.id, NEW.fmr_project_id
      );
    ELSIF NEW.status = 'rejected' AND COALESCE(NEW.certification_status, '') <> 'disputed' THEN
      INSERT INTO public.notifications (user_id, type, title, message, progress_update_id, project_id)
      VALUES (
        NEW.contractor_id,
        'progress_update_rejected',
        'Progress update returned',
        format('%s: %s', v_name, COALESCE(NULLIF(btrim(NEW.approval_remarks), ''), 'The DA office returned this update.')),
        NEW.id, NEW.fmr_project_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_progress_update_events ON public.progress_updates;
CREATE TRIGGER trg_notify_progress_update_events
  AFTER INSERT OR UPDATE ON public.progress_updates
  FOR EACH ROW EXECUTE FUNCTION public.notify_progress_update_events();

-- --------------------------------------------------- project assignment events
CREATE OR REPLACE FUNCTION public.notify_project_assignment_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
BEGIN
  IF NEW.contractor_id IS NOT NULL AND NEW.contractor_id IS DISTINCT FROM OLD.contractor_id THEN
    INSERT INTO public.notifications (user_id, type, title, message, project_id)
    VALUES (
      NEW.contractor_id,
      'project_assigned',
      'New project assigned',
      format('You were assigned to %s%s.', NEW.project_name,
             CASE WHEN NEW.municipality IS NOT NULL THEN ' (' || NEW.municipality || ')' ELSE '' END),
      NEW.id
    );
  END IF;

  IF NEW.site_engineer_id IS NOT NULL AND NEW.site_engineer_id IS DISTINCT FROM OLD.site_engineer_id THEN
    INSERT INTO public.notifications (user_id, type, title, message, project_id)
    VALUES (
      NEW.site_engineer_id,
      'site_engineer_assigned',
      'You are the site engineer',
      format('You were assigned as site engineer for %s. Contractor progress on it will be routed to you.', NEW.project_name),
      NEW.id
    );

    IF NEW.contractor_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, project_id)
      VALUES (
        NEW.contractor_id,
        'project_site_engineer_set',
        'Site engineer assigned',
        format('A site engineer was assigned to %s. You can submit progress updates now.', NEW.project_name),
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_project_assignment_events ON public.fmr_projects;
CREATE TRIGGER trg_notify_project_assignment_events
  AFTER UPDATE OF contractor_id, site_engineer_id ON public.fmr_projects
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_assignment_events();

-- --------------------------------------------------------------- live updates
-- progress_updates was not in the realtime publication, so no screen ever received its changes.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.progress_updates;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Verify:
--   select tgname from pg_trigger where tgname in ('trg_notify_progress_update_events','trg_notify_project_assignment_events');
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'progress_updates';

-- Rollback:
--   DROP TRIGGER IF EXISTS trg_notify_progress_update_events ON public.progress_updates;
--   DROP TRIGGER IF EXISTS trg_notify_project_assignment_events ON public.fmr_projects;
--   DROP FUNCTION IF EXISTS public.notify_progress_update_events();
--   DROP FUNCTION IF EXISTS public.notify_project_assignment_events();
