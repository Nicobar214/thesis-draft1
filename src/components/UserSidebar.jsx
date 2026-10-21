import { useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import Icons from './Icons';
import SidebarEdgeToggle from './ui/SidebarEdgeToggle';
import { SidebarConnectionStatus } from './UserSidebarStatus';
import { confirmSignOut } from '../lib/confirm';
import ProfileAvatar from './ui/ProfileAvatar';
import { getAvatarUrl } from '../lib/avatar';
import { SidebarAccount, SidebarBrand, SidebarFooter, SidebarGroupLabel, SidebarNav, SidebarNavItem, SidebarSignOut } from './ui/SidebarParts';

const navItems = [
  { to: '/user', label: 'Dashboard', description: 'Your roads and reports at a glance', icon: Icons.Dashboard },
  { to: '/user/fmr-projects', label: 'FMR Projects', description: 'Browse farm-to-market roads', icon: Icons.Road },
  { to: '/user/map', label: 'Map View', description: 'Road projects on the map', icon: Icons.MapPin },
  { to: '/user/reports', label: 'My Reports', description: 'Track the reports you sent', icon: Icons.Document },
  { to: '/user/feedback', label: 'Community Feedback', description: 'What others are reporting', icon: Icons.Feedback },
  { to: '/user/profile', label: 'Profile Settings', description: 'Your account details', icon: Icons.UserCircle },
];

const NAV_GROUPS = [
  { label: 'Workspace', to: ['/user', '/user/map'] },
  { label: 'Projects', to: ['/user/fmr-projects'] },
  { label: 'My Activity', to: ['/user/reports', '/user/feedback'] },
  { label: 'Account', to: ['/user/profile'] },
];

export default function UserSidebar({ collapsed, setCollapsed, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    if (!(await confirmSignOut())) return;
    await supabase.auth.signOut();
    navigate('/signin');
  }

  const isActive = (path) => {
    if (path === '/user') return location.pathname === '/user';
    return location.pathname.startsWith(path);
  };

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')?.[0] || 'Citizen';

  // `isCollapsed` is false in the phone drawer, which always shows labels.
  const sidebarContent = (isCollapsed) => (
    <div className="flex h-full select-none flex-col bg-slate-900 text-white">
      <SidebarBrand collapsed={isCollapsed} portalLabel="Citizen Portal" />

      <SidebarNav data-tour="nav">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className="space-y-1.5">
            <SidebarGroupLabel label={group.label} first={gi === 0} collapsed={isCollapsed} />
            {group.to.map((path) => navItems.find((n) => n.to === path)).filter(Boolean).map((item) => {
              const Icon = item.icon;
              return (
                <SidebarNavItem
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  icon={<Icon />}
                  label={item.label}
                  description={item.description}
                  active={isActive(item.to)}
                  collapsed={isCollapsed}
                />
              );
            })}
          </div>
        ))}
      </SidebarNav>

      <SidebarFooter>
        <SidebarConnectionStatus collapsed={isCollapsed} />
        {user && (
          <div className="mt-3">
            <SidebarAccount
              collapsed={isCollapsed}
              to="/user/profile"
              onClick={() => setMobileOpen(false)}
              avatar={<ProfileAvatar src={getAvatarUrl(user)} name={userName} className="size-10 rounded-xl text-sm shadow-sm" />}
              name={userName}
              subtitle="Citizen Account"
            />
          </div>
        )}
        <SidebarSignOut collapsed={isCollapsed} onClick={handleLogout} />
      </SidebarFooter>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 sm:top-5 left-4 z-[1200] p-2 bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 flex items-center justify-center"
        aria-label="Open Navigation Menu"
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
