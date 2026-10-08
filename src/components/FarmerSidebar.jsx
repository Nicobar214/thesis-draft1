import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabaseFarmer as supabase } from '../lib/supabase';
import Icons from './Icons';
import Logo from './Logo';
import SidebarEdgeToggle from './ui/SidebarEdgeToggle';

// Labels kept to one or two plain words each -- no jargon ("Logistics",
// "FMR", "Directory") a first-time farmer user would have to decode.
const navItems = [
  { to: '/farmer', label: 'My Farm', icon: Icons.MapPin },
  { to: '/farmer/harvest', label: 'My Harvest', icon: Icons.Wheat },
  { to: '/farmer/report', label: 'Report Issue', icon: Icons.Warning },
  { to: '/farmer/reports', label: 'My Reports', icon: Icons.Document },
  { to: '/farmer/fmr-projects', label: 'Road Projects', icon: Icons.Road },
  { to: '/farmer/markets', label: 'Markets', icon: Icons.Building },
];

// Three groups by what the page is FOR, not just what it's called:
//   Overview   - the one "where do things stand" home page
//   My Activity - things that are the farmer's own (mirrors the citizen
//                 portal's identical "My Activity" group, for the same
//                 reason: these are personal records, not reference data)
//   Browse     - everyone's data, for looking things up rather than acting
const NAV_GROUPS = [
  { label: 'Overview', to: ['/farmer'] },
  { label: 'My Activity', to: ['/farmer/harvest', '/farmer/report', '/farmer/reports'] },
  { label: 'Browse', to: ['/farmer/fmr-projects', '/farmer/markets'] },
];

export default function FarmerSidebar({ collapsed, setCollapsed, user, farmerRecord, pendingReportsCount = 0 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/farmer/login');
  }

  // Exact match only: no farmer route has nested sub-routes, and prefix
  // matching here is actively wrong -- '/farmer/report' is a text-prefix of
  // '/farmer/reports', so startsWith() lit up "Report Issue" and "My
  // Reports" at the same time whenever either one was open.
  const isActive = (path) => location.pathname === path;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-300 border-r border-slate-800 select-none">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800 shrink-0">
        {collapsed ? (
          <Logo variant="glyph" tone="light" className="size-9" alt="KalsaTrack" />
        ) : (
          <div className="flex flex-col gap-1 min-w-0">
            <Logo tone="light" className="h-7" />
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider leading-none">
              Farmer Portal
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className="space-y-1">
            {collapsed ? (
              gi > 0 && <div className="mx-2 my-2 border-t border-slate-800" />
            ) : (
              <p className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${gi > 0 ? 'pt-4' : 'pt-1'}`}>{group.label}</p>
            )}
            {group.to.map((path) => navItems.find((n) => n.to === path)).filter(Boolean).map((item) => {
              const active = isActive(item.to);
              const Icon = item.icon;
              const badge = item.to === '/farmer/reports' ? pendingReportsCount : 0;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group ${
                    active
                      ? 'bg-emerald-800 text-white font-semibold'
                      : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <span className={`relative ${active ? 'text-white' : 'text-slate-400 group-hover:text-emerald-400'}`}>
                    <Icon />
                    {collapsed && badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-slate-900 text-[9px] font-bold flex items-center justify-center">
                        {badge}
                      </span>
                    )}
                  </span>
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                  {!collapsed && badge > 0 && (
                    <span className="min-w-5 h-5 px-1 rounded-full bg-amber-400 text-slate-900 text-[10px] font-bold flex items-center justify-center">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-slate-800 px-3 py-4 space-y-2 shrink-0">
        {!collapsed && user && (
          <Link to="/farmer" className="block px-3 py-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Signed In</p>
            <p className="text-xs text-slate-200 font-medium truncate">{farmerRecord?.full_name || 'Farmer Account'}</p>
            <p className="text-[10px] text-slate-500 truncate">RSBSA: {farmerRecord?.rsbsa_number || 'N/A'}</p>
          </Link>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition-colors w-full ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Icons.Logout />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-50 p-2 bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 flex items-center justify-center"
        aria-label="Open Navigation Menu"
      >
        <Icons.Menu />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white"
        >
          <Icons.X />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-30 bg-slate-900 border-r border-slate-800 transition-all duration-300 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {sidebarContent}
        <SidebarEdgeToggle collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>
    </>
  );
}
