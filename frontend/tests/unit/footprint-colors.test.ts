import { expect, it } from 'vitest';
import { colorFootprintFeatures } from '../../src/lib/map/footprint-colors';

it('assigns a stable color per activity in large collections', () => {
  const features = Array.from({ length: 10_000 }, (_, index) => ({
    type: 'Feature' as const,
    properties: { activity_id: `activity-${index % 4}`, segment_index: index },
  }));
  const colored = colorFootprintFeatures(features, ['green', 'blue', 'orange', 'violet']);

  expect(colored).toHaveLength(10_000);
  expect(colored[0].properties.color).toBe('green');
  expect(colored[1].properties.color).toBe('blue');
  expect(colored[2].properties.color).toBe('orange');
  expect(colored[3].properties.color).toBe('violet');
  expect(colored[4].properties.color).toBe('green');
  expect(colored[9_999].properties.color).toBe('violet');
});

it('keeps non-track features on one fallback color', () => {
  const features = [{ properties: {} }, { properties: {} }];

  expect(colorFootprintFeatures(features, ['green', 'blue']).map((feature) => feature.properties.color)).toEqual([
    'green',
    'green',
  ]);
});
