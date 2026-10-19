-- ============================================================
-- LGU proposals: checklist of required supporting documents.
--
-- Replaces the single "SB Resolution / Document" upload with one upload per DA
-- requirement (src/lib/proposalRequirements.js):
--   1. Letter of Intent / LGU Resolution
--   2. Local Road Network Map
--   3. Prioritization Template (Annex B)
--   4. LDIP / AFMP / PCIP Certification
--   5. RDC Endorsement
-- Stored as [{ key, path, name, uploaded_at }]. Older proposals keep their
-- document_url, shown as the Letter of Intent. Safe to re-run.
-- ============================================================

alter table public.lgu_project_proposals
  add column if not exists supporting_documents jsonb not null default '[]'::jsonb;

-- Check: select id, supporting_documents from public.lgu_project_proposals limit 5;
