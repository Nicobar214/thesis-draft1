import SeverityIcon from '../../SeverityIcon';
import { SEVERITY_TAXONOMY } from '../../../lib/publicReportStatus';

/** Pick the severity category and the specific problem so the report reaches the right team. */
export default function ClassifyStep({
  severityCategory,
  specificProblem,
  setSeverityCategory,
  setSpecificProblem,
  setCategory,
  setStep,
}) {
  const categoryMeta = severityCategory ? SEVERITY_TAXONOMY[severityCategory] : null;
  const problemOptions = categoryMeta?.problems || [];
  const canProceed = severityCategory && specificProblem;

  return (
      <div className="report-step-in space-y-5">
        <button type="button"
          onClick={() => { setSpecificProblem(''); setSeverityCategory(''); setStep('picking'); }}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 font-medium transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to project list
        </button>

        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
          <p className="text-sm font-medium text-teal-800 mb-0.5">Step 1 of 2 — Classify your report</p>
          <p className="text-xs text-teal-600">
            Select the severity and specific problem so your report reaches the right team immediately.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            What type of issue is this?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(SEVERITY_TAXONOMY).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                aria-pressed={severityCategory === key}
                onClick={() => { setSeverityCategory(key); setSpecificProblem(''); setCategory(key); }}
                className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                  severityCategory === key
                    ? `${meta.color} ring-2 ring-offset-1 ring-current`
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="mt-0.5"><SeverityIcon category={key} className="size-5" /></span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {severityCategory && (
          <div>
            <label htmlFor="classify-problem" className="block text-sm font-semibold text-slate-700 mb-2">
              What specifically is the problem?
            </label>
            <select
              id="classify-problem"
              value={specificProblem}
              onChange={(e) => setSpecificProblem(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition"
            >
              <option value="">— Select specific problem —</option>
              {problemOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {specificProblem && (
              <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${categoryMeta?.color || ''}`}>
                <SeverityIcon category={severityCategory} />
                <span>
                  {categoryMeta?.label} → {problemOptions.find((p) => p.value === specificProblem)?.label}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => { setSeverityCategory(''); setSpecificProblem(''); setStep('picking'); }}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canProceed}
            onClick={() => setStep('reporting')}
            className="flex-1 px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to Report →
          </button>
        </div>
      </div>
  );
}
