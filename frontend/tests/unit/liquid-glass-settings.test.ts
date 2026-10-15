import { describe, expect, it } from 'vitest';
import { DEFAULT_GLASS_SETTINGS, normalizeGlassSettings } from '../../src/lib/styles/liquid-glass-settings.ts';

describe('glass preview settings', () => {
  it('bounds optics before they reach displacement-map generation', () => {
    expect(normalizeGlassSettings({ transparency: 1000, refraction: -1, blur: 99, highlight: -.5 })).toEqual({ ...DEFAULT_GLASS_SETTINGS,
      transparency: 95, refraction: 0, blur: 8, highlight: 0
    });
  });
  it('accepts the full optical range and bounds newly added parameters', () => {
    expect(normalizeGlassSettings({ refraction: 60, bezel: -1, curvature: 99, ior: 0,
      chroma: 99, specularWidth: -1, lightAngle: 999 })).toEqual({ ...DEFAULT_GLASS_SETTINGS,
      refraction: 60, bezel: .1, curvature: 6, ior: 1.3, chroma: .3,
      specularWidth: 1, lightAngle: 180 });
  });
  it('preserves old stored preferences while defaulting missing and non-finite optics', () => {
    const settings = normalizeGlassSettings({ transparency: 90, refraction: 28, blur: 4, highlight: .4,
      ior: NaN, bezel: Infinity, lightAngle: '-90' });
    expect(settings).toMatchObject({ transparency: 90, refraction: 28, blur: 4, highlight: .4,
      bezel: .8, curvature: 3, ior: 1.5, chroma: .12, specularWidth: 1.5, lightAngle: -120 });
  });
  it('ignores corrupt, non-finite and unknown stored values', () => {
    for (const value of [null, [], 'broken', { transparency: '90', refraction: Infinity, blur: NaN, highlight: null, unexpected: 1 }]) {
      expect(normalizeGlassSettings(value)).toEqual(DEFAULT_GLASS_SETTINGS);
    }
  });
});
