import { useEffect, useState } from 'react';
import UserLayout from '../components/UserLayout';
import Icons from '../components/Icons';
import { supabase } from '../lib/supabase';

export default function UserProfile() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user || null);
      setLoading(false);
    });
  }, []);

  async function handlePasswordReset() {
    if (!user?.email) return;

    setSending(true);
    setMessage('');
    setError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/signin`,
      });

      if (error) throw error;
      setMessage('Password reset link sent to your email.');
    } catch (err) {
      setError(err.message || 'Unable to send reset link.');
    } finally {
      setSending(false);
    }
  }

  return (
    <UserLayout>
      <div className="max-w-2xl">
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6 sm:p-8">
          {loading ? (
            <p className="text-sm text-slate-500">Loading profile...</p>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-6">
                <div className="size-14 rounded-2xl bg-teal-100 text-teal-700 grid place-items-center">
                  <Icons.Building />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">My Profile</h2>
                  <p className="text-sm text-slate-500">Account details and security</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs uppercase tracking-wider text-slate-400">Name</p>
                  <p className="text-sm font-medium text-slate-800">{user?.user_metadata?.full_name || user?.email?.split('@')?.[0] || 'User'}</p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs uppercase tracking-wider text-slate-400">Email</p>
                  <p className="text-sm font-medium text-slate-800">{user?.email || 'No email'}</p>
                </div>
              </div>

              {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}
              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

              <button
                onClick={handlePasswordReset}
                disabled={sending || !user?.email}
                className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-sm font-medium"
              >
                {sending ? 'Sending...' : 'Send Password Reset Link'}
              </button>
            </>
          )}
        </div>
      </div>
    </UserLayout>
  );
}
