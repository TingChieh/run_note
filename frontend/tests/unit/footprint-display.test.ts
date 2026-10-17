import { expect, it } from 'vitest';
import { footprintDisplayData, MAX_FOOTPRINT_DISPLAY_POINTS } from '../../src/lib/map/footprint-display';

it('bounds large map geometry while preserving path endpoints and source data', () => {
  const coordinates = Array.from({ length: 250_000 }, (_, index) => [121 + (index % 100) / 1000, 31 + (index % 80) / 1000] as [number, number]);
  const data = { features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }] } as unknown as import('../../src/lib/api/footprints').FootprintsAll;

  const display = footprintDisplayData(data);
  const reduced = display.features[0].geometry as unknown as { coordinates: [number, number][] };
  expect(reduced.coordinates.length).toBeLessThanOrEqual(MAX_FOOTPRINT_DISPLAY_POINTS);
  expect(reduced.coordinates[0]).toBe(coordinates[0]);
  expect(reduced.coordinates.at(-1)).toBe(coordinates.at(-1));
  expect(coordinates).toHaveLength(250_000);
  expect(reduced.coordinates.reduce((minimum, point) => Math.min(minimum, point[0]), Infinity)).toBe(121);
  expect(reduced.coordinates.reduce((maximum, point) => Math.max(maximum, point[1]), -Infinity)).toBe(31.079);
});

it('returns small map collections unchanged', () => {
  const data = { features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[121, 31], [122, 32]] }, properties: {} }] } as unknown as import('../../src/lib/api/footprints').FootprintsAll;
  expect(footprintDisplayData(data)).toBe(data);
});
