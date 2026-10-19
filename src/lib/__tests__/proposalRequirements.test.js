import { describe, it, expect } from 'vitest';
import { PROPOSAL_REQUIREMENTS, findRequirementDoc, requirementProgress, mergeRequirementDocs } from '../proposalRequirements';

describe('proposal requirements checklist', () => {
  it('has the five DA requirements with short names', () => {
    expect(PROPOSAL_REQUIREMENTS).toHaveLength(5);
    PROPOSAL_REQUIREMENTS.forEach((r) => expect(r.label.length).toBeLessThanOrEqual(40));
  });

  it('counts what is attached', () => {
    const p = { supporting_documents: [{ key: 'road_network_map', path: 'a.pdf' }, { key: 'rdc_endorsement', path: 'b.pdf' }] };
    expect(requirementProgress(p)).toEqual({ attached: 2, total: 5 });
  });

  it('shows an older single document as the letter of intent', () => {
    const old = { document_url: 'x.pdf', document_name: 'SB Resolution.pdf' };
    expect(findRequirementDoc(old, 'letter_of_intent')).toMatchObject({ path: 'x.pdf', legacy: true });
    expect(requirementProgress(old).attached).toBe(1);
  });

  it('replaces a re-uploaded file and keeps the others, in checklist order', () => {
    const existing = [{ key: 'rdc_endorsement', path: 'old-rdc.pdf' }, { key: 'letter_of_intent', path: 'loi.pdf' }];
    const merged = mergeRequirementDocs(existing, { rdc_endorsement: { path: 'new-rdc.pdf', name: 'rdc.pdf' } }, 'T');
    expect(merged.map((d) => d.key)).toEqual(['letter_of_intent', 'rdc_endorsement']);
    expect(merged[1]).toMatchObject({ path: 'new-rdc.pdf', uploaded_at: 'T' });
  });
});
