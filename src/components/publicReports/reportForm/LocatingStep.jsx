/** Waiting for a GPS fix: spinner, "location found" confirmation, or a permission/timeout error. */
export default function LocatingStep({
  gpsLoading,
  gpsSlow,
  gps,
  gpsError,
  acquireGps,
}) {
  return (
      <div className="report-step-in flex flex-col items-center justify-center min-h-[320px] py-10 px-6 space-y-6">
        {gpsLoading && (
          <>
            <div className="relative flex items-center justify-center">
              <span className="absolute inline-flex h-24 w-24 rounded-full bg-teal-400 opacity-20 animate-ping" />
              <span className="absolute inline-flex h-16 w-16 rounded-full bg-teal-400 opacity-25 animate-ping" style={{ animationDelay: '0.25s' }} />
              <div className="relative z-10 w-14 h-14 bg-teal-500 rounded-full flex items-center justify-center shadow-lg shadow-teal-500/40">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-slate-800">Getting your GPS position…</p>
              <p className="text-sm text-slate-500 mt-1">Please stay still for the best accuracy</p>
              <p
                className={`mx-auto mt-3 max-w-xs text-xs text-amber-700 transition-opacity duration-500 ${gpsSlow ? 'opacity-100' : 'opacity-0'}`}
                aria-live="polite"
              >
                {gpsSlow ? 'Taking a little longer than usual. Moving near a window or into the open helps.' : '\u00A0'}
              </p>
            </div>
          </>
        )}

        {!gpsLoading && gps && (
          <>
            <div className="w-14 h-14 bg-teal-500 rounded-full flex items-center justify-center shadow-lg shadow-teal-500/40">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-slate-800">Location found</p>
              <p className="text-sm text-slate-500 mt-1">Finding road projects near you…</p>
            </div>
          </>
        )}

        {!gpsLoading && !gps && gpsError && (
          <>
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </div>
            <div className="text-center space-y-2 max-w-xs">
              <p className="font-semibold text-slate-900">Location Access Required</p>
              <p className="text-sm text-slate-500">{gpsError}</p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 text-left mt-2">
                <p className="font-semibold mb-1">Enable Location in Browser Settings:</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Tap the lock / info icon in the address bar</li>
                  <li>Set "Location" to "Allow"</li>
                  <li>Reload or tap "Try Again" below</li>
                </ul>
              </div>
            </div>
            <button type="button" onClick={acquireGps}
              className="inline-flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-teal-700 transition shadow-lg shadow-teal-500/20">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Try Again
            </button>
          </>
        )}

        {!gpsLoading && !gpsError && !gps && (
          <button type="button" onClick={acquireGps}
            className="inline-flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-teal-700 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            Detect My Location
          </button>
        )}
      </div>
  );
}
