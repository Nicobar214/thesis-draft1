/* FarmerReportIssue.jsx - Report road damage, at /farmer/report */
import PublicReportForm from "../components/PublicReportForm";

export default function FarmerReportIssue() {
  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-orange-700 text-white rounded-2xl p-5 shadow-sm">
        <h3 className="font-extrabold text-base sm:text-lg">Report Road Damage or Impassable Sections</h3>
        <p className="text-xs text-amber-100 mt-1 leading-relaxed">
          Experiencing potholes, washed out bridges, landslides, or impassable muddy sections on your Farm-to-Market Road? Submit an official report below. Your GPS location and linked road will be automatically recorded.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <PublicReportForm prefillCategory="safety" />
      </div>
    </div>
  );
}
