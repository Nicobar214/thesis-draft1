/* The camera next to the notification bell (contractor and LGU headers): take a
 * geotagged supporting-evidence photo anytime and SAVE IT TO THE PHONE. Nothing is
 * attached automatically: the person attaches it themselves later, with "Attach
 * file" on the form it is for.
 *
 * The photo carries GPS, time and a verification QR; it is registered when taken,
 * so the QR works wherever the saved file is used (/verify checks the file's
 * fingerprint, which saving does not change).
 *
 *   <HeaderEvidenceCamera client={supabase} kind="delay_evidence" /> */
import { useState } from 'react';
import { DownloadIcon, MapPinIcon, ShieldCheckIcon } from 'lucide-react';
import GeotagCamera from '../camera/GeotagCamera';
import { Modal } from '../ui/Modal';
import { confirm as confirmDialog } from '../../lib/confirm';
import { notify } from '../../lib/toast';
import { registerAttestation } from '../../lib/photoAttestation';

const fileNameFor = (a) => {
  const d = a?.capturedAt ? new Date(a.capturedAt) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `KalsaTrack-evidence-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
};

/** Phone: the share sheet ("Save image" / Photos). Elsewhere: a normal download. */
async function saveToDevice(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Evidence photo' });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // fall through to a download
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export default function HeaderEvidenceCamera({ client, kind, label = 'Supporting evidence' }) {
  const [shot, setShot] = useState(null); // { file, preview, attestation }
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const captured = (photo) => {
    if (!photo.check.ok) { notify(photo.check.problem, 'error'); return; }
    const file = new File([photo.file], fileNameFor(photo.attestation), { type: 'image/jpeg' });
    setShot({ file, preview: photo.preview, attestation: photo.attestation });
    setSaved(false);
    // Register now so the QR on the photo can be checked wherever it ends up.
    if (client && photo.attestation) registerAttestation(client, photo.attestation).catch(() => {});
  };

  const save = async () => {
    setSaving(true);
    try {
      const how = await saveToDevice(shot.file);
      if (how === 'cancelled') return;
      setSaved(true);
      notify(how === 'shared' ? 'Photo saved.' : 'Photo downloaded to this device.', 'success');
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (!saved && !(await confirmDialog({
      title: 'Close without saving?',
      message: 'This photo is not saved to your phone yet, so it will be gone. You can take another anytime.',
      confirmLabel: 'Close without saving',
      cancelLabel: 'Go back',
      tone: 'danger',
    }))) return;
    setShot(null);
  };

  const a = shot?.attestation;
  return (
    <>
      <GeotagCamera iconOnly kind={kind} label={label} place="where the evidence is" onCaptured={captured} />
      {shot && (
        <Modal
          onClose={close}
          title={saved ? 'Saved to your phone' : 'Save this evidence photo'}
          description={saved
            ? 'To use it, open the form it is for and add it with "Attach file" under Supporting evidence.'
            : 'It is not attached to anything. Save it, then attach it yourself where it is needed.'}
          size="md"
          footer={(
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={close} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {saved ? 'Done' : 'Close'}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                data-autofocus
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-60"
              >
                <DownloadIcon className="size-4" aria-hidden="true" /> {saved ? 'Save again' : 'Save to phone'}
              </button>
            </div>
          )}
        >
          <div className="space-y-3">
            <img src={shot.preview} alt="The evidence photo you took" className="max-h-[50vh] w-full rounded-xl border border-slate-200 bg-slate-100 object-contain" />
            {a && (
              <dl className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
                <div className="flex items-center gap-1.5"><MapPinIcon className="size-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                  <span>{a.latitude?.toFixed(5)}, {a.longitude?.toFixed(5)}{a.accuracy != null ? ` · ±${Math.round(a.accuracy)} m` : ''}</span>
                </div>
                <div className="flex items-center gap-1.5"><ShieldCheckIcon className="size-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                  <span>Verification code <span className="font-mono font-semibold text-slate-800">{a.code}</span></span>
                </div>
              </dl>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
