/*
 * proposalRequirements.js — the DA checklist of required supporting documents
 * for an LGU FMR project proposal (short names; the hint keeps the full meaning).
 * Used by the LGU proposal form and the DA admin review, so both show the same list.
 *
 * Uploaded files are saved in lgu_project_proposals.supporting_documents as
 * [{ key, path, name, uploaded_at }] (supabase_lgu_proposal_requirements.sql).
 */
export const PROPOSAL_REQUIREMENTS = [
  {
    key: 'letter_of_intent',
    label: 'Letter of Intent / LGU Resolution',
    hint: 'States the need to connect the production area to the market through an FMR, endorsed by the LGU.',
  },
  {
    key: 'road_network_map',
    label: 'Local Road Network Map',
    hint: 'Shows the road connects to an equal or higher road class and to a market, trading center or agri facility.',
  },
  {
    key: 'prioritization_template',
    label: 'Prioritization Template (Annex B)',
    hint: 'Accomplished by the LGU/proponent; downloadable from the BAFE website.',
  },
  {
    key: 'ldip_certification',
    label: 'LDIP / AFMP / PCIP Certification',
    hint: 'From the Municipal or Provincial Planning and Development Officer that the FMR is a priority investment.',
  },
  {
    key: 'rdc_endorsement',
    label: 'RDC Endorsement',
    hint: 'From the Regional Development Council that the project is part of the Regional Development Plan.',
  },
];

/** The saved document for a requirement, or null. Older proposals had one "document_url". */
export function findRequirementDoc(proposal, key) {
  const docs = Array.isArray(proposal?.supporting_documents) ? proposal.supporting_documents : [];
  const doc = docs.find((d) => d?.key === key && d?.path);
  if (doc) return doc;
  if (key === 'letter_of_intent' && proposal?.document_url && docs.length === 0) {
    return { key, path: proposal.document_url, name: proposal.document_name || 'Document', legacy: true };
  }
  return null;
}

/** { attached, total } for the checklist summary. */
export function requirementProgress(proposal) {
  const attached = PROPOSAL_REQUIREMENTS.filter((r) => findRequirementDoc(proposal, r.key)).length;
  return { attached, total: PROPOSAL_REQUIREMENTS.length };
}

/**
 * Merges newly uploaded files into the saved list (a new upload replaces the
 * old one for that requirement). uploads: { [key]: { path, name } }.
 */
export function mergeRequirementDocs(existing, uploads, now = new Date().toISOString()) {
  const byKey = new Map((Array.isArray(existing) ? existing : []).filter((d) => d?.key).map((d) => [d.key, d]));
  Object.entries(uploads || {}).forEach(([key, up]) => {
    if (up?.path) byKey.set(key, { key, path: up.path, name: up.name || null, uploaded_at: now });
  });
  return PROPOSAL_REQUIREMENTS.map((r) => byKey.get(r.key)).filter(Boolean);
}
