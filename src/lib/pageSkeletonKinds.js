// Which skeleton body each page of the multi-page portals uses
// (components/PageSkeletons.jsx). Add a route here when a page is added.
const ROUTE_KINDS = {
  farmer: {
    '/farmer': 'map',
    '/farmer/harvest': 'kpiForm',
    '/farmer/reports': 'list',
    '/farmer/fmr-projects': 'cards',
    '/farmer/markets': 'table',
    '/farmer/profile': 'profile',
  },
  user: {
    '/user': 'dashboard',
    '/user/reports': 'list',
    '/user/feedback': 'list',
    '/user/fmr-projects': 'cards',
    '/user/map': 'fullMap',
    '/user/profile': 'profile',
  },
  contractor: {
    '/contractor': 'dashboard',
    '/contractor/projects': 'cards',
    '/contractor/reports': 'list',
    '/contractor/profile': 'profile',
  },
};
const DEFAULT_KIND = { farmer: 'map', user: 'dashboard', contractor: 'dashboard' };

export function kindForPath(portal, pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return ROUTE_KINDS[portal]?.[path] || DEFAULT_KIND[portal] || 'dashboard';
}


/** Number of sidebar items to draw in the skeleton. */
export function portalPageCount(portal) {
  return Object.keys(ROUTE_KINDS[portal] || {}).length || 5;
}
