import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserSidebar from './UserSidebar';
import Icons from './Icons';
import NotificationBell from './NotificationBell';

/**
 * UserLayout - Shared layout wrapper for all user pages.
 * Provides the sidebar and main content area.
 */
export default function UserLayout({
  children,
  requireAuth = true,
  showSidebar = true,
  showHeader = true,
  rootClassName,
  mainClassName = 'min-h-dvh',
  contentClassName = '',
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const pageTitleMap = {
    '/user': 'Dashboard',
    '/user/fmr-projects': 'FMR Projects Directory',
    '/user/map': 'Geospatial Map View',
    '/user/reports': 'My Road Reports',
    '/user/feedback': 'Community Feedback Hub',
    '/user/profile': 'Profile & Account Settings',
  };

  const pageTitle = pageTitleMap[location.pathname] || 'User Portal';
  const userLabel = user?.email?.split('@')?.[0] || 'there';

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
            <div className={`${showSidebar ? 'w-full' : 'mx-auto max-w-7xl'} px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4`}>
              <div className="flex min-w-0 items-center gap-3 pl-12 lg:pl-0">
                <h1 className="truncate text-base sm:text-lg font-bold text-slate-900">{pageTitle}</h1>
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <Icons.ShieldCheck />
                  DA Region VI Citizen Portal
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Closes the citizen feedback loop: status changes were already
                    being written to notifications, but never displayed. */}
                <NotificationBell
                  client={supabase}
                  resolveTarget={resolveNotificationTarget}
                  onSelect={openNotification}
                />

                <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
                  <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                    {userLabel.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:block text-xs font-semibold text-slate-700">{userLabel}</span>
                </div>
              </div>
            </div>
          </header>
        )}

        <div className={`${showSidebar ? 'w-full' : 'mx-auto max-w-7xl'} px-4 sm:px-6 lg:px-8 pb-6 ${showHeader ? 'pt-5' : 'pt-16'} lg:pt-6 ${contentClassName}`}>
          {children}
        </div>
      </main>
    </div>
  );
}

