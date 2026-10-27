/* ContractorPriority.jsx — Priority Tasks: what the DA's prioritization asks of
 * this contractor (e.g. "Expedite contractor"), with the reply form, on its own
 * page and menu item (red count of tasks waiting for a reply), so it is not
 * buried in the dashboard. */
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
          The DA ranks roads and projects by need. When it decides something about one of your projects, it shows here.
          Reply with what you will do and by when; the DA is notified.
        </p>
        <PriorityTasksPanel client={supabase} userId={userId} role="contractor" showNotification={notify} />
      </div>
    </ContractorLayout>
  );
}
