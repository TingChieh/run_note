import { describe, expect, it } from 'vitest';
import { coverflowGeometry, coverflowPosition } from '../../src/lib/styles/coverflow';

describe('fanned card hand', () => {
  it('draws the main card up at its original size in the center', () => {
    expect(coverflowPosition(0, coverflowGeometry(900, 192))).toMatchObject({ x: 0, y: 0, z: 0, rotation: 0, roll: 0, scale: 1, opacity: 1 });
  });
  it('sinks, shrinks and rolls side cards outwards symmetrically', () => {
    const geometry = coverflowGeometry(900, 192);
    const left = coverflowPosition(-1, geometry), right = coverflowPosition(1, geometry);
    expect(left.x).toBeLessThan(0); expect(right.x).toBeGreaterThan(0);
    expect(left.roll).toBeLessThan(0); expect(right.roll).toBeGreaterThan(0);
    expect(left.y).toBe(right.y); expect(right.y).toBeGreaterThan(0);
    const far = coverflowPosition(2, geometry);
    expect(far.y).toBeGreaterThan(right.y); expect(far.scale).toBeLessThan(right.scale); expect(far.roll).toBeGreaterThan(right.roll);
    expect(coverflowPosition(3, geometry).opacity).toBe(0);
  });
  it('keeps every side card center clear of the hover-scaled main card', () => {
    for (const width of [600, 900, 1200, 1600]) {
      const geometry = coverflowGeometry(width, 192);
      if (geometry.radius) expect(geometry.step).toBeGreaterThanOrEqual(192 * .56);
      expect(geometry.radius).toBeLessThanOrEqual(3);
    }
  });
  it('reduces side cards to fit narrow containers while retaining mobile sliding travel', () => {
    expect(coverflowGeometry(900, 192).radius).toBe(2);
    expect(coverflowGeometry(600, 192).radius).toBe(1);
    expect(coverflowGeometry(240, 160).radius).toBe(0);
    expect(coverflowGeometry(0, 144).radius).toBe(0);
    expect(coverflowPosition(1, coverflowGeometry(240, 160)).x).toBeGreaterThanOrEqual(160);
  });
  it('moves continuously when the center begins to travel', () => {
    const position = coverflowPosition(.001, coverflowGeometry(900, 192));
    expect(position.x).toBeGreaterThan(0); expect(position.x).toBeLessThan(1);
    expect(position.y).toBeGreaterThan(0); expect(position.y).toBeLessThan(1);
    expect(position.scale).toBeLessThan(1); expect(position.scale).toBeGreaterThan(.999);
  });
  it('uses the third side slot on wide containers and keeps a hidden buffer', () => {
    const geometry = coverflowGeometry(1200, 192);
    expect(geometry.radius).toBe(3);
    expect(coverflowPosition(3, geometry).opacity).toBe(1);
    expect(coverflowPosition(4, geometry).opacity).toBe(0);
  });
});
