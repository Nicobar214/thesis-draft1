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
import PortalHeader from './ui/PortalHeader';
import { useProfileNameUpdates } from '../lib/profileName';

// One line under the title, as on every portal's header.
const PAGE_DESCRIPTIONS = {
  '/contractor': 'Your assigned projects and what needs attention',
  '/contractor/projects': 'Roads assigned to you, their progress and your submission history',
  '/contractor/reports': 'Citizen reports on your roads and the repairs assigned to you',
  '/contractor/profile': 'Your photo, contact number and account details',
};

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
      if (!u) { navigate('/contractor/login'); return; }
      setUser(u);
      supabase.from('profiles').select('full_name, email').eq('id', u.id).maybeSingle()
        .then(({ data }) => setProfile(data));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        navigate('/contractor/login');
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const summary = useContractorSummary(supabase, user?.id || null);
  useProfileNameUpdates(useCallback((name) => setProfile((p) => ({ ...(p || {}), full_name: name })), []));

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Contractor';
  const pageTitle = PAGE_TITLES[location.pathname] || 'Contractor Portal';
  const pageDescription = PAGE_DESCRIPTIONS[location.pathname] || '';

  // A notification opens the thing it is about.
  const resolveNotificationTarget = (n) => {
    if (n.progress_update_id) return { actionLabel: 'View this update' };
    if (n.project_id) return { actionLabel: 'Open my projects' };
    if (n.report_id) return { actionLabel: 'Open citizen report repairs' };
    return null;
  };

  const openNotification = (n) => {
    if (n.progress_update_id) navigate(`/contractor/projects?update=${n.progress_update_id}`);
    else if (n.project_id) navigate('/contractor/projects');
    else if (n.report_id) navigate('/contractor/reports');
  };

  return (
    <ContractorSummaryContext.Provider value={summary}>
      <div className="min-h-dvh bg-slate-50 font-sans text-slate-800">
        <ContractorSidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} displayName={displayName} />

        <main className={`transition-all duration-300 min-h-dvh ${collapsed ? 'lg:ml-20' : 'lg:ml-80'}`}>
          <PortalHeader
            title={pageTitle}
            description={pageDescription}
            actions={(
              <Link to="/contractor/projects" className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700">
                <Icons.Plus />
                <span className="hidden sm:inline">Submit Progress</span>
              </Link>
            )}
            bell={<NotificationBell client={supabase} resolveTarget={resolveNotificationTarget} onSelect={openNotification} />}
            account={{
              to: '/contractor/profile',
              avatar: <ProfileAvatar client={supabase} name={displayName} fallback="C" className="size-9 rounded-xl text-sm shadow-sm sm:size-10" />,
              name: displayName,
              detail: user?.email,
            }}
          />

          <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </ContractorSummaryContext.Provider>
  );
}
