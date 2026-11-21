import { describe, expect, test } from 'vitest';
import { parseCells, parseDetail } from '../../src/lib/api/exploration.ts';

const version = { source_version: 0, atlas_version: 'test', status: 'ready' };

describe('exploration response validation', () => {
  test('validates grid extent, counts and response cap', () => {
    const valid = { ...version, bounds: [10, 11, 12, 13], cells: [[1, -2, 3]], block_size: 4 };
    expect(parseCells(valid).cells).toEqual([[1, -2, 3]]);
    expect(() => parseCells({ ...valid, cells: [[1, -2, 0]] })).toThrow();
    expect(() => parseCells({ ...valid, cells: Array(5001).fill([1, -2, 3]) })).toThrow();
    expect(() => parseCells({ ...valid, bounds: [10, 11, -12, 13] })).toThrow();
  });
  test('requires all twelve chronological months, even while history is pending', () => {
    const pending = {
      ...version,
      status: 'pending',
      scope: 'global',
      code: 'all',
      year: 2026,
      name: '全域',
      city: null,
      first_year: null,
      new_cells: null,
      cumulative_cells: null,
      months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, new_cells: null, cumulative_cells: null })),
    };
    expect(parseDetail(pending).status).toBe('pending');
    expect(() => parseDetail({ ...pending, months: pending.months.slice(1) })).toThrow();
    expect(() => parseDetail({ ...pending, months: [...pending.months].reverse() })).toThrow();
  });
});
