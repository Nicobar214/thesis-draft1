import { RefreshCwIcon, WifiOffIcon } from 'lucide-react';

/**
 * A strip under the page header that says plainly what works without signal.
 * Offline: amber, with how many items are waiting on this phone.
 * Back online with items still waiting: teal "Sending…" strip.
 * Online with nothing waiting: renders nothing.
 */
export default function OfflineBanner({ online, pendingCount = 0, offlineText, className = '' }) {
  if (online && pendingCount === 0) return null;
  const waiting = pendingCount > 0
    ? ` ${pendingCount} ${pendingCount === 1 ? 'item' : 'items'} waiting to send.`
    : '';

  if (!online) {
    return (
      <div role="status" className={`flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 sm:px-6 lg:px-8 ${className}`}>
        <WifiOffIcon className="mt-px size-4 shrink-0" aria-hidden="true" />
        <span>
          {offlineText || "You're offline. Showing information saved on this phone."}
          {waiting && <strong className="font-semibold">{waiting}</strong>}
        </span>
      </div>
    );
  }

  return (
    <div role="status" className={`flex items-center gap-2 border-b border-teal-200 bg-teal-50 px-4 py-2 text-xs font-medium text-teal-900 sm:px-6 lg:px-8 ${className}`}>
      <RefreshCwIcon className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>Sending {pendingCount} {pendingCount === 1 ? 'item' : 'items'} saved while offline…</span>
    </div>
  );
}
