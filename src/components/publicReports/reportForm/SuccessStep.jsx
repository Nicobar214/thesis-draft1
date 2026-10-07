/** Shown after a report is submitted, or saved to send later when offline. */
export default function SuccessStep({
  queuedOffline,
  resetAll,
}) {
  return (
      <div className="report-step-in text-center py-12 px-6">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">Report Submitted!</h3>
        <p className="text-slate-600 max-w-md mx-auto mb-6">
          {queuedOffline
            ? 'Your report was saved offline and will sync automatically when you are back online.'
            : 'Your report has been recorded and location-verified. The photo and GPS coordinates confirm your on-site presence. Thank you for helping monitor community infrastructure.'}
        </p>
        <button onClick={resetAll} className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 font-semibold text-sm transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Submit another report
        </button>
      </div>
  );
}
