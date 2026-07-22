import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserSidebar from './UserSidebar';
import Icons from './Icons';

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
  mainClassName = 'min-h-screen',
  contentClassName = '',
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const pageTitleMap = {
    '/user': 'Dashboard',
    '/user/fmr-projects': 'FMR Projects Directory',
    '/user/projects': 'FMR Projects Directory',
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

  const rootClass = rootClassName ?? 'min-h-screen bg-slate-50 font-sans text-slate-800';

  return (
    <div className={rootClass}>
      {showSidebar && (
        <UserSidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
      )}

      {/* Main content area */}
      <main
        className={`transition-all duration-300 ${showSidebar ? (collapsed ? 'lg:ml-[72px]' : 'lg:ml-64') : ''} ${mainClassName}`}
      >
        {showHeader && (
          <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-base sm:text-lg font-bold text-slate-900">{pageTitle}</h1>
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <Icons.ShieldCheck />
                  DA Region VI Citizen Portal
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  to="/user/reports?action=new"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 text-xs font-semibold transition-colors"
                >
                  <Icons.Warning />
                  <span>Report Road Issue</span>
                </Link>

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

        <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 pt-16 lg:pt-6 ${contentClassName}`}>
          {children}
        </div>
      </main>
    </div>
  );
}

