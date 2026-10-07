import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { notify } from './toast';

/**
 * Which projects the signed-in citizen follows, and how many people follow each.
 *
 * Counts come from project_follow_counts (never who follows). Until
 * supabase_project_follows.sql has been run the view does not exist; `available`
 * stays false and the pages simply hide the feature.
 *
 *   const follows = useProjectFollows();
 *   follows.available            feature usable?
 *   follows.isFollowing(id)      is the viewer following this project?
 *   follows.countFor(id)         number of followers
 *   follows.toggle(id)           follow / unfollow (optimistic, rolls back on failure)
 *   follows.followProps(id)      ready-made props for FmrProjectDetailDialog's `follow`
 */
export function useProjectFollows() {
  const [follows, setFollows] = useState(null); // null = feature unavailable; else { [projectId]: { count, following } }
  const [busyId, setBusyId] = useState(null);
  const followsRef = useRef(null);
  const busyRef = useRef(new Set());

  useEffect(() => {
    followsRef.current = follows;
  }, [follows]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('project_follow_counts')
        .select('project_id, follower_count, i_follow');
      if (!alive || error || !data) return;
      const next = {};
      data.forEach((row) => {
        next[String(row.project_id)] = { count: Number(row.follower_count) || 0, following: Boolean(row.i_follow) };
      });
      setFollows(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(async (projectId) => {
    const key = String(projectId);
    const state = followsRef.current;
    if (state === null || busyRef.current.has(key)) return;

    const was = state[key] || { count: 0, following: false };
    const now = { count: Math.max(0, was.count + (was.following ? -1 : 1)), following: !was.following };

    busyRef.current.add(key);
    setBusyId(key);
    setFollows((prev) => ({ ...prev, [key]: now })); // optimistic

    const { error } = now.following
      ? await supabase.from('project_follows').insert({ project_id: projectId })
      : await supabase.from('project_follows').delete().eq('project_id', projectId);

    // 23505 = already following: the database agrees with what we show, so it is not an error.
    if (error && error.code !== '23505') {
      setFollows((prev) => ({ ...prev, [key]: was })); // roll back
      notify(
        now.following ? 'Could not follow this project. Please try again.' : 'Could not unfollow this project. Please try again.',
        'error'
      );
    } else if (now.following) {
      notify('You will be notified when this project makes progress.', 'success');
    }

    busyRef.current.delete(key);
    setBusyId(null);
  }, []);

  const isFollowing = useCallback((projectId) => Boolean(follows?.[String(projectId)]?.following), [follows]);
  const countFor = useCallback((projectId) => follows?.[String(projectId)]?.count || 0, [follows]);

  const followingCount = useMemo(
    () => (follows ? Object.values(follows).filter((f) => f.following).length : 0),
    [follows]
  );

  const followProps = useCallback((projectId) => ({
    available: follows !== null,
    following: isFollowing(projectId),
    count: countFor(projectId),
    busy: busyId === String(projectId),
    onToggle: () => toggle(projectId),
  }), [follows, isFollowing, countFor, busyId, toggle]);

  return { available: follows !== null, isFollowing, countFor, followingCount, toggle, followProps };
}

export default useProjectFollows;
