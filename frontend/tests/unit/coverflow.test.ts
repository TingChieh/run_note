import { describe, expect, it } from 'vitest';
import { coverflowGeometry, coverflowPosition } from '../../src/lib/styles/coverflow';

describe('bounded equal-size card space', () => {
  it('keeps the main card at its original size in the center', () => {
    expect(coverflowPosition(0, coverflowGeometry(600, 144))).toMatchObject({ x: 0, z: 0, rotation: 0, scale: 1, opacity: 1 });
  });
  it('keeps side cards the same projected size without shrinking or receding', () => {
    const geometry = coverflowGeometry(600, 144);
    const left = coverflowPosition(-1, geometry), right = coverflowPosition(1, geometry);
    expect(left.x).toBeLessThan(0); expect(right.x).toBeGreaterThan(0);
    for (const offset of [-2, -1, 0, 1, 2]) {
      expect(coverflowPosition(offset, geometry)).toMatchObject({ z: 0, rotation: 0, scale: 1, opacity: 1 });
    }
    expect(coverflowPosition(3, geometry).opacity).toBe(0);
  });
  it('reduces side cards to fit narrow containers while retaining mobile sliding travel', () => {
    expect(coverflowGeometry(600, 144).radius).toBe(2);
    expect(coverflowGeometry(360, 144).radius).toBe(1);
    expect(coverflowGeometry(180, 144).radius).toBe(0);
    expect(coverflowGeometry(0, 144).radius).toBe(0);
    expect(coverflowPosition(1, coverflowGeometry(180, 144)).x).toBeGreaterThanOrEqual(144);
    expect(coverflowPosition(1, coverflowGeometry(700, 144)).x).toBeGreaterThan(72);
  });
  it('translates continuously when the center begins to move', () => {
    const position = coverflowPosition(.001, coverflowGeometry(600, 144));
    expect(position.x).toBeGreaterThan(0); expect(position.x).toBeLessThan(1);
    expect(position.scale).toBe(1);
  });
  it('uses the fourth side slot on wide containers and keeps a hidden buffer', () => {
    const geometry = coverflowGeometry(800, 144);
    expect(geometry.radius).toBe(4);
    expect(coverflowPosition(4, geometry).opacity).toBe(1);
    expect(coverflowPosition(5, geometry).opacity).toBe(0);
  });
});
