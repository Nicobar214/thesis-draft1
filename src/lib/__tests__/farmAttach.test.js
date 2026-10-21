import { describe, it, expect } from 'vitest';
import { crossesWater, chooseAttachPoint, prepare } from '../farmAttach';

// A river running east-west at lat 10.770; the farm is south of it at 10.768.
const river = { kind: 'river', line: [[10.770, 122.340], [10.770, 122.360]] };
const farm = [10.768, 122.350];
const roadNorth = { highway: 'tertiary', line: [[10.7705, 122.345], [10.7705, 122.355]] };   // ~280 m, across the river
const roadSouth = { highway: 'unclassified', line: [[10.764, 122.345], [10.764, 122.355]] }; // ~440 m, same side

describe('farmAttach', () => {
  it('detects a walk that crosses the river', () => {
    const data = prepare([], [river]);
    expect(crossesWater(farm, [10.7705, 122.350], data.water)).toBe(true);
    expect(crossesWater(farm, [10.764, 122.350], data.water)).toBe(false);
  });

  it('joins the road on the farm side, even if a road across the river is closer', () => {
    const at = chooseAttachPoint(farm, prepare([roadNorth, roadSouth], [river]));
    expect(at.crossesWater).toBe(false);
    expect(at.point[0]).toBeCloseTo(10.764, 4);
  });

  it('says so when every nearby road is across water', () => {
    const at = chooseAttachPoint(farm, prepare([roadNorth], [river]));
    expect(at.crossesWater).toBe(true);
  });

  it('ignores canals (they can be crossed) and far-away roads', () => {
    const canal = { kind: 'canal', line: river.line };
    expect(chooseAttachPoint(farm, prepare([roadNorth], [canal])).crossesWater).toBe(false);
    expect(chooseAttachPoint(farm, prepare([roadNorth], [river]), 100)).toBeNull();
  });
});
