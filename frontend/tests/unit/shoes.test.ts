import { describe, expect, it } from 'vitest';
import { kilometersToMeters, metersToKilometers, remainingLabel } from '#lib/api/shoes.ts';

describe('shoe distances', () => {
  it('preserves millimeter precision from kilometer entry', () => {
    expect(kilometersToMeters('12.000001')).toBe('12000.001');
    expect(metersToKilometers('12000.001')).toBe('12.000001');
    expect(kilometersToMeters('00000.12')).toBe('120');
    expect(kilometersToMeters('999999.999999')).toBe('999999999.999');
    expect(kilometersToMeters('1000000')).toBeNull();
    expect(kilometersToMeters('1e2')).toBeNull();
  });

  it('keeps small positive remaining distances visible', () => {
    expect(remainingLabel('99.999')).toBe('剩余不足 0.1 km');
    expect(remainingLabel('37600')).toBe('剩余 37.6 km');
  });
});
