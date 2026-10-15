import { describe, expect, it } from 'vitest';
import { DEFAULT_GLASS_SETTINGS, normalizeGlassSettings } from '../../src/lib/styles/liquid-glass-settings.ts';

describe('glass preview settings', () => {
  it('bounds optics before they reach displacement-map generation', () => {
    expect(normalizeGlassSettings({ transparency: 1000, refraction: -1, blur: 99, highlight: -.5 })).toEqual({
      transparency: 95, refraction: 0, blur: 8, highlight: 0
    });
  });
  it('ignores corrupt, non-finite and unknown stored values', () => {
    for (const value of [null, [], 'broken', { transparency: '90', refraction: Infinity, blur: NaN, highlight: null, unexpected: 1 }]) {
      expect(normalizeGlassSettings(value)).toEqual(DEFAULT_GLASS_SETTINGS);
    }
  });
});
