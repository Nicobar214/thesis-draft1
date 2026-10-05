/**
 * Global toast store.
 *
 * One small pub/sub store so any page, component or plain helper can raise a
 * toast without prop-drilling or a provider:
 *
 *   import { toast } from '../lib/toast';
 *   toast.success('Saved.');
 *   toast.error('Could not save.');
 *
 * `notify(message, type)` matches the `showNotification(message, type)`
 * signature the dashboards already use, so existing call sites keep working.
 * <ToastViewport /> (mounted once in App) renders the store.
 */

const TYPES = ['success', 'error', 'warning', 'info'];
const MAX_VISIBLE = 4;
const DURATION_MS = { success: 4000, info: 4500, warning: 5500, error: 7000 };

const listeners = new Set();
const timers = new Map();
let toasts = [];
let nextId = 1;

function emit() {
  listeners.forEach((listener) => listener());
}

// Callers that don't pass a type (older alert()-style code) get one inferred
// from the wording, so a failure never shows up looking like a success.
function inferType(text) {
  if (/^(error|failed|could not|couldn't|unable)\b/i.test(text)) return 'error';
  if (/^(no |please )|not found\b/i.test(text)) return 'warning';
  return 'success';
}

function normalizeType(type, text) {
  if (type === undefined || type === null) return inferType(text);
  if (type === 'warn') return 'warning';
  return TYPES.includes(type) ? type : 'info';
}

function normalizeMessage(message) {
  if (message == null) return '';
  if (typeof message === 'string') return message;
  if (typeof message.message === 'string') return message.message;
  return String(message);
}

export function dismissToast(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

function schedule(id, type, duration) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => dismissToast(id), duration ?? DURATION_MS[type]));
}

export function notify(message, type, options = {}) {
  const text = normalizeMessage(message).trim();
  if (!text) return null;
  const kind = normalizeType(type, text);

  // Same message already on screen: restart it instead of stacking duplicates.
  const existing = toasts.find((t) => t.type === kind && t.message === text);
  if (existing) {
    toasts = toasts.map((t) => (t.id === existing.id ? { ...t, shownAt: Date.now() } : t));
    schedule(existing.id, kind, options.duration);
    emit();
    return existing.id;
  }

  const id = nextId++;
  toasts = [...toasts, { id, type: kind, message: text, shownAt: Date.now(), duration: options.duration ?? DURATION_MS[kind] }];
  while (toasts.length > MAX_VISIBLE) dismissToast(toasts[0].id);
  schedule(id, kind, options.duration);
  emit();
  return id;
}

export const toast = {
  success: (message, options) => notify(message, 'success', options),
  error: (message, options) => notify(message, 'error', options),
  warning: (message, options) => notify(message, 'warning', options),
  info: (message, options) => notify(message, 'info', options),
  dismiss: dismissToast,
};

export function subscribeToasts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts() {
  return toasts;
}
