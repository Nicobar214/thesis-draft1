import { useEffect, useState } from 'react';

function seenKey(portal, userId) {
  return `kt-tour-seen:${portal}:${userId}`;
}

/**
 * Opens the guided tour once, on a new account's first visit to the portal,
 * after a short delay so the page has rendered. Once closed it never opens by
 * itself again, on any page; start() replays the current page's tour from the
 * help button. Pass a null portal on pages that have no tour, and
 * autoStart: false when the visit is for something else (a form opened by a
 * link) -- the tour then waits for a later page instead of covering it.
 */
export function usePageTour(portal, userId, { delay = 900, autoStart = true } = {}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!portal || !userId || !autoStart) return undefined;
    let seen = true;
    try {
      seen = Boolean(localStorage.getItem(seenKey(portal, userId)));
    } catch {
      // Storage blocked: skip auto-start rather than show it on every load.
    }
    if (seen) return undefined;
    const timer = setTimeout(() => setOpen(true), delay);
    return () => clearTimeout(timer);
  }, [portal, userId, delay, autoStart]);

  const close = () => {
    setOpen(false);
    try {
      if (portal && userId) localStorage.setItem(seenKey(portal, userId), '1');
    } catch {
      // Nothing to do; it will just auto-start again next visit.
    }
  };

  return { open, start: () => setOpen(true), close };
}
