/**
 * Promise-based replacement for window.confirm().
 *
 *   import { confirm } from '../lib/confirm';
 *   if (!(await confirm({
 *     title: 'Delete market?',
 *     message: 'This cannot be undone.',
 *     confirmLabel: 'Delete market',
 *     tone: 'danger',
 *   }))) return;
 *
 * <ConfirmDialogHost /> (mounted once in App) renders the dialog. Requests
 * raised while one is open are queued, never dropped.
 */

const listeners = new Set();
const queue = [];
let current = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function advance() {
  current = queue.shift() || null;
  emit();
}

export function confirm(options = {}) {
  return new Promise((resolve) => {
    queue.push({
      title: options.title || 'Are you sure?',
      message: options.message || '',
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      tone: options.tone || 'primary', // 'primary' | 'danger' | 'warning'
      resolve,
    });
    if (!current) advance();
  });
}

export function settleConfirm(result) {
  const request = current;
  if (!request) return;
  request.resolve(Boolean(result));
  advance();
}

export function subscribeConfirm(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConfirmRequest() {
  return current;
}

/** The one "log out?" prompt, shared by every portal's log-out button. */
export function confirmSignOut() {
  return confirm({
    title: 'Log out?',
    message: 'You will need to sign in again to continue.',
    confirmLabel: 'Log out',
    tone: 'warning',
  });
}
