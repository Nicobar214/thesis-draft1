/* FarmerProfileModal.jsx — view + edit the farmer's own profile.
 *
 * Most of this record is the farmer's official RSBSA registration (full
 * name, crop, farm area, control number) and is shown read-only here on
 * purpose: supabase_farmer_auth_migration.sql only grants farmers a
 * self-update policy for this reason, not for self-editing official DA
 * records. Contact number is the one field that's genuinely theirs to keep
 * current, and the one real detail support staff need updated in the field.
 */
import { useState } from 'react';
import { supabaseFarmer as supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';

function InfoField({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800 truncate">{value || 'N/A'}</p>
    </div>
  );
}

export default function FarmerProfileModal({ farmerRecord, onSaved, onClose }) {
  const [contactNumber, setContactNumber] = useState(farmerRecord?.contact_number || '');
  const [saving, setSaving] = useState(false);

  const dirty = contactNumber.trim() !== String(farmerRecord?.contact_number || '').trim();

  const handleSave = async () => {
    if (!farmerRecord?.id || !dirty) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('farmer_beneficiaries')
        .update({ contact_number: contactNumber.trim() })
        .eq('id', farmerRecord.id);
      if (error) throw error;
      notify('Contact number updated.');
      await onSaved?.();
      onClose();
    } catch (err) {
      notify(`Could not save: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="My Profile"
      description="Your RSBSA registration details. Only your contact number can be changed here."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Close</Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!dirty}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2.5">
          <InfoField label="Full Name" value={farmerRecord?.full_name} />
          <InfoField label="RSBSA Number" value={farmerRecord?.rsbsa_number} />
          <InfoField label="Control ID" value={farmerRecord?.control_no} />
          <InfoField label="Primary Crop" value={farmerRecord?.crop} />
          <InfoField label="Farm Area" value={farmerRecord?.farm_area_ha ? `${farmerRecord.farm_area_ha} Ha` : null} />
          <InfoField
            label="Location"
            value={[farmerRecord?.barangay, farmerRecord?.municipality].filter(Boolean).join(', ')}
          />
        </div>

        <div>
          <label htmlFor="farmer-contact-number" className="block text-xs font-semibold text-slate-600 mb-1.5">
            Contact Number
          </label>
          <input
            id="farmer-contact-number"
            type="tel"
            value={contactNumber}
            onChange={(e) => setContactNumber(e.target.value)}
            placeholder="09XXXXXXXXX"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 outline-none"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            Something else out of date? Ask your LGU or DA officer to correct it — those details come from your official RSBSA record.
          </p>
        </div>
      </div>
    </Modal>
  );
}
