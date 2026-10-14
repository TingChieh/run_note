import { describe, expect, it } from 'vitest';
import { dashboardDistance } from '../../src/lib/api/dashboard-format';
describe('dashboard distance presentation', () => {
  it('uses zero to one decimals without mutating API precision', () => {
    const input = '5123.456';
    expect(dashboardDistance(input)).toBe('5.1 km');
    expect(input).toBe('5123.456');
    expect(dashboardDistance(10000)).toBe('10 km');
    expect(dashboardDistance(0)).toBe('0 km');
    expect(dashboardDistance(null)).toBe('—');
  });
});
