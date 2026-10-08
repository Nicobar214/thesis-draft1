/* FarmerHarvestDetailModal.jsx — read a single harvest record in full,
 * including the computed yield and the comparison to the previous harvest
 * of the same crop (precomputed by the caller via lib/harvestMath.js).
 */
import { useEffect, useState } from 'react';
import { supabaseFarmer as supabase } from '../../lib/supabase';
import { confirm } from '../../lib/confirm';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import { yieldPerHectare, formatYield } from '../../lib/harvestMath';

const PHOTO_BUCKET = 'farmer-harvest-photos';

function InfoField({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value ?? 'N/A'}</p>
    </div>
  );
}

export default function FarmerHarvestDetailModal({ entry, comparison, onClose, onEdit, onDelete }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoState, setPhotoState] = useState(entry?.photo_path ? 'loading' : 'none');

  // The bucket is private (farm records aren't public evidence), so the
  // stored photo_path resolves to a short-lived signed URL, not a public
  // one. No photo_path -> nothing to fetch; the initial state ('none') is
  // already correct, so the effect simply doesn't run for that case.
  useEffect(() => {
    if (!entry?.photo_path) return undefined;
    let alive = true;
    setPhotoState('loading');
    supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(entry.photo_path, 3600)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data?.signedUrl) {
          setPhotoState('error');
          return;
        }
        setPhotoUrl(data.signedUrl);
        setPhotoState('ready');
      });
    return () => { alive = false; };
  }, [entry?.photo_path]);

  if (!entry) return null;

  const computedYield = yieldPerHectare(entry.quantity_kg, entry.area_ha);
  const harvestDate = new Date(entry.harvest_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const recordedAt = entry.created_at ? new Date(entry.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const updatedAt = entry.updated_at && entry.updated_at !== entry.created_at
    ? new Date(entry.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this harvest record?',
      message: 'This can’t be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await onDelete(entry.id);
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      title={entry.crop}
      description={harvestDate}
      size="md"
      footer={
        <>
          <Button variant="dangerOutline" onClick={handleDelete}>Delete</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => onEdit(entry)}>Edit</Button>
        </>
      }
    >
      <div className="space-y-5">
        {photoState === 'ready' && (
          <img
            src={photoUrl}
            alt={`${entry.crop} harvest`}
            className="w-full h-48 object-cover rounded-xl border border-slate-200"
          />
        )}
        {photoState === 'error' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            This record has a photo, but it couldn&rsquo;t be loaded right now.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <InfoField label="Quantity" value={`${Number(entry.quantity_kg).toLocaleString()} kg`} />
          <InfoField label="Area Harvested" value={entry.area_ha ? `${entry.area_ha} ha` : 'Not recorded'} />
          <InfoField label="Yield" value={formatYield(computedYield)} />
          <InfoField label="Quality / Grade" value={entry.quality_grade || 'Ungraded'} />
        </div>

        {entry.remarks && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Notes</p>
            <p className="text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2.5">{entry.remarks}</p>
          </div>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Compared to your last {entry.crop} harvest</p>
          {comparison ? (
            <div className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${comparison.percentChange >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {comparison.percentChange >= 0 ? '+' : ''}{comparison.percentChange.toFixed(1)}%
              <span className="ml-1.5 font-normal text-slate-500">
                ({Number(comparison.previous.quantity_kg).toLocaleString()} kg → {Number(comparison.current.quantity_kg).toLocaleString()} kg)
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-500">This is your first recorded harvest for {entry.crop}.</p>
          )}
        </div>

        <p className="text-[11px] text-slate-400">
          Recorded {recordedAt}{updatedAt ? ` · last updated ${updatedAt}` : ''}
        </p>
      </div>
    </Modal>
  );
}
