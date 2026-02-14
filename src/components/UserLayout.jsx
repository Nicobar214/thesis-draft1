import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserSidebar from './UserSidebar';

/**
 * UserLayout - Shared layout wrapper for all user pages.
 * Provides the sidebar and main content area.
 */
export default function UserLayout({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) navigate('/signin');
      else setUser(user);
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <UserSidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} />

      {/* Main content area */}
      <main
        className={`transition-all duration-300 min-h-screen ${
          collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 pt-16 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
