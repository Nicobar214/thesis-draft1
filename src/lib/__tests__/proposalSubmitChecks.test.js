import { describe, it, expect } from 'vitest';
import { missingRequiredDocs, proposalWarnings } from '../proposalSubmitChecks';

const complete = {
  barangay: 'Tabuc', start_latitude: '10.8', start_longitude: '122.4', end_latitude: '10.81', end_longitude: '122.41',
  estimated_length_km: '2', estimated_budget: '30000000', beneficiary_farmers_count: '120', beneficiary_households_count: '85',
  target_funding_year: '2027', description: 'Gravel road to the market.',
};

describe('proposal submit checks', () => {
  it('lists the required documents still missing', () => {
    const files = { letter_of_intent: { name: 'loi.pdf' } };
    const saved = { supporting_documents: [{ key: 'rdc_endorsement', path: 'r.pdf' }] };
    expect(missingRequiredDocs(saved, files).map((r) => r.key))
      .toEqual(['road_network_map', 'prioritization_template', 'ldip_certification']);
    expect(missingRequiredDocs(null, {})).toHaveLength(5);
  });

  it('has no warnings for a complete proposal', () => {
    expect(proposalWarnings({ form: complete, hasPhoto: true, daEstimate: 30000000, year: 2026 })).toEqual([]);
  });

  it('flags small faults without blocking', () => {
    const w = proposalWarnings({ form: { ...complete, estimated_budget: '60000000', description: '', target_funding_year: '2024' }, hasPhoto: false, daEstimate: 30000000, year: 2026 });
    expect(w).toContain('Estimated budget is 100% above the DA standard cost for this length.');
    expect(w).toContain('Target funding year (2024) has already passed.');
    expect(w).toContain('No road photo is attached.');
    expect(w).toContain('No additional description of the road.');
  });
});
