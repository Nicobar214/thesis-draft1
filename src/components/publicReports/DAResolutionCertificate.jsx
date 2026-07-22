import { useRef } from 'react';
import Icons from '../Icons';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DAResolutionCertificate({
  report,
  fieldFinding,
  resolution,
  onClose,
}) {
  const printRef = useRef(null);

  const handlePrint = () => {
    window.print();
  };

  if (!report) return null;

  const serialNo = `DA-RAED-6-${String(report.id || '').slice(0, 8).toUpperCase()}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl max-w-3xl w-full my-8 flex flex-col max-h-[90vh]">
        {/* Modal Action Header (Non-printable) */}
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-emerald-100 text-emerald-800 font-bold text-xs">
              <Icons.ShieldCheck />
            </span>
            <div>
              <h3 className="font-bold text-slate-900 text-base">DA-RAED Resolution Certificate</h3>
              <p className="text-xs text-slate-500">Official Department of Agriculture Field Action Document</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors"
            >
              <Icons.Document />
              <span>Print / Save PDF</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 transition-colors p-1"
            >
              <Icons.X />
            </button>
          </div>
        </header>

        {/* Printable Certificate Body */}
        <div ref={printRef} className="p-8 space-y-6 overflow-y-auto font-sans print:p-6 print:overflow-visible">
          {/* Government Header */}
          <div className="text-center space-y-1 pb-4 border-b-2 border-slate-900">
            <p className="text-xs font-semibold text-slate-500 tracking-widest uppercase">Republic of the Philippines</p>
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-tight">DEPARTMENT OF AGRICULTURE — REGION VI</h2>
            <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Regional Agricultural Engineering Division (RAED)</p>
            <p className="text-[11px] text-slate-500">Fort San Pedro, Iloilo City · Tel: (033) 337-1234 · Email: raed6@da.gov.ph</p>
            
            <div className="pt-3 flex justify-between items-center text-xs font-mono font-bold text-slate-700">
              <span>DOCUMENT CONTROL NO: {serialNo}</span>
              <span>ISSUED: {fmtDate(resolution?.resolved_at || report.updated_at)}</span>
            </div>
          </div>

          {/* Certificate Title */}
          <div className="text-center space-y-1">
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-wide">
              OFFICIAL FIELD INSPECTION & ACTION RESOLUTION CERTIFICATE
            </h1>
            <p className="text-xs text-slate-600 italic">
              This certificate verifies the receipt, technical evaluation, field inspection, and administrative resolution of reported Farm-to-Market Road infrastructure issues under DA-RAED Region VI oversight.
            </p>
          </div>

          {/* Section 1: Report Details */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider bg-slate-100 px-3 py-1 rounded border-l-4 border-emerald-700">
              I. Incident & Location Profile
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-500 block font-medium">Tracking Ref #:</span>
                <span className="font-bold text-slate-900">{String(report.id || '').slice(0, 8).toUpperCase()}</span>
              </div>
              <div>
                <span className="text-slate-500 block font-medium">Date Reported:</span>
                <span className="font-semibold text-slate-800">{fmtDate(report.created_at)}</span>
              </div>
              <div>
                <span className="text-slate-500 block font-medium">Location / Barangay:</span>
                <span className="font-semibold text-slate-800">{report.barangay ? `${report.barangay}, ` : ''}{report.municipality}, Iloilo</span>
              </div>
              <div>
                <span className="text-slate-500 block font-medium">GPS Coordinates:</span>
                <span className="font-mono text-slate-800">{Number(report.latitude || 0).toFixed(6)}, {Number(report.longitude || 0).toFixed(6)}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500 block font-medium">Linked FMR Road Project:</span>
                <span className="font-bold text-emerald-800">{report.project_name || 'Municipal Road Network'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500 block font-medium">Reported Problem Description:</span>
                <p className="font-medium text-slate-800 mt-0.5 bg-white p-2 rounded border border-slate-200">"{report.description}"</p>
              </div>
            </div>
          </section>

          {/* Section 2: Technical Inspection Findings */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider bg-slate-100 px-3 py-1 rounded border-l-4 border-emerald-700">
              II. DA Field Engineering Technical Findings
            </h3>
            <div className="text-xs p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 block font-medium">Assigned DA Field Engineer:</span>
                  <span className="font-bold text-slate-900">{report.assigned_engineer_name || fieldFinding?.engineer_id || 'Regional DA Field Engineer'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block font-medium">Field Verification Status:</span>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <Icons.CheckCircle /> {report.verification || 'Verified On-Site'}
                  </span>
                </div>
              </div>

              {fieldFinding ? (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div>
                    <span className="text-slate-500 block font-medium">On-Site Condition Observed:</span>
                    <p className="font-semibold text-slate-800 bg-white p-2 rounded border border-slate-200">{fieldFinding.condition_observed}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-medium">Recommended Engineering Action:</span>
                    <p className="font-semibold text-emerald-900 bg-emerald-50/50 p-2 rounded border border-emerald-200">{fieldFinding.recommended_action}</p>
                  </div>
                  {fieldFinding.estimated_cost_range && (
                    <div>
                      <span className="text-slate-500 block font-medium">Estimated Repair Cost Category:</span>
                      <span className="font-bold text-slate-900">{fieldFinding.estimated_cost_range}</span>
                    </div>
                  )}
                  {fieldFinding.field_photo_url && (
                    <div>
                      <span className="text-slate-500 block font-medium mb-1">On-Site Inspection Geo Photo:</span>
                      <img src={fieldFinding.field_photo_url} alt="DA Field Inspection Photo" className="w-full max-h-48 object-cover rounded-lg border border-slate-300" />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-500 italic">Technical field inspection logs compiled by regional engineer team.</p>
              )}
            </div>
          </section>

          {/* Section 3: Final Administrative Resolution */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider bg-slate-100 px-3 py-1 rounded border-l-4 border-emerald-700">
              III. Official DA Action Directive & Resolution
            </h3>
            <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-emerald-900 text-sm">RESOLUTION STATUS: RESOLVED</span>
                <span className="font-medium text-slate-500">{fmtDate(resolution?.resolved_at || report.updated_at)}</span>
              </div>
              <div>
                <span className="text-slate-600 block font-medium mb-0.5">Official Resolution Summary & Action Taken:</span>
                <p className="font-semibold text-slate-900 bg-white p-3 rounded-lg border border-emerald-200 leading-relaxed">
                  {resolution?.summary || 'This road issue has been verified and resolved by DA Region VI Engineering and Local Government Officers.'}
                </p>
              </div>
              {resolution?.resolved_by_name && (
                <div className="pt-1 text-right text-slate-600 font-medium">
                  Approved By: <span className="font-bold text-slate-900">{resolution.resolved_by_name}</span> ({resolution.resolved_by_email || 'DA-RAED Officer'})
                </div>
              )}
            </div>
          </section>

          {/* Signatures & Seal */}
          <div className="pt-6 grid grid-cols-2 gap-8 text-center text-xs">
            <div className="space-y-8">
              <div className="border-b border-slate-400 w-4/5 mx-auto" />
              <div>
                <p className="font-bold text-slate-900">{report.assigned_engineer_name || 'DA FIELD ENGINEER'}</p>
                <p className="text-slate-500">Field Inspection Engineer, DA Region VI</p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="border-b border-slate-400 w-4/5 mx-auto" />
              <div>
                <p className="font-bold text-slate-900">{resolution?.resolved_by_name || 'RAED REGIONAL DIRECTOR'}</p>
                <p className="text-slate-500">DA-RAED Region VI Chief / LGU Officer</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
