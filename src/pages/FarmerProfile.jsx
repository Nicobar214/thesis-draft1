/* FarmerProfile.jsx — the farmer's own profile, same layout as every other
 * portal (components/profile/AccountProfile.jsx).
 *
 * The name and farm details are the farmer's official RSBSA record, so they're
 * read-only here (farmers may only self-update their contact number — see
 * supabase_farmer_auth_migration.sql). The photo is theirs to change.
 */
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { FileTextIcon, WheatIcon, LandPlotIcon } from 'lucide-react';
import AccountProfile from '../components/profile/AccountProfile';
import { supabaseFarmer as supabase } from '../lib/supabase';

export default function FarmerProfile() {
  const { user, farmerRecord, farmerLoading, reloadFarmerRecord, reports, reportsLoading } = useOutletContext();
  const [harvestCount, setHarvestCount] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('farmer_harvest_logs')
      .select('id', { count: 'exact', head: true })
      .eq('farmer_id', user.id)
      .then(({ count }) => setHarvestCount(count ?? 0));
  }, [user?.id]);

  const location = [farmerRecord?.barangay, farmerRecord?.municipality].filter(Boolean).join(', ');
  const validation = farmerRecord?.validation_status || 'For Verification';

  return (
    <AccountProfile
      client={supabase}
      loading={farmerLoading}
      name={farmerRecord?.full_name}
      email={user?.email}
      roleLabel="Registered Farmer"
      location={location || null}
      memberSince={farmerRecord?.created_at || user?.created_at}
      fallbackInitial="F"
      nameHint="From your RSBSA record. Ask your LGU or DA officer to correct it."
      phone={{
        value: farmerRecord?.contact_number || '',
        hint: 'So your LGU and DA staff can reach you.',
        onSave: async (next) => {
          const { error } = await supabase
            .from('farmer_beneficiaries')
            .update({ contact_number: next })
            .eq('id', farmerRecord.id);
          if (error) throw error;
          await reloadFarmerRecord?.();
        },
      }}
      statsLoading={reportsLoading || harvestCount === null}
      stats={[
        { label: 'Reports Submitted', value: reports?.length ?? 0, icon: FileTextIcon, tone: 'bg-teal-50 text-teal-700' },
        { label: 'Harvests Logged', value: harvestCount ?? 0, icon: WheatIcon, tone: 'bg-amber-50 text-amber-700' },
        { label: 'Farm Area', value: farmerRecord?.farm_area_ha ? `${farmerRecord.farm_area_ha} ha` : '—', icon: LandPlotIcon, tone: 'bg-emerald-50 text-emerald-700' },
      ]}
      detailsTitle="RSBSA Record"
      detailsDescription="Your official registration. Ask your LGU or DA officer to correct anything here."
      details={[
        { label: 'RSBSA Number', value: farmerRecord?.rsbsa_number || 'N/A' },
        { label: 'Control ID', value: farmerRecord?.control_no || 'N/A' },
        { label: 'Primary Crop', value: farmerRecord?.crop || 'N/A' },
        {
          label: 'Record Status',
          value: validation,
          tone: validation === 'Validated' ? 'text-emerald-700' : validation === 'Needs Correction' ? 'text-red-700' : 'text-amber-700',
        },
      ]}
    />
  );
}
