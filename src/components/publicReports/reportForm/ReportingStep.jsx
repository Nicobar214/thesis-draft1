import { MapPinIcon } from 'lucide-react';
import SeverityIcon from '../../SeverityIcon';
import PublicReportRouteMapPanel from '../PublicReportRouteMapPanel';
import { SEVERITY_TAXONOMY } from '../../../lib/publicReportStatus';

const inputCls =
  'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm ' +
  'focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition';

/** The report itself: description, live camera photo, optional contact details, and submit. */
export default function ReportingStep({
  stopCamera,
  setStep,
  selProject,
  gps,
  selProjectRoute,
  error,
  severityCategory,
  specificProblem,
  description,
  setDescription,
  camError,
  camReady,
  photoPreview,
  photoBlob,
  videoRef,
  canvasRef,
  capturePhoto,
  retakePhoto,
  fullName,
  setFullName,
  contact,
  setContact,
  handleSubmit,
  submitting,
}) {
  const lowAcc = gps && gps.accuracy > 100;

  return (
      <div className="report-step-in space-y-5">
        {/* Back */}
        <button type="button"
          onClick={() => { stopCamera(); setStep('classify'); }}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 font-medium transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to project list
        </button>

        {/* Auto-filled read-only chips */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Auto-filled from GPS</p>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl max-w-full">
              <svg className="w-3.5 h-3.5 text-teal-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="text-xs font-medium text-slate-700 truncate">{selProject?.project_name}</span>
            </div>
            {selProject?.municipality && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
                <span className="text-xs text-slate-600">{selProject.municipality}</span>
              </div>
            )}
            {selProject?.location && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                <span className="text-xs text-slate-600">{selProject.location}</span>
              </div>
            )}
            {gps && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl">
                <span className="text-xs text-teal-700 font-mono font-medium">
                  <MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Map preview: report pin + the reported project's route */}
        {gps && selProject && (
          <PublicReportRouteMapPanel
            project={selProject}
            routeRecord={selProjectRoute}
            reportLatitude={gps.lat}
            reportLongitude={gps.lng}
            heightClass="h-56 sm:h-64"
            title="Your Report Pin & Project Route"
          />
        )}

        {/* Low-accuracy warning */}
        {lowAcc && (
          <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            <span>Low GPS accuracy (±{Math.round(gps.accuracy)}m) — move to open sky for better results. You can still submit.</span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {severityCategory && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium bg-slate-50 border-slate-200 text-slate-700">
            <SeverityIcon category={severityCategory} />
            <span>
              {SEVERITY_TAXONOMY[severityCategory]?.label}
              {specificProblem ? ` → ${SEVERITY_TAXONOMY[severityCategory]?.problems.find((p) => p.value === specificProblem)?.label}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setStep('classify')}
              className="ml-2 underline underline-offset-2 text-slate-500 hover:text-slate-700"
            >
              change
            </button>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
            placeholder="Describe the current condition, issue, or observation at this project site…"
            className={`${inputCls} resize-none`} />
        </div>

        {/* Photo capture */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Site Photo <span className="text-red-500">*</span>
            <span className="text-xs font-normal text-slate-400 ml-1">(live camera only)</span>
          </label>
          {camError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 mb-3">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{camError}</span>
            </div>
          )}
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video">
            {!photoPreview ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!camReady && !camError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
                    <div className="animate-spin w-8 h-8 border-2 border-white/30 border-t-white rounded-full" />
                  </div>
                )}
              </>
            ) : (
              <img src={photoPreview} alt="Captured" className="w-full h-full object-cover" />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="flex justify-center gap-3 mt-3">
            {!photoPreview ? (
              <button type="button" onClick={capturePhoto} disabled={!camReady}
                className="inline-flex items-center gap-2 bg-white text-slate-900 border-2 border-slate-300 px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-50 disabled:opacity-40 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
                Capture Photo
              </button>
            ) : (
              <button type="button" onClick={retakePhoto}
                className="inline-flex items-center gap-2 text-slate-600 border border-slate-300 px-5 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                Retake
              </button>
            )}
          </div>
        </div>

        {/* Optional identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Your Name <span className="text-xs text-slate-400 font-normal">(optional)</span>
            </label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Juan Dela Cruz" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Contact Info <span className="text-xs text-slate-400 font-normal">(optional)</span>
            </label>
            <input type="text" value={contact} onChange={(e) => setContact(e.target.value)}
              placeholder="Email or phone" className={inputCls} />
          </div>
        </div>

        {/* Submit */}
        <button type="button" onClick={handleSubmit}
          disabled={submitting || !description.trim() || !photoBlob}
          className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 text-white px-8 py-3.5 rounded-xl font-semibold text-sm hover:bg-teal-700 disabled:opacity-60 transition shadow-lg shadow-teal-500/20">
          {submitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              Submit Report
            </>
          )}
        </button>
      </div>
  );
}
