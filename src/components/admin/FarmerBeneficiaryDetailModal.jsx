import { useState } from 'react';
import { BENEFICIARY_VALIDATION_STATUSES } from '../../utils/farmerBeneficiaryData';

function formatDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
}

function StatusPill({ status }) {
  const tones = {
    'For Verification': 'bg-amber-50 text-amber-700 border-amber-200',
    Validated: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Needs Correction': 'bg-orange-50 text-orange-700 border-orange-200',
    'Duplicate Record': 'bg-purple-50 text-purple-700 border-purple-200',
    Rejected: 'bg-red-50 text-red-700 border-red-200',
    Archived: 'bg-slate-50 text-slate-700 border-slate-200',
    'Active Beneficiary': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Under Review': 'bg-sky-50 text-sky-700 border-sky-200',
    Inactive: 'bg-slate-50 text-slate-700 border-slate-200',
  };

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tones[status] || tones.Archived}`}>
      {status}
    </span>
  );
}

function InfoCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
      {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
    </div>
  );
}

export default function FarmerBeneficiaryDetailModal({ beneficiary, onClose, onUpdate }) {
  const [remarks, setRemarks] = useState(beneficiary?.adminRemarks || '');

  if (!beneficiary) return null;

  const applyDecision = (validationStatus) => {
    const beneficiaryStatus = validationStatus === 'Archived'
      ? 'Inactive'
      : validationStatus === 'Validated'
        ? 'Active Beneficiary'
        : 'Under Review';

    onUpdate?.(beneficiary.id, {
      validationStatus,
      beneficiaryStatus,
      adminRemarks: remarks.trim() || beneficiary.adminRemarks,
      lastUpdated: new Date(),
      validationHistory: [
        ...(beneficiary.validationHistory || []),
        {
          date: new Date(),
          actor: 'DA Regional Admin',
          action: validationStatus,
          remarks: remarks.trim() || 'DA admin updated the beneficiary review status.',
        },
      ],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Farmer Beneficiary Profile</p>
            <h3 className="mt-1 text-2xl font-bold text-slate-900">{beneficiary.fullName}</h3>
            <p className="mt-1 text-sm text-slate-500">{beneficiary.beneficiaryId} - {beneficiary.municipality}, {beneficiary.barangay}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={beneficiary.validationStatus} />
            <StatusPill status={beneficiary.beneficiaryStatus} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <InfoCard label="RSBSA / Registry No." value={beneficiary.rsbsaNumber} helper={beneficiary.contactNumber || 'No contact number'} />
            <InfoCard label="Crop / Farm Area Served" value={`${beneficiary.crop} - ${Number(beneficiary.farmAreaHa || 0).toFixed(2)} ha`} helper={`Estimated yield ${Number(beneficiary.estimatedYield || 0).toFixed(1)} t`} />
            <InfoCard label="Submitted by LGU" value={beneficiary.submittedByLgu} helper={`Submitted ${formatDate(beneficiary.submittedDate)}`} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900">Linked FMR Project</h4>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{beneficiary.linkedProject}</p>
                <p className="mt-1 text-sm text-slate-500">{beneficiary.serviceArea} - {beneficiary.distanceToFmrKm} km from service route</p>
                <p className="mt-3 text-sm text-slate-600">{beneficiary.benefitReason}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900">Location and Documents</h4>
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-600">
                <span className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5">Lat: {Number(beneficiary.gps?.lat || 0).toFixed(5)}</span>
                <span className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5">Lng: {Number(beneficiary.gps?.lng || 0).toFixed(5)}</span>
              </div>
              <div className="mt-4 space-y-2">
                {(beneficiary.supportingDocuments || []).map((documentName) => (
                  <div key={documentName} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    {documentName}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900">Validation History</h4>
              <div className="mt-4 space-y-3">
                {(beneficiary.validationHistory || []).map((entry, index) => (
                  <div key={`${entry.action}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-semibold text-slate-900">{entry.action}</p>
                      <p className="text-xs font-medium text-slate-500">{formatDate(entry.date)}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{entry.actor}</p>
                    <p className="mt-2 text-sm text-slate-600">{entry.remarks}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900">DA Review Action</h4>
              <label className="mt-4 block text-xs font-semibold uppercase tracking-widest text-slate-500">Admin Remarks</label>
              <textarea
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                rows={6}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-700 outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                placeholder="Add DA validation notes, correction instructions, or audit remarks."
              />
              <div className="mt-4 grid grid-cols-1 gap-2">
                {BENEFICIARY_VALIDATION_STATUSES.filter((status) => status !== 'For Verification').map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => applyDecision(status)}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Mark as {status}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
