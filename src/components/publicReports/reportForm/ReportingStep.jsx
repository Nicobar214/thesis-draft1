import { useMemo } from 'react';
import { Building2Icon, LocateFixedIcon, MapPinIcon, RouteIcon, TriangleAlertIcon } from 'lucide-react';
import { buildRoutePoints } from '../../../lib/mapRouteUtils';
import { distToProject } from '../../../lib/reportSubmission';
import { nearestPointOnRoute } from '../routeGeometry';
import SeverityIcon from '../../SeverityIcon';
import PublicReportRouteMapPanel from '../PublicReportRouteMapPanel';
import { SEVERITY_TAXONOMY } from '../../../lib/publicReportStatus';
import RequiredReminder from './RequiredReminder';

// A friendly "are you at the right road?" nudge, never a block. Lenient for
// now (testing); tighten it later, e.g. to 300 m, once reporting is live.
const FAR_FROM_PROJECT_M = 1000;

function fmtMeters(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

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

  // How far the reporter is from the project road: the mapped route line when
  // there is one, else the project's mid/start point.
  const distanceToProject = useMemo(() => {
    if (!gps || !selProject) return null;
    const route = buildRoutePoints(selProject, selProjectRoute).points || [];
    if (route.length >= 2) {
      const nearest = nearestPointOnRoute(route, [gps.lat, gps.lng]);
      if (Number.isFinite(nearest?.distanceMeters)) return nearest.distanceMeters;
    }
    const d = distToProject(gps.lat, gps.lng, selProject);
    return Number.isFinite(d) ? d : null;
  }, [gps, selProject, selProjectRoute]);
  // Give a rough fix the benefit of the doubt: only warn when even the near
  // edge of the GPS circle is far from the road.
  const farFromProject = distanceToProject != null
    && distanceToProject - (gps?.accuracy || 0) > FAR_FROM_PROJECT_M;
  // Required fields still empty, shown as a reminder above Submit.
  const missing = [
    !photoBlob && { key: 'photo', label: 'Take a site photo', targetId: 'report-photo' },
    !description.trim() && { key: 'description', label: 'Describe the problem', targetId: 'report-description' },
  ].filter(Boolean);

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
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Auto-filled from GPS</p>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl max-w-full">
              <RouteIcon className="size-3.5 shrink-0 text-teal-600" aria-hidden="true" />
              <span className="text-xs font-medium text-slate-700 truncate">{selProject?.project_name}</span>
            </div>
            {selProject?.municipality && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                <Building2Icon className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="text-xs text-slate-600">{selProject.municipality}</span>
              </div>
            )}
            {selProject?.location && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                <MapPinIcon className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="text-xs text-slate-600">{selProject.location}</span>
              </div>
            )}
            {gps && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl">
                <span className="text-xs text-teal-700 font-mono font-medium">
                  <LocateFixedIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
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
            gpsAccuracy={gps.accuracy}
          />
        )}

        {/* Friendly distance check: never blocks submitting */}
        {farFromProject && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              You seem to be about <strong>{fmtMeters(distanceToProject)}</strong> from <strong>{selProject?.project_name}</strong>.
              Reports are checked against where you are, so please make sure you picked the right road, or send the report
              from the site itself. You can still submit.
            </span>
          </div>
        )}

        {/* Low-accuracy warning */}
        {lowAcc && (
          <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            <span>
              Rough location (±{Math.round(gps.accuracy)} m). Your device is estimating from Wi-Fi or cell signal. Step outside
              or turn on GPS; the pin sharpens on its own within a few seconds. You can still submit.
            </span>
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

        {/* Photo capture */}
        <div id="report-photo" tabIndex={-1} className="scroll-mt-24 outline-none">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Site Photo <span className="text-red-500">*</span>
            <span className="text-xs font-normal text-slate-500 ml-1">(live camera only)</span>
          </label>
          <p className="mb-2 text-xs text-slate-500">
            Photos are shared with the community. Please keep people and vehicle plate numbers out of the frame.
          </p>
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

        {/* Description */}
        <div>
          <label htmlFor="report-description" className="block text-sm font-medium text-slate-700 mb-1.5">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea id="report-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
            placeholder="Describe the current condition, issue, or observation at this project site…"
            className={`${inputCls} resize-none`} />
        </div>

        {/* Optional identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="report-name" className="block text-sm font-medium text-slate-700 mb-1.5">
              Your Name <span className="text-xs text-slate-500 font-normal">(optional)</span>
            </label>
            <input id="report-name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Juan Dela Cruz" className={inputCls} />
          </div>
          <div>
            <label htmlFor="report-contact" className="block text-sm font-medium text-slate-700 mb-1.5">
              Contact Info <span className="text-xs text-slate-500 font-normal">(optional)</span>
            </label>
            <input id="report-contact" type="text" value={contact} onChange={(e) => setContact(e.target.value)}
              placeholder="Email or phone" className={inputCls} />
          </div>
        </div>

        {/* Submit */}
        <RequiredReminder missing={missing} />
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
