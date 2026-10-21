/*
 * proposalSubmitChecks.js — what an LGU proposal needs before it goes to DA.
 *
 *   missingRequiredDocs(proposal, files)  the DA checklist items still not attached
 *                                         (all 5 are required to submit)
 *   proposalWarnings({...})               small faults that don't block submitting,
 *                                         shown in the confirmation so the LGU can
 *                                         fix them first or submit anyway
 */
import { PROPOSAL_REQUIREMENTS, findRequirementDoc } from './proposalRequirements';

/** Requirements with neither a saved file nor a newly chosen one. */
export function missingRequiredDocs(proposal, files = {}) {
  return PROPOSAL_REQUIREMENTS.filter((r) => !files[r.key] && !findRequirementDoc(proposal, r.key));
}

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

/**
 * form: the proposal form; hasPhoto: a road photo is attached (new or saved);
 * daEstimate: DA's standard cost for the length (₱), or null; year: current year.
 */
export function proposalWarnings({ form = {}, hasPhoto = false, daEstimate = null, year = new Date().getFullYear() } = {}) {
  const warnings = [];
  const hasStart = Number.isFinite(num(form.start_latitude)) && Number.isFinite(num(form.start_longitude));
  const hasEnd = Number.isFinite(num(form.end_latitude)) && Number.isFinite(num(form.end_longitude));
  const length = num(form.estimated_length_km);
  const budget = num(form.estimated_budget);
  const farmers = num(form.beneficiary_farmers_count);
  const area = num(form.beneficiary_households_count);
  const fundingYear = num(form.target_funding_year);

  if (!form.barangay) warnings.push('No barangay is selected.');
  if (!hasStart || !hasEnd) warnings.push('The road route is not fully drawn on the map (start and end points).');
  if (!(length > 0)) warnings.push('Estimated road length is missing.');
  if (!(budget > 0)) {
    warnings.push('Estimated budget is missing.');
  } else if (daEstimate > 0) {
    const diff = (budget - daEstimate) / daEstimate;
    if (Math.abs(diff) > 0.3) {
      warnings.push(`Estimated budget is ${Math.round(Math.abs(diff) * 100)}% ${diff > 0 ? 'above' : 'below'} the DA standard cost for this length.`);
    }
  }
  if (!(farmers > 0)) warnings.push('Number of beneficiary farmers is missing.');
  if (!(area > 0)) warnings.push('Total farm area served is missing.');
  if (Number.isFinite(fundingYear) && fundingYear < year) warnings.push(`Target funding year (${fundingYear}) has already passed.`);
  if (!String(form.description || '').trim()) warnings.push('No additional description of the road.');
  if (!hasPhoto) warnings.push('No road photo is attached.');
  return warnings;
}
