import { describe, expect, it } from 'vitest';
import type { Metric } from '../../src/lib/api/activities';
import { activityAchievement } from '../../src/lib/api/activity-labels';

describe('activity distance achievements', () => {
  it.each<[Metric, string | null]>([
    [0, null], [4999, null], ['4999.999', null],
    [5000, '5 km 达成'], ['5000.00', '5 km 达成'],
    [9999, '5 km 达成'], ['9999.999', '5 km 达成'],
    [10000, '10 km 达成'], ['10000.01', '10 km 达成'],
    [19999, '10 km 达成'], ['19999.999', '10 km 达成'],
    [20000, '20 km 达成'], ['42195', '20 km 达成']
  ])('uses the actual distance %s to show only the highest achievement', (distance, expected) => {
    expect(activityAchievement(distance)).toBe(expected);
  });

  it.each([null, undefined, '', ' ', 'invalid', '5 km', '-5000', -5000, NaN, Infinity, 'Infinity', '1e4'])('does not award invalid or missing distance %s', distance => {
    expect(activityAchievement(distance as Metric)).toBeNull();
  });
});
