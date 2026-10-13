# KalsaTrack — System Workflows

> Part of the KalsaTrack architecture set. See [SYSTEM_ARCHITECTURE.md §0](SYSTEM_ARCHITECTURE.md#0-how-to-read-this-document-set) for the evidence labels. Unless marked otherwise, every step below is **[Verified]** against the cited function or file.

| # | Workflow | Primary actors |
|---|---|---|
| WF-1 | [Citizen road report submission (online and offline)](#wf-1-citizen-road-report-submission) | Citizen, Farmer, Anonymous |
| WF-2 | [Report triage, inspection and resolution](#wf-2-report-triage-inspection-and-resolution) | Admin, Field Engineer |
| WF-3 | [Repair follow-up, verification and citizen confirmation](#wf-3-repair-follow-up-verification-and-citizen-confirmation) | Admin, Field Engineer, Citizen |
| WF-4 | [LGU escalation](#wf-4-lgu-escalation) | Admin, LGU |
| WF-5 | [Work Plan, contractor progress, certification and tranche release](#wf-5-work-plan-contractor-progress-certification-and-tranche-release) | Admin, Contractor, Site Engineer |
| WF-6 | [LGU project proposal](#wf-6-lgu-project-proposal) | LGU, Admin |
| WF-7 | [Staff and farmer account provisioning](#wf-7-staff-and-farmer-account-provisioning) | Admin, LGU |
| WF-8 | [Photo attestation and public verification](#wf-8-photo-attestation-and-public-verification) | All capturers, Public |
| WF-9 | [Notifications](#wf-9-notifications) | System |

---

## 0. Data flow diagrams

### 0.1 Level 0 (context)

```mermaid
flowchart LR
    Cit[Citizen / Farmer] -- "report, photo, GPS,<br/>support, confirmation" --> P0((KalsaTrack))
    P0 -- "report status, notifications,<br/>project progress" --> Cit
    FE[Field Engineer] -- "inspection findings, visit GPS,<br/>repair evidence, certification" --> P0
    P0 -- "assignments, routed submissions" --> FE
    Con[Contractor] -- "quantity progress, photos, remarks" --> P0
    P0 -- "approval decisions, reports on projects" --> Con
    LGU[LGU] -- "proposals, beneficiaries, markets,<br/>escalation decisions" --> P0
    P0 -- "escalations, analytics" --> LGU
    Adm[DA Admin] -- "triage, approvals, projects,<br/>work plans, tranche releases" --> P0
    P0 -- "queues, analytics, audit trail" --> Adm
    Pub[Public] -- "verification code" --> P0
    P0 -- "public reports, attestation record" --> Pub
```

### 0.2 Level 1

```mermaid
flowchart TB
    Cit[Citizen / Farmer]
    FE[Field Engineer]
    Con[Contractor]
    LGU[LGU]
    Adm[Admin]

    P1((1.0<br/>Capture &<br/>submit report))
    P2((2.0<br/>Triage &<br/>inspect))
    P3((3.0<br/>Resolve &<br/>repair follow-up))
    P4((4.0<br/>Plan & report<br/>project progress))
    P5((5.0<br/>Certify, approve<br/>& release funds))
    P6((6.0<br/>Propose &<br/>review projects))
    P7((7.0<br/>Attest &<br/>verify photos))
    P8((8.0<br/>Notify))

    D1[(D1 public_reports<br/>+ workflow tables)]
    D2[(D2 activity_logs<br/>append-only)]
    D3[(D3 fmr_projects ·<br/>work_plan_items · tranches)]
    D4[(D4 progress_updates<br/>+ items)]
    D5[(D5 lgu_project_proposals)]
    D6[(D6 photo_attestations)]
    D7[(D7 notifications)]
    S1[(S1 Storage buckets)]
    Q1[(Q1 IndexedDB queue)]

    Cit --> P1
    P1 --> S1 & D1
    P1 -. offline .-> Q1 -. replay .-> P1
    P1 --> P7
    Adm --> P2
    FE --> P2
    P2 <--> D1
    P2 --> D2
    Adm --> P3
    FE --> P3
    Cit -- confirmation --> P3
    P3 <--> D1
    P3 --> D2
    Adm -- Work Plan --> P4
    Con -- quantities --> P4
    P4 <--> D3
    P4 --> D4
    FE -- certify --> P5
    Adm -- approve / release --> P5
    P5 <--> D4
    P5 --> D3
    LGU --> P6
    Adm --> P6
    P6 <--> D5
    P6 -- publish --> D3
    P7 <--> D6
    D1 & D4 & D3 & D5 -- triggers --> P8 --> D7
    D7 -- realtime --> Cit & FE & Con & LGU & Adm
```

---

## WF-1. Citizen road report submission

**Entry points:** [src/components/PublicReportForm.jsx](../../src/components/PublicReportForm.jsx), used from the citizen and farmer portals. Steps: Locating → Picking (nearby project) → Classify → Reporting → Success ([src/components/publicReports/reportForm/](../../src/components/publicReports/reportForm/)).

**Rules:**

- A project counts as nearby within 250 m of its midpoint or 150 m of an endpoint, with a 1 km "wider" fallback ([src/lib/reportSubmission.js:9-11](../../src/lib/reportSubmission.js#L9-L11)).
- Required: category, description, photo, project, GPS ([:76-84](../../src/lib/reportSubmission.js#L76-L84)).

```mermaid
sequenceDiagram
    autonumber
    actor C as Citizen
    participant F as PublicReportForm
    participant A as photoAttestation
    participant IDB as IndexedDB queue
    participant ST as Storage<br/>public-report-photos
    participant DB as Postgres
    participant SW as Service Worker

    C->>F: Allow GPS, choose project, classify, take photo
    F->>F: validateReportInput() · computeVerification()
    F->>A: attestPhoto(blob, {gps, time, label})
    A-->>F: stamped JPEG + {code, sha256}
    alt Online
        F->>ST: upload(reports/<ts>_<id>.jpg)
        F->>DB: insert public_reports {..., photo_url}
        Note over DB: BEFORE INSERT trigger<br/>status := 'pending', clears workflow fields,<br/>user_id := auth.uid(),<br/>'Verified On-Site' → 'Needs Review'<br/>then RLS WITH CHECK
        F->>DB: rpc register_photo_attestation(code, sha256, …)
        F-->>C: Success (reference number)
    else Offline or network failure
        F->>IDB: enqueueReport(payload, blob, {authToken, attestation})
        F-->>C: Success: "queued, will send when online"
        Note over IDB,SW: Later: 'online' event, page visible,<br/>or Background Sync 'sync-offline-reports'
        SW->>IDB: getQueuedReports()
        SW->>ST: upload photo (Bearer stored token)
        SW->>DB: insert row
        SW->>DB: register_photo_attestation
        SW->>IDB: mark synced / retry with backoff (max 5)
    end
```

Evidence: [PublicReportForm.jsx:192-248](../../src/components/PublicReportForm.jsx#L192-L248), [src/sw.js:158-276](../../src/sw.js#L158-L276), [src/lib/offlineSync.js:11-13,200](../../src/lib/offlineSync.js#L11-L13), [supabase_public_report_workflow_rls_hardening.sql:77-121,369-385](../../supabase_public_report_workflow_rls_hardening.sql#L77-L121).

**Engagement after submission:**

- *Support* ("me too"): any signed-in citizen may support another person's report once (`public_report_supporters`, `citizen_can_support_report`). Milestones notify the reporter ([supabase_report_supporters.sql](../../supabase_report_supporters.sql)).
- *Tracking:* the citizen sees milestone timestamps only, through `public_reports_citizen_view` ([src/lib/useMyReports.js](../../src/lib/useMyReports.js), realtime).

---

## WF-2. Report triage, inspection and resolution

### 2.1 State model

A report has two linked status fields, `status` (admin lifecycle) and `engineer_status` (field lifecycle). The trigger `public_report_enforce_state_invariant` rejects invalid combinations ([…rls_hardening.sql:167-203](../../supabase_public_report_workflow_rls_hardening.sql#L167-L203)).

```mermaid
stateDiagram-v2
    [*] --> pending: citizen insert
    pending --> dismissed: dismiss_public_report<br/>(reason required, no engineer work yet)
    pending --> reviewed: review_public_report<br/>(priority low / medium / urgent)
    reviewed --> dismissed: dismiss_public_report

    state reviewed {
        [*] --> unassigned
        unassigned --> assigned: assign_public_report_engineer
        assigned --> unassigned: unassign (reason)
        assigned --> in_progress: start_public_report_inspection<br/>(assigned FE only)
        in_progress --> inspected: submit_public_report_inspection<br/>(photo, condition, action, rating 1-5,<br/>GPS, certification)
        inspected --> rejected: reject_public_report_inspection<br/>(reason)
        rejected --> in_progress: start (re-inspection)
        inspected --> validated: validate_public_report_inspection<br/>(admin, not the inspector)
    }

    reviewed --> resolved: resolve_public_report<br/>(requires validated latest inspection,<br/>summary, resolution_type)
    dismissed --> [*]
    resolved --> [*]
```

`resolution_type` ∈ `repaired`, `scheduled_for_repair`, `referred_to_contractor`, `monitoring_required`, `no_action_required`, `outside_project_scope`, `duplicate_case`, `other` ([supabase_public_report_workflow_rpcs.sql:59-68](../../supabase_public_report_workflow_rpcs.sql#L59-L68)).

### 2.2 Sequence

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    actor E as Field Engineer
    participant UI as Dashboard / FE Dashboard
    participant SVC as publicReportWorkflow.js
    participant RPC as SECURITY DEFINER RPCs
    participant T as Tables + triggers
    participant N as notifications

    A->>UI: Open review queue (realtime 'admin-public-reports-realtime')
    A->>SVC: reviewReport(id, priority, deadline)
    SVC->>RPC: review_public_report
    RPC->>RPC: _public_report_require_admin()
    RPC->>T: status = 'reviewed' · audit log
    A->>SVC: assignEngineer(id, engineerId)
    SVC->>RPC: assign_public_report_engineer
    RPC->>T: engineer_status = 'assigned' · audit
    T->>N: notify engineer
    E->>UI: Open assignment (map, navigation link)
    E->>SVC: startInspection(id, lat, lng)
    SVC->>RPC: start_public_report_inspection
    RPC->>RPC: assigned FE only · no active inspection
    RPC->>T: finding(status='in_progress') · engineer_status='in_progress'
    E->>UI: Capture attested photo, findings, rating, certify
    SVC->>RPC: submit_public_report_inspection
    RPC->>RPC: validate fields, GPS ranges
    RPC->>T: finding 'submitted' · engineer_status='inspected'
    A->>SVC: validateInspection(id, findingId)
    SVC->>RPC: validate_public_report_inspection
    RPC->>RPC: latest submitted · validator ≠ inspector
    RPC->>T: finding 'validated' · engineer_status='validated'
    A->>SVC: resolveReport(id, summary, type)
    SVC->>RPC: resolve_public_report
    RPC->>T: status='resolved' · resolution row · audit
    T->>N: notify reporter
```

Evidence: [src/services/publicReportWorkflow.js](../../src/services/publicReportWorkflow.js), [supabase_public_report_workflow_rpcs.sql:224-1061](../../supabase_public_report_workflow_rpcs.sql#L224). Offline engineer actions are queued through `enqueueEngineerUpdate` ([src/lib/offlineReports.js:97](../../src/lib/offlineReports.js#L97)).

---

## WF-3. Repair follow-up, verification and citizen confirmation

**Purpose:** "resolved" records a **decision**. The repair-action table records whether the work actually **happened** ([supabase_public_report_repair_actions.sql:4](../../supabase_public_report_repair_actions.sql#L4)).

```mermaid
stateDiagram-v2
    [*] --> planned: plan_public_report_repair<br/>(resolution needs follow-up;<br/>party DA / LGU / contractor; target date ≥ today)
    [*] --> completed: plan_… when resolution_type = 'repaired'
    planned --> completed: complete_public_report_repair (note)
    completed --> verified: verify_public_report_repair<br/>after-photo + GPS ≤ 500 m<br/>assigned FE or admin<br/>verifier ≠ completer
    planned --> cancelled: cancel (reason)
    completed --> cancelled: cancel (reason)
    verified --> [*]
    cancelled --> [*]
```

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    actor E as Field Engineer
    actor C as Citizen (reporter)
    participant RV as RepairVerifyPanel
    participant Q as IndexedDB<br/>kalsatrack-repair-evidence
    participant DB as RPC / tables

    A->>DB: plan_public_report_repair(report, party, target)
    A->>DB: complete_public_report_repair(action, note)
    E->>RV: Capture after-photo + GPS on site
    alt offline
        RV->>Q: store evidence
        Q-->>RV: replay when online
    end
    RV->>DB: upload photo · verify_public_report_repair(action, url, lat, lng, acc)
    DB->>DB: distance = _public_report_distance_m(report, gps)
    alt distance > 500 m
        DB-->>RV: exception "Verification location is N m from the reported site"
    else ok
        DB-->>RV: status = 'verified'
    end
    C->>DB: insert citizen_confirmation(is_fixed, comment)
    Note over DB: only the reporter, only when resolved<br/>(citizen_can_confirm_report)
    DB->>DB: trigger notify_citizen_confirmation → staff notified if "not fixed"
```

Evidence: [supabase_public_report_repair_actions.sql:208-567](../../supabase_public_report_repair_actions.sql#L208), [supabase_public_report_repair_verification_hardening.sql:58-150](../../supabase_public_report_repair_verification_hardening.sql#L58), [src/components/publicReports/RepairVerifyPanel.jsx](../../src/components/publicReports/RepairVerifyPanel.jsx), [src/lib/offlineRepairVerifications.js](../../src/lib/offlineRepairVerifications.js), [supabase_citizen_fix_confirmation.sql:32-84](../../supabase_citizen_fix_confirmation.sql#L32-L84).

---

## WF-4. LGU escalation

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    actor L as LGU (same municipality)
    participant DB as Tables (RLS)
    actor C as Citizen

    A->>DB: insert public_report_lgu_escalations<br/>(escalation_status='for_action', reason)
    Note over DB: policy …_insert_admin
    L->>DB: select escalations (…_select_lgu_municipality)
    L->>DB: insert public_report_lgu_decisions (decision, remarks)
    L->>DB: update escalation status / decision fields
    Note over DB: policies scoped by public_report_current_municipality()
    C->>DB: select decisions on own report (…_select_report_owner)
```

Evidence: [src/pages/Dashboard.jsx:2459](../../src/pages/Dashboard.jsx#L2459), [src/components/lgu/LguForActionTab.jsx:14](../../src/components/lgu/LguForActionTab.jsx#L14), [src/components/publicReports/LguEscalationPanel.jsx](../../src/components/publicReports/LguEscalationPanel.jsx), policies in [supabase_public_report_workflow_rls_hardening.sql:542-579](../../supabase_public_report_workflow_rls_hardening.sql#L542-L579). **[Inferred]** Escalation statuses observed in the UI: `for_action`, `more_info_requested`. No `CHECK` constraint on `escalation_status` was found.

---

## WF-5. Work Plan, contractor progress, certification and tranche release

### 5.1 State model

```mermaid
stateDiagram-v2
    direction LR
    state "Work Plan (fmr_projects.work_plan_status)" as WPS {
        [*] --> none
        none --> draft: save_work_plan_draft
        draft --> draft: save_work_plan_draft
        draft --> finalized: finalize_work_plan<br/>(captures adoption baseline;<br/>items locked by trigger)
    }
    state "Progress update (status / certification_status)" as PUS {
        [*] --> pending_routed: submit_progress_update_with_quantities<br/>(trigger routes to site engineer)
        pending_routed --> pending_certified: certify (validated quantities)
        pending_routed --> rejected_disputed: certify → disputed (remarks)
        pending_certified --> approved: approve_progress_update_admin
        pending_routed --> rejected: reject_progress_update_admin
        pending_certified --> rejected: reject_progress_update_admin
        approved --> [*]: immutable (trigger)
    }
```

### 5.2 Sequence

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    actor K as Contractor
    actor S as Site Engineer
    participant DB as RPC / triggers
    participant ST as Storage progress-photos

    A->>DB: assign_project_site_engineer(project, engineer)
    A->>DB: save_work_plan_draft(project, items[])
    A->>DB: finalize_work_plan(project)
    Note over DB: baseline = official accomplishment<br/>work_plan_items now locked
    K->>K: ContractorProgressForm: period, quantities, remarks,<br/>certification, attested photo
    K->>ST: upload photo
    K->>DB: rpc submit_progress_update_with_quantities
    DB->>DB: assigned contractor? plan finalized? valid period?
    DB->>DB: BEFORE INSERT route_progress_update_to_site_engineer<br/>(error if project has no site engineer)
    DB->>DB: AFTER INSERT items → sync_reported_quantity_progress
    DB-->>S: notification (notify_progress_update_events)
    S->>DB: rpc certify_progress_with_quantities(validated qty per item)
    DB->>DB: enforce_site_engineer_certification (routed engineer only, not own submission)<br/>enforce_stored_quantity_progress (all items validated)
    alt disputed
        DB-->>K: status = 'rejected', certification_status = 'disputed'
    else certified
        A->>DB: rpc approve_progress_update_admin
        DB->>DB: must be certified, 0-100 %, baseline present
        DB->>DB: status='approved' · fmr_projects.accomplishment updated
        DB-->>K: notification
    end
    opt Billing hold
        A->>DB: set_billing_hold_admin(update, hold, reason)
    end
    A->>DB: rpc release_project_tranche(tranche, amount)
    DB->>DB: verified progress ≥ required_progress? not already released?
    DB-->>A: tranche released
```

Evidence: [supabase_site_engineer_routing.sql:39-170](../../supabase_site_engineer_routing.sql#L39-L170), [supabase_work_plan_quantity_reporting_phase1.sql:82-473](../../supabase_work_plan_quantity_reporting_phase1.sql#L82), [supabase_final_workflow_security_hardening.sql:62-420](../../supabase_final_workflow_security_hardening.sql#L62-L420), [supabase_progress_workflow_integrity_migration.sql:102-376](../../supabase_progress_workflow_integrity_migration.sql#L102-L376), [src/pages/ContractorProgressForm.jsx:279-324](../../src/pages/ContractorProgressForm.jsx#L279-L324), [src/components/progress/QuantityCertificationReview.jsx](../../src/components/progress/QuantityCertificationReview.jsx).

**Segregation of duties enforced in the database:** the contractor submits, the routed site engineer certifies (and cannot certify their own submission), the admin approves, and the admin releases funds only above the progress gate.

---

## WF-6. LGU project proposal

```mermaid
stateDiagram-v2
    [*] --> Submitted: LGU insert (direct table write)
    Submitted --> Approved: validate_lgu_project_proposal
    Submitted --> Rejected: reject_lgu_project_proposal
    Submitted --> NeedsRevision: request_lgu_project_proposal_revision (notes)
    Under_Validation --> Approved
    Under_Validation --> Rejected
    Under_Validation --> NeedsRevision
    NeedsRevision --> Submitted: LGU edit (revision_count + 1)
    Approved --> Published: Admin creates fmr_projects row,<br/>sets proposal.fmr_project_id,<br/>logs 'published'
    Rejected --> [*]
    Published --> [*]
```

- **[Verified]** Approval does **not** create the project automatically. The admin creates the `fmr_projects` row through the normal project form and the client then links the proposal ([src/pages/Dashboard.jsx:3207-3230](../../src/pages/Dashboard.jsx#L3207-L3230)).
- **[Verified]** Submission and resubmission are direct table writes by the LGU ([src/components/lgu/LguProjectProposalsTab.jsx:436-469](../../src/components/lgu/LguProjectProposalsTab.jsx#L436-L469)). Because of the broad `lgu_project_proposals_rw` policy, these writes are not restricted by role at the database level (see review F-02).
- **[Inferred]** The `Under Validation` status exists in the `CHECK` constraint and the UI, but no code path that sets it was found.

---

## WF-7. Staff and farmer account provisioning

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin (or LGU for farmers)
    participant UI as Dashboard / LguDashboard
    participant H as supabaseAdmin client<br/>(persistSession: false)
    participant AU as Supabase Auth
    participant TR as handle_new_user (trigger)
    participant RPC as create_*_profile RPC

    A->>UI: Fill staff form (name, e-mail or username, password)
    UI->>H: auth.signUp(email, password, metadata)
    H->>AU: create auth.users row
    AU->>TR: AFTER INSERT
    TR->>TR: profiles row: role = 'farmer' if metadata says so, else 'user'
    alt Field engineer / contractor / LGU
        UI->>RPC: create_field_engineer_profile / create_contractor_profile / create_lgu_profile
        RPC->>RPC: caller must be admin
        RPC->>RPC: trigger protect_privileged_profile_roles
        RPC-->>UI: profile role set
    else Farmer (LGU portal)
        Note over UI: synthetic e-mail = username@farmer.kalsatrack.internal
    end
    UI-->>A: Success, or "Account created but profile failed. Run supabase_create_…sql"
```

Evidence: [src/pages/Dashboard.jsx:8285-8667](../../src/pages/Dashboard.jsx#L8285), [src/pages/LguDashboard.jsx:973-1023](../../src/pages/LguDashboard.jsx#L973-L1023), [src/lib/farmerAuth.js](../../src/lib/farmerAuth.js), [supabase_farmer_profile_trigger_migration.sql](../../supabase_farmer_profile_trigger_migration.sql), [supabase_final_workflow_security_hardening.sql:430-472](../../supabase_final_workflow_security_hardening.sql#L430-L472).

**Note:** The two steps (sign-up, then profile RPC) are **not atomic**. If the RPC fails, an auth user is left with role `user`. The UI tells the admin to fix this manually.

---

## WF-8. Photo attestation and public verification

```mermaid
sequenceDiagram
    autonumber
    actor U as Capturer (citizen / FE / contractor)
    participant PA as photoAttestation.js
    participant ST as Storage bucket
    participant DB as register / verify RPC
    actor P as Anyone with the photo
    participant V as /verify/:code

    U->>PA: attestPhoto(blob, {gps, accuracy, time, kind, label})
    PA->>PA: code = 12 random Crockford-base32 chars
    PA->>PA: draw watermark bar + QR(/verify/code) → JPEG
    PA->>PA: sha256 = SHA-256(stamped JPEG)
    U->>ST: upload stamped JPEG
    U->>DB: register_photo_attestation(code, sha256, kind, record_id, bucket, path, gps, captured_at)
    DB->>DB: registered_at = now() (server clock)<br/>reject same code with a different hash
    P->>V: scan QR or type code
    V->>DB: verify_photo_attestation(code)
    DB-->>V: kind, label, gps, captured_at, registered_at, storage path (no names / ids)
    V->>ST: public URL of the original
    V-->>P: show original next to record
    opt Check a file the visitor holds
        P->>V: choose image file (FileCheck)
        V->>V: sha256Hex(file) == record.sha256 ?
        V-->>P: "match" or "mismatch"
    end
```

Evidence: [src/lib/photoAttestation.js](../../src/lib/photoAttestation.js), [supabase_photo_attestations.sql](../../supabase_photo_attestations.sql), [src/pages/VerifyPhotoPage.jsx](../../src/pages/VerifyPhotoPage.jsx), [src/App.jsx:94-95](../../src/App.jsx#L94-L95). Integrated into the citizen report, field inspection, repair verification and contractor progress paths, including offline replay ([src/sw.js:205-227](../../src/sw.js#L205-L227)).

**[Verified] Two levels of checking.** (1) Visual comparison with the stored original. (2) A cryptographic check: the visitor picks a file, the page computes its SHA-256 in the browser and compares it with the registered fingerprint ([src/pages/VerifyPhotoPage.jsx:43-70](../../src/pages/VerifyPhotoPage.jsx#L43-L70)). **[Inferred] Limitation:** any re-compression (for example by a messaging app) changes the hash. A "mismatch" therefore means "not the exact registered file", not necessarily "tampered"; the visual comparison covers that case.

---

## WF-9. Notifications

```mermaid
flowchart LR
    E1[progress_updates insert/update] -->|notify_progress_update_events| N[(notifications)]
    E2[fmr_projects contractor/site engineer change] -->|notify_project_assignment_events| N
    E3[fmr_projects accomplishment change] -->|notify_project_followers| N
    E4[public_report_supporters insert] -->|notify_report_supporter_milestone| N
    E5[citizen confirmation is_fixed] -->|notify_citizen_confirmation| N
    E6[workflow RPCs] -->|direct insert| N
    N -->|Realtime channel notifications-userId| Bell[NotificationBell.jsx]
```

Evidence: trigger list in [DATABASE_ERD.md §7](DATABASE_ERD.md#7-triggers), [src/components/NotificationBell.jsx](../../src/components/NotificationBell.jsx). There is no push, e-mail or SMS delivery: users see notifications only while the app is open.
