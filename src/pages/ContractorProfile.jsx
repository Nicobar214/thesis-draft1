/* ContractorProfile.jsx — the contractor's own profile (same layout as every
 * other portal's profile; see components/profile/AccountProfile.jsx). */
import { FolderKanbanIcon, SendIcon, CheckCircle2Icon } from 'lucide-react';
import ContractorLayout from '../components/ContractorLayout';
import StaffProfile from '../components/profile/StaffProfile';
import { supabaseContractor as supabase } from '../lib/supabase';
import { useContractorSummaryContext } from '../lib/contractorSummaryContext';

function ContractorProfileBody() {
  const summary = useContractorSummaryContext();
  const municipalities = [...new Set(summary.projects.map((p) => p.municipality).filter(Boolean))];

  return (
    <StaffProfile
      client={supabase}
      roleLabel="Contractor"
      fallbackInitial="C"
      statsLoading={summary.loading}
      stats={[
        { label: 'Assigned Projects', value: summary.projects.length, icon: FolderKanbanIcon, tone: 'bg-teal-50 text-teal-700' },
        { label: 'Updates Submitted', value: summary.updates.length, icon: SendIcon, tone: 'bg-sky-50 text-sky-700' },
        { label: 'Approved This Month', value: summary.approvedThisMonth, icon: CheckCircle2Icon, tone: 'bg-emerald-50 text-emerald-700' },
      ]}
      details={[
        { label: 'Role', value: 'Contractor' },
        { label: 'Region', value: 'DA Region VI (Western Visayas)' },
        { label: 'Working in', value: municipalities.length ? municipalities.join(', ') : 'No projects yet' },
        { label: 'Projects without a site engineer', value: summary.withoutEngineer.length, tone: summary.withoutEngineer.length ? 'text-amber-700' : 'text-slate-800' },
      ]}
    />
  );
}

export default function ContractorProfile() {
  return (
    <ContractorLayout>
      <ContractorProfileBody />
    </ContractorLayout>
  );
}
