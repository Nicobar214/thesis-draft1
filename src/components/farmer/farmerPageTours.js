// Guided walkthrough for each farmer page, keyed by route, in the farmer's
// chosen language (lib/farmerI18n.js `walk.*` keys). Same format as the
// citizen and LGU tours: each step spotlights a [data-tour] element; a step
// with no target is a centered card; a step not on screen is skipped.

const el = (name) => `[data-tour="${name}"]`;

export function farmerPageTours(t) {
  const step = (key, target) => ({ target: target ? el(target) : undefined, title: t(`walk.${key}.title`), body: t(`walk.${key}.body`) });

  // Early in every guide: what the ? button does.
  const help = step('help', 'help');
  // Closing steps on every page.
  const header = [step('report', 'farmer-report'), step('notifications', 'notifications')];

  return {
    '/farmer': [
      step('farm.intro'),
      help,
      step('nav', 'farmer-nav'),
      step('farm.summary', 'farm-summary'),
      step('farm.map', 'farm-map'),
      ...header,
    ],
    '/farmer/harvest': [
      step('harvest.intro'),
      help,
      step('harvest.summary', 'harvest-summary'),
      step('harvest.form', 'harvest-form'),
      step('harvest.history', 'harvest-history'),
      ...header,
    ],
    '/farmer/reports': [
      step('reports.intro'),
      help,
      step('reports.new', 'reports-new'),
      step('reports.stats', 'reports-stats'),
      step('reports.filters', 'reports-filters'),
      ...header,
    ],
    '/farmer/community': [
      step('community.intro'),
      help,
      step('community.scope', 'feedback-scope'),
      step('community.filters', 'feedback-filters'),
      ...header,
    ],
    '/farmer/fmr-projects': [
      step('projects.intro'),
      help,
      step('projects.stats', 'projects-stats'),
      step('projects.list', 'projects-list'),
      ...header,
    ],
    '/farmer/markets': [
      step('markets.intro'),
      help,
      step('markets.list', 'markets-list'),
      ...header,
    ],
    '/farmer/profile': [
      step('profile.intro'),
      help,
      step('profile.language', 'profile-language'),
      ...header,
    ],
  };
}

/* Button and counter wording for PageTour, in the farmer's language. */
export function farmerTourLabels(t) {
  return {
    step: (n, total) => t('walk.step', { n, total }),
    skip: t('walk.skip'),
    close: t('walk.close'),
    back: t('walk.back'),
    next: t('walk.next'),
    done: t('walk.done'),
  };
}
