/**
 * Shared modal system.
 *
 * <Modal> is the full component for new dialogs (header, scrolling body,
 * footer, portal, focus + keyboard handling).
 *
 * Existing large modals keep their own inner markup and adopt the same look
 * and behaviour with three small hooks into this file:
 *   - MODAL_OVERLAY / MODAL_PANEL / MODAL_WIDTH  -> identical visual shell
 *   - <ModalEffects onClose={...} />             -> Esc to close, focus trap,
 *                                                   scroll lock, focus restore
 *   - role="dialog" aria-modal="true" on the panel
 *
 * Layering: modals sit at z-[9000], confirmation dialogs at z-[9500] (so a
 * confirm raised from inside a modal is on top), toasts at z-[10000].
 */
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/* ---------- shared look ---------- */

export const MODAL_OVERLAY =
  'modal-overlay-in fixed inset-0 z-[9000] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4';

export const MODAL_PANEL =
  'modal-panel-in flex max-h-[90vh] max-h-[90dvh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5 outline-none';

/** For legacy modals whose whole panel scrolls (sticky header/footer inside). */
export const MODAL_PANEL_SCROLL =
  'modal-panel-in max-h-[90vh] max-h-[90dvh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5 outline-none';

export const MODAL_WIDTH = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
  full: 'max-w-7xl',
};

const STYLE_ID = 'app-modal-styles';
const CSS = `
@keyframes modal-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-panel-in { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
.modal-overlay-in { animation: modal-overlay-in 160ms ease-out both; }
.modal-panel-in { animation: modal-panel-in 200ms cubic-bezier(0.21, 1.02, 0.73, 1) both; }
@media (prefers-reduced-motion: reduce) { .modal-overlay-in, .modal-panel-in { animation: none !important; } }
`;

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* ---------- behaviour ---------- */

const openStack = [];
let scrollLocks = 0;
let savedOverflow = '';

function lockScroll() {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Drop this in as the first child of a modal overlay. Renders nothing visible.
 * Only the top-most open modal reacts to the keyboard.
 */
export function ModalEffects({ onClose, closeOnEscape = true }) {
  const anchorRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const overlay = anchorRef.current?.parentElement;
    const dialog = overlay?.querySelector('[role="dialog"],[role="alertdialog"]') || null;
    const previouslyFocused = document.activeElement;
    const token = {};
    openStack.push(token);
    lockScroll();

    if (dialog) {
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      const preferred = dialog.querySelector('[data-autofocus]');
      (preferred || dialog).focus({ preventScroll: true });
    }

    const onKeyDown = (event) => {
      if (openStack[openStack.length - 1] !== token) return;

      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key === 'Tab' && dialog) {
        const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (items.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openStack.indexOf(token);
      if (index !== -1) openStack.splice(index, 1);
      unlockScroll();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [closeOnEscape]);

  return <span ref={anchorRef} hidden aria-hidden="true" />;
}

/* ---------- component ---------- */

function CloseIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/**
 * @param {Object}   props
 * @param {Function} props.onClose
 * @param {string}   [props.title]
 * @param {string}   [props.description]
 * @param {'sm'|'md'|'lg'|'xl'|'2xl'|'full'} [props.size='md']
 * @param {React.ReactNode} [props.footer]        actions, right-aligned; primary last
 * @param {boolean}  [props.dismissible=true]     show X, allow Esc
 * @param {boolean}  [props.closeOnBackdrop=true]
 * @param {boolean}  [props.hideHeader=false]     for custom layouts (confirm dialogs)
 * @param {string}   [props.role='dialog']
 * @param {number}   [props.layer=9000]           z-index (confirm uses 9500)
 */
export function Modal({
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  dismissible = true,
  closeOnBackdrop = true,
  hideHeader = false,
  role = 'dialog',
  layer = 9000,
  panelClassName = '',
  bodyClassName = 'px-6 py-5',
  ariaLabel,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const pressedOnBackdrop = useRef(false);

  const handleClose = () => {
    if (dismissible) onClose?.();
  };

  const node = (
    <div
      className={MODAL_OVERLAY}
      style={{ zIndex: layer }}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a full click that starts and ends on the backdrop closes it,
        // so selecting text and releasing outside never dismisses the dialog.
        if (closeOnBackdrop && pressedOnBackdrop.current && event.target === event.currentTarget) handleClose();
      }}
    >
      <ModalEffects onClose={handleClose} closeOnEscape={dismissible} />
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        className={`${MODAL_PANEL} ${MODAL_WIDTH[size] || MODAL_WIDTH.md} ${panelClassName}`}
      >
        {!hideHeader && (
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold leading-6 text-slate-900">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-slate-500">
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close dialog"
                className="-mr-2 -mt-1 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        )}

        <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(node, document.body);
}

export default Modal;
