import { useEffect, useState } from 'react';

const DISMISS_KEY = 'pwa-install-banner-dismissed';
const UPDATE_EVENT = 'pwa-update-available';

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [applyUpdate, setApplyUpdate] = useState(null);

  useEffect(() => {
    if (isStandaloneDisplay()) {
      setHidden(true);
    }

    const dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    if (dismissed) {
      setHidden(true);
    }

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setHidden(dismissed);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setHidden(true);
      window.localStorage.setItem(DISMISS_KEY, '1');
    };

    const onUpdateAvailable = (event) => {
      setApplyUpdate(() => event.detail?.applyUpdate ?? null);
      setUpdateReady(true);
      setHidden(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener(UPDATE_EVENT, onUpdateAvailable);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener(UPDATE_EVENT, onUpdateAvailable);
    };
  }, []);

  const onInstall = async () => {
    if (!deferredPrompt) return;

    setInstalling(true);
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setInstalling(false);
    setDeferredPrompt(null);
    setHidden(true);
    window.localStorage.setItem(DISMISS_KEY, '1');
  };

  const onDismiss = () => {
    if (updateReady) {
      setUpdateReady(false);
      setApplyUpdate(null);
      return;
    }

    setHidden(true);
    window.localStorage.setItem(DISMISS_KEY, '1');
  };

  const onUpdate = async () => {
    if (!applyUpdate) return;

    setApplyingUpdate(true);
    await applyUpdate();
  };

  if (updateReady && applyUpdate) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[999] px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-emerald-200 bg-white/95 backdrop-blur shadow-xl shadow-emerald-900/10">
          <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Update available</p>
              <p className="mt-1 text-xs sm:text-sm text-slate-600">
                A new version is ready. Refresh when convenient to load the latest changes.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg px-3 py-2 text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Later
              </button>
              <button
                type="button"
                onClick={onUpdate}
                disabled={applyingUpdate}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {applyingUpdate ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!deferredPrompt || hidden || isStandaloneDisplay()) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[999] px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="mx-auto max-w-3xl rounded-2xl border border-emerald-200 bg-white/95 backdrop-blur shadow-xl shadow-emerald-900/10">
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Install KalsaTrack</p>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">
              Add this app to your home screen for faster access and offline support.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg px-3 py-2 text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={onInstall}
              disabled={installing}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {installing ? 'Installing...' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
