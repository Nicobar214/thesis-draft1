/* FarmerWelcomeTour.jsx — short first-time walkthrough for the farmer portal.
 *
 * Farmers are often new to this kind of app. This small modal (reuses
 * ui/Modal.jsx) explains each tab in one slide, in the farmer's language. The
 * first slide lets them pick English, Hiligaynon or Tagalog, so the rest of the
 * guide (and the whole portal) is already in their language. It owns its own
 * "have they seen this" state, so FarmerLayout only renders it with two props.
 */
import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import Icons from '../Icons';
import { FARMER_LANGUAGES, useFarmerT } from '../../lib/farmerI18n';

// Matches the sidebar's tabs and order (FarmerSidebar.jsx).
const SLIDES = [
  { id: 'welcome', icon: 'Sprout', tone: 'bg-emerald-50 text-emerald-600', titleKey: 'tour.welcome.title', bodyKey: 'tour.welcome.body', languagePicker: true },
  { id: 'myFarm', icon: 'MapPin', tone: 'bg-emerald-50 text-emerald-600', titleKey: 'nav.myFarm', bodyKey: 'tour.myFarm.body' },
  { id: 'harvest', icon: 'Wheat', tone: 'bg-amber-50 text-amber-700', titleKey: 'nav.harvest', bodyKey: 'tour.harvest.body' },
  { id: 'report', icon: 'Warning', tone: 'bg-emerald-50 text-emerald-700', titleKey: 'tour.report.title', bodyKey: 'tour.report.body' },
  { id: 'myReports', icon: 'Document', tone: 'bg-sky-50 text-sky-700', titleKey: 'nav.myReports', bodyKey: 'tour.myReports.body' },
  { id: 'roadProjects', icon: 'Road', tone: 'bg-teal-50 text-teal-700', titleKey: 'nav.roadProjects', bodyKey: 'tour.roadProjects.body' },
  { id: 'markets', icon: 'Building', tone: 'bg-violet-50 text-violet-700', titleKey: 'nav.markets', bodyKey: 'tour.markets.body' },
  { id: 'language', icon: 'UserCircle', tone: 'bg-slate-100 text-slate-700', titleKey: 'tour.language.title', bodyKey: 'tour.language.body' },
];

function storageKeyFor(userId) {
  return userId ? `farmer-onboarding-seen:${userId}` : null;
}

function LanguagePicker() {
  const { lang, setLang } = useFarmerT();
  return (
    <div role="radiogroup" aria-label="Language" className="mt-4 grid grid-cols-1 gap-2 text-left sm:grid-cols-3">
      {FARMER_LANGUAGES.map((option) => {
        const selected = option.code === lang;
        return (
          <button
            key={option.code}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setLang(option.code)}
            className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              selected ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * @param {string}  [userId]        current farmer's auth id; the "seen" flag
 *                                  is scoped to this since a device may be
 *                                  shared between farmers in the field
 * @param {*}       [reopenSignal]  change this value to force the tour open
 *                                  again regardless of the stored flag
 */
export default function FarmerWelcomeTour({ userId, reopenSignal }) {
  const { t } = useFarmerT();
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
            {t('tour.skip')}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setStep((s) => s - 1)}>
                {t('tour.back')}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            >
              {isLast ? t('tour.start') : t('tour.next')}
            </Button>
          </div>
        </div>
      }
      ariaLabel={t('tour.welcome.title')}
    >
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${slide.tone}`}>
        {Icon && <Icon />}
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">{t(slide.titleKey)}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{t(slide.bodyKey)}</p>
      {slide.languagePicker && <LanguagePicker />}

      <div className="mt-6 flex items-center justify-center gap-1.5" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 rounded-full transition-all ${
              i === step ? 'w-5 bg-emerald-600' : 'w-1.5 bg-slate-200'
            }`}
          />
        ))}
      </div>
    </Modal>
  );
}
