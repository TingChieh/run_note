import { describe, expect, it } from 'vitest';
import { routeDrawing } from '../../src/lib/api/route-drawing.ts';
import type { Route } from '../../src/lib/api/activities.ts';

// Synthetic loop with GPS-like jitter; never real coordinates.
function loop(count: number): Route {
  const coordinates: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / (count - 1)) * Math.PI * 2;
    const jitter = Math.sin(i * 12.9898) * 0.00002;
    coordinates.push([120 + Math.cos(a) * 0.01 + jitter, 30 + Math.sin(a) * 0.006 - jitter]);
  }
  return { type: 'FeatureCollection', start: coordinates[0], end: coordinates[count - 1], features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { segment_index: 0, point_count: count } }
  ] } as never;
}
const vertices = (path: string) => path.split(/(?=[ML])/).length;

describe('routeDrawing simplification', () => {
  it('leaves the default output untouched', () => {
    const route = loop(3000);
    expect(routeDrawing(route)).toEqual(routeDrawing(route, 360, 220, {}));
  });
  it('shrinks thumbnails a lot while keeping endpoints and shape bounds', () => {
    const route = loop(3000);
    const full = routeDrawing(route).paths[0], thumb = routeDrawing(route, 360, 220, { tolerance: 0.8, digits: 1 }).paths[0];
    expect(thumb.length).toBeLessThan(full.length / 2);
    const start = (path: string) => path.split(' ')[0].slice(1).split(',').map(Number);
    const end = (path: string) => path.split(' ').at(-1)!.slice(1).split(',').map(Number);
    expect(start(thumb)[0]).toBeCloseTo(start(full)[0], 0); expect(start(thumb)[1]).toBeCloseTo(start(full)[1], 0);
    expect(end(thumb)[0]).toBeCloseTo(end(full)[0], 0); expect(end(thumb)[1]).toBeCloseTo(end(full)[1], 0);
    expect(vertices(thumb)).toBeGreaterThan(20);
    expect(thumb).not.toMatch(/NaN|Infinity/);
  });
  it('keeps corners and handles degenerate segments', () => {
    const corner = { type: 'FeatureCollection', start: [120, 30], end: [120, 30.01], features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[120, 30], [120.005, 30], [120.01, 30], [120.01, 30.005], [120.01, 30.01]] }, properties: { segment_index: 0, point_count: 5 } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[120, 30], [120, 30]] }, properties: { segment_index: 1, point_count: 2 } }
    ] } as never;
    const [path, stationary] = routeDrawing(corner, 360, 220, { tolerance: 0.8, digits: 1 }).paths;
    expect(vertices(path)).toBe(3);
    expect(stationary).not.toMatch(/NaN/);
  });
});
