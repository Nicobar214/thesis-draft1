/* In-map driving directions for the field engineer: the road route from where
 * they are to a report site, with turn-by-turn steps, from the public OSRM car
 * router (the same router the app already uses for routes). No external app. */

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

const DIRECTION = {
  left: 'left',
  right: 'right',
  'slight left': 'slightly left',
  'slight right': 'slightly right',
  'sharp left': 'sharp left',
  'sharp right': 'sharp right',
  straight: 'straight',
  uturn: 'around',
};

/* One OSRM step as a short instruction, e.g. "Turn left onto Rizal Street". */
export function describeStep(step) {
  const m = step?.maneuver || {};
  const road = step?.name ? ` onto ${step.name}` : '';
  const dir = DIRECTION[m.modifier] || '';
  switch (m.type) {
    case 'depart': return `Head out${step?.name ? ` on ${step.name}` : ''}`;
    case 'arrive': return 'Arrive at the report site';
    case 'roundabout':
    case 'rotary': return `At the roundabout, take exit ${m.exit || 1}${road}`;
    case 'merge': return `Merge${dir ? ` ${dir}` : ''}${road}`;
    case 'fork': return `Keep ${dir || 'ahead'} at the fork${road}`;
    case 'end of road': return `At the end of the road, turn ${dir || 'ahead'}${road}`;
    case 'continue':
    case 'new name': return `Continue${dir && dir !== 'straight' ? ` ${dir}` : ''}${road}`;
    default:
      if (dir === 'straight' || !dir) return `Go straight${road}`;
      if (dir === 'around') return `Make a U-turn${road}`;
      return `Turn ${dir}${road}`;
  }
}

/* OSRM answer → { points: [[lat, lng]], distanceM, durationS, steps: [{ text, distanceM, startM }] }.
 * startM is how far along the route each step begins, to find the next one. */
export function parseOsrmRoute(json) {
  const route = json?.routes?.[0];
  if (!route?.geometry?.coordinates?.length) return null;
  let travelled = 0;
  const steps = (route.legs?.[0]?.steps || []).map((step) => {
    const out = { text: describeStep(step), distanceM: step.distance || 0, startM: travelled };
    travelled += step.distance || 0;
    return out;
  });
  return {
    points: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceM: route.distance || 0,
    durationS: route.duration || 0,
    steps,
  };
}

export async function fetchDrivingRoute(from, to, { signal } = {}) {
  const url = `${OSRM}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const route = parseOsrmRoute(await res.json());
  if (!route) throw new Error('No road route found');
  return route;
}

/**
 * Of several points where someone could join a road, the one that is really
 * closest by street (the straight-line nearest point can sit across a river
 * or a field from any street). One OSRM table request; returns the index into
 * `candidates`, counting how far each candidate is from the street OSRM snaps
 * it to, since that last stretch is walked, not driven.
 */
export async function fetchBestEntryIndex(from, candidates, { signal } = {}) {
  if (candidates.length <= 1) return 0;
  const coords = [from, ...candidates].map(([lat, lng]) => `${lng},${lat}`).join(';');
  const res = await fetch(`${OSRM.replace('/route/', '/table/')}/${coords}?sources=0&annotations=distance`, { signal });
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const json = await res.json();
  const row = json?.distances?.[0];
  if (!Array.isArray(row)) return 0;
  let best = 0;
  let bestCost = Infinity;
  candidates.forEach((_, i) => {
    const driven = row[i + 1];
    const snap = json.destinations?.[i + 1]?.distance ?? 0;
    // Walking the last stretch counts extra: 1 m on foot ≈ 3 m by car.
    const cost = driven == null ? Infinity : driven + snap * 3;
    if (cost < bestCost) { bestCost = cost; best = i; }
  });
  return best;
}

/* Where the engineer is along the route: what is left and the next step. */
export function routeProgress(route, travelledM) {
  if (!route) return null;
  const done = Math.max(0, Math.min(travelledM || 0, route.distanceM));
  const remainingM = Math.max(0, route.distanceM - done);
  const share = route.distanceM > 0 ? remainingM / route.distanceM : 0;
  const next = route.steps.find((s) => s.startM + s.distanceM > done && s.startM >= done - 5) || route.steps.find((s) => s.startM + s.distanceM > done);
  return {
    remainingM,
    remainingS: route.durationS * share,
    nextText: next?.text || 'Arrive at the report site',
    nextInM: next ? Math.max(0, next.startM - done) : remainingM,
  };
}

export function formatEta(seconds) {
  const min = Math.max(1, Math.round((seconds || 0) / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}
