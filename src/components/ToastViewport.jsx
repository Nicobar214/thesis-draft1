import { useSyncExternalStore } from 'react';
import { subscribeToasts, getToasts, dismissToast } from '../lib/toast';

const styles = `
@keyframes toast-in { from { opacity: 0; transform: translateX(24px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes toast-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.toast-in { animation: toast-in 220ms cubic-bezier(0.21, 1.02, 0.73, 1) both; }
.toast-progress { transform-origin: left; animation: toast-progress linear forwards; }
@media (prefers-reduced-motion: reduce) { .toast-in, .toast-progress { animation: none !important; } }
`;

const TONES = {
  success: {
    title: 'Success',
    icon: 'bg-emerald-50 text-emerald-600',
    bar: 'bg-emerald-500',
    path: 'M5 13l4 4L19 7',
  },
  error: {
    title: 'Something went wrong',
    icon: 'bg-rose-50 text-rose-600',
    bar: 'bg-rose-500',
    path: 'M6 18L18 6M6 6l12 12',
  },
  warning: {
    title: 'Heads up',
    icon: 'bg-amber-50 text-amber-600',
    bar: 'bg-amber-500',
    path: 'M12 9v3.75m0 3.75h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  },
  info: {
    title: 'Notice',
    icon: 'bg-sky-50 text-sky-600',
    bar: 'bg-sky-500',
    path: 'M12 8h.01M11 12h1v4h1m8-4a9 9 0 11-18 0 9 9 0 0118 0z',
  },
};

function ToastItem({ item }) {
  const tone = TONES[item.type] || TONES.info;
  const isError = item.type === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className="toast-in pointer-events-auto relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10"
    >
      <div className="flex items-start gap-3 p-3.5 pr-10">
        <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${tone.icon}`}>
          <svg className="size-4.5" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={tone.path} />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-5 text-slate-900">{tone.title}</p>
          <p className="mt-0.5 break-words text-[13px] leading-5 text-slate-600">{item.message}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div
        key={item.shownAt}
        className={`toast-progress absolute inset-x-0 bottom-0 h-0.5 ${tone.bar}`}
        style={{ animationDuration: `${item.duration}ms` }}
      />
    </div>
  );
}

/** Renders every active toast. Mount once, near the app root. */
export default function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-[10000] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5"
    >
      <style>{styles}</style>
      {toasts.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  );
}
