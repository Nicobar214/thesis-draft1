import { useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabaseContractor as supabase } from '../lib/supabase';
import Icons from './Icons';
import SidebarEdgeToggle from './ui/SidebarEdgeToggle';
import { ConnectionStatus } from './ui/SidebarStatusCards';
import { useContractorSummaryContext } from '../lib/contractorSummaryContext';
import { confirmSignOut } from '../lib/confirm';
import ProfileAvatar from './ui/ProfileAvatar';
import { SidebarAccount, SidebarBrand, SidebarFooter, SidebarGroupLabel, SidebarNav, SidebarNavItem, SidebarSignOut } from './ui/SidebarParts';

const NAV_GROUPS = [
  { label: 'Workspace', items: [{ to: '/contractor', label: 'Dashboard', description: 'Your projects at a glance', icon: Icons.Dashboard, exact: true }] },
  { label: 'Work', items: [
    { to: '/contractor/projects', label: 'My Projects', description: 'Roads assigned to you', icon: Icons.Road },
    { to: '/contractor/priority', label: 'Priority Tasks', description: 'Requests from the DA prioritization', icon: Icons.ShieldCheck },
    { to: '/contractor/delays', label: 'Delay Follow-ups', description: 'Explain late projects to the DA', icon: Icons.Clock },
  ] },
  { label: 'Records', items: [{ to: '/contractor/reports', label: 'Reports', description: 'Citizen reports and repairs', icon: Icons.Document }] },
  { label: 'Account', items: [{ to: '/contractor/profile', label: 'My Profile', description: 'Your account details', icon: Icons.UserCircle }] },
];

export default function ContractorSidebar({ collapsed, setCollapsed, user, displayName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const summary = useContractorSummaryContext();

  const isActive = (item) => (item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to));

  async function handleLogout() {
    if (!(await confirmSignOut())) return;
    await supabase.auth.signOut({ scope: 'local' });
    navigate('/contractor/login');
  }

  // Counters on the nav items so the work waiting is visible without opening a page.
  const badgeFor = (to) => {
    // Returned updates are fixed from the history on My Projects.
    if (to === '/contractor/projects') return summary.withoutEngineer.length + summary.needsFix.length;
    if (to === '/contractor/reports') return summary.repairsToDo || 0;
    if (to === '/contractor/delays') return summary.delayReplies || 0;
    if (to === '/contractor/priority') return summary.priorityReplies || 0;
    return 0;
  };

  // `isCollapsed` is false in the phone drawer, which always shows labels.
  const sidebarContent = (isCollapsed) => (
    <div className="flex h-full select-none flex-col bg-slate-900 text-white">
      <SidebarBrand collapsed={isCollapsed} portalLabel="Contractor Portal" />

      <SidebarNav>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className="space-y-1.5">
            <SidebarGroupLabel label={group.label} first={gi === 0} collapsed={isCollapsed} />
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarNavItem
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  icon={<Icon />}
                  label={item.label}
                  description={item.description}
                  active={isActive(item)}
                  collapsed={isCollapsed}
                  badge={badgeFor(item.to)}
                />
              );
            })}
          </div>
        ))}
      </SidebarNav>

      <SidebarFooter>
        <ConnectionStatus collapsed={isCollapsed} />
        {user && (
          <div className="mt-3">
            <SidebarAccount
              collapsed={isCollapsed}
              to="/contractor/profile"
              onClick={() => setMobileOpen(false)}
              avatar={<ProfileAvatar client={supabase} name={displayName} fallback="C" className="size-10 rounded-xl text-sm shadow-sm" />}
              name={displayName || user.email}
              subtitle="Contractor Account"
            />
          </div>
        )}
        <SidebarSignOut collapsed={isCollapsed} onClick={handleLogout} />
      </SidebarFooter>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 sm:top-5 left-3 sm:left-4 z-[1200] p-2 bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 flex items-center justify-center"
        aria-label="Open navigation menu"
      >
        <Icons.Menu />
      </button>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[1150] bg-slate-950/70 backdrop-blur-xs transition-opacity" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-[1200] w-80 max-w-[85vw] bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button onClick={() => setMobileOpen(false)} aria-label="Close navigation menu" className="absolute top-4 right-4 z-10 p-1 text-slate-400 hover:text-white">
          <Icons.X />
        </button>
        {sidebarContent(false)}
      </aside>

      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-30 bg-slate-900 border-r border-slate-800 shadow-2xl transition-all duration-300 ${collapsed ? 'w-20' : 'w-80'}`}
      >
        {sidebarContent(collapsed)}
        <SidebarEdgeToggle collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>
    </>
  );
}
