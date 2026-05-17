import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserSidebar from './UserSidebar';

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
    '/user/fmr-projects': 'FMR Projects',
    '/user/projects': 'Projects',
    '/user/map': 'Map View',
    '/user/reports': 'My Reports',
    '/user/feedback': 'Community Feedback',
    '/user/profile': 'Profile',
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

  const rootClass = rootClassName ?? 'min-h-screen bg-slate-50';

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
          <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900">{pageTitle}</h1>
              <p className="hidden sm:block text-sm text-slate-500">Welcome back, {userLabel}</p>
            </div>
          </header>
        )}

        <div className={`mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 pt-20 lg:pt-6 ${contentClassName}`}>
          {children}
        </div>
      </main>
    </div>
  );
}

