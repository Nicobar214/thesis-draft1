/* ContractorLayout.jsx – Shared layout for the contractor portal.
 * Sidebar (same pattern as the citizen portal) + a header with the page title and the
 * notification bell. It fetches the contractor's summary once and shares it through context,
 * so the sidebar counters and the dashboard always agree.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabaseContractor as supabase } from '../lib/supabase';
import { useContractorSummary } from '../lib/contractorPipeline';
import { ContractorSummaryContext } from '../lib/contractorSummaryContext';
import ContractorSidebar from './ContractorSidebar';
import NotificationBell from './NotificationBell';
import Icons from './Icons';

const PAGE_TITLES = {
  '/contractor': 'Dashboard',
  '/contractor/projects': 'My Projects',
  '/contractor/reports': 'Reports',
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

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Contractor';
  const pageTitle = PAGE_TITLES[location.pathname] || 'Contractor Portal';

  // A notification opens the thing it is about.
  const openNotification = (n) => {
    if (n.progress_update_id) navigate(`/contractor/reports?update=${n.progress_update_id}`);
    else if (n.project_id) navigate('/contractor/projects');
  };

  return (
    <ContractorSummaryContext.Provider value={summary}>
      <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
        <ContractorSidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} displayName={displayName} />

        <main className={`transition-all duration-300 min-h-screen ${collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'}`}>
          <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
            <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 pl-12 lg:pl-0">
                <h1 className="text-base sm:text-lg font-bold text-slate-900">{pageTitle}</h1>
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
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

                <NotificationBell client={supabase} onSelect={openNotification} />

                <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
                  <div className="w-8 h-8 rounded-lg bg-teal-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:block text-xs font-semibold text-slate-700">{displayName}</span>
                </div>
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
