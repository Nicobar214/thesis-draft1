import { useEffect, useState } from 'react';

/**
 * The signed-in user for a Supabase client, kept current: it re-reads on every
 * auth event, including USER_UPDATED (fired by auth.updateUser), so anything
 * that shows account details -- like the header avatar -- updates the moment
 * the profile page saves a change.
 */
export function useAuthUser(client) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    let active = true;
    client.auth.getUser().then(({ data }) => {
      if (active) setUser(data?.user ?? null);
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  return user;
}
