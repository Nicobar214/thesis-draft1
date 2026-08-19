import authBackground from '../assets/auth-background.jpg';

/**
 * Shared decorative backdrop for every sign-in page: an aerial photo of a
 * farm-to-market road through rice fields, washed with a deep green overlay so
 * the white auth card stays readable and the brand reads as agricultural.
 *
 * `accent` tints the ambient glow only, so each portal keeps the colour cue it
 * already used (rose = admin, amber = contractor, and so on) without the page
 * looking like a different product each time.
 *
 * The source photo is 739x415, so it upscales on large screens. The heavy
 * overlay plus a 1px blur turn that softness into deliberate depth-of-field
 * rather than visible pixelation — swap in a larger file at the same path if a
 * higher-resolution original becomes available.
 */
const ACCENTS = {
  emerald: { primary: 'bg-emerald-400/25', secondary: 'bg-teal-400/15' },
  rose: { primary: 'bg-rose-500/25', secondary: 'bg-slate-400/10' },
  amber: { primary: 'bg-amber-400/25', secondary: 'bg-orange-500/12' },
  cyan: { primary: 'bg-cyan-400/25', secondary: 'bg-sky-500/12' },
  indigo: { primary: 'bg-indigo-400/25', secondary: 'bg-blue-500/12' },
};

export default function AuthBackground({ accent = 'emerald' }) {
  const glow = ACCENTS[accent] || ACCENTS.emerald;

  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Photo. scale-105 hides the edge softening introduced by the blur. */}
      <img
        src={authBackground}
        alt=""
        className="absolute inset-0 w-full h-full object-cover scale-105 blur-[1px]"
        draggable={false}
      />

      {/* Deep green wash — the main legibility layer. */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/95 via-emerald-900/88 to-slate-950/96" />

      {/* Vignette: darkens the edges so a centred card lifts off the photo. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 45%, transparent 0%, rgba(2, 20, 12, 0.55) 100%)',
        }}
      />

      {/* Ambient accent glows, carried over from the original per-role design. */}
      <div className={`absolute -top-24 -left-16 w-80 h-80 rounded-full blur-[100px] ${glow.primary}`} />
      <div className={`absolute bottom-0 right-0 w-96 h-96 rounded-full blur-[110px] ${glow.secondary}`} />
    </div>
  );
}
