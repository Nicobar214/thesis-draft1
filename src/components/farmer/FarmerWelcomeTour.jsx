/* FarmerWelcomeTour.jsx — short first-time walkthrough for the farmer portal.
 *
 * Farmers are often new to this kind of app, and FarmerDashboard.jsx has no
 * explanation of what its tabs do. This is a small, self-contained modal
 * (reuses ui/Modal.jsx, no new dependency) that explains each tab in one
 * slide. It owns its own "have they seen this" state so FarmerDashboard only
 * has to render it and pass two props.
 */
import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import Icons from '../Icons';

const SLIDES = [
  {
    icon: 'Sprout',
    tone: 'bg-emerald-50 text-emerald-600',
    title: 'Welcome to KalsaTrack',
    body: 'This is your farmer portal. It shows your farm’s nearby road project and market, lets you report road problems, and tracks your harvests. A quick look at what each tab does:',
  },
  {
    icon: 'MapPin',
    tone: 'bg-emerald-50 text-emerald-600',
    title: 'Logistics Map',
    body: 'See your farm, the nearest road project being built or repaired, and the nearest market — all on one map.',
  },
  {
    icon: 'Wheat',
    tone: 'bg-amber-50 text-amber-700',
    title: 'Harvest',
    body: 'Log how much you harvested and when. You’ll see your harvests over time so you can track your own progress.',
  },
  {
    icon: 'Warning',
    tone: 'bg-emerald-50 text-emerald-700',
    title: 'Report Road Issue',
    body: 'See a damaged or unsafe road? Tap the green “Report Road Issue” button at the top of any page and send a photo. The DA office will review it.',
  },
  {
    icon: 'Document',
    tone: 'bg-sky-50 text-sky-700',
    title: 'My Reports',
    body: 'Track the status of every report you’ve sent, from submitted to resolved.',
  },
  {
    icon: 'Building',
    tone: 'bg-violet-50 text-violet-700',
    title: 'Markets Directory',
    body: 'Browse nearby markets — operating hours, accepted crops, and contact numbers.',
  },
];

function storageKeyFor(userId) {
  return userId ? `farmer-onboarding-seen:${userId}` : null;
}

/**
 * @param {string}  [userId]        current farmer's auth id; the "seen" flag
 *                                  is scoped to this since a device may be
 *                                  shared between farmers in the field
 * @param {*}       [reopenSignal]  change this value to force the tour open
 *                                  again regardless of the stored flag
 */
export default function FarmerWelcomeTour({ userId, reopenSignal }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // First time this farmer has a session: open automatically if they haven't
  // dismissed it before on this device.
  useEffect(() => {
    const key = storageKeyFor(userId);
    if (!key) return;
    try {
      if (!localStorage.getItem(key)) {
        setStep(0);
        setOpen(true);
      }
    } catch {
      // Storage unavailable (private mode, etc.) -- fail open is wrong here
      // since it would show the tour every load, so just skip it silently.
    }
  }, [userId]);

  // Manual reopen via the header's "?" button, independent of the flag.
  useEffect(() => {
    if (reopenSignal === undefined || reopenSignal === 0) return;
    setStep(0);
    setOpen(true);
  }, [reopenSignal]);

  const finish = () => {
    setOpen(false);
    const key = storageKeyFor(userId);
    try {
      if (key) localStorage.setItem(key, '1');
    } catch {
      // Nothing to do if storage can't be written -- the tour will just
      // reappear next load, which is a minor inconvenience, not a bug.
    }
  };

  if (!open) return null;

  const slide = SLIDES[step];
  const Icon = Icons[slide.icon];
  const isLast = step === SLIDES.length - 1;

  return (
    <Modal
      onClose={finish}
      size="sm"
      hideHeader
      bodyClassName="px-6 pt-8 pb-2 text-center"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="text-xs font-semibold text-slate-400 hover:text-slate-600"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            >
              {isLast ? 'Get Started' : 'Next'}
            </Button>
          </div>
        </div>
      }
      ariaLabel="Welcome to KalsaTrack"
    >
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${slide.tone}`}>
        {Icon && <Icon />}
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">{slide.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{slide.body}</p>

      <div className="mt-6 flex items-center justify-center gap-1.5" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <span
            key={s.title}
            className={`h-1.5 rounded-full transition-all ${
              i === step ? 'w-5 bg-emerald-600' : 'w-1.5 bg-slate-200'
            }`}
          />
        ))}
      </div>
    </Modal>
  );
}
