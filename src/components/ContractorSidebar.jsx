import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabaseContractor as supabase } from '../lib/supabase';
import Icons from './Icons';
import Logo from './Logo';
import SidebarEdgeToggle from './ui/SidebarEdgeToggle';
import { AttentionSummary, ConnectionStatus } from './ui/SidebarStatusCards';
import { useContractorSummaryContext } from '../lib/contractorSummaryContext';

const NAV_GROUPS = [
  { label: 'Workspace', items: [{ to: '/contractor', label: 'Dashboard', icon: Icons.Dashboard, exact: true }] },
  { label: 'Work', items: [{ to: '/contractor/projects', label: 'My Projects', icon: Icons.Road }] },
  { label: 'Records', items: [{ to: '/contractor/reports', label: 'Reports', icon: Icons.Document }] },
];

export default function ContractorSidebar({ collapsed, setCollapsed, user, displayName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const summary = useContractorSummaryContext();

  const isActive = (item) => (item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to));

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/signin');
  }

  // Counters on the nav items so the work waiting is visible without opening a page.
  const badgeFor = (to) => {
    if (to === '/contractor/projects') return summary.withoutEngineer.length;
    if (to === '/contractor/reports') return summary.needsFix.length;
    return 0;
  };

  const attentionRows = [
    { key: 'fix', label: 'Needs correction', count: summary.needsFix.length, tone: 'rose', onClick: () => navigate('/contractor/reports') },
    { key: 'engineer', label: 'With site engineer', count: summary.awaitingEngineer.length, tone: 'amber', onClick: () => navigate('/contractor/reports') },
    { key: 'admin', label: 'With DA for approval', count: summary.awaitingAdmin.length, tone: 'sky', onClick: () => navigate('/contractor/reports') },
    { key: 'noeng', label: 'No site engineer yet', count: summary.withoutEngineer.length, tone: 'rose', onClick: () => navigate('/contractor/projects') },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-300 border-r border-slate-800 select-none">
      <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800 shrink-0">
        {collapsed ? (
          <Logo variant="glyph" tone="light" className="size-9" alt="KalsaTrack" />
        ) : (
          <div className="flex flex-col gap-1 min-w-0">
            <Logo tone="light" className="h-7" />
            <span className="text-[10px] font-semibold text-teal-400 uppercase tracking-wider leading-none">Contractor Portal</span>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 py-3 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className="space-y-1">
            {collapsed ? (
              gi > 0 && <div className="mx-2 my-2 border-t border-slate-800" />
            ) : (
              <p className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${gi > 0 ? 'pt-4' : 'pt-1'}`}>{group.label}</p>
            )}
            {group.items.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              const badge = badgeFor(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group ${
                    active ? 'bg-teal-700 text-white font-semibold' : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <span className={active ? 'text-white' : 'text-slate-400 group-hover:text-teal-400'}><Icon /></span>
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                  {!collapsed && badge > 0 && (
                    <span className="min-w-5 rounded-full bg-rose-500 px-1.5 text-center text-[10px] font-bold leading-5 text-white">{badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        {!collapsed && <AttentionSummary title="Your submissions" rows={attentionRows} />}
      </nav>

      <div className="border-t border-slate-800 px-3 py-4 space-y-2 shrink-0">
        <ConnectionStatus collapsed={collapsed} />
        {!collapsed && user && (
          <div className="px-3 py-2 rounded-xl bg-slate-800/50">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Signed In</p>
            <p className="text-xs text-slate-200 font-medium truncate">{displayName}</p>
            <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition-colors w-full ${collapsed ? 'justify-center' : ''}`}
        >
          <Icons.Logout />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-50 p-2 bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 flex items-center justify-center"
        aria-label="Open navigation menu"
      >
        <Icons.Menu />
      </button>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs transition-opacity" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button onClick={() => setMobileOpen(false)} aria-label="Close navigation menu" className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white">
          <Icons.X />
        </button>
        {sidebarContent}
      </aside>

      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-30 bg-slate-900 border-r border-slate-800 transition-all duration-300 ${collapsed ? 'w-[72px]' : 'w-64'}`}
      >
        {sidebarContent}
        <SidebarEdgeToggle collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>
    </>
  );
}
