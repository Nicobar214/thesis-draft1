/* AvatarUploader.jsx — large avatar with a camera button to change the photo,
 * and a "Remove" link once one is set. Shared by the citizen profile page and
 * the farmer profile dialog; both save through lib/avatar.js.
 *
 * Nothing is uploaded until the person confirms: picking a file opens a
 * preview ("Use this photo?"), and removing asks first too.
 */
import { useEffect, useRef, useState } from 'react';
import { CameraIcon, Loader2Icon } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import { Modal } from './Modal';
import { Button } from './Button';
import { useAuthUser } from '../../lib/useAuthUser';
import { getAvatarUrl, removeAvatar, uploadAvatar } from '../../lib/avatar';
import { confirm } from '../../lib/confirm';
import { notify } from '../../lib/toast';

export default function AvatarUploader({ client, name, fallback = 'U', size = 'size-28 text-3xl', ringClassName = 'ring-4 ring-white' }) {
  const user = useAuthUser(client);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(null); // 'upload' | 'remove' | null
  const [pending, setPending] = useState(null); // { file, previewUrl } awaiting confirmation
  const avatarUrl = getAvatarUrl(user);

  // Free the preview's object URL when it's replaced or the dialog closes.
  useEffect(() => () => {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  const pickFile = () => inputRef.current?.click();

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      notify('Please choose an image file (JPG, PNG or WebP).', 'error');
      return;
    }
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  };

  const confirmUpload = async () => {
    if (!pending) return;
    setBusy('upload');
    try {
      await uploadAvatar(client, pending.file);
      notify('Profile photo updated.');
      setPending(null);
    } catch (err) {
      notify(err.message || 'Could not upload the photo.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    const ok = await confirm({
      title: 'Remove profile photo?',
      message: 'Your initials will be shown instead. You can add a new photo any time.',
      confirmLabel: 'Remove photo',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('remove');
    try {
      await removeAvatar(client);
      notify('Profile photo removed.');
    } catch (err) {
      notify(err.message || 'Could not remove the photo.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <ProfileAvatar src={avatarUrl} name={name} fallback={fallback} className={`${size} rounded-full shadow-md ${ringClassName}`} />
        {busy === 'remove' && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-slate-900/45">
            <Loader2Icon className="size-7 animate-spin text-white" aria-hidden="true" />
          </span>
        )}
        <button
          type="button"
          onClick={pickFile}
          disabled={Boolean(busy)}
          aria-label={avatarUrl ? 'Change profile photo' : 'Upload profile photo'}
          title={avatarUrl ? 'Change photo' : 'Upload photo'}
          className="absolute bottom-0.5 right-0.5 grid size-9 place-items-center rounded-full border-2 border-white bg-teal-600 text-white shadow transition hover:bg-teal-700 disabled:opacity-60"
        >
          <CameraIcon className="size-4" aria-hidden="true" />
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs font-semibold">
        <button type="button" onClick={pickFile} disabled={Boolean(busy)} className="text-teal-700 hover:text-teal-800 disabled:opacity-60">
          {avatarUrl ? 'Change photo' : 'Upload photo'}
        </button>
        {avatarUrl && (
          <button type="button" onClick={handleRemove} disabled={Boolean(busy)} className="text-slate-500 hover:text-red-600 disabled:opacity-60">
            {busy === 'remove' ? 'Removing…' : 'Remove'}
          </button>
        )}
      </div>

      {pending && (
        <Modal
          size="sm"
          title="Use this photo?"
          description="This is how your photo will look across the app."
          layer={9500}
          dismissible={busy !== 'upload'}
          closeOnBackdrop={false}
          onClose={() => setPending(null)}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setPending(null)} disabled={busy === 'upload'}>Cancel</Button>
              <Button variant="secondary" onClick={pickFile} disabled={busy === 'upload'}>Choose another</Button>
              <Button variant="primary" onClick={confirmUpload} loading={busy === 'upload'} data-autofocus="">
                Use this photo
              </Button>
            </>
          )}
        >
          <div className="flex items-center justify-center gap-6 py-2">
            {/* Previewed at the two sizes it will actually appear: profile and header. */}
            <img src={pending.previewUrl} alt="New profile photo preview" className="size-32 rounded-full object-cover shadow-md ring-4 ring-emerald-50" />
            <div className="flex flex-col items-center gap-1.5">
              <img src={pending.previewUrl} alt="" className="size-10 rounded-xl object-cover shadow-sm" />
              <span className="text-[11px] text-slate-400">Top bar</span>
            </div>
          </div>
          <p className="text-center text-xs text-slate-400">The photo will be cropped to a square from its center.</p>
        </Modal>
      )}
    </div>
  );
}
