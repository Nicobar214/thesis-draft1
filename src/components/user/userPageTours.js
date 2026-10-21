// Guided tour steps for each citizen page, keyed by route. A step with no
// target is shown as a centered card. Targets are [data-tour] attributes on
// the page; a step whose element is not on screen is skipped automatically.

const t = (name) => `[data-tour="${name}"]`;

export const USER_PAGE_TOURS = {
  '/user': [
    {
      title: 'Welcome to KalsaTrack',
      body: 'This short guide shows the main parts of this page. Every page has its own guide: tap the ? button at the top whenever you want it.',
    },
    {
      target: t('nav'),
      title: 'Main menu',
      body: 'Move between your Dashboard, FMR Projects, Map, My Reports, Community Feedback and Profile.',
    },
    {
      target: t('dash-report'),
      title: 'Report a road problem',
      body: 'See a damaged or unsafe road? Tap here to send a report with a photo and its location.',
    },
    {
      target: t('dash-activity'),
      title: 'Your reports',
      body: 'Every report you have sent and where it stands: submitted, under review, or resolved.',
    },
    {
      target: t('dash-nearby'),
      title: 'Projects in your area',
      body: 'Road projects in your municipality. Set your municipality in Profile to personalize this.',
    },
    {
      target: t('dash-map'),
      title: 'Roads near you',
      body: 'A quick map of FMR roads and your report pins. Use "Open the full map" for more detail.',
    },
    {
      target: t('dash-stats'),
      title: 'Program numbers',
      body: 'How many road projects there are in the region, and how many are completed, ongoing or proposed.',
    },
    {
      target: t('notifications'),
      title: 'Notifications',
      body: 'Updates on your reports and on projects you follow show up here.',
    },
    {
      target: t('help'),
      title: 'Need help again?',
      body: 'This guide won’t show up by itself again. Tap ? on any page to see the guide for that page.',
    },
  ],

  '/user/fmr-projects': [
    {
      title: 'FMR Projects',
      body: 'Every Farm-to-Market Road project in the region, with its status, progress and budget.',
    },
    {
      target: t('fmr-stats'),
      title: 'Project totals',
      body: 'How many projects are on-going, proposed and completed, and the total road length.',
    },
    {
      target: t('fmr-filters'),
      title: 'Search and filter',
      body: 'Search by project name or place, filter by year or municipality, change the sort order, or export the list as CSV.',
    },
    {
      target: t('fmr-status'),
      title: 'Status tabs',
      body: 'Show On-Going, Proposed, Completed or Overdue projects. "Following" lists the projects you follow.',
    },
    {
      target: t('fmr-view'),
      title: 'Table or cards',
      body: 'Switch the layout. Click any project to open its details, progress and budget.',
    },
  ],

  '/user/map': [
    {
      title: 'Map View',
      body: 'Every road project and your own reports on one map.',
    },
    {
      target: t('map-search'),
      title: 'Find a place',
      body: 'Type a barangay, road or project name to jump to it on the map.',
    },
    {
      target: t('map-status'),
      title: 'Filter by status',
      body: 'Show only completed, on-going or proposed roads.',
    },
    {
      target: t('map-canvas'),
      title: 'The map',
      body: 'Each colored line is a road project: green is completed, amber is on-going, blue is proposed. Click a road to see its details.',
    },
    {
      target: t('map-layers'),
      title: 'Layers',
      body: 'Turn markets, road gaps, farmer areas and your reports on or off, or change the map style.',
    },
    {
      target: t('map-legend'),
      title: 'Legend',
      body: 'What each color and marker on the map means.',
    },
    {
      target: t('map-list'),
      title: 'Project list',
      body: 'Click a project here to zoom the map to it.',
    },
  ],

  '/user/reports': [
    {
      title: 'My Reports',
      body: 'Send reports about road problems and follow each one until it is resolved.',
    },
    {
      target: t('reports-new'),
      title: 'Submit a new report',
      body: 'Add a photo, choose the problem and pin the location. It goes straight to the DA office for review.',
    },
    {
      target: t('reports-stats'),
      title: 'Status summary',
      body: 'The big card shows all your reports and how many are resolved. Tap a smaller card to show only those reports; tap it again to show all.',
    },
    {
      target: t('reports-filters'),
      title: 'Search and filter',
      body: 'Find a report by description or location, or filter by status and type of problem.',
    },
    {
      target: t('reports-view'),
      title: 'Your report list',
      body: 'Switch between table and cards. Open a report to see its history, the inspection result and the repair follow-up.',
    },
  ],

  '/user/feedback': [
    {
      title: 'Community Feedback',
      body: 'Road reports and feedback from across the community, so you can see what others have raised.',
    },
    {
      target: t('feedback-scope'),
      title: 'Everyone or just you',
      body: 'Switch between everyone’s submissions and only your own.',
    },
    {
      target: t('feedback-filters'),
      title: 'Search and filter',
      body: 'Search by project, message or location, and filter by type, status or verification.',
    },
  ],

  '/user/profile': [
    {
      title: 'Profile Settings',
      body: 'Your account details and preferences.',
    },
    {
      target: t('profile-photo'),
      title: 'Your photo',
      body: 'Tap the camera to add a profile photo. It also appears at the top right of every page.',
    },
    {
      target: t('profile-info'),
      title: 'Your name',
      body: 'Tap Edit to change the name shown on your reports.',
    },
    {
      target: t('profile-location'),
      title: 'Your location',
      body: 'Set your municipality and barangay so your dashboard shows the road projects near you.',
    },
  ],
};
