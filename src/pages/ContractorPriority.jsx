/* ContractorPriority.jsx — Do These First: this contractor's projects that the DA
 * prioritized, best DA rank first, on its own page and menu item so it is not
 * buried in the dashboard. Each live priority can take a progress update right
 * here (the same form as My Projects). Older rows that still ask for a reply
 * show their form here too. */
import { useEffect, useState } from 'react';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import PriorityTasksPanel from '../components/priority/PriorityTasksPanel';
import ContractorProgressForm from './ContractorProgressForm';
import { notify } from '../lib/toast';

export default function ContractorPriority() {
  const [user, setUser] = useState(null);
  const [submitProject, setSubmitProject] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => { if (alive) setUser(data?.user || null); });
    return () => { alive = false; };
  }, []);

  // The form needs the whole project row (Work Plan, baseline), not the list's subset.
  const openSubmit = async (project) => {
    const { data, error } = await supabase.from('fmr_projects').select('*').eq('id', project.id).maybeSingle();
    if (error || !data) { notify('Could not open this project. Please try again.', 'error'); return; }
    setSubmitProject(data);
  };

  return (
    <ContractorLayout>
      <div className="space-y-5">
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-xs">
          The DA ranks on-going projects by how much farmers gain when they are finished (citizen reports, market access,
          main crops, farmers nearby). Your projects the DA made a priority are listed here, most important first. Please
          work on these first, and send their progress updates from here.
        </p>
        <PriorityTasksPanel client={supabase} userId={user?.id || null} role="contractor" showNotification={notify} onSubmitProgress={openSubmit} />
      </div>
      {submitProject && user && (
        <ContractorProgressForm
          project={submitProject}
          user={user}
          onClose={() => setSubmitProject(null)}
          onSubmitted={() => {
            setSubmitProject(null);
            notify('Progress update submitted. Your site engineer checks it next.', 'success');
          }}
        />
      )}
    </ContractorLayout>
  );
}
