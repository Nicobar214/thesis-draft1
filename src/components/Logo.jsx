import lockupDark from '../assets/logo-lockup.png';
import lockupLight from '../assets/logo-lockup-light.png';
import glyphDark from '../assets/logo-glyph.png';
import glyphLight from '../assets/logo-glyph-light.png';

/**
 * The KalsaTrack brand mark.
 *
 * variant  'lockup' — the full horizontal "KALS TRACK" lockup (2.58:1). Needs
 *                     room; use where the old square box + "KalsaTrack" text sat.
 *          'glyph'  — the road/leaf mark alone, square. For collapsed sidebars,
 *                     tight headers and anywhere a label already names the brand.
 * tone     the ink color, NOT the background:
 *          'dark'  — original artwork, for LIGHT backgrounds
 *          'light' — white "TRACK" + brightened greens, for DARK backgrounds
 *
 * Size with a height class (h-8, size-9, …). The lockup is height-driven and
 * keeps its own aspect ratio, so never give it a fixed width.
 */
const SOURCES = {
  lockup: { dark: lockupDark, light: lockupLight },
  glyph: { dark: glyphDark, light: glyphLight },
};

export default function Logo({
  variant = 'lockup',
  tone = 'dark',
  className = '',
  alt,
  ...rest
}) {
  const src = (SOURCES[variant] || SOURCES.lockup)[tone] || SOURCES.lockup.dark;
  // The glyph is usually decorative — a nearby text label already names the
  // brand — so it defaults to an empty alt unless a caller supplies one.
  const label = alt !== undefined ? alt : variant === 'lockup' ? 'KalsaTrack' : '';

  return (
    <img
      src={src}
      alt={label}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={`w-auto shrink-0 select-none object-contain ${className}`}
      {...rest}
    />
  );
}
