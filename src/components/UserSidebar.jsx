import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import Icons from './Icons';

const navItems = [
  { to: '/user', label: 'Dashboard', icon: Icons.Dashboard },
  { to: '/user/fmr-projects', label: 'FMR Projects', icon: Icons.Road },
  { to: '/user/map', label: 'Map View', icon: Icons.MapPin },
  { to: '/user/reports', label: 'Reports', icon: Icons.Document },
  { to: '/user/feedback', label: 'Feedback', icon: Icons.Feedback },
  { to: '/user/profile', label: 'Profile', icon: Icons.Building },
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
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-slate-200 shrink-0">
        <div className="size-9 bg-teal-600 rounded-lg grid place-items-center shrink-0">
          <span className="text-white font-bold text-sm">K</span>
        </div>
        {!collapsed && (
          <span className="font-semibold text-slate-900 tracking-tight whitespace-nowrap">
            KalsaTrack
          </span>
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
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                active
                  ? 'bg-teal-50 text-teal-700 shadow-sm shadow-teal-100'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <Icon />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-slate-200 px-3 py-4 space-y-2 shrink-0">
        {!collapsed && user && (
          <Link to="/user/profile" className="block px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Signed in as</p>
            <p className="text-sm text-slate-700 truncate">{user.email}</p>
          </Link>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors w-full ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Icons.Logout />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse Toggle (desktop only) */}
      <div className="hidden lg:block border-t border-slate-200 px-3 py-3 shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
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
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-slate-200 text-slate-600"
      >
        <Icons.Menu />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600"
        >
          <Icons.X />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-30 bg-white border-r border-slate-200 transition-all duration-300 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}


