# KalsaTrack — Architecture Review

> Part of the KalsaTrack architecture set. See [SYSTEM_ARCHITECTURE.md §0](SYSTEM_ARCHITECTURE.md#0-how-to-read-this-document-set) for the evidence labels.
>
> **Scope and method.** Static review of the repository at branch `feature/polygon-map` (base `22b5cd3` plus working-tree changes) on 2026-10-13. No code was executed against Supabase. Security findings are derived from the **latest definitions in the SQL scripts**. Each one must be confirmed against the live database with the read-only queries in [§7](#7-read-only-verification-queries) before it is reported as a live vulnerability.

---

## 1. Executive summary

KalsaTrack is a thick-client PWA on Supabase. Its central design idea is to put the business rules **inside PostgreSQL**: guarded RPC functions, invariant triggers, append-only audit logs and RLS. For the core accountability workflows (citizen reports, repair verification, contractor progress and payment tranches) this is implemented carefully. State machines are explicit, segregation of duties is enforced by the database, and evidence (GPS-tagged, hash-fingerprinted photos) is required where it matters.

The main weaknesses are in **database governance and the edges of the permission model**:

1. There is no ordered migration system, so the deployed schema cannot be reproduced or verified from the repository.
2. Several older, permissive RLS policies were never replaced (project routes, LGU proposals, road gaps, notifications, profiles).
3. Some authorization helpers trust client-editable JWT metadata.
4. Self-service profile updates can change a user's own role to non-privileged staff roles such as `lgu`.

On the frontend, the admin dashboard has become a 10,000-line module, and there is no error boundary and no automated test coverage for SQL.

| Area | Rating | Basis |
|---|---|---|
| Workflow integrity (reports, repairs, progress, tranches) | **Strong** | §2 |
| Evidence and transparency (photo attestation, citizen views) | **Strong** | §2 |
| Offline resilience | **Good** | §2, R-05 |
| Authorization outside the core workflows | **Weak** | F-01 to F-07 |
| Schema governance and reproducibility | **Weak** | F-08, F-09 |
| Frontend maintainability | **Fair** | F-14, F-15 |
| Test and operational maturity | **Fair** | F-16, F-19 |

---

## 2. Architectural strengths

| # | Strength | Evidence |
|---|---|---|
| S-1 | **Rules enforced in the database, not the UI.** Every workflow transition is a `SECURITY DEFINER` RPC that checks role, assignment and current state, so calling the REST API directly cannot skip steps. | [supabase_public_report_workflow_rpcs.sql](../../supabase_public_report_workflow_rpcs.sql) (e.g. `:503`, `:646`, `:1011`) |
| S-2 | **Segregation of duties in SQL.** An inspector cannot validate their own inspection; whoever completes a repair cannot verify it; a contractor cannot certify their own submission; approval requires prior engineer certification; tranche release requires verified progress. | [workflow_rpcs.sql:851](../../supabase_public_report_workflow_rpcs.sql#L851), [repair_actions.sql:482](../../supabase_public_report_repair_actions.sql#L482), [progress_workflow_integrity_migration.sql:140,376](../../supabase_progress_workflow_integrity_migration.sql#L140) |
| S-3 | **Tamper-evident audit trail.** `public_report_activity_logs` has BEFORE UPDATE / DELETE triggers that block changes; approved progress updates and finalized Work Plans are immutable. | [supabase_public_report_workflow_foundation.sql](../../supabase_public_report_workflow_foundation.sql), [work_plan_quantity_reporting_phase1.sql:82-134](../../supabase_work_plan_quantity_reporting_phase1.sql#L82-L134) |
| S-4 | **Defence-in-depth on citizen inserts.** The RLS `WITH CHECK` plus a BEFORE INSERT trigger together neutralise forged workflow fields and identity. | [rls_hardening.sql:77-121,369-385](../../supabase_public_report_workflow_rls_hardening.sql#L77-L121) |
| S-5 | **Privacy-aware public projection.** `security_barrier` citizen views omit reporter name and contact details and the identities of staff who acted; `verify_photo_attestation` returns no names or ids. | [rls_hardening.sql:209-319](../../supabase_public_report_workflow_rls_hardening.sql#L209-L319), [supabase_photo_attestations.sql:88](../../supabase_photo_attestations.sql#L88) |
| S-6 | **Credible field evidence.** Geotagged, watermarked, QR-linked, SHA-256-registered photos with a server timestamp; repair verification requires the engineer to be within 500 m of the reported site. | [src/lib/photoAttestation.js](../../src/lib/photoAttestation.js), [repair_verification_hardening.sql:58-138](../../supabase_public_report_repair_verification_hardening.sql#L58-L138) |
| S-7 | **Offline-first capture** with retry and backoff, Background Sync, and page-side replay that uses a fresh session. | [src/lib/offlineSync.js](../../src/lib/offlineSync.js), [src/sw.js](../../src/sw.js) |
| S-8 | **Per-portal session isolation** and a non-persistent helper client for admin-driven sign-up. | [src/lib/supabase.js](../../src/lib/supabase.js) |
| S-9 | **Safe-by-default auth UX.** Auth errors do not reveal whether an account exists; deploy-safe lazy loading. | [src/lib/authErrors.js](../../src/lib/authErrors.js), [src/lib/lazyPage.js](../../src/lib/lazyPage.js) |
| S-10 | **Change-safety discipline on data repairs.** Risky data scripts come with `_dryrun` and `_rollback` pairs and a pre-flight state-violation check. | e.g. [supabase_public_report_repair_actions_dryrun.sql](../../supabase_public_report_repair_actions_dryrun.sql), [workflow_rpcs.sql:21](../../supabase_public_report_workflow_rpcs.sql#L21) |
| S-11 | **Testable pure domain modules** (19 test files) covering scoring, scheduling, status mapping, offline queue, GPS and camera hooks. | [src/lib/__tests__/](../../src/lib/__tests__/) |

---

## 3. Architectural weaknesses (summary)

| # | Weakness | Consequence |
|---|---|---|
| W-1 | No migration framework; 80 unordered root-level scripts, some redefining the same function up to 4 times | Live schema cannot be reproduced or audited; risk of an older definition overwriting a fix |
| W-2 | Permission model is uneven: very strict for core workflows, permissive for peripheral tables | Integrity of peripheral data (routes, proposals, gaps) depends on users behaving well |
| W-3 | Mixed role sources (`profiles.role` versus JWT `user_metadata`) | Authorization can be influenced by client-editable data |
| W-4 | Monolithic pages (`Dashboard.jsx` 10,004 lines; `LguDashboard.jsx` 2,894) | Hard to review, test and change safely |
| W-5 | Text foreign keys and polymorphic ids without constraints | Orphaned or mismatched references are possible |
| W-6 | Strong vendor coupling (Supabase-specific RLS, auth schema, storage) | Migration away from Supabase would be costly (accepted trade-off) |
| W-7 | Reliance on free public services (OSRM demo server, Nominatim) | Rate limits or usage-policy blocks in production |

---

## 4. Findings

Severity: **High** = can let an ordinary user change or access data outside their role; **Medium** = integrity, privacy or reliability risk with limited reach; **Low** = hygiene or maintainability. Status: **Confirmed-in-repo** = the latest script definitions produce the issue; live state unverified.

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| **F-01** | **High** | **Self-assigned staff role.** The `profiles` UPDATE policy lets a user update their own row (`auth.uid() = id`). The `protect_privileged_profile_roles` trigger only blocks `admin` and `field_engineer`. A signed-in citizen can therefore run `update profiles set role='lgu', municipality='<X>' where id = auth.uid()` and gain LGU-scoped access (farmer beneficiaries including RSBSA numbers and phone numbers, harvest logs, escalations, municipality reports). The same applies to `contractor`. | [supabase_fix_missing_fe_profiles.sql:57-61](../../supabase_fix_missing_fe_profiles.sql#L57-L61); [supabase_final_workflow_security_hardening.sql:436-441](../../supabase_final_workflow_security_hardening.sql#L436-L441); no column-level `GRANT`/`REVOKE` on `profiles` found | Confirmed-in-repo |
| **F-01b** | **High** | **Admin check trusts client metadata.** `is_admin_jwt()` returns true when `user_metadata.role = 'admin'`, and any user can set that with `auth.updateUser({data:{role:'admin'}})`. It is used in the `profiles` UPDATE / INSERT / DELETE policies (so the user can edit or delete **any** profile, e.g. demote real admins to `user`), in `citizen_confirmations_select`, and in policies in `supabase_tighten_citizen_rls.sql` and `supabase_feedbacks_community_view.sql`. | [supabase_complete_fe_setup.sql:83-90](../../supabase_complete_fe_setup.sql#L83-L90); [supabase_fix_missing_fe_profiles.sql:57-71](../../supabase_fix_missing_fe_profiles.sql#L57-L71); [supabase_citizen_fix_confirmation.sql:78](../../supabase_citizen_fix_confirmation.sql#L78); [supabase_tighten_citizen_rls.sql:20-34](../../supabase_tighten_citizen_rls.sql#L20-L34) | Confirmed-in-repo |
| **F-02** | **High** | **LGU proposals open to every signed-in user.** `lgu_project_proposals_rw`, `lgu_project_proposal_activity_logs_rw` and `lgu_project_alert_logs_rw` are `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Any citizen or farmer can read, edit, approve (by setting `status='Approved'` directly) or delete proposals and forge their activity logs, bypassing the admin-only review RPCs. | [supabase_lgu_project_proposals_migration.sql:112-118](../../supabase_lgu_project_proposals_migration.sql#L112-L118); [supabase_lgu_role_additive.sql:77](../../supabase_lgu_role_additive.sql#L77) | Confirmed-in-repo |
| **F-03** | **High** | **Project route geometry is writable by anonymous users.** `"Anyone can insert/update/delete project_routes"` is granted to `anon, authenticated`. The public map's road lines can be altered or erased without signing in. | [supabase_project_routes_migration.sql:34-45](../../supabase_project_routes_migration.sql#L34-L45) | Confirmed-in-repo |
| **F-04** | Medium | `road_network_gaps_write_authenticated` (`FOR ALL … USING (true)`) lets any signed-in user change the gap analysis that feeds admin priority scoring. | [supabase_leon_road_network_gaps.sql:108-112](../../supabase_leon_road_network_gaps.sql#L108-L112) | Confirmed-in-repo |
| **F-05** | Medium | **Notification spoofing.** `notifications_insert_authenticated` only checks `auth.uid() is not null`, so any user can insert a notification addressed to any other user (in-app phishing). | [rls_hardening.sql:535-537](../../supabase_public_report_workflow_rls_hardening.sql#L535-L537) | Confirmed-in-repo |
| **F-06** | Medium | **Self-registration as a farmer.** `handle_new_user()` grants `role='farmer'` whenever sign-up metadata says so. Because sign-up is public, anyone can create a farmer account through the API without LGU provisioning. | [supabase_farmer_profile_trigger_migration.sql:21-29](../../supabase_farmer_profile_trigger_migration.sql#L21-L29) | Confirmed-in-repo |
| **F-07** | Low | `current_profile_role()` falls back to JWT `user_metadata.role` when the profile role is `NULL` (the role constraint allows `NULL`). It is used by about 86 policy and function references. | [supabase_farmer_beneficiaries_migration.sql:50-62](../../supabase_farmer_beneficiaries_migration.sql#L50-L62) | Confirmed-in-repo; exploitable only if a profile has `NULL` role |
| **F-08** | **High (process)** | **No migration history / schema drift.** 80 scripts with no ordering. Functions are redefined in several files: `approve_progress_update_admin` ×4, `create_field_engineer_profile` ×4, `certify_progress_update_engineer` ×3, `reject_progress_update_admin` ×3, `finalize_work_plan` ×3. Re-running an older script silently reverts security fixes. | `grep "function public.<name>"` across `supabase_*.sql`; see [DATABASE_ERD.md §6](DATABASE_ERD.md#6-rpc-function-catalogue) | Verified |
| **F-09** | Medium | **Live objects missing from the repo.** The `auth.users` trigger that calls `handle_new_user()` is not created in any script, and the `progress-photos` bucket insert is commented out. A fresh environment built from the repo would not work. | [supabase_farmer_profile_trigger_migration.sql:3-6](../../supabase_farmer_profile_trigger_migration.sql#L3-L6) (comment confirms it exists live); [supabase_contractor_migration.sql:127](../../supabase_contractor_migration.sql#L127) | Verified |
| **F-10** | Medium | **Legacy `projects` table still in use** alongside `fmr_projects`, with authenticated insert / update / delete policies. Two sources of "project" data. | [src/pages/Dashboard.jsx:1173,3290,3308](../../src/pages/Dashboard.jsx#L1173); [src/pages/UserFeedback.jsx:316](../../src/pages/UserFeedback.jsx#L316); [supabase_fix_projects_rls.sql](../../supabase_fix_projects_rls.sql) | Verified |
| **F-11** | Medium | **Referential integrity gaps.** `public_reports.project_id`, `public_report_lgu_escalations.project_id` and `farmer_beneficiaries.linked_project_id` are `text` pointing to `fmr_projects.id` (`bigint`) with no FK. | [DATABASE_ERD.md §5.2](DATABASE_ERD.md#52-logical-relationships-without-foreign-keys) | Verified |
| **F-12** | Medium (thesis validity) | **Priority scoring uses simulated crop data.** `SIMULATED_CROP_DATA` (hard-coded scores for Iloilo municipalities) feeds the admin Priority tab and proposal ranking. Results must be presented as illustrative until real data replaces it. | [src/lib/priorityScoring.js:12-38](../../src/lib/priorityScoring.js#L12-L38); used by [PriorityTab.jsx:7](../../src/components/admin/PriorityTab.jsx#L7), [LguProposalsTab.jsx:11](../../src/components/admin/LguProposalsTab.jsx#L11) | Verified |
| **F-13** | Low | **Client "on-site" label always discarded.** The client computes `Verified On-Site` (≤100 m), but the insert trigger downgrades it to `Needs Review` for every non-admin. Correct as a security measure, but the client logic is misleading and the 100 m rule effectively has no effect. | [src/lib/reportSubmission.js:67-73](../../src/lib/reportSubmission.js#L67-L73); [rls_hardening.sql:101-103](../../supabase_public_report_workflow_rls_hardening.sql#L101-L103) | Verified |
| **F-14** | Medium | **Monolithic modules.** `Dashboard.jsx` is 10,004 lines and contains 9 realtime channels, account creation, project CRUD and many tabs. | `wc -l src/pages/*.jsx` | Verified |
| **F-15** | Low | **No React error boundary.** A render-time exception blanks the whole portal. | No `componentDidCatch` or `errorElement` in `src/` | Verified |
| **F-16** | Medium | **No automated tests for database logic** (RLS, RPCs, triggers) and **no CI**. The most security-critical code is untested. | No `.github/`, no pgTAP; manual scripts [verify_progress_workflow.sql](../../verify_progress_workflow.sql), [supabase_public_report_security_verification.sql](../../supabase_public_report_security_verification.sql) | Verified |
| **F-17** | Low | **Non-atomic account provisioning.** `signUp` followed by a separate profile RPC; on failure an orphaned `user`-role account remains. | [src/pages/Dashboard.jsx:8285-8322,8493](../../src/pages/Dashboard.jsx#L8285) | Verified |
| **F-18** | Low | **Configuration hygiene.** `.env` defines `VITE_SUPABASE_KEY`, but the code reads `VITE_SUPABASE_ANON_KEY` (supplied only by `.env.local`). `vercel` CLI is listed as a runtime dependency. The README is still the Vite template. Neither `.env` nor `.env.local` is tracked by git (good). | [src/lib/supabase.js:4](../../src/lib/supabase.js#L4); [package.json](../../package.json); [README.md](../../README.md) | Verified |
| **F-19** | Low | **No security headers.** `vercel.json` sets no CSP, `X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy`. | [vercel.json](../../vercel.json) | Verified |
| **F-20** | Medium | **Third-party free endpoints in production paths.** The OSRM public demo server and Nominatim have strict usage policies (Nominatim: about 1 request/second, identifying User-Agent required). | [src/lib/mapRouteUtils.js](../../src/lib/mapRouteUtils.js), [src/lib/placeSearch.js](../../src/lib/placeSearch.js) | Verified usage; **[Inferred]** policy impact |

---

## 5. Risks

| ID | Risk | Likelihood | Impact | Related | Mitigation |
|---|---|---|---|---|---|
| R-01 | Unauthorized role elevation leads to disclosure of farmer PII (Data Privacy Act RA 10173 exposure) | Medium | High | F-01, F-01b, F-07 | Rec. 1–2 |
| R-02 | Public map or proposal data vandalised, undermining the transparency claim | Medium | High | F-02, F-03, F-04 | Rec. 3 |
| R-03 | A deployment reverts a security fix because an old script is re-run | Medium | High | F-08 | Rec. 4 |
| R-04 | Cannot rebuild the system (disaster recovery, new environment, panel demo) from the repo | Medium | High | F-08, F-09 | Rec. 4 |
| R-05 | Service-worker replay uses the JWT stored at queue time. If the access token has expired (Supabase default is about 1 hour), Background-Sync uploads fail until the page itself replays with a fresh session. After 5 failures the item stops retrying. | Medium | Medium | [src/sw.js:150-155](../../src/sw.js#L150-L155), [src/lib/offlineSync.js:11](../../src/lib/offlineSync.js#L11) | Rec. 9 |
| R-06 | Free routing or geocoding services throttle or block the app | Medium | Medium | F-20 | Rec. 10 |
| R-07 | Single Supabase project for dev and prod: testing pollutes production data (the purge script shows this has already happened) | High | Medium | [supabase_purge_test_public_reports.sql](../../supabase_purge_test_public_reports.sql) | Rec. 4 |
| R-08 | Exact GPS of anonymous reports and public photo buckets reveal where and when a person stood | Low | Medium | `public_reports_citizen_view`, public buckets | Privacy notice (exists: [src/pages/LegalPage.jsx](../../src/pages/LegalPage.jsx)); consider coarsening coordinates for anonymous reports |
| R-09 | Changes to the 10k-line dashboard introduce regressions | High | Medium | F-14, F-16 | Rec. 6–7 |

---

## 6. Recommendations (prioritised)

All items are **[Recommendation]**; none have been applied.

| # | Priority | Action | Addresses |
|---|---|---|---|
| 1 | **Immediate** | Restrict `profiles` updates. Either extend `protect_privileged_profile_roles` to block **any** `role` or `municipality` change by non-admins, or drop the generic UPDATE policy and expose a `update_my_profile(full_name, phone)` RPC. Replace every `is_admin_jwt()` use with `current_profile_role() = 'admin'`, then drop `is_admin_jwt()`. | F-01, F-01b |
| 2 | Immediate | Remove the `user_metadata` fallback from `current_profile_role()`; make `profiles.role` `NOT NULL DEFAULT 'user'`. | F-07 |
| 3 | Immediate | Replace the permissive policies: `project_routes` (read for all, write admin), `lgu_project_proposals` (LGU insert / update own `Submitted`/`Needs Revision` rows in own municipality; status changes only through RPC; admin read all), `…_activity_logs` (insert through RPC only), `road_network_gaps` (admin write), `notifications` (insert through triggers / `SECURITY DEFINER` only). | F-02 to F-05 |
| 4 | High | Adopt the Supabase CLI migration workflow: `supabase db pull` the live schema as a baseline into `supabase/migrations/`, archive the root scripts, keep one definition per function, and add a staging project. | F-08, F-09, R-03, R-04, R-07 |
| 5 | High | Add database tests (pgTAP or SQL assertions run in CI against a local Supabase) for every RPC guard and the policy matrix in [SOFTWARE_ARCHITECTURE.md §5.3](SOFTWARE_ARCHITECTURE.md#53-role-based-access-and-permission-matrix). Add a GitHub Actions workflow running `lint`, `test` and `build`. | F-16 |
| 6 | Medium | Split `Dashboard.jsx` into per-tab route modules (as the farmer portal already does with nested routes) and move data access into `src/services/*` like `publicReportWorkflow.js`. | F-14 |
| 7 | Medium | Add a top-level error boundary per portal layout with a "reload" action. | F-15 |
| 8 | Medium | Migrate the remaining reads from `projects` to `fmr_projects`, then drop `projects`. Convert text project ids to `bigint` FKs. | F-10, F-11 |
| 9 | Medium | Before Background-Sync replay, ask an open client page for a fresh token (`postMessage`), or refresh using a stored refresh token; keep failed items visible for manual retry. | R-05 |
| 10 | Medium | Self-host OSRM / Nominatim or use a keyed provider; cache geocoding results; set an identifying User-Agent / `Referer`. | F-20 |
| 11 | Low | Gate farmer self-sign-up: accept `farmer` only when an LGU-issued invite token or an admin/LGU caller is present (e.g. move provisioning into a `SECURITY DEFINER` RPC that sets the role after `signUp`). | F-06 |
| 12 | Low | Add security headers in `vercel.json`; fix `.env` naming; move `vercel` to devDependencies; replace the README with project documentation linking to this folder. | F-18, F-19 |
| 13 | Low | Replace `SIMULATED_CROP_DATA` with `farmer_beneficiaries` / `farmer_harvest_logs` aggregates, or label the Priority tab as illustrative. | F-12 |
| 14 | Low | Remove or re-purpose the client `Verified On-Site` computation, or compute the label server-side in the insert trigger from the report and project coordinates. | F-13 |

---

## 7. Read-only verification queries

These are `SELECT`-only catalogue queries. They change nothing. Run them in the Supabase SQL editor to confirm or close each finding against the live database.

```sql
-- F-01 / F-01b / F-07: current profiles policies and helper definitions
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'profiles';

select proname, pg_get_functiondef(oid)
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('is_admin_jwt', 'current_profile_role', 'protect_privileged_profile_roles');

-- F-02 / F-03 / F-04 / F-05: broad policies still present?
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by tablename, policyname;

-- F-08: which version of each multiply-defined function is live
select proname, md5(pg_get_functiondef(oid)) as body_hash
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('approve_progress_update_admin', 'reject_progress_update_admin',
                  'certify_progress_update_engineer', 'finalize_work_plan',
                  'create_field_engineer_profile');

-- F-09: triggers on auth.users and the progress-photos bucket
select tgname, tgrelid::regclass, pg_get_triggerdef(oid)
from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- F-10: is the legacy table still populated?
select count(*) as legacy_projects from public.projects;

-- F-11: orphaned text references
select count(*) as orphan_reports
from public.public_reports r
where r.project_id is not null and r.project_id ~ '^\d+$'
  and not exists (select 1 from public.fmr_projects p where p.id = r.project_id::bigint);

-- General: tables without RLS
select c.relname from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity;
```

---

## 8. Inconsistencies between the code and the database scripts

| # | Inconsistency | Evidence |
|---|---|---|
| I-1 | The client labels reports `Verified On-Site`; the database always rewrites this for non-admins | F-13 |
| I-2 | `handle_new_user()` is defined in the scripts, but its trigger is not | F-09 |
| I-3 | `progress-photos` bucket used by code ([ContractorProgressForm.jsx:296](../../src/pages/ContractorProgressForm.jsx#L296)); creation commented out in SQL | F-09 |
| I-4 | `Under Validation` proposal status is allowed by the `CHECK` constraint and displayed in the UI, but nothing sets it | [SYSTEM_WORKFLOWS.md WF-6](SYSTEM_WORKFLOWS.md#wf-6-lgu-project-proposal) |
| I-5 | `.env` key name differs from what the code reads | F-18 |
| I-6 | `FieldEngineerAuth.jsx` calls `create_field_engineer_profile`, which the latest definition restricts to admins, so the call fails for a non-admin | [DATABASE_ERD.md §6.3](DATABASE_ERD.md#63-proposals-accounts-and-utilities) |
| I-7 | `fmr_projects.target_completion_date` and `date_completed` are `text`, while scheduling tables use `date` | [supabase_fmr_projects_migration.sql:9-30](../../supabase_fmr_projects_migration.sql#L9-L30) |

### 8.1 Corrections made during this analysis

For transparency, two preliminary observations from the exploration phase were withdrawn after closer reading:

- "`maintenance` table lacks RLS": `maintenance` is a private **schema** created by a purge script, not an application table.
- "Some storage buckets are not created in SQL": five of the six buckets are created in SQL; only `progress-photos` is not (I-3).

---

## 9. Technical debt register

| Item | Type | Effort | Notes |
|---|---|---|---|
| Migration baseline + CLI workflow | Process | M | Unblocks most other database fixes |
| RLS tightening (Rec. 1–3) | Security | S–M | Small SQL changes; needs tests (Rec. 5) |
| SQL test suite + CI | Quality | M | |
| Split `Dashboard.jsx` / `LguDashboard.jsx` | Maintainability | L | Do incrementally, tab by tab |
| Retire `projects`; typed FKs | Data | M | Needs data cleanup first (query in §7) |
| Error boundaries | Reliability | S | |
| Replace simulated crop data | Data validity | M | Depends on beneficiary and harvest data quality |
| Self-host or keyed geo services | Ops | M | |
| Documentation (README, this folder) | Docs | S | This document set is the first step |
