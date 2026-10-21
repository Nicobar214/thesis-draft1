import { useState } from 'react';
import PhotoLightbox from './PhotoLightbox';

/**
 * A photo that opens full size in the shared viewer (PhotoLightbox): the page
 * behind is blurred and the ✕, Esc or a tap on the backdrop closes it.
 *
 * Pass `photos` (+ `index`) to open a set, e.g. before / after, so the viewer
 * can flip between them; otherwise it opens just this photo with `label`.
 * `className` styles the <img>; `wrapperClassName` the clickable frame.
 */
export default function ZoomablePhoto({
  src,
  alt = '',
  label,
  className = '',
  wrapperClassName = '',
  photos = null,
  index = 0,
  badge = true,
}) {
  const [open, setOpen] = useState(null); // index of the open photo, or null
  if (!src) return null;
  const set = photos?.length ? photos : [{ src, label: label || alt || 'Photo' }];

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(photos?.length ? index : 0); }}
        className={`group relative block overflow-hidden rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${wrapperClassName}`}
        aria-label={`View ${label || alt || 'photo'} full size`}
      >
        <img src={src} alt={alt} className={`transition duration-200 group-hover:opacity-95 ${className}`} />
        {badge && (
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Tap to view
          </span>
        )}
      </button>
      {open !== null && (
        <PhotoLightbox photos={set} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

/**
 * A text button ("View photo") that opens a photo in the same viewer, for
 * tables and lists that link to a photo instead of showing a thumbnail.
 * `resolveSrc` (async) is for private files that need a signed URL first.
 */
export function PhotoViewButton({ src, resolveSrc, label = 'Photo', className = '', children }) {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const openViewer = async (e) => {
    e.stopPropagation();
    if (!resolveSrc) {
      setUrl(src);
      return;
    }
    setBusy(true);
    try {
      const resolved = await resolveSrc(src);
      if (resolved) setUrl(resolved);
    } finally {
      setBusy(false);
    }
  };

  if (!src) return null;
  return (
    <>
      <button type="button" onClick={openViewer} disabled={busy} className={className}>
        {children || 'View photo'}
      </button>
      {url && <PhotoLightbox photos={[{ src: url, label }]} index={0} onClose={() => setUrl(null)} />}
    </>
  );
}

