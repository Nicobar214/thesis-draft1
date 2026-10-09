import { Suspense, useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Outlet } from 'react-router-dom';
import { supabaseFarmer as supabase } from '../lib/supabase';
import { useFarmerRecord } from '../lib/useFarmerRecord';
import { useFarmerReports } from '../lib/useFarmerReports';
import FarmerSidebar from './FarmerSidebar';
import FarmerWelcomeTour from './farmer/FarmerWelcomeTour';
import FarmerProfileModal from './farmer/FarmerProfileModal';
import FarmerReportModal from './farmer/FarmerReportModal';
import NotificationBell from './NotificationBell';
import { CameraIcon, HelpCircleIcon } from 'lucide-react';

function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-10 h-10 border-4 border-emerald-200 border-t-emerald-700 rounded-full animate-spin" />
    </div>
  );
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const { user, farmerRecord, loading, reload: reloadFarmerRecord } = useFarmerRecord();
  const { reports, loading: reportsLoading, reload: reloadReports } = useFarmerReports();

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
    '/farmer': 'My Farm',
    '/farmer/harvest': 'Harvest',
    '/farmer/reports': 'My Reports',
    '/farmer/fmr-projects': 'Road Projects',
    '/farmer/markets': 'Markets',
  };
  const pageTitle = pageTitleMap[location.pathname] || 'Farmer Portal';

  const pageDescriptionMap = {
    '/farmer': 'Your farm, nearest road project, and nearest market at a glance.',
    '/farmer/harvest': 'Log your harvests and track your output over time.',
    '/farmer/reports': 'Track the status of reports you’ve submitted.',
    '/farmer/fmr-projects': 'Every Farm-to-Market Road project in your area.',
    '/farmer/markets': 'Find nearby markets to sell or distribute your harvest.',
  };
  const pageDescription = pageDescriptionMap[location.pathname] || '';

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
    <div className="min-h-dvh bg-slate-50 font-sans text-slate-800">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[10000] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-emerald-800 focus:shadow-lg focus:ring-2 focus:ring-emerald-600"
      >
        Skip to main content
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
        className={`transition-all duration-300 ${collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'} min-h-dvh`}
      >
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
          <div className="w-full px-4 sm:px-6 lg:px-8 h-20 sm:h-24 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3 pl-12 lg:pl-0">
              <div className="min-w-0">
                <h1 className="truncate text-lg sm:text-2xl font-bold text-slate-900">{pageTitle}</h1>
                {pageDescription && (
                  <p className="hidden sm:block mt-0.5 text-xs text-slate-500 truncate">{pageDescription}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {/* Primary action, on every farmer page -- reporting a road
                  problem should never be more than one tap away. */}
              <button
                type="button"
                onClick={openReport}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 sm:px-4 sm:py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 active:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
              >
                <CameraIcon className="size-4 sm:size-5" aria-hidden="true" />
                <span className="sm:hidden">Report</span>
                <span className="hidden sm:inline">Report Road Issue</span>
              </button>

              <button
                type="button"
                onClick={() => setHelpReopenCount((c) => c + 1)}
                aria-label="Show help"
                title="Show help"
                className="p-2 sm:p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
              >
                <HelpCircleIcon className="size-4 sm:size-5" aria-hidden="true" />
              </button>

              <NotificationBell
                client={supabase}
                resolveTarget={resolveNotificationTarget}
                onSelect={openNotification}
              />

              {/* Farmer profile, top right. Clickable -- opens the profile/
                  settings modal so an editable detail (contact number) is
                  never more than one tap from wherever the farmer is. */}
              <button
                type="button"
                onClick={() => setShowProfileModal(true)}
                aria-label="View and edit your profile"
                title="View and edit your profile"
                className="flex items-center gap-2.5 sm:gap-3 pl-2.5 sm:pl-4 border-l border-slate-200 rounded-xl hover:bg-slate-50 transition-colors -mr-1 py-1 pr-1"
              >
                <div className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 rounded-xl bg-gradient-to-br from-emerald-700 to-teal-700 text-white font-bold text-sm sm:text-base flex items-center justify-center shadow-sm">
                  {(farmerRecord?.first_name || farmerRecord?.full_name || 'F').charAt(0).toUpperCase()}
                </div>
                <div className="hidden sm:block min-w-0 text-left">
                  <p className="text-sm font-bold text-slate-900 truncate max-w-[160px]">{farmerRecord?.full_name || 'Farmer Account'}</p>
                  <p className="text-xs text-slate-500 truncate max-w-[160px]">RSBSA: {farmerRecord?.rsbsa_number || 'N/A'}</p>
                </div>
              </button>
            </div>
          </div>
        </header>

        <div className="w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
          <Suspense fallback={<PageLoadingFallback />}>
            <Outlet context={{ openReport, reports, reportsLoading, reloadReports }} />
          </Suspense>
        </div>
      </main>

      <FarmerWelcomeTour userId={user?.id} reopenSignal={helpReopenCount} />

      {showReportModal && (
        <FarmerReportModal
          onClose={closeReport}
          onSubmitted={reloadReports}
        />
      )}

      {showProfileModal && (
        <FarmerProfileModal
          farmerRecord={farmerRecord}
          onSaved={reloadFarmerRecord}
          onClose={() => setShowProfileModal(false)}
        />
      )}
    </div>
  );
}
