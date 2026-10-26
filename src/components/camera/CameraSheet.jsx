/* The full-screen camera every photo in the app is taken with: the live view
 * fills the phone screen, with one big shutter button at the bottom, like the
 * phone's own camera app.
 *
 * Purely the look. Each caller keeps its own camera logic (stream, capture,
 * GPS stamp, geofence) and passes its <video> ref in; the camera should only
 * run while `open` is true, so the stream starts once this <video> exists.
 *
 *   <CameraSheet open={open} title="Site photo" onClose={close}
 *     videoRef={videoRef} ready={cameraReady} error={cameraError}
 *     hint="GPS ±8 m" onShutter={capture} shutterDisabled={!cameraReady || busy} /> */
import { createPortal } from 'react-dom';
import { RefreshCwIcon, XIcon } from 'lucide-react';
import { ModalEffects } from '../ui/Modal';

export default function CameraSheet({
  open,
  title = 'Camera',
  onClose,
  videoRef,
  ready = false,
  error = '',
  hint = '',
  onShutter,
  shutterDisabled = false,
  busy = false,
  shutterLabel = 'Take photo',
  onRestart,
  children,
}) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9600] bg-black text-white">
      {/* Esc closes, focus stays inside, the page behind does not scroll. */}
      <ModalEffects onClose={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative flex h-full w-full flex-col outline-none">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="size-10 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-label="Starting camera" />
          </div>
        )}
        {children}

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="rounded-full bg-black/40 p-2 text-white hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <XIcon className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Bottom bar: hint, shutter, restart */}
        <div className="relative z-10 mt-auto bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
          {(error || hint) && (
            <p role={error ? 'alert' : undefined} aria-live="polite" className={`mx-auto mb-4 max-w-md text-center text-xs ${error ? 'rounded-lg bg-rose-600/90 px-3 py-2 text-white' : 'text-white/85'}`}>
              {error || hint}
            </p>
          )}
          <div className="mx-auto grid max-w-md grid-cols-3 items-center">
            <span />
            <button
              type="button"
              onClick={onShutter}
              disabled={shutterDisabled}
              aria-label={shutterLabel}
              title={shutterLabel}
              className="mx-auto grid size-[72px] place-items-center rounded-full border-4 border-white/90 bg-white/10 transition active:scale-95 disabled:opacity-40 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
            >
              <span className={`block size-14 rounded-full ${busy ? 'animate-pulse bg-teal-400' : 'bg-white'}`} />
            </button>
            {onRestart ? (
              <button
                type="button"
                onClick={onRestart}
                aria-label="Restart camera"
                title="Restart camera"
                className="ml-auto rounded-full bg-black/40 p-3 text-white hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <RefreshCwIcon className="size-5" aria-hidden="true" />
              </button>
            ) : <span />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
