import { Suspense, useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Outlet } from 'react-router-dom';
import { supabaseFarmer as supabase } from '../lib/supabase';
import { useFarmerRecord } from '../lib/useFarmerRecord';
import { useFarmerReports } from '../lib/useFarmerReports';
import FarmerSidebar from './FarmerSidebar';
import FarmerWelcomeTour from './farmer/FarmerWelcomeTour';
import PageTour from './ui/PageTour';
import { usePageTour } from '../lib/usePageTour';
import { farmerPageTours, farmerTourLabels } from './farmer/farmerPageTours';
import FarmerReportModal from './farmer/FarmerReportModal';
import NotificationBell from './NotificationBell';
import ProfileAvatar from './ui/ProfileAvatar';
import PortalHeader from './ui/PortalHeader';
import { CameraIcon, HelpCircleIcon, WifiOffIcon, RefreshCwIcon } from 'lucide-react';
import { useOnlineStatus } from '../lib/offlineCache';
import { listQueuedHarvests, syncQueuedHarvests, HARVEST_QUEUE_EVENT } from '../lib/offlineHarvests';
import { getQueuedReports } from '../lib/offlineReports';
import { triggerQueuedSync } from '../lib/offlineSync';
import { FarmerI18nProvider, useFarmerLanguageState } from '../lib/farmerI18n';
import { PageBodySkeleton } from './PageSkeletons';

// While a farmer page's code downloads, show that page's own skeleton
// inside the layout (the sidebar and header are already on screen).
function PageLoadingFallback() {
  return <PageBodySkeleton portal="farmer" />;
}

/**
 * FarmerLayout - the parent element for every /farmer/* route (see App.jsx),
 * mirroring UserLayout.jsx: persistent sidebar + header, and the data that's
 * the same no matter which farmer page is active (identity, notifications,
 * the first-time welcome tour).
 *
 * Rendered ONCE per route-tree, not per page: it sits on the parent <Route>
 * and renders child pages through <Outlet>, so navigating between farmer
 * pages does not remount the sidebar/header or re-run useFarmerRecord() /
 * useFarmerReports() -- that remount-per-page was why the RSBSA chip used to
 * blank out and refetch on every page change. Only the inner Suspense
 * (around the Outlet) shows a spinner for a not-yet-loaded page chunk; the
 * sidebar and header never unmount for it.
 */
export default function FarmerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [helpReopenCount, setHelpReopenCount] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();

  const { user, farmerRecord, loading, reload: reloadFarmerRecord } = useFarmerRecord();
  const { reports, loading: reportsLoading, reload: reloadReports } = useFarmerReports();
  const online = useOnlineStatus();
  // Farmer portal language (English / Hiligaynon / Tagalog), chosen in My Profile or the welcome guide.
  const i18n = useFarmerLanguageState();
  const { t } = i18n;
  const [pendingCount, setPendingCount] = useState(0);

  // Offline-first: harvests and road reports added with no signal wait on the
  // phone. Count them for the banner, and send them whenever the signal returns.
  useEffect(() => {
    if (!user?.id) return undefined;
    let alive = true;
    const countPending = async () => {
      const [harvests, queuedReports] = await Promise.all([
        listQueuedHarvests(user.id),
        getQueuedReports().catch(() => []),
      ]);
      const farmerReports = (queuedReports || []).filter((r) => r?.portal === 'farmer' && r?.status !== 'synced');
      if (alive) setPendingCount(harvests.length + farmerReports.length);
    };
    const sendPending = async () => {
      if (navigator.onLine === false) { countPending(); return; }
      await Promise.allSettled([syncQueuedHarvests(supabase), triggerQueuedSync()]);
      await countPending();
      reloadReports();
    };
    sendPending();
    window.addEventListener('online', sendPending);
    window.addEventListener(HARVEST_QUEUE_EVENT, countPending);
    return () => {
      alive = false;
      window.removeEventListener('online', sendPending);
      window.removeEventListener(HARVEST_QUEUE_EVENT, countPending);
    };
  }, [user?.id, reloadReports]);

  // The report dialog's open state lives in the URL (?action=new), the same
  // contract as the citizen portal's /user/reports?action=new. That keeps the
  // old /farmer/report route working (it redirects here), and lets a phone's
  // Back button close the dialog instead of leaving the page.
  const showReportModal = searchParams.get('action') === 'new';
  const openReport = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('action', 'new');
    return next;
  });
  const closeReport = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.delete('action');
    return next;
  }, { replace: true });

  // Matches FarmerSidebar's navItems labels exactly -- the header and the
  // sidebar should never name the current page two different ways.
  const pageTitleMap = {
    '/farmer': 'nav.myFarm',
    '/farmer/harvest': 'nav.harvest',
    '/farmer/reports': 'nav.myReports',
    '/farmer/community': 'nav.community',
    '/farmer/fmr-projects': 'nav.roadProjects',
    '/farmer/markets': 'nav.markets',
    '/farmer/profile': 'nav.myProfile',
  };
  const pageTitle = t(pageTitleMap[location.pathname] || 'portal.name');

  // ? opens a walkthrough of the page you are on, in the farmer's language.
  // The welcome guide (language choice) still opens by itself on the first
  // visit, so page walkthroughs only start from the ? button.
  const tourSteps = farmerPageTours(t)[location.pathname];
  const pageTour = usePageTour(tourSteps ? 'farmer-pages' : null, user?.id, { autoStart: false });

  const pageDescriptionMap = {
    '/farmer': 'page.myFarm.desc',
    '/farmer/harvest': 'page.harvest.desc',
    '/farmer/reports': 'page.myReports.desc',
    '/farmer/community': 'page.community.desc',
    '/farmer/fmr-projects': 'page.roadProjects.desc',
    '/farmer/markets': 'page.markets.desc',
    '/farmer/profile': 'page.myProfile.desc',
  };
  const pageDescription = pageDescriptionMap[location.pathname] ? t(pageDescriptionMap[location.pathname]) : '';

  // ProtectedRoute already guards every /farmer/* route; this is defense in
  // depth for the moment between that guard resolving and this layout's own
  // fetch finishing, same as UserLayout does for /user/*.
  useEffect(() => {
    if (!loading && !user) navigate('/farmer/login');
  }, [loading, user, navigate]);

  // If another tab signs out, or signs in as a different farmer, this tab
  // must not keep showing the previous account's data.
  useEffect(() => {
    let loadedFor;
    supabase.auth.getSession().then(({ data: { session } }) => { loadedFor = session?.user?.id ?? null; });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (loadedFor === undefined) return;
      const nextId = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT' || !nextId) {
        navigate('/farmer/login');
      } else if (loadedFor && nextId !== loadedFor) {
        window.location.reload();
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const pendingReportsCount = reports.filter((r) => r.status !== 'resolved').length;

  const resolveNotificationTarget = (n) => {
    if (!n.report_id) return null;
    const match = reports.find((r) => r.id === n.report_id);
    if (!match) return { unavailable: 'This report is no longer in your list.' };
    return {
      actionLabel: 'Open my report',
      details: [
        { label: 'Location', value: [match.barangay, match.municipality].filter(Boolean).join(', ') || '—' },
        { label: 'Status', value: String(match.status || 'pending').replace(/_/g, ' ') },
      ],
    };
  };

  const openNotification = (n) => {
    navigate(n.report_id ? `/farmer/reports?report=${n.report_id}` : '/farmer/reports');
  };

  return (
    <FarmerI18nProvider value={i18n}>
    <div className="min-h-dvh bg-slate-50 font-sans text-slate-800">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[10000] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-emerald-800 focus:shadow-lg focus:ring-2 focus:ring-emerald-600"
      >
        {t('skipToContent')}
      </a>

      <FarmerSidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        user={user}
        farmerRecord={farmerRecord}
        pendingReportsCount={pendingReportsCount}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className={`transition-all duration-300 ${collapsed ? 'lg:ml-20' : 'lg:ml-80'} min-h-dvh`}
      >
        <PortalHeader
          title={pageTitle}
          description={pageDescription}
          actions={(
            <>
              {/* Primary action, on every farmer page -- reporting a road
                  problem should never be more than one tap away. */}
              <button type="button" onClick={openReport} data-tour="farmer-report" className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700">
                <CameraIcon className="size-4" aria-hidden="true" />
                <span className="sm:hidden">{t('header.report')}</span>
                <span className="hidden sm:inline">{t('header.reportRoadIssue')}</span>
              </button>
              <button
                type="button"
                onClick={tourSteps ? pageTour.start : () => setHelpReopenCount((c) => c + 1)}
                data-tour="help"
                aria-label={t('header.help')}
                title={t('header.help')}
                className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
              >
                <HelpCircleIcon className="size-5" aria-hidden="true" />
              </button>
            </>
          )}
          bell={(
            <span data-tour="notifications" className="inline-flex">
              <NotificationBell client={supabase} resolveTarget={resolveNotificationTarget} onSelect={openNotification} />
            </span>
          )}
          account={{
            to: '/farmer/profile',
            avatar: <ProfileAvatar client={supabase} name={farmerRecord?.full_name || farmerRecord?.first_name} fallback="F" className="size-9 rounded-xl text-sm shadow-sm sm:size-10" />,
            name: farmerRecord?.full_name || t('farmerAccount'),
            detail: `RSBSA: ${farmerRecord?.rsbsa_number || 'N/A'}`,
          }}
        />

        {/* Offline status: what the farmer is looking at, and what is waiting to send. */}
        {!online ? (
          <div role="status" className="sticky top-20 sm:top-24 z-10 flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6 lg:px-8">
            <WifiOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              <span className="font-semibold">{t('banner.offline')}</span> {t('banner.offlineBody')}
              {pendingCount > 0 && <span className="font-semibold"> {t('banner.waiting', { n: pendingCount })}</span>}
            </p>
          </div>
        ) : pendingCount > 0 && (
          <div role="status" className="flex items-center gap-2.5 border-b border-teal-100 bg-teal-50 px-4 py-2 text-sm text-teal-900 sm:px-6 lg:px-8">
            <RefreshCwIcon className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            {t('banner.sending', { n: pendingCount })}
          </div>
        )}

        <div className="w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
          <Suspense fallback={<PageLoadingFallback />}>
            <Outlet context={{ openReport, reports, reportsLoading, reloadReports, user, farmerRecord, farmerLoading: loading, reloadFarmerRecord }} />
          </Suspense>
        </div>
      </main>

      <FarmerWelcomeTour userId={user?.id} reopenSignal={helpReopenCount} />
      {pageTour.open && tourSteps && (
        <PageTour key={location.pathname} steps={tourSteps} labels={farmerTourLabels(t)} onClose={pageTour.close} />
      )}

      {showReportModal && (
        <FarmerReportModal
          onClose={closeReport}
          onSubmitted={reloadReports}
        />
      )}
    </div>
    </FarmerI18nProvider>
  );
}
