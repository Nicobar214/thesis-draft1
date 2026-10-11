import { useEffect, useMemo, useState } from 'react';
import UserLayout from '../components/UserLayout';
import { supabase } from '../lib/supabase';
import { getMunicipalities, getBarangays } from '../data/iloiloLocations';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import AvatarUploader from '../components/ui/AvatarUploader';
import { confirm } from '../lib/confirm';
import { MapPinIcon, UserRoundIcon, TriangleAlertIcon, FileTextIcon, MessageSquareIcon, StarIcon, PencilIcon } from 'lucide-react';

// The preference toggles are saved to the account, but nothing sends notifications
// based on them yet (the bell always shows everything, and there is no weekly
// summary job). Hidden so the page does not promise something it cannot do.
// Set to true once a consumer honours these values.
const SHOW_NOTIFICATION_PREFERENCES = false;

function SectionHeading({ icon, title, description }) {
  const HeadingIcon = icon;
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-teal-700">
        <HeadingIcon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
    </div>
  );
}

export default function UserProfile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityStats, setActivityStats] = useState({ reportsSubmitted: 0, feedbackGiven: 0, projectsFollowed: 0 });

  const [isEditingName, setIsEditingName] = useState(false);
  const [fullName, setFullName] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
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

  // The saved name, not the text box: while editing, the header card keeps the
  // current name until the change is confirmed and saved.
  const savedName = profile?.full_name || user?.user_metadata?.full_name || '';
  const displayName = savedName || user?.email?.split('@')?.[0] || 'User';

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
      const [{ data: reports }, { data: feedbacks }, followRes] = await Promise.all([
        supabase
          .from('public_reports_citizen_view')
          .select('id, project_name, is_current_user_report')
          .eq('is_current_user_report', true),
        supabase
          .from('feedbacks')
          .select('id, project_name, user_id')
          .eq('user_id', user.id),
        // Real follows, once supabase_project_follows.sql has been run (own rows only).
        supabase.from('project_follows').select('project_id', { count: 'exact', head: true }),
      ]);

      const followedNames = new Set([
        ...(reports || []).map((r) => String(r.project_name || '').trim().toLowerCase()).filter(Boolean),
        ...(feedbacks || []).map((f) => String(f.project_name || '').trim().toLowerCase()).filter(Boolean),
      ]);

      setActivityStats({
        reportsSubmitted: (reports || []).length,
        feedbackGiven: (feedbacks || []).length,
        // Until follows exist, fall back to projects the user has reported or commented on.
        projectsFollowed: followRes?.error || followRes?.count == null ? followedNames.size : followRes.count,
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

  async function handleSaveName() {
    if (!user?.id || !fullName.trim()) return;
    const previousName = savedName;
    const ok = await confirm({
      title: 'Change your name?',
      message: previousName
        ? `From "${previousName}" to "${fullName.trim()}".
This is the name shown on your reports and feedback.`
        : `Your name will be "${fullName.trim()}".
This is the name shown on your reports and feedback.`,
      confirmLabel: 'Save name',
    });
    if (!ok) return;
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

      setProfile((prev) => ({ ...(prev || {}), full_name: safeName }));
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

    const nextLocation = [barangay, municipality].filter(Boolean).join(', ');
    const ok = await confirm({
      title: 'Update your location?',
      message: savedLocation
        ? `From "${savedLocation}" to "${nextLocation}".
Your dashboard will show road projects near this location.`
        : `Your location will be "${nextLocation}".
Your dashboard will show road projects near this location.`,
      confirmLabel: 'Save location',
    });
    if (!ok) return;

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
          full_name: savedName || displayName,
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
            full_name: savedName || displayName,
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
          role="switch"
          aria-checked={value}
          aria-label={label}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    );
  }

  const savedLocation = [profile?.barangay || user?.user_metadata?.barangay, profile?.municipality || user?.user_metadata?.municipality]
    .filter(Boolean)
    .join(', ');
  const locationDirty = municipality !== (profile?.municipality || user?.user_metadata?.municipality || '')
    || barangay !== (profile?.barangay || user?.user_metadata?.barangay || '');

  const activityTiles = [
    { label: 'Reports Submitted', value: activityStats.reportsSubmitted, icon: FileTextIcon, tone: 'bg-teal-50 text-teal-700' },
    { label: 'Feedback Given', value: activityStats.feedbackGiven, icon: MessageSquareIcon, tone: 'bg-sky-50 text-sky-700' },
    { label: 'Projects Followed', value: activityStats.projectsFollowed, icon: StarIcon, tone: 'bg-amber-50 text-amber-700' },
  ];

  return (
    <UserLayout>
      <div className="space-y-6">
        {(message || error) && (
          <div className="space-y-2" role="status">
            {message && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{message}</p>}
            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
          </div>
        )}

        {/* 1. Identity: who you are, at a glance. The most prominent card. */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm" data-tour="profile-photo">
          <div className="h-24 sm:h-28 bg-gradient-to-r from-emerald-700 via-teal-600 to-teal-500" />
          <div className="px-5 sm:px-8 pb-5">
            {/* Only the photo is pulled up over the banner (-mt-14); the name block
                starts at the banner's bottom edge, so text never sits on the color. */}
            <div className="flex min-w-0 max-w-full flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
              <div className="-mt-14 shrink-0">
                <AvatarUploader client={supabase} name={displayName} size="size-28 text-3xl" />
              </div>
              <div className="min-w-0 max-w-full sm:pt-4">
                {loading ? (
                  <div className="space-y-2">
                    <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
                    <div className="h-4 w-36 animate-pulse rounded bg-slate-100" />
                  </div>
                ) : (
                  <>
                    <h2 className="truncate text-2xl font-bold tracking-tight text-slate-900">{displayName}</h2>
                    <p className="truncate text-sm text-slate-500">{user?.email || 'No email'}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${savedLocation ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                        <MapPinIcon className="size-3.5" aria-hidden="true" />
                        {savedLocation || 'Location not set'}
                      </span>
                      <span className="text-xs text-slate-400">Member since {memberSinceLabel} · Last active {lastActiveLabel}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Activity: a full-width strip under the identity, split into equal
              thirds, instead of floating boxes squeezed against the banner. */}
          <dl className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/60">
            {activityTiles.map((tile) => (
              <div key={tile.label} className="flex flex-col items-center gap-2 px-3 py-4 text-center sm:flex-row sm:justify-center sm:gap-3 sm:text-left">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tile.tone}`} aria-hidden="true">
                  <tile.icon className="size-5" />
                </span>
                <div className="flex flex-col-reverse">
                  <dt className="text-xs text-slate-500">{tile.label}</dt>
                  <dd className="text-2xl font-bold leading-tight text-slate-900">{activityLoading ? '…' : tile.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        {/* 2. The two things people actually edit, side by side and equal weight.
            Each card stacks its fields and keeps its action at the bottom, so the
            buttons line up across both cards. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="flex flex-col rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm" data-tour="profile-info">
            <SectionHeading icon={UserRoundIcon} title="Personal Info" description="The name shown on your reports and feedback." />

            <div className="mt-5 flex-1 space-y-4">
              <div>
                <label htmlFor="profile-full-name" className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
                <input
                  id="profile-full-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  readOnly={!isEditingName}
                  className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition ${isEditingName ? 'border-teal-500 bg-white ring-2 ring-teal-500/20' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                />
              </div>
              <div>
                <label htmlFor="profile-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                <input
                  id="profile-email"
                  type="email"
                  value={user?.email || ''}
                  readOnly
                  title="Your email is tied to your sign-in and cannot be changed here."
                  className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500"
                />
                <p className="mt-1 text-xs text-slate-400">Your sign-in email can't be changed.</p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              {isEditingName ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingName(false);
                      setFullName(profile?.full_name || user?.user_metadata?.full_name || '');
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={savingName || !fullName.trim()}
                    className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    {savingName ? 'Saving…' : 'Save name'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <PencilIcon className="size-4" aria-hidden="true" />
                  Edit name
                </button>
              )}
            </div>
          </section>

          <section className="flex flex-col rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm" data-tour="profile-location">
            <SectionHeading icon={MapPinIcon} title="My Location" description="Used to show the road projects near you on your dashboard." />

            <div className="mt-5 flex-1 space-y-4">
              <div>
                <label htmlFor="profile-municipality" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Municipality <span className="text-red-500">*</span>
                </label>
                <select
                  id="profile-municipality"
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="">Select municipality</option>
                  {municipalities.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="profile-barangay" className="mb-1.5 block text-sm font-medium text-slate-700">Barangay</label>
                <select
                  id="profile-barangay"
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  disabled={!municipality}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:bg-slate-50"
                >
                  <option value="">{municipality ? 'Select barangay' : 'Choose a municipality first'}</option>
                  {barangayOptions.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              {!locationDirty && savedLocation && (
                <span className="text-xs text-slate-400">Saved</span>
              )}
              <button
                type="button"
                onClick={handleSaveLocation}
                disabled={savingLocation || !municipality || !locationDirty}
                className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {savingLocation ? 'Saving…' : 'Save location'}
              </button>
            </div>
          </section>
        </div>

        {SHOW_NOTIFICATION_PREFERENCES && (
          <section className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
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
        )}

        {/* 3. Rarely needed and irreversible: a quiet strip at the very bottom,
            not a card competing with the settings above. */}
        <section className="rounded-2xl border border-dashed border-red-200 bg-white/60 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Delete account</p>
                <p className="text-xs text-slate-500">Permanently removes your account and may remove your report history.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="self-start rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 sm:self-auto"
            >
              Delete my account
            </button>
          </div>
        </section>
      </div>

      {showDeleteModal && (
        <Modal
          size="sm"
          role="alertdialog"
          title="Delete account"
          description="This permanently removes your account and cannot be undone."
          dismissible={!deletingAccount}
          closeOnBackdrop={false}
          onClose={() => {
            setShowDeleteModal(false);
            setDeleteConfirmText('');
          }}
          footer={(
            <>
              <Button
                variant="secondary"
                disabled={deletingAccount}
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deletingAccount}
                disabled={deleteConfirmText !== 'DELETE'}
                onClick={handleDeleteAccount}
              >
                Delete account
              </Button>
            </>
          )}
        >
          <label htmlFor="delete-account-confirm" className="block text-sm font-medium text-slate-700">
            Type <span className="font-mono font-semibold text-red-600">DELETE</span> to confirm
          </label>
          <input
            id="delete-account-confirm"
            data-autofocus
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            autoComplete="off"
            className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
            placeholder="DELETE"
          />
        </Modal>
      )}
    </UserLayout>
  );
}
