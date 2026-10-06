import { useCallback, useEffect, useMemo, useState } from 'react';

/*
 * Where a contractor's progress update stands. The database keeps two columns, `status`
 * (the admin's decision) and `certification_status` (the site engineer's), and the
 * contractor needs one plain answer: whose turn is it?
 */
export const STAGES = {
  awaiting_engineer: {
    key: 'awaiting_engineer',
    label: 'Awaiting site engineer',
    helper: 'Your site engineer is checking the figures against the actual site.',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    step: 1,
  },
  awaiting_admin: {
    key: 'awaiting_admin',
    label: 'Awaiting DA approval',
    helper: 'Certified by the site engineer. The DA office gives the final approval.',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-500',
    step: 2,
  },
  disputed: {
    key: 'disputed',
    label: 'Disputed by site engineer',
    helper: 'The figures did not match the site. Correct them and submit a new update.',
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
    step: 1,
    needsFix: true,
  },
  returned: {
    key: 'returned',
    label: 'Returned by DA',
    helper: 'The DA office returned this update. Read the remarks and resubmit.',
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
    step: 2,
    needsFix: true,
  },
  approved: {
    key: 'approved',
    label: 'Approved',
    helper: 'Approved. The project\'s official accomplishment was updated.',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
    step: 3,
  },
};

export function pipelineStage(update) {
  const status = String(update?.status || '').toLowerCase();
  const cert = String(update?.certification_status || '').toLowerCase();
  if (status === 'approved') return STAGES.approved;
  if (status === 'rejected') return cert === 'disputed' ? STAGES.disputed : STAGES.returned;
  if (cert === 'certified') return STAGES.awaiting_admin;
  return STAGES.awaiting_engineer;
}

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * The contractor's projects and recent updates, with the counts both the sidebar and the
 * dashboard need. Stays live through realtime plus a refetch when the tab regains focus.
 */
export function useContractorSummary(client, userId) {
  const [projects, setProjects] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    const [p, u] = await Promise.allSettled([
      client
        .from('fmr_projects')
        .select('id, project_name, municipality, status, accomplishment, site_engineer_id')
        .eq('contractor_id', userId),
      client
        .from('progress_updates')
        .select('id, fmr_project_id, reported_accomplishment, remarks, status, certification_status, certification_remarks, certified_accomplishment, approval_remarks, submitted_at, certified_at, reviewed_at, fmr_projects(project_name, municipality)')
        .eq('contractor_id', userId)
        .order('submitted_at', { ascending: false })
        .limit(60),
    ]);
    const rows = (res) => (res.status === 'fulfilled' && !res.value.error ? res.value.data || [] : null);
    const pr = rows(p);
    const ur = rows(u);
    if (pr) setProjects(pr);
    if (ur) setUpdates(ur);
    setLoading(false);
  }, [client, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    queueMicrotask(load);
    const channel = client
      .channel(`contractor-summary-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_updates' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, load)
      .subscribe();
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      client.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [client, userId, load]);

  return useMemo(() => {
    const staged = updates.map((u) => ({ ...u, stage: pipelineStage(u) }));
    const awaitingEngineer = staged.filter((u) => u.stage.key === 'awaiting_engineer');
    const awaitingAdmin = staged.filter((u) => u.stage.key === 'awaiting_admin');

    // A rejected update only needs action while nothing newer exists for that project.
    const latestByProject = new Map();
    staged.forEach((u) => { if (!latestByProject.has(u.fmr_project_id)) latestByProject.set(u.fmr_project_id, u); });
    const needsFix = [...latestByProject.values()].filter((u) => u.stage.needsFix);

    const monthStart = startOfMonth();
    const approvedThisMonth = new Set(
      staged
        .filter((u) => u.stage.key === 'approved' && new Date(u.submitted_at).getTime() >= monthStart)
        .map((u) => u.fmr_project_id),
    );
    const needingUpdate = projects.filter((p) => !approvedThisMonth.has(p.id));
    const approvedThisMonthCount = staged.filter((u) => u.stage.key === 'approved' && new Date(u.submitted_at).getTime() >= monthStart).length;
    const withoutEngineer = projects.filter((p) => !p.site_engineer_id);
    const busy = new Set([...awaitingEngineer, ...awaitingAdmin].map((u) => u.fmr_project_id));

    return {
      loading,
      reload: load,
      projects,
      updates: staged,
      awaitingEngineer,
      awaitingAdmin,
      needsFix,
      needingUpdate,
      withoutEngineer,
      busyProjectIds: busy,
      approvedThisMonth: approvedThisMonthCount,
    };
  }, [projects, updates, loading, load]);
}
