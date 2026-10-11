/* ContractorLayout.jsx – Shared layout for the contractor portal.
 * Sidebar (same pattern as the citizen portal) + a header with the page title and the
 * notification bell. It fetches the contractor's summary once and shares it through context,
 * so the sidebar counters and the dashboard always agree.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabaseContractor as supabase } from '../lib/supabase';
import { useContractorSummary } from '../lib/contractorPipeline';
import { ContractorSummaryContext } from '../lib/contractorSummaryContext';
import ContractorSidebar from './ContractorSidebar';
import NotificationBell from './NotificationBell';
import Icons from './Icons';
import ProfileAvatar from './ui/ProfileAvatar';
import { useProfileNameUpdates } from '../lib/profileName';

const PAGE_TITLES = {
  '/contractor': 'Dashboard',
  '/contractor/projects': 'My Projects',
  '/contractor/reports': 'Reports',
  '/contractor/profile': 'My Profile',
};

export default function ContractorLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (!u) { navigate('/signin'); return; }
      setUser(u);
      supabase.from('profiles').select('full_name, email').eq('id', u.id).maybeSingle()
        .then(({ data }) => setProfile(data));
    });
  }, [navigate]);

  const summary = useContractorSummary(supabase, user?.id || null);
  useProfileNameUpdates(useCallback((name) => setProfile((p) => ({ ...(p || {}), full_name: name })), []));

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Contractor';
  const pageTitle = PAGE_TITLES[location.pathname] || 'Contractor Portal';

  // A notification opens the thing it is about.
  const resolveNotificationTarget = (n) => {
    if (n.progress_update_id) return { actionLabel: 'View this update' };
    if (n.project_id) return { actionLabel: 'Open my projects' };
    return null;
  };

  const openNotification = (n) => {
    if (n.progress_update_id) navigate(`/contractor/reports?update=${n.progress_update_id}`);
    else if (n.project_id) navigate('/contractor/projects');
  };

  return (
    <ContractorSummaryContext.Provider value={summary}>
      <div className="min-h-dvh bg-slate-50 font-sans text-slate-800">
        <ContractorSidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} displayName={displayName} />

        <main className={`transition-all duration-300 min-h-dvh ${collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'}`}>
          <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
            <div className="w-full px-4 sm:px-6 lg:px-8 h-18 sm:h-20 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 pl-12 lg:pl-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">{pageTitle}</h1>
                <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                  <Icons.ShieldCheck />
                  DA Region VI Contractor Portal
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  to="/contractor/projects"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors"
                >
                  <Icons.Plus />
                  <span>Submit Progress</span>
                </Link>

                <NotificationBell client={supabase} resolveTarget={resolveNotificationTarget} onSelect={openNotification} />

                <Link
                  to="/contractor/profile"
                  title="My profile"
                  aria-label="Open your profile"
                  className="flex items-center gap-2 pl-3 border-l border-slate-200 rounded-r-xl py-1 pr-1 hover:bg-slate-50 transition-colors"
                >
                  <ProfileAvatar client={supabase} name={displayName} fallback="C" className="size-9 rounded-xl text-xs shadow-xs" />
                  <span className="hidden sm:block max-w-[140px] truncate text-xs font-semibold text-slate-700">{displayName}</span>
                </Link>
              </div>
            </div>
          </header>

          <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </ContractorSummaryContext.Provider>
  );
}
