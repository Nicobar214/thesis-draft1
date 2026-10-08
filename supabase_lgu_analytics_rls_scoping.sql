-- ============================================================
-- LGU Analytics — scope farmer_beneficiaries/farmer_harvest_logs reads
--
-- Pre-existing gap, found while building LGU Analytics (which aggregates
-- exactly this data per-LGU): both SELECT policies below let ANY
-- authenticated user, including every LGU and every other role, read every
-- farmer's record nationwide, not just their own municipality's. Replaces
-- them with the same municipality-scoping idiom already used for
-- fmr_projects / public_report_lgu_escalations, reusing the existing
-- public_report_current_municipality() helper (no duplicate function).
--
-- That helper returns NULL when the LGU's own profile has no municipality
-- set -- the app already treats that as "province-wide LGU, sees all"
-- (LguDashboard.jsx: municipalityScope falsy -> no .eq('municipality', ...)
-- filter applied). Both policies below preserve that exact behavior, plus
-- farmers' own-row access and admin's full access. INSERT/UPDATE/DELETE
-- policies on these tables are untouched -- out of scope.
-- ============================================================

drop policy if exists farmer_beneficiaries_select_self on public.farmer_beneficiaries;
create policy farmer_beneficiaries_select_self
  on public.farmer_beneficiaries for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() = 'lgu'
      and (
        public.public_report_current_municipality() is null
        or farmer_beneficiaries.municipality = public.public_report_current_municipality()
      )
    )
  );

drop policy if exists farmer_harvest_logs_select_all on public.farmer_harvest_logs;
create policy farmer_harvest_logs_select_scoped
  on public.farmer_harvest_logs for select
  to authenticated
  using (
    farmer_id = auth.uid()
    or public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() = 'lgu'
      and (
        public.public_report_current_municipality() is null
        or exists (
          select 1 from public.farmer_beneficiaries fb
          where fb.user_id = farmer_harvest_logs.farmer_id
            and fb.municipality = public.public_report_current_municipality()
        )
      )
    )
  );

-- Verification (run after applying):
-- select policyname, qual from pg_policies where tablename in ('farmer_beneficiaries','farmer_harvest_logs') and cmd = 'r';
