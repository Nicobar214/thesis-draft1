/* AccountProfile.jsx — the profile page layout shared by every staff and farmer
 * portal (admin, LGU, field engineer, contractor, farmer). Same look as the
 * citizen profile (pages/UserProfile.jsx):
 *
 *   1. Identity card — banner, photo (AvatarUploader), saved name, email, chips,
 *      plus an optional activity strip.
 *   2. Personal Info (name / email / optional phone) beside Account Details
 *      (read-only facts that matter to that role).
 *
 * Each portal passes only what relates to it. Edits always ask for confirmation,
 * and the identity card shows the SAVED name, never the text being typed.
 */
import { useEffect, useState } from 'react';
import { MapPinIcon, UserRoundIcon, PencilIcon, BadgeCheckIcon, PhoneIcon } from 'lucide-react';
import AvatarUploader from '../ui/AvatarUploader';
import { confirm } from '../../lib/confirm';
import { notify } from '../../lib/toast';
import { lowerKeepAcronyms } from '../../lib/textCase';

function SectionHeading({ icon, title, description }) {
  const HeadingIcon = icon;
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-teal-700">
        <HeadingIcon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** An editable text field with Edit -> Cancel / Save, confirming before it saves. */
function EditableField({ id, label, savedValue, type = 'text', placeholder, confirmTitle, confirmNote, onSave, hint }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(savedValue || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(savedValue || '');
  }, [savedValue, editing]);

  const trimmed = draft.trim();
  const changed = trimmed !== String(savedValue || '').trim();

  const save = async () => {
    if (!trimmed || !changed) return;
    const ok = await confirm({
      title: confirmTitle,
      message: `${savedValue ? `From "${savedValue}" to "${trimmed}".` : `It will be "${trimmed}".`}${confirmNote ? `\n${confirmNote}` : ''}`,
      confirmLabel: 'Save',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await onSave(trimmed);
      notify(`${label} updated.`);
      setEditing(false);
    } catch (err) {
      notify(err.message || `Could not update your ${lowerKeepAcronyms(label)}.`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          type={type}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={!editing}
          className={`min-w-0 flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none transition ${editing ? 'border-teal-500 bg-white ring-2 ring-teal-500/20' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
        />
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(savedValue || ''); }}
              disabled={saving}
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !trimmed || !changed}
              className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${lowerKeepAcronyms(label)}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <PencilIcon className="size-4" aria-hidden="true" />
            Edit
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function ReadOnlyField({ label, value, hint }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <p className="truncate rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">{value || '—'}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * @param client       the portal's Supabase client (photo upload + live avatar)
 * @param name         saved display name
 * @param email        sign-in email (read-only)
 * @param roleLabel    chip under the name, e.g. "Administrator"
 * @param location     optional chip, e.g. "Leon, Iloilo"
 * @param memberSince  account creation date
 * @param onSaveName   async (name) => void; omit to make the name read-only
 * @param nameHint     note under the name field (e.g. why it can't be edited)
 * @param phone        optional { value, onSave, hint } — shown only when given
 * @param stats        optional [{ label, value, icon, tone }] activity strip
 * @param details      [{ label, value, hint? }] read-only facts for this role
 * @param loading      shows skeletons for the name block
 * @param labels       optional text overrides (e.g. a translated farmer portal); see DEFAULT_LABELS
 * @param children     optional extra sections shown under the two cards (e.g. language settings)
 */
const DEFAULT_LABELS = {
  memberSince: 'Member since {date}',
  personalInfo: 'Personal Info',
  personalInfoDesc: 'How you appear to others in KalsaTrack.',
  fullName: 'Full name',
  email: 'Email',
  emailHint: 'Your sign-in email can’t be changed.',
  contact: 'Contact number',
};

export default function AccountProfile({
  client,
  name,
  email,
  roleLabel,
  location,
  memberSince,
  onSaveName,
  nameHint,
  phone,
  stats = [],
  statsLoading = false,
  details = [],
  detailsTitle = 'Account Details',
  detailsDescription = 'Managed by DA Region VI. Contact an administrator to change these.',
  loading = false,
  fallbackInitial = 'U',
  labels,
  children,
}) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const displayName = name || email?.split('@')?.[0] || 'Account';
  const memberSinceLabel = formatDate(memberSince);

  return (
    <div className="space-y-6">
      {/* 1. Identity */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
        <div className="h-24 sm:h-28 bg-gradient-to-r from-emerald-700 via-teal-600 to-teal-500" />
        <div className="px-5 sm:px-8 pb-5">
          <div className="flex min-w-0 max-w-full flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
            <div className="-mt-14 shrink-0">
              <AvatarUploader client={client} name={displayName} fallback={fallbackInitial} size="size-28 text-3xl" />
            </div>
            <div className="min-w-0 max-w-full sm:pt-4">
              {loading ? (
                <div className="space-y-2">
                  <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-36 animate-pulse rounded bg-slate-100" />
                </div>
              ) : (
                <>
                  <h2 className="truncate text-2xl font-bold tracking-tight text-slate-900">{displayName}</h2>
                  {email && <p className="truncate text-sm text-slate-500">{email}</p>}
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    {roleLabel && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800">
                        <BadgeCheckIcon className="size-3.5" aria-hidden="true" />
                        {roleLabel}
                      </span>
                    )}
                    {location && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                        <MapPinIcon className="size-3.5" aria-hidden="true" />
                        {location}
                      </span>
                    )}
                    {memberSinceLabel && <span className="text-xs text-slate-400">{L.memberSince.replace('{date}', memberSinceLabel)}</span>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {stats.length > 0 && (
          <dl className={`grid divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/60 ${stats.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {stats.map((tile) => (
              <div key={tile.label} className="flex flex-col items-center gap-2 px-3 py-4 text-center sm:flex-row sm:justify-center sm:gap-3 sm:text-left">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tile.tone || 'bg-teal-50 text-teal-700'}`} aria-hidden="true">
                  <tile.icon className="size-5" />
                </span>
                <div className="flex flex-col-reverse">
                  <dt className="text-xs text-slate-500">{tile.label}</dt>
                  <dd className="text-2xl font-bold leading-tight text-slate-900">{statsLoading ? '…' : tile.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* 2. What they can edit, beside what only DA can change. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <SectionHeading icon={UserRoundIcon} title={L.personalInfo} description={L.personalInfoDesc} />
          <div className="mt-5 space-y-4">
            {onSaveName ? (
              <EditableField
                id="account-full-name"
                label={L.fullName}
                savedValue={name}
                confirmTitle="Change your name?"
                confirmNote="This is the name others see on your activity."
                onSave={onSaveName}
                hint={nameHint}
              />
            ) : (
              <ReadOnlyField label={L.fullName} value={displayName} hint={nameHint} />
            )}
            <ReadOnlyField label={L.email} value={email} hint={L.emailHint} />
            {phone && (
              <EditableField
                id="account-phone"
                label={L.contact}
                type="tel"
                placeholder="09XXXXXXXXX"
                savedValue={phone.value}
                confirmTitle="Change your contact number?"
                confirmNote={phone.confirmNote}
                onSave={phone.onSave}
                hint={phone.hint}
              />
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <SectionHeading icon={phone ? PhoneIcon : BadgeCheckIcon} title={detailsTitle} description={detailsDescription} />
          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {details.map((d) => (
              <div key={d.label} className="rounded-xl bg-slate-50 px-4 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{d.label}</dt>
                <dd className={`mt-0.5 truncate text-sm font-medium ${d.tone || 'text-slate-800'}`}>{d.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {children}
    </div>
  );
}
