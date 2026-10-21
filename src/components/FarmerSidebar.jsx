import { useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabaseFarmer as supabase } from '../lib/supabase';
import Icons from './Icons';
import SidebarEdgeToggle from './ui/SidebarEdgeToggle';
import { confirmSignOut } from '../lib/confirm';
import { useFarmerT } from '../lib/farmerI18n';
import ProfileAvatar from './ui/ProfileAvatar';
import { SidebarAccount, SidebarBrand, SidebarFooter, SidebarGroupLabel, SidebarNav, SidebarNavItem, SidebarSignOut } from './ui/SidebarParts';

// Labels kept to one or two plain words each -- no jargon ("Logistics",
// "FMR", "Directory") a first-time farmer user would have to decode.
const navItems = [
  { to: '/farmer', labelKey: 'nav.myFarm', descKey: 'nav.desc.myFarm', icon: Icons.MapPin },
  { to: '/farmer/harvest', labelKey: 'nav.harvest', descKey: 'nav.desc.harvest', icon: Icons.Wheat },
  { to: '/farmer/reports', labelKey: 'nav.myReports', descKey: 'nav.desc.myReports', icon: Icons.Document },
  { to: '/farmer/fmr-projects', labelKey: 'nav.roadProjects', descKey: 'nav.desc.roadProjects', icon: Icons.Road },
  { to: '/farmer/community', labelKey: 'nav.community', descKey: 'nav.desc.community', icon: Icons.Feedback },
  { to: '/farmer/markets', labelKey: 'nav.markets', descKey: 'nav.desc.markets', icon: Icons.Building },
  { to: '/farmer/profile', labelKey: 'nav.myProfile', descKey: 'nav.desc.myProfile', icon: Icons.UserCircle },
];

// Groups by what the page is FOR: Overview (my farm and the roads serving it),
// My Activity (the farmer's own records), Browse (looking things up), Account.
const NAV_GROUPS = [
  { labelKey: 'nav.group.overview', to: ['/farmer', '/farmer/fmr-projects'] },
  { labelKey: 'nav.group.activity', to: ['/farmer/harvest', '/farmer/reports'] },
  { labelKey: 'nav.group.browse', to: ['/farmer/community', '/farmer/markets'] },
  { labelKey: 'nav.group.account', to: ['/farmer/profile'] },
];

export default function FarmerSidebar({ collapsed, setCollapsed, user, farmerRecord, displayName = '', pendingReportsCount = 0 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useFarmerT();

  async function handleLogout() {
    if (!(await confirmSignOut())) return;
    await supabase.auth.signOut({ scope: 'local' });
    navigate('/farmer/login');
  }

  // Exact match only: '/farmer/report' is a text-prefix of '/farmer/reports',
  // so prefix matching would light up two items at once.
  const isActive = (path) => location.pathname === path;

  // `isCollapsed` is false in the phone drawer, which always shows labels.
  const sidebarContent = (isCollapsed) => (
    <div className="flex h-full select-none flex-col bg-slate-900 text-white">
      <SidebarBrand collapsed={isCollapsed} portalLabel={t('portal.name')} />

      <SidebarNav data-tour="farmer-nav">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.labelKey} className="space-y-1.5">
            <SidebarGroupLabel label={t(group.labelKey)} first={gi === 0} collapsed={isCollapsed} />
            {group.to.map((path) => navItems.find((n) => n.to === path)).filter(Boolean).map((item) => {
              const Icon = item.icon;
              return (
                <SidebarNavItem
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  icon={<Icon />}
                  label={t(item.labelKey)}
                  description={t(item.descKey)}
                  active={isActive(item.to)}
                  collapsed={isCollapsed}
                  badge={item.to === '/farmer/reports' ? pendingReportsCount : 0}
                />
              );
            })}
          </div>
        ))}
      </SidebarNav>

      <SidebarFooter>
        {user && (
          <SidebarAccount
            collapsed={isCollapsed}
            to="/farmer/profile"
            onClick={() => setMobileOpen(false)}
            avatar={(
              <ProfileAvatar
                client={supabase}
                name={farmerRecord?.full_name || farmerRecord?.first_name}
                fallback="F"
                className="size-10 rounded-xl text-sm shadow-sm"
              />
            )}
            name={displayName}
            subtitle={`RSBSA: ${farmerRecord?.rsbsa_number || 'N/A'}`}
          />
        )}
        <SidebarSignOut collapsed={isCollapsed} onClick={handleLogout} label={t('nav.signOut')} />
      </SidebarFooter>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-[1200] p-2 bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 flex items-center justify-center"
        aria-label={t('nav.openMenu')}
      >
        <Icons.Menu />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[1150] bg-slate-950/70 backdrop-blur-xs transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-[1200] w-80 max-w-[85vw] bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="absolute top-4 right-4 z-10 p-1 text-slate-400 hover:text-white"
        >
          <Icons.X />
        </button>
        {sidebarContent(false)}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-30 bg-slate-900 border-r border-slate-800 shadow-2xl transition-all duration-300 ${
          collapsed ? 'w-20' : 'w-80'
        }`}
      >
        {sidebarContent(collapsed)}
        <SidebarEdgeToggle collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>
    </>
  );
}
