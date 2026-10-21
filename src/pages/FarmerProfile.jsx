/* FarmerProfile.jsx — the farmer's own profile and settings, same layout as
 * every other portal (components/profile/AccountProfile.jsx).
 *
 * The name and farm details are the farmer's official RSBSA record, so they're
 * read-only here (farmers may only self-update their contact number — see
 * supabase_farmer_auth_migration.sql). The photo is theirs to change, and so is
 * the portal's language (English, Hiligaynon or Tagalog, lib/farmerI18n.js).
 */
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { FileTextIcon, WheatIcon, LandPlotIcon, LanguagesIcon, CheckIcon } from 'lucide-react';
import AccountProfile from '../components/profile/AccountProfile';
import { supabaseFarmer as supabase } from '../lib/supabase';
import { FARMER_LANGUAGES, translate, useFarmerT } from '../lib/farmerI18n';
import { notify } from '../lib/toast';

function LanguageSettings() {
  const { t, lang, setLang } = useFarmerT();

  const choose = (code) => {
    if (code === lang) return;
    setLang(code);
    const label = FARMER_LANGUAGES.find((l) => l.code === code)?.label || code;
    // Confirm in the newly chosen language.
    notify(translate(code, 'profile.languageSaved', { lang: label }), 'success');
  };

  return (
    <section id="language" className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm" data-tour="profile-language">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700" aria-hidden="true">
          <LanguagesIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{t('profile.language')}</h3>
          <p className="mt-0.5 text-sm text-slate-500">{t('profile.languageDesc')}</p>
        </div>
      </div>

      <div role="radiogroup" aria-label={t('profile.language')} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FARMER_LANGUAGES.map((option) => {
          const selected = option.code === lang;
          return (
            <button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(option.code)}
              className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                selected ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span>
                <span className={`block text-sm font-semibold ${selected ? 'text-emerald-800' : 'text-slate-800'}`}>{option.label}</span>
                <span className="block text-xs text-slate-500">{option.native}</span>
              </span>
              {selected && <CheckIcon className="size-5 shrink-0 text-emerald-700" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-400">{t('profile.languageNote')}</p>
    </section>
  );
}

export default function FarmerProfile() {
  const { user, farmerRecord, farmerLoading, reloadFarmerRecord, reports, reportsLoading } = useOutletContext();
  const { t } = useFarmerT();
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
      roleLabel={t('profile.role')}
      location={location || null}
      memberSince={farmerRecord?.created_at || user?.created_at}
      fallbackInitial="F"
      nameHint={t('profile.nameHint')}
      labels={{
        memberSince: t('profile.memberSince', { date: '{date}' }),
        personalInfo: t('profile.personalInfo'),
        personalInfoDesc: t('profile.personalInfoDesc'),
        fullName: t('profile.fullName'),
        email: t('profile.email'),
        emailHint: t('profile.emailHint'),
        contact: t('profile.contact'),
      }}
      phone={{
        value: farmerRecord?.contact_number || '',
        hint: t('profile.phoneHint'),
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
        { label: t('profile.statReports'), value: reports?.length ?? 0, icon: FileTextIcon, tone: 'bg-teal-50 text-teal-700' },
        { label: t('profile.statHarvests'), value: harvestCount ?? 0, icon: WheatIcon, tone: 'bg-amber-50 text-amber-700' },
        { label: t('profile.statArea'), value: farmerRecord?.farm_area_ha ? `${farmerRecord.farm_area_ha} ha` : '—', icon: LandPlotIcon, tone: 'bg-emerald-50 text-emerald-700' },
      ]}
      detailsTitle={t('profile.recordTitle')}
      detailsDescription={t('profile.recordDesc')}
      details={[
        { label: t('profile.rsbsa'), value: farmerRecord?.rsbsa_number || 'N/A' },
        { label: t('profile.control'), value: farmerRecord?.control_no || 'N/A' },
        { label: t('profile.crop'), value: farmerRecord?.crop || 'N/A' },
        {
          label: t('profile.status'),
          value: validation,
          tone: validation === 'Validated' ? 'text-emerald-700' : validation === 'Needs Correction' ? 'text-red-700' : 'text-amber-700',
        },
      ]}
    >
      <LanguageSettings />
    </AccountProfile>
  );
}
