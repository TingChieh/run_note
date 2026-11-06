import { describe, expect, it } from 'vitest';
import shapes from '../../src/lib/data/china-provinces.json';

// The shapes are inlined into the server-rendered dashboard HTML and the JS bundle, so both their
// validity and their size matter. Regenerate with scripts/simplify-province-paths.py.
const rings = (path: string) => path.split('M').slice(1).map(ring => ring.replace(/Z$/, ''));
const points = (ring: string) => ring.split('L').map(pair => pair.split(',').map(Number));

describe('province map shapes', () => {
  it('keeps every province and the sea outline', () => {
    const codes = new Set(shapes.map(shape => shape.code));
    expect([...codes].filter(code => typeof code === 'number')).toHaveLength(34);
    expect(codes.has('100000_JD')).toBe(true);
    for (const shape of shapes) expect(shape.name, String(shape.code)).not.toBe('');
  });
  it('is made of closed rings of finite points inside the 660x420 viewBox', () => {
    for (const shape of shapes) {
      expect(shape.path, shape.name).toMatch(/^M[-\d.,L]+Z(M[-\d.,L]+Z)*$/);
      for (const ring of rings(shape.path)) {
        const pts = points(ring);
        expect(pts.length, `${shape.name} ring`).toBeGreaterThanOrEqual(3);
        for (const [x, y] of pts) {
          expect(Number.isFinite(x) && Number.isFinite(y), shape.name).toBe(true);
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(660);
          expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(420);
        }
      }
    }
  });
  it('stays small enough to inline (was 380 kB of path data)', () => {
    expect(shapes.reduce((sum, shape) => sum + shape.path.length, 0)).toBeLessThan(120_000);
  });
});
