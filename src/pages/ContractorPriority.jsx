/* ContractorPriority.jsx — Do These First: this contractor's projects that the DA
 * prioritized, best DA rank first, on its own page and menu item so it is not
 * buried in the dashboard. Nothing to answer; older rows that still ask for a
 * reply show their form here too. */
import { useEffect, useState } from 'react';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import PriorityTasksPanel from '../components/priority/PriorityTasksPanel';
import { notify } from '../lib/toast';

export default function ContractorPriority() {
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => { if (alive) setUserId(data?.user?.id || null); });
    return () => { alive = false; };
  }, []);

  return (
    <ContractorLayout>
      <div className="space-y-5">
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-xs">
          The DA ranks on-going projects by how much farmers gain when they are finished (road still to build, market
          access, citizen reports, main crops, farmers nearby). Your projects the DA made a priority are listed here,
          most important first. Please work on these first.
        </p>
        <PriorityTasksPanel client={supabase} userId={userId} role="contractor" showNotification={notify} />
      </div>
    </ContractorLayout>
  );
}
