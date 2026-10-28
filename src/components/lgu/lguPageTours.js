// Guided tour steps for each LGU page, keyed by the dashboard tab. Same format
// as the citizen tours (components/user/userPageTours.js): each step spotlights
// a [data-tour] element on the page; a step with no target is a centered card;
// a step whose element is not on screen (e.g. another sub-tab) is skipped.

const t = (name) => `[data-tour="${name}"]`;

// Early in every guide: what the ? button is, so the LGU knows help is always there.
const HELP_STEP = {
  target: t('help'),
  title: 'This is the Help button',
  body: 'Tap ? on any page to replay its guide. Each page has its own walkthrough of what is on it and what to do there.',
};

// Closing steps on every page.
const HEADER_STEPS = [
  {
    target: t('lgu-propose'),
    title: 'Propose a project',
    body: 'Start a new farm-to-market road proposal for the DA from any page.',
  },
  {
    target: t('notifications'),
    title: 'Notifications',
    body: 'Jobs the DA sends you, proposal decisions and other updates appear here.',
  },
];

export const LGU_PAGE_TOURS = {
  overview: [
    {
      title: 'Welcome to the LGU portal',
      body: 'A quick walkthrough of this page. It takes less than a minute.',
    },
    HELP_STEP,
    {
      target: t('lgu-nav'),
      title: 'Main menu',
      body: 'Overview, Citizen Reports, Project Proposals, Beneficiaries, Markets, Analytics and your profile.',
    },
    {
      target: t('lgu-kpis'),
      title: 'Your roads at a glance',
      body: 'How many FMR projects your municipality has, how far along they are, and how many farmers are registered.',
    },
    {
      target: t('lgu-map'),
      title: 'Route map',
      body: 'Every FMR road and citizen report in your area. Use the filters above it to focus on a barangay, project or overdue reports.',
    },
    {
      target: t('lgu-inventory'),
      title: 'Road inventory',
      body: 'Every FMR road with its project status (On-Going, Pending or Completed), length and year built. Filter by status or barangay, and tap a column header to sort.',
    },
    ...HEADER_STEPS,
  ],

  'citizen-reports': [
    {
      title: 'Citizen Reports',
      body: 'Minor road problems citizens reported (fallen trees, debris, signs, lights). The DA checks each one, then sends it to your LGU to fix.',
    },
    HELP_STEP,
    {
      target: t('handler-stages'),
      title: 'Where your jobs stand',
      body: 'To do, In progress, Sent to the DA, Being checked by the DA, and Done. Tap a card to show only those jobs.',
    },
    {
      target: t('handler-filters'),
      title: 'Find a report',
      body: 'Search by road, barangay or reference number, and filter by issue type, municipality or barangay.',
    },
    {
      target: t('handler-list'),
      title: 'Handle a job in 3 steps',
      body: '1. Accept it and set a work date. 2. Start the work. 3. Send an on-site after-photo. Not yours? Use "Return to DA" before starting.',
    },
    ...HEADER_STEPS,
  ],

  proposals: [
    {
      title: 'Project Proposals',
      body: 'Propose new farm-to-market roads to the DA and follow each one until it is decided.',
    },
    HELP_STEP,
    {
      target: t('lgu-proposal-tabs'),
      title: 'Your proposals',
      body: 'See every proposal you sent and where it stands: submitted, under validation, needs revision, approved or rejected.',
    },
    {
      target: t('lgu-proposal-new'),
      title: 'Submit a new proposal',
      body: 'Draw the road on the map (open Layers to see existing FMR roads with their start and end, markets, or satellite view), attach the 5 required documents and a road photo (taken with the camera or attached), then submit it to the DA. A road that already exists under the same name cannot be proposed again.',
    },
    ...HEADER_STEPS,
  ],

  beneficiaries: [
    {
      title: 'Farmer Beneficiaries',
      body: 'The farmers in your municipality, their farms, and the roads and markets they use.',
    },
    HELP_STEP,
    {
      target: t('lgu-ben-tabs'),
      title: 'List, register, analyze',
      body: 'See registered farmers, register a new one (pin the farm and link its road and market), or view farmer analytics.',
    },
    {
      target: t('lgu-ben-export'),
      title: 'Export',
      body: 'Download the filtered farmer list as a CSV file.',
    },
    ...HEADER_STEPS,
  ],

  markets: [
    {
      title: 'Markets',
      body: 'The markets and trading posts where farmers sell. They are used to work out farm-to-market routes.',
    },
    HELP_STEP,
    {
      target: t('lgu-market-tabs'),
      title: 'Market list and registration',
      body: 'See the registered markets, or register a new one with its location and the crops it accepts.',
    },
    ...HEADER_STEPS,
  ],

  analytics: [
    {
      title: 'Analytics',
      body: 'Numbers for your municipality: road projects, farmers and reported harvests.',
    },
    HELP_STEP,
    {
      target: t('lgu-analytics-filters'),
      title: 'Filters',
      body: 'Choose a year and a barangay. Everything below follows these filters.',
    },
    {
      target: t('lgu-analytics-projects'),
      title: 'Project implementation',
      body: 'Status and progress of FMR projects, using engineer-certified figures only.',
    },
    {
      target: t('lgu-analytics-harvest'),
      title: 'Reported harvest',
      body: 'Harvest reported by farmers. Unusually high entries wait for your check before they count.',
    },
    ...HEADER_STEPS,
  ],

  profile: [
    {
      title: 'My Profile',
      body: 'Your LGU account details and profile photo.',
    },
    HELP_STEP,
    ...HEADER_STEPS,
  ],
};
