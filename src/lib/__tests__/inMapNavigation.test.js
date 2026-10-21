import { describe, it, expect } from 'vitest';
import { describeStep, formatEta, parseOsrmRoute, routeProgress } from '../inMapNavigation';

const osrm = {
  routes: [{
    distance: 1500,
    duration: 300,
    geometry: { coordinates: [[122.5, 10.7], [122.505, 10.7], [122.51, 10.701]] },
    legs: [{
      steps: [
        { distance: 500, name: 'Rizal Street', maneuver: { type: 'depart' } },
        { distance: 1000, name: 'Bonifacio Drive', maneuver: { type: 'turn', modifier: 'left' } },
        { distance: 0, name: '', maneuver: { type: 'arrive' } },
      ],
    }],
  }],
};

describe('describeStep', () => {
  it('turns router steps into short instructions', () => {
    expect(describeStep({ name: 'Rizal Street', maneuver: { type: 'turn', modifier: 'right' } })).toBe('Turn right onto Rizal Street');
    expect(describeStep({ name: '', maneuver: { type: 'roundabout', exit: 2 } })).toBe('At the roundabout, take exit 2');
    expect(describeStep({ maneuver: { type: 'arrive' } })).toBe('Arrive at the report site');
  });
});

describe('parseOsrmRoute', () => {
  it('reads the line as [lat, lng] with steps placed along it', () => {
    const route = parseOsrmRoute(osrm);
    expect(route.points[0]).toEqual([10.7, 122.5]);
    expect(route.distanceM).toBe(1500);
    expect(route.steps.map((s) => s.startM)).toEqual([0, 500, 1500]);
  });

  it('is null when there is no route', () => {
    expect(parseOsrmRoute({ routes: [] })).toBeNull();
  });
});

describe('routeProgress', () => {
  const route = parseOsrmRoute(osrm);
  it('gives what is left and the next instruction', () => {
    const p = routeProgress(route, 200);
    expect(p.remainingM).toBe(1300);
    expect(p.nextText).toBe('Turn left onto Bonifacio Drive');
    expect(p.nextInM).toBe(300);
    expect(p.remainingS).toBeCloseTo(260, 0);
  });
});

describe('formatEta', () => {
  it('reads as minutes, then hours', () => {
    expect(formatEta(90)).toBe('2 min');
    expect(formatEta(4000)).toBe('1 h 7 min');
  });
});
