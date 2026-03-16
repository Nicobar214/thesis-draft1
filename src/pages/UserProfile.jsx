import { useEffect, useMemo, useState } from 'react';
import UserLayout from '../components/UserLayout';
import Icons from '../components/Icons';
import { supabase } from '../lib/supabase';
import { getMunicipalities, getBarangays } from '../data/iloiloLocations';

export default function UserProfile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityStats, setActivityStats] = useState({ reportsSubmitted: 0, feedbackGiven: 0, projectsFollowed: 0 });

  const [isEditingName, setIsEditingName] = useState(false);
  const [fullName, setFullName] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('');
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [notificationPrefs, setNotificationPrefs] = useState({
    projectUpdates: true,
    reportStatus: true,
    weeklySummary: false,
  });

  const municipalities = useMemo(() => getMunicipalities(), []);
  const barangayOptions = useMemo(() => getBarangays(municipality), [municipality]);

  const displayName = fullName || user?.user_metadata?.full_name || user?.email?.split('@')?.[0] || 'User';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

  const memberSinceLabel = useMemo(() => {
    const value = user?.created_at;
    if (!value) return 'Unknown';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }, [user?.created_at]);

  const lastActiveLabel = useMemo(() => {
    const value = user?.last_sign_in_at || user?.updated_at || null;
    if (!value) return 'Unknown';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }, [user?.last_sign_in_at, user?.updated_at]);

  const lastPasswordChanged = useMemo(() => {
    const value = user?.user_metadata?.password_changed_at;
    if (!value) return 'Never';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Never';
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }, [user?.user_metadata?.password_changed_at]);

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      const authUser = user || null;
      setUser(authUser);

      if (!authUser?.id) {
        setLoading(false);
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, full_name, email, municipality, barangay, created_at, updated_at')
        .eq('id', authUser.id)
        .maybeSingle();

      setProfile(profileData || null);
      setFullName(profileData?.full_name || authUser.user_metadata?.full_name || authUser.email?.split('@')?.[0] || '');
      setMunicipality(profileData?.municipality || authUser.user_metadata?.municipality || '');
      setBarangay(profileData?.barangay || authUser.user_metadata?.barangay || '');
      setAvatarPreview(authUser.user_metadata?.avatar_data_url || authUser.user_metadata?.avatar_url || '');

      const savedPrefs = authUser.user_metadata?.notification_preferences;
      if (savedPrefs && typeof savedPrefs === 'object') {
        setNotificationPrefs({
          projectUpdates: Boolean(savedPrefs.projectUpdates ?? true),
          reportStatus: Boolean(savedPrefs.reportStatus ?? true),
          weeklySummary: Boolean(savedPrefs.weeklySummary ?? false),
        });
      }

      setLoading(false);
    }

    loadProfile();
  }, []);

  useEffect(() => {
    async function loadActivity() {
      if (!user?.id) return;

      setActivityLoading(true);
      const [{ data: reports }, { data: feedbacks }] = await Promise.all([
        supabase
          .from('public_reports')
          .select('id, project_name, user_id')
          .eq('user_id', user.id),
        supabase
          .from('feedbacks')
          .select('id, project_name, user_id')
          .eq('user_id', user.id),
      ]);

      const followedNames = new Set([
        ...(reports || []).map((r) => String(r.project_name || '').trim().toLowerCase()).filter(Boolean),
        ...(feedbacks || []).map((f) => String(f.project_name || '').trim().toLowerCase()).filter(Boolean),
      ]);

      setActivityStats({
        reportsSubmitted: (reports || []).length,
        feedbackGiven: (feedbacks || []).length,
        projectsFollowed: followedNames.size,
      });
      setActivityLoading(false);
    }

    loadActivity();
  }, [user?.id]);

  useEffect(() => {
    if (!municipality) {
      setBarangay('');
      return;
    }

    if (barangay && !getBarangays(municipality).includes(barangay)) {
      setBarangay('');
    }
  }, [municipality, barangay]);

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

  async function handleSaveName() {
    if (!user?.id || !fullName.trim()) return;
    setSavingName(true);
    setMessage('');
    setError('');
    try {
      const safeName = fullName.trim();

      const { error: authError } = await supabase.auth.updateUser({
        data: { ...user.user_metadata, full_name: safeName },
      });
      if (authError) throw authError;

      await supabase.from('profiles').upsert({
        id: user.id,
        email: user.email,
        full_name: safeName,
        municipality,
        updated_at: new Date().toISOString(),
      });

      setMessage('Name updated successfully.');
      setIsEditingName(false);
      const { data: { user: refreshedUser } } = await supabase.auth.getUser();
      setUser(refreshedUser || user);
    } catch (err) {
      setError(err.message || 'Failed to update name.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveLocation() {
    if (!user?.id || !municipality) {
      setError('Municipality is required.');
      return;
    }

    setSavingLocation(true);
    setMessage('');
    setError('');
    try {
      const metadataUpdate = {
        ...user.user_metadata,
        municipality,
        barangay,
      };

      const { error: authError } = await supabase.auth.updateUser({ data: metadataUpdate });
      if (authError) throw authError;

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: fullName.trim() || displayName,
          municipality,
          barangay,
          updated_at: new Date().toISOString(),
        });

      if (profileError) {
        const { error: fallbackError } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            email: user.email,
            full_name: fullName.trim() || displayName,
            municipality,
            updated_at: new Date().toISOString(),
          });

        if (fallbackError) throw fallbackError;
      }

      setMessage('Location saved. Your dashboard will use this for nearby projects.');
      const { data: { user: refreshedUser } } = await supabase.auth.getUser();
      setUser(refreshedUser || user);
    } catch (err) {
      setError(err.message || 'Failed to save location.');
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleSavePreferences() {
    if (!user?.id) return;
    setSavingPrefs(true);
    setMessage('');
    setError('');
    try {
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          ...user.user_metadata,
          notification_preferences: notificationPrefs,
        },
      });
      if (authError) throw authError;

      setMessage('Notification preferences saved.');
      const { data: { user: refreshedUser } } = await supabase.auth.getUser();
      setUser(refreshedUser || user);
    } catch (err) {
      setError(err.message || 'Unable to save preferences.');
    } finally {
      setSavingPrefs(false);
    }
  }

  function handleAvatarUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleDeleteAccount() {
    if (!user?.id) return;
    setDeletingAccount(true);
    setMessage('');
    setError('');

    try {
      const { error: rpcError } = await supabase.rpc('delete_my_account');
      if (rpcError) throw rpcError;

      await supabase.auth.signOut();
      window.location.href = '/signin';
    } catch (err) {
      setError(err.message || 'Unable to delete account automatically. Please contact the administrator.');
    } finally {
      setDeletingAccount(false);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    }
  }

  function ToggleRow({ label, value, onToggle }) {
    return (
      <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-slate-200 bg-slate-50">
        <p className="text-sm text-slate-700">{label}</p>
        <button
          type="button"
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? 'bg-teal-600' : 'bg-slate-300'}`}
          aria-pressed={value}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    );
  }

  return (
    <UserLayout>
      <div className="space-y-5">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Profile</h1>
          <p className="text-sm text-slate-500 mt-1">Manage your identity, location, notifications, and account security.</p>
        </section>

        {(message || error) && (
          <div className="space-y-2">
            {message && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{message}</p>}
            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-1">
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6 sticky top-24">
              {loading ? (
                <p className="text-sm text-slate-500">Loading profile...</p>
              ) : (
                <>
                  <div className="flex flex-col items-center text-center">
                    <div className="size-28 rounded-full bg-teal-600 text-white flex items-center justify-center text-3xl font-bold overflow-hidden border-4 border-teal-100">
                      {avatarPreview ? <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" /> : initials}
                    </div>
                    <label className="mt-3 text-xs font-semibold text-teal-700 cursor-pointer hover:text-teal-800">
                      Upload photo
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                    </label>
                    <h2 className="mt-4 text-xl font-semibold text-slate-900">{displayName}</h2>
                    <p className="text-sm text-slate-500">{user?.email || 'No email'}</p>
                    <p className="mt-3 text-xs text-slate-400">Member since {memberSinceLabel} • Last active {lastActiveLabel}</p>
                  </div>

                  <div className="mt-6 border-t border-slate-100 pt-4">
                    <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">My Activity</p>
                    <div className="grid grid-cols-1 gap-2.5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center justify-between text-sm">
                        <span className="text-slate-600">Reports Submitted</span>
                        <span className="font-semibold text-slate-900">{activityLoading ? '...' : activityStats.reportsSubmitted}</span>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center justify-between text-sm">
                        <span className="text-slate-600">Feedback Given</span>
                        <span className="font-semibold text-slate-900">{activityLoading ? '...' : activityStats.feedbackGiven}</span>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center justify-between text-sm">
                        <span className="text-slate-600">Projects Followed</span>
                        <span className="font-semibold text-slate-900">{activityLoading ? '...' : activityStats.projectsFollowed}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="xl:col-span-2 space-y-5">
            <section className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-900">Personal Info</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Name</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      disabled={!isEditingName}
                      className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none disabled:bg-slate-50"
                    />
                    {isEditingName ? (
                      <button
                        onClick={handleSaveName}
                        disabled={savingName || !fullName.trim()}
                        className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium disabled:bg-teal-300"
                      >
                        {savingName ? 'Saving...' : 'Save'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setIsEditingName(true)}
                        className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-medium text-slate-700"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email</label>
                  <div title="Email address is managed by authentication and cannot be edited here.">
                    <input
                      type="email"
                      value={user?.email || ''}
                      readOnly
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-slate-900">My Location</h3>
              <p className="text-sm text-slate-500 mt-1">Used to personalize your dashboard and show nearby projects.</p>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Municipality *</label>
                  <select
                    value={municipality}
                    onChange={(e) => setMunicipality(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none"
                  >
                    <option value="">Select municipality</option>
                    {municipalities.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Barangay</label>
                  <select
                    value={barangay}
                    onChange={(e) => setBarangay(e.target.value)}
                    disabled={!municipality}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none disabled:bg-slate-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select barangay</option>
                    {barangayOptions.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={handleSaveLocation}
                disabled={savingLocation || !municipality}
                className="mt-4 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium disabled:bg-teal-300"
              >
                {savingLocation ? 'Saving...' : 'Save Location'}
              </button>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-slate-900">Notification Preferences</h3>
              <div className="mt-4 space-y-3">
                <ToggleRow
                  label="Notify me when a project in my area is updated"
                  value={notificationPrefs.projectUpdates}
                  onToggle={() => setNotificationPrefs((prev) => ({ ...prev, projectUpdates: !prev.projectUpdates }))}
                />
                <ToggleRow
                  label="Notify me when my submitted report changes status"
                  value={notificationPrefs.reportStatus}
                  onToggle={() => setNotificationPrefs((prev) => ({ ...prev, reportStatus: !prev.reportStatus }))}
                />
                <ToggleRow
                  label="Weekly summary of FMR progress in my municipality"
                  value={notificationPrefs.weeklySummary}
                  onToggle={() => setNotificationPrefs((prev) => ({ ...prev, weeklySummary: !prev.weeklySummary }))}
                />
              </div>

              <button
                onClick={handleSavePreferences}
                disabled={savingPrefs}
                className="mt-4 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium disabled:bg-teal-300"
              >
                {savingPrefs ? 'Saving...' : 'Save Preferences'}
              </button>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-slate-900">Security</h3>
              <p className="text-sm text-slate-500 mt-1">Last password changed: {lastPasswordChanged}</p>

              <button
                onClick={handlePasswordReset}
                disabled={sending || !user?.email}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-sm font-medium"
              >
                {sending ? 'Sending...' : 'Send Password Reset Link'}
              </button>
            </section>

            <section className="bg-white rounded-2xl border border-red-200/70 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowDangerZone((v) => !v)}
                className="w-full flex items-center justify-between px-6 py-4 text-left"
              >
                <h3 className="text-lg font-semibold text-red-700">Danger Zone</h3>
                <span className="text-sm text-red-500">{showDangerZone ? 'Hide' : 'Show'}</span>
              </button>

              {showDangerZone && (
                <div className="px-6 pb-6">
                  <p className="text-sm text-red-600 mb-4">Deleting your account is irreversible and may remove your history.</p>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
                  >
                    Delete My Account
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900">Delete Account</h3>
            <p className="text-sm text-slate-500 mt-2">Type DELETE to confirm account deletion.</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="mt-4 w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
              placeholder="DELETE"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deletingAccount || deleteConfirmText !== 'DELETE'}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:bg-red-300"
              >
                {deletingAccount ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </UserLayout>
  );
}
