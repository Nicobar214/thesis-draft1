/* StaffProfile.jsx — AccountProfile wired to the signed-in staff account's own
 * `profiles` row (admin, LGU, field engineer, contractor). Loads the row, saves
 * name / phone edits, and leaves each portal to pass only its own stats and
 * read-only details.
 */
import AccountProfile from './AccountProfile';
import { saveProfileName, saveProfilePhone, useOwnProfile } from '../../lib/profileName';

export default function StaffProfile({
  client,
  roleLabel,
  location,
  stats,
  statsLoading,
  details = [],
  showPhone = true,
  fallbackInitial,
}) {
  const { user, profile, loading, patchProfile } = useOwnProfile(client);
  const name = profile?.full_name || user?.user_metadata?.full_name || '';

  return (
    <AccountProfile
      client={client}
      loading={loading}
      name={name}
      email={user?.email || profile?.email}
      roleLabel={roleLabel}
      location={location ?? (profile?.municipality ? `${profile.municipality}, Iloilo` : null)}
      memberSince={profile?.created_at || user?.created_at}
      onSaveName={async (next) => {
        await saveProfileName(client, next);
        patchProfile({ full_name: next });
      }}
      phone={showPhone ? {
        value: profile?.phone || '',
        hint: 'So DA staff can reach you about your work.',
        onSave: async (next) => {
          await saveProfilePhone(client, next);
          patchProfile({ phone: next });
        },
      } : undefined}
      stats={stats}
      statsLoading={statsLoading}
      details={details}
      fallbackInitial={fallbackInitial}
    />
  );
}
