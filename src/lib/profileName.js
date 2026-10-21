import { useEffect, useState } from 'react';

const NAME_EVENT = 'kt:profile-name';

/**
 * Saves a staff account's display name in both places the app reads it from:
 * the auth account and profiles.full_name. Headers that cache the name listen
 * for the change via useProfileNameUpdates().
 */
export async function saveProfileName(client, name) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You need to be signed in.');
  const { error: authError } = await client.auth.updateUser({ data: { full_name: name } });
  if (authError) throw authError;
  const { error } = await client
    .from('profiles')
    .update({ full_name: name, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(NAME_EVENT, { detail: { userId: user.id, name } }));
  return user;
}

/** Saves profiles.phone for the signed-in staff account. */
export async function saveProfilePhone(client, phone) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You need to be signed in.');
  const { error } = await client
    .from('profiles')
    .update({ phone, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) throw error;
}

/** Calls onChange(name) whenever this tab saves a new profile name. */
export function useProfileNameUpdates(onChange) {
  useEffect(() => {
    const handler = (event) => onChange(event.detail?.name);
    window.addEventListener(NAME_EVENT, handler);
    return () => window.removeEventListener(NAME_EVENT, handler);
  }, [onChange]);
}

const nameCacheKey = (portal) => `kt:display-name:${portal}`;

function readCachedName(portal) {
  try {
    return JSON.parse(localStorage.getItem(nameCacheKey(portal)) || 'null');
  } catch {
    return null;
  }
}

/**
 * The header name without the refresh flicker. Before the profile loads, a
 * portal used to show a stand-in ("Contractor", the e-mail prefix) and then
 * swap to the real name. This shows the name remembered from the last visit
 * on this device instead, and nothing at all on a first visit.
 *
 * liveName: the real name once loaded (with the portal's own fallback),
 * or null while still loading. The remembered name is tied to the account,
 * so another account signing in on the same device never sees it.
 */
export function useRememberedName(client, portal, liveName) {
  const [cached, setCached] = useState(() => readCachedName(portal));

  useEffect(() => {
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      const userId = data?.session?.user?.id || null;
      if (liveName && userId) {
        const next = { userId, name: liveName };
        try { localStorage.setItem(nameCacheKey(portal), JSON.stringify(next)); } catch { /* storage blocked */ }
        setCached(next);
      } else if (!liveName && cached && cached.userId !== userId) {
        try { localStorage.removeItem(nameCacheKey(portal)); } catch { /* storage blocked */ }
        setCached(null);
      }
    });
    return () => { active = false; };
    // cached is read only to decide whether to drop it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, portal, liveName]);

  return liveName || cached?.name || '';
}

/** The signed-in account's own profiles row (name, email, phone, municipality, created_at). */
export function useOwnProfile(client) {
  const [state, setState] = useState({ user: null, profile: null, loading: true });

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        if (active) setState({ user: null, profile: null, loading: false });
        return;
      }
      const { data } = await client
        .from('profiles')
        .select('id, full_name, email, phone, municipality, created_at')
        .eq('id', user.id)
        .maybeSingle();
      if (active) setState({ user, profile: data || null, loading: false });
    })();
    return () => { active = false; };
  }, [client]);

  const patchProfile = (patch) => setState((s) => ({ ...s, profile: { ...(s.profile || {}), ...patch } }));
  return { ...state, patchProfile };
}
