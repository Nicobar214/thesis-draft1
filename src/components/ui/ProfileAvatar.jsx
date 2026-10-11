/* ProfileAvatar.jsx — the account's photo, or its initials when there is none
 * (or the photo fails to load). Pass `src` when the caller already has it;
 * otherwise pass `client` and it follows the signed-in user live, so a photo
 * saved on the profile page shows up here immediately.
 */
import { useState } from 'react';
import { useAuthUser } from '../../lib/useAuthUser';
import { getAvatarUrl, getInitials } from '../../lib/avatar';

function AvatarFace({ src, name, fallback, className }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = src && failedSrc !== src;
  return (
    <span className={`relative inline-grid shrink-0 place-items-center overflow-hidden font-bold text-white bg-gradient-to-br from-emerald-700 to-teal-700 ${className}`}>
      {showImage ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailedSrc(src)} />
      ) : (
        <span aria-hidden="true">{getInitials(name, fallback)}</span>
      )}
    </span>
  );
}

function LiveAvatar({ client, name, fallback, className }) {
  const user = useAuthUser(client);
  return <AvatarFace src={getAvatarUrl(user)} name={name} fallback={fallback} className={className} />;
}

export default function ProfileAvatar({ client, src, name, fallback = 'U', className = 'size-9 rounded-xl text-sm' }) {
  if (src !== undefined || !client) {
    return <AvatarFace src={src} name={name} fallback={fallback} className={className} />;
  }
  return <LiveAvatar client={client} name={name} fallback={fallback} className={className} />;
}
