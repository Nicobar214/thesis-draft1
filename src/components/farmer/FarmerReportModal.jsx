import { XIcon } from 'lucide-react';
import { supabaseFarmer } from '../../lib/supabase';
import { MODAL_OVERLAY, MODAL_PANEL_SCROLL, ModalEffects } from '../ui/Modal';
import PublicReportForm from '../PublicReportForm';

/**
 * The citizen "New Report" dialog (UserReports.jsx), for the farmer portal.
 * Same form and flow; the one difference is the farmer's Supabase client, so
 * the report is filed under the farmer's own account and appears in their
 * My Reports (and, like every report, in the citizen Community Feedback feed).
 */
export default function FarmerReportModal({ onClose, onSubmitted }) {
  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      {/* No close-on-Escape: the form can be mid-capture (camera/GPS). */}
      <ModalEffects onClose={onClose} closeOnEscape={false} />
      <div
        className={`${MODAL_PANEL_SCROLL} max-w-2xl`}
        role="dialog"
        aria-modal="true"
        aria-label="New location-verified report"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-100">
          <div>
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">New Report</p>
            <h3 className="text-lg font-semibold text-slate-900 mt-0.5">Location-Verified Report</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6">
          <PublicReportForm client={supabaseFarmer} onSubmitted={onSubmitted} />
        </div>
      </div>
    </div>
  );
}
