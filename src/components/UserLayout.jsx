import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HelpCircleIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import UserSidebar from './UserSidebar';
import Icons from './Icons';
import NotificationBell from './NotificationBell';
import PageTour from './ui/PageTour';
import { usePageTour } from '../lib/usePageTour';
import { USER_PAGE_TOURS } from './user/userPageTours';
import ProfileAvatar from './ui/ProfileAvatar';
import { getAvatarUrl } from '../lib/avatar';

/**
 * UserLayout - Shared layout wrapper for all user pages.
 * Provides the sidebar and main content area.
 */
export default function UserLayout({
  children,
  requireAuth = true,
  showSidebar = true,
  showHeader = true,
  // Page-level buttons (e.g. "Submit New Report") shown in the top bar, so the page
  // doesn't need its own row above the content just for them.
  headerActions = null,
  rootClassName,
  mainClassName = 'min-h-dvh',
  contentClassName = '',
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  // Each page has its own guide. It opens by itself only once per account;
  // after that only the ? button opens it.
  const tourSteps = USER_PAGE_TOURS[location.pathname];
  const params = new URLSearchParams(location.search);
  const openedForTask = params.has('action') || params.has('report') || params.has('project');
  const tour = usePageTour(requireAuth && tourSteps ? 'citizen' : null, user?.id, { autoStart: !openedForTask });

  // Each page's name, one-line description and icon live here, in the sticky top bar,
  // so pages don't repeat their own title underneath it. Icons match the sidebar.
  const pageMeta = {
    '/user': { title: 'Dashboard', description: 'Your overview of road projects and reports', icon: Icons.Dashboard },
    '/user/fmr-projects': { title: 'FMR Projects Directory', description: 'Browse farm-to-market road projects across Region VI', icon: Icons.Road },
    '/user/map': { title: 'Geospatial Map View', description: 'See where FMR projects are across Iloilo Province', icon: Icons.MapPin },
    '/user/reports': { title: 'My Road Reports', description: 'Track the status of the reports you submitted', icon: Icons.Document },
    '/user/feedback': { title: 'Community Feedback Hub', description: 'See what others have reported and follow your own', icon: Icons.Feedback },
    '/user/profile': { title: 'Profile & Account Settings', description: 'Manage your details, location, notifications and security', icon: Icons.UserCircle },
  };

  const page = pageMeta[location.pathname] || { title: 'User Portal', description: '', icon: null };
  const PageIcon = page.icon;
  const userLabel = user?.user_metadata?.full_name || user?.email?.split('@')?.[0] || 'there';

  useEffect(() => {
    if (!requireAuth) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) navigate('/signin');
      else setUser(user);
    });
  }, [navigate, requireAuth]);

  // The citizen session lives in one localStorage slot shared by every tab of this browser
  // profile. If another tab signs in as a different account (or signs out), this tab must not
  // keep showing the previous account's data: reload for the new user, or go to sign-in.
  useEffect(() => {
    if (!requireAuth) return undefined;
    let loadedFor;
    supabase.auth.getSession().then(({ data: { session } }) => { loadedFor = session?.user?.id ?? null; });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (loadedFor === undefined) return;
      const nextId = session?.user?.id ?? null;
      // Profile saves (name, photo) fire USER_UPDATED: refresh the header with them.
      if (event === 'USER_UPDATED' && session?.user && nextId === loadedFor) {
        setUser(session.user);
        return;
      }
      if (event === 'SIGNED_OUT' || !nextId) {
        navigate('/signin');
      } else if (loadedFor && nextId !== loadedFor) {
        window.location.reload();
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate, requireAuth]);

  // A citizen's notifications are about their own reports, or about a project they follow.
  const isProjectNotification = (n) => Boolean(n.project_id) && !n.report_id;
  const resolveNotificationTarget = (n) => ({
    actionLabel: isProjectNotification(n) ? 'View project' : n.report_id ? 'Open my report' : 'Go to my reports',
  });
  const openNotification = (n) => {
    if (isProjectNotification(n)) {
      navigate(`/user/fmr-projects?project=${n.project_id}`);
      return;
    }
    navigate(n.report_id ? `/user/reports?report=${n.report_id}` : '/user/reports');
  };

  const rootClass = rootClassName ?? 'min-h-dvh bg-slate-50 font-sans text-slate-800';

  return (
    <div className={rootClass}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[10000] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-teal-800 focus:shadow-lg focus:ring-2 focus:ring-teal-600"
      >
        Skip to main content
      </a>
      {showSidebar && (
        <UserSidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
      )}

      {/* Main content area */}
      <main
        id="main-content"
        tabIndex={-1}
        className={`transition-all duration-300 ${showSidebar ? (collapsed ? 'lg:ml-[72px]' : 'lg:ml-64') : ''} ${mainClassName}`}
      >
        {showHeader && (
          <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
            <div className={`${showSidebar ? 'w-full' : 'mx-auto max-w-7xl'} px-4 sm:px-6 lg:px-8 h-18 sm:h-20 flex items-center justify-between gap-4`}>
              <div className="flex min-w-0 items-center gap-3.5 pl-12 lg:pl-0">
                {PageIcon && (
                  <span className="hidden sm:grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-teal-700" aria-hidden="true">
                    <PageIcon />
                  </span>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-lg sm:text-2xl font-bold tracking-tight text-slate-900 leading-tight">{page.title}</h1>
                  {page.description && (
                    <p className="hidden sm:block truncate text-sm text-slate-500">{page.description}</p>
                  )}
                </div>
                <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <Icons.ShieldCheck />
                  DA Region VI Citizen Portal
                </span>
              </div>

              <div className="flex items-center gap-3">
                {headerActions && (
                  <div className="flex items-center gap-2 border-r border-slate-200 pr-3">{headerActions}</div>
                )}
                {tourSteps && (
                  <button
                    type="button"
                    onClick={tour.start}
                    data-tour="help"
                    aria-label="Show a guide to this page"
                    title="Show a guide to this page"
                    className="p-2 sm:p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                  >
                    <HelpCircleIcon className="size-4 sm:size-5" aria-hidden="true" />
                  </button>
                )}

                {/* Closes the citizen feedback loop: status changes were already
                    being written to notifications, but never displayed. */}
                <span data-tour="notifications" className="inline-flex">
                  <NotificationBell
                    client={supabase}
                    resolveTarget={resolveNotificationTarget}
                    onSelect={openNotification}
                  />
                </span>

                <button
                  type="button"
                  onClick={() => navigate('/user/profile')}
                  aria-label="Open your profile"
                  title="Profile settings"
                  className="flex items-center gap-2 pl-3 border-l border-slate-200 rounded-r-xl py-1 pr-1 hover:bg-slate-50 transition-colors"
                >
                  <ProfileAvatar src={getAvatarUrl(user)} name={userLabel} className="size-9 rounded-xl text-xs shadow-xs" />
                  <span className="hidden sm:block max-w-[140px] truncate text-xs font-semibold text-slate-700">{userLabel}</span>
                </button>
              </div>
            </div>
          </header>
        )}

        <div className={`${showSidebar ? 'w-full' : 'mx-auto max-w-7xl'} px-4 sm:px-6 lg:px-8 pb-6 ${showHeader ? 'pt-5' : 'pt-16'} lg:pt-6 ${contentClassName}`}>
          {children}
        </div>
      </main>

      {tour.open && tourSteps && <PageTour steps={tourSteps} onClose={tour.close} />}
    </div>
  );
}

