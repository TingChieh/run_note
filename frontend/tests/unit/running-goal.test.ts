import { describe, it, expect } from 'vitest';
import { goalRange, validGoal, goalStorageKey } from '../../src/lib/api/running-goal';
describe('personal running goal', () => {
  it('uses account local dates, Monday weeks and exclusive calendar end dates', () => {
    const now = new Date('2026-12-31T18:00:00Z');
    expect(goalRange('week', 'Asia/Shanghai', now)).toEqual({ from:'2026-12-28', to:'2027-01-04' });
    expect(goalRange('month', 'Asia/Shanghai', now)).toEqual({ from:'2027-01-01', to:'2027-02-01' });
    expect(goalRange('year', 'America/Los_Angeles', now)).toEqual({ from:'2026-01-01', to:'2027-01-01' });
    expect(goalRange('month', 'UTC', new Date('2024-02-29T12:00:00Z'))).toEqual({ from:'2024-02-01', to:'2024-03-01' });
  });
  it('accepts positive kilometre goals and rejects invalid or excessive precision', () => {
    expect(validGoal('50.5')).toBe(50.5);
    for (const value of ['0','-1','NaN','Infinity','10.55','100001','1e3','']) expect(validGoal(value)).toBeNull();
  });
  it('keeps account and period preferences separate', () => {
    expect(goalStorageKey('a','week')).not.toBe(goalStorageKey('b','week'));
    expect(goalStorageKey('a','week')).not.toBe(goalStorageKey('a','month'));
  });
});
