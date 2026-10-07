import { lazy } from 'react';

const RELOAD_KEY = 'kt-chunk-reload';

function clearReloadFlag() {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * React.lazy for route pages, safe across deployments.
 *
 * After a new deploy the old hashed chunk files disappear, so a tab opened before
 * the deploy can fail to fetch a page it has not loaded yet. Retry once, then
 * reload the app a single time to pick up the new build. The reload flag is only
 * cleared after a chunk loads successfully, so a chunk that is genuinely missing
 * can never cause a reload loop - it surfaces as a normal error instead.
 *
 *   const Dashboard = lazyPage(() => import('./pages/Dashboard'));
 */
export function lazyPage(importer) {
  return lazy(async () => {
    try {
      const mod = await importer();
      clearReloadFlag();
      return mod;
    } catch (firstError) {
      try {
        const mod = await importer();
        clearReloadFlag();
        return mod;
      } catch (error) {
        let alreadyReloaded = false;
        try {
          alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
          if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, '1');
        } catch {
          alreadyReloaded = true;
        }
        if (!alreadyReloaded && typeof window !== 'undefined') {
          window.location.reload();
          return new Promise(() => {});
        }
        throw error || firstError;
      }
    }
  });
}
