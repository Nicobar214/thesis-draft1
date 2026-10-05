import { Modal } from './Modal';
import { Button } from './Button';

const TONES = {
  danger: {
    icon: 'bg-red-50 text-red-600',
    button: 'danger',
    path: 'M12 9v3.75m0 3.75h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  },
  warning: {
    icon: 'bg-amber-50 text-amber-600',
    button: 'warning',
    path: 'M12 9v3.75m0 3.75h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  },
  primary: {
    icon: 'bg-teal-50 text-teal-600',
    button: 'primary',
    path: 'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z',
  },
};

/**
 * The one confirmation dialog layout. Used by confirm() (see lib/confirm.js)
 * and by any state-driven "are you sure?" modal.
 *
 * For destructive tone, initial focus lands on Cancel so a stray Enter is safe.
 * Cancel sits left, the confirming action right (matches every other dialog).
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  layer,
  onConfirm,
  onCancel,
}) {
  const style = TONES[tone] || TONES.primary;
  const destructive = tone === 'danger';

  return (
    <Modal
      role="alertdialog"
      size="sm"
      layer={layer}
      hideHeader
      closeOnBackdrop={false}
      onClose={busy ? undefined : onCancel}
      dismissible={!busy}
      ariaLabel={typeof title === 'string' ? title : undefined}
      bodyClassName="p-0"
    >
      <div className="flex items-start gap-4 px-6 pt-6">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={style.path} />
          </svg>
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {message && (
            <div className="mt-1.5 whitespace-pre-line break-words text-sm leading-6 text-slate-600">{message}</div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus={destructive ? '' : undefined}>
          {cancelLabel}
        </Button>
        <Button variant={style.button} onClick={onConfirm} loading={busy} data-autofocus={destructive ? undefined : ''}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
