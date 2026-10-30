import { describe, expect, it } from 'vitest';
import { UNLINKED, change, changeLines, changeText, medicineMatrix, previousRange, sparkRuns, spanDays } from '../../src/lib/components/wellbeing-report-math.ts';

describe('ranges and comparison', () => {
  it('counts days inclusively and puts the previous stretch right before it, same length', () => {
    expect(spanDays('2026-10-01', '2026-10-07')).toBe(7);
    expect(previousRange('2026-10-08', '2026-10-14')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(previousRange('2026-10-01', '2026-10-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('compares only when both sides were recorded, never against 0', () => {
    expect(change(6.5, 5.7)).toBe(0.8);
    expect(change(null, 5)).toBeNull();
    expect(change(5, null)).toBeNull();
    expect([changeText(0.8), changeText(-1.2), changeText(0), changeText(null)]).toEqual(['↑ 0.8', '↓ 1.2', '持平', '']);
  });
});

describe('the small line', () => {
  it('breaks at a gap instead of drawing across it, and keeps a lone day as a dot only', () => {
    const { runs, dots } = sparkRuns([5, 6, null, 7, null, 2, 3], 10);
    expect(runs).toHaveLength(2);
    expect(dots).toHaveLength(5);
    expect(sparkRuns([null, 4, null], 10)).toEqual({ runs: [], dots: [[50, 16.2]] });
    expect(sparkRuns([null, null], 10).dots).toEqual([]);
  });
  it('puts a higher value higher up', () => {
    const { dots } = sparkRuns([2, 8], 10);
    expect(dots[1][1]).toBeLessThan(dots[0][1]);
  });
});

describe('medicine × side effect grid', () => {
  const doses = [{ id: 'd1', medication_name: '甲药' }, { id: 'd2', medication_name: '乙药' }];
  it('counts each side effect under the medicine of its dose, most frequent column first, unlinked ones last', () => {
    const events = [
      { dose_id: 'd1', symptom: '头晕' }, { dose_id: 'd1', symptom: '头晕' }, { dose_id: 'd1', symptom: '恶心' },
      { dose_id: 'd2', symptom: '头晕' }, { dose_id: null, symptom: '口干' }, { dose_id: 'gone', symptom: '口干' }
    ];
    const m = medicineMatrix(doses, events);
    expect(m.columns).toEqual(['头晕', '口干', '恶心']);
    expect(m.rows.map(r => r.name)).toEqual(['甲药', '乙药', UNLINKED]);
    expect(m.rows[0].cells).toEqual([2, 0, 1]);
    expect(m.rows[2].cells).toEqual([0, 2, 0]);
    expect(m.max).toBe(2);
  });
  it('is empty without side effects', () => {
    expect(medicineMatrix(doses, [])).toEqual({ columns: [], rows: [], max: 0 });
  });
});

describe('dose history lines', () => {
  const item = (date: string, pills: number, kind: 'first_in_range' | 'changed') => ({ date, taken_at: `${date}T08:00:00Z`, pills, dose_amount: null, dose_unit: null, kind });
  it('starts with the first dose, then says from-what-to-what each time the amount changed', () => {
    const lines = changeLines([item('2026-10-01', 1, 'first_in_range'), item('2026-10-05', 2, 'changed'), item('2026-10-09', 1, 'changed')], c => `${c.pills} 颗`);
    expect(lines).toEqual([{ date: '2026-10-01', from: null, to: '1 颗' }, { date: '2026-10-05', from: '1 颗', to: '2 颗' }, { date: '2026-10-09', from: '2 颗', to: '1 颗' }]);
    expect(changeLines([], c => String(c.pills))).toEqual([]);
  });
});
