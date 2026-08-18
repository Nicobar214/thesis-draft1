import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import Icons from './Icons';
import Logo from './Logo';

const navItems = [
  { to: '/user', label: 'Dashboard', icon: Icons.Dashboard },
  { to: '/user/fmr-projects', label: 'FMR Projects', icon: Icons.Road },
  { to: '/user/map', label: 'Map View', icon: Icons.MapPin },
  { to: '/user/reports', label: 'My Reports', icon: Icons.Document },
  { to: '/user/feedback', label: 'Community Feedback', icon: Icons.Feedback },
  { to: '/user/profile', label: 'Profile Settings', icon: Icons.Building },
];

export default function UserSidebar({ collapsed, setCollapsed, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  const isActive = (path) => {
    if (path === '/user') return location.pathname === '/user';
    return location.pathname.startsWith(path);
  };

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
              Citizen Portal
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = isActive(item.to);
          const Icon = item.icon;
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
              <span className={active ? 'text-white' : 'text-slate-400 group-hover:text-emerald-400'}>
                <Icon />
              </span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-slate-800 px-3 py-4 space-y-2 shrink-0">
        {!collapsed && user && (
          <Link to="/user/profile" className="block px-3 py-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Signed In</p>
            <p className="text-xs text-slate-200 font-medium truncate">{user.email}</p>
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

      {/* Collapse Toggle (desktop only) */}
      <div className="hidden lg:block border-t border-slate-800 px-3 py-3 shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          {collapsed ? <Icons.ChevronRight /> : <Icons.ChevronLeft />}
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
      </aside>
    </>
  );
}


