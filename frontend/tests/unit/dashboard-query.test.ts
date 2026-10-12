import { describe, expect, it } from 'vitest';
import { dashboardQuery, dashboardSelection } from '../../src/lib/api/dashboard-query';
describe('dashboard selection survives identity rechecks without storing private data', () => {
  it('restores valid choices, including leap dates, with default year when absent', () => {
    expect(dashboardSelection(new URLSearchParams(), 2026)).toEqual({year:2026,metric:'distance',period:'month',day:null});
    expect(dashboardSelection(new URLSearchParams('year=2024&metric=count&period=week&day=2024-02-29'), 2026)).toEqual({year:2024,metric:'count',period:'week',day:'2024-02-29'});
  });
  it('ignores out of range years, impossible dates and dates from another year', () => {
    expect(dashboardSelection(new URLSearchParams('year=2101&metric=evil&period=year&day=2024-02-30'), 2026)).toEqual({year:2026,metric:'distance',period:'month',day:null});
    expect(dashboardSelection(new URLSearchParams('year=2024&day=2023-12-31'), 2026).day).toBeNull();
    expect(dashboardSelection(new URLSearchParams('year=1900&day=1900-02-29'), 2026).day).toBeNull();
    expect(dashboardSelection(new URLSearchParams('year=2100&day=2100-12-31'), 2026).day).toBe('2100-12-31');
  });
  it('replaces preferences, drops cleared day, preserves unrelated URL parameters', () => {
    const query = dashboardQuery(new URLSearchParams('unrelated=keep&year=2024&day=2024-02-29'), {year:2025,metric:'count',period:'week',day:null});
    expect(query.get('unrelated')).toBe('keep'); expect(query.get('year')).toBe('2025'); expect(query.get('metric')).toBe('count'); expect(query.get('period')).toBe('week'); expect(query.has('day')).toBe(false);
  });
});
