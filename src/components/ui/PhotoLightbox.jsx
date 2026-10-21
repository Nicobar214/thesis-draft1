import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, XIcon } from 'lucide-react';
import { ModalEffects } from './Modal';

/**
 * Full-screen photo viewer. With more than one photo (e.g. before / after) it
 * shows tabs and arrows to flip between them, so the two can be compared at
 * the same size. Escape closes; the arrow keys switch photos.
 *
 * photos: [{ src, label }]   index: which one is open   onIndex(i)   onClose()
 */
export default function PhotoLightbox({ photos = [], index = 0, onIndex, onClose }) {
  const count = photos.length;
  const photo = photos[index];

  useEffect(() => {
    if (count < 2) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') onIndex?.((index + 1) % count);
      if (e.key === 'ArrowLeft') onIndex?.((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, index, onIndex]);

  if (!photo) return null;

  // Portalled to <body> above every modal (they sit at z-[9000]); inside a
  // modal panel a fixed overlay would be trapped under it.
  return createPortal((
    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md" onClick={onClose}>
      <ModalEffects onClose={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={photo.label || 'Photo'}
        className="relative flex max-h-full w-full max-w-4xl flex-col items-center gap-3 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between gap-2">
          {count > 1 ? (
            <div className="inline-flex rounded-xl bg-white/10 p-1" role="tablist" aria-label="Photos">
              {photos.map((p, i) => (
                <button
                  key={p.src}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  onClick={() => onIndex?.(i)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${i === index ? 'bg-white text-slate-900' : 'text-white/80 hover:text-white'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-white">{photo.label}</p>
          )}
          <div className="flex items-center gap-1">
            <a
              href={photo.src}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Open the full-size photo in a new tab"
            >
              <ExternalLinkIcon className="size-5" aria-hidden="true" />
            </a>
            <button type="button" onClick={onClose} aria-label="Close photo" data-autofocus className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white">
              <XIcon className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full items-center justify-center">
          {count > 1 && (
            <button
              type="button"
              onClick={() => onIndex?.((index - 1 + count) % count)}
              aria-label="Previous photo"
              className="absolute left-2 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
            >
              <ChevronLeftIcon className="size-6" aria-hidden="true" />
            </button>
          )}
          <img src={photo.src} alt={photo.label || ''} className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain shadow-2xl" />
          {count > 1 && (
            <button
              type="button"
              onClick={() => onIndex?.((index + 1) % count)}
              aria-label="Next photo"
              className="absolute right-2 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
            >
              <ChevronRightIcon className="size-6" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}
