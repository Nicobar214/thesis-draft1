/* ContractorLayout.jsx – Shared layout for contractor portal
 * Top-nav with: Dashboard | My Projects | Reports
 * Shows contractor's name + amber "Contractor" role badge.
 */
import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const NAV_ITEMS = [
  { to: '/contractor',          label: 'Dashboard',   exact: true },
  { to: '/contractor/projects', label: 'My Projects', exact: false },
  { to: '/contractor/reports',  label: 'Reports',     exact: false },
];

export default function ContractorLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (!u) { navigate('/signin'); return; }
      setUser(u);
      supabase.from('profiles').select('full_name, email').eq('id', u.id).maybeSingle()
        .then(({ data }) => setProfile(data));
    });
  }, [navigate]);

  const isActive = (item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/signin');
  };

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Contractor';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticky header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-200/50 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="size-9 bg-teal-600 rounded-lg grid place-items-center">
                <span className="text-white font-bold text-sm">K</span>
              </div>
              <span className="font-semibold text-slate-900 tracking-tight hidden sm:block">KalsaTrack</span>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive(item)
                      ? 'bg-teal-50 text-teal-700 shadow-sm shadow-teal-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right side: badge + name + sign out */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                  Contractor
                </span>
                <span className="text-sm text-slate-700 font-medium">{displayName}</span>
              </div>
              <button
                onClick={handleSignOut}
                className="px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
              >
                Sign Out
              </button>
              {/* Mobile hamburger */}
              <button
                className="md:hidden p-2 rounded-xl hover:bg-slate-100 transition-colors"
                onClick={() => setMobileOpen((v) => !v)}
              >
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileOpen
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile nav dropdown */}
          {mobileOpen && (
            <nav className="md:hidden pb-4 space-y-1 border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2 px-2 pb-3 mb-2 border-b border-slate-100">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                  Contractor
                </span>
                <span className="text-sm text-slate-700 font-medium">{displayName}</span>
              </div>
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive(item)
                      ? 'bg-teal-50 text-teal-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
