import { describe, expect, it } from 'vitest';
import { gainWords, kmNumber, monthLabel, paceDelta, parseRecords, progressSpan, readRecords, recordDate, recordMonth, recordSentence, signedDistance } from '../../src/lib/api/records';
import { pageDescription } from '../../src/lib/seo';

const id = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const run = (n: number, date: string, pace: string) => ({ activity_id: id(n), activity_date: date, distance_m: '5000.000', duration_seconds: String(Number(pace) * 5), avg_pace_seconds_per_km: pace });
// 22 months, 2025-01 .. 2026-10.
const monthly = () => Array.from({ length: 22 }, (_, i) => ({
  month_start: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
  activity_count: i % 3, distance_m: String((i % 3) * 5000), avg_pace_seconds_per_km: i % 3 ? '330.000' : null
}));
const yearly = () => [
  { year: 2025, activity_count: 8, distance_m: '40000.000', activity_days: 8, avg_pace_seconds_per_km: '340.000', is_partial: false, delta: null, delta_basis: null },
  { year: 2026, activity_count: 6, distance_m: '30000.000', activity_days: 6, avg_pace_seconds_per_km: '330.000', is_partial: true,
    delta: { activity_count: -1, distance_m: '-1500.5', avg_pace_seconds_per_km: '-10.000' }, delta_basis: 'previous_year_same_period' }
];
function valid(): any {
  return {
    date_assignment: 'activity_local_date',
    personal_bests: [
      { category: '5km', best: { ...run(1, '2026-03-05', '330.000'), qualifying_count: 4 }, first: run(2, '2025-01-12', '372.000'), pace_gain_seconds_per_km: '42.000' },
      { category: '10km', best: null, first: null, pace_gain_seconds_per_km: null }
    ],
    totals: { activity_count: 14, distance_m: '70000.000', activity_days: 14, avg_pace_seconds_per_km: '335.000', first_activity_date: '2025-01-12' },
    monthly: monthly(),
    weekly: Array.from({ length: 26 }, (_, i) => ({ week_start: new Date(Date.UTC(2026, 3, 27 + i * 7)).toISOString().slice(0, 10), active_days: i % 4 })),
    weekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i, activity_count: i })),
    yearly: yearly()
  };
}
const empty = () => ({ ...valid(), personal_bests: [
  { category: '5km', best: null, first: null, pace_gain_seconds_per_km: null }, { category: '10km', best: null, first: null, pace_gain_seconds_per_km: null }
], totals: { activity_count: 0, distance_m: '0', activity_days: 0, avg_pace_seconds_per_km: null, first_activity_date: null }, monthly: [], yearly: [] });
const respond = (data: unknown) => async () => Response.json({ data, error: null });

describe('records contract', () => {
  it('accepts a complete response and keeps missing values null', () => {
    const parsed = parseRecords(valid());
    expect(parsed.personal_bests[0].first?.avg_pace_seconds_per_km).toBe('372.000');
    expect(parsed.personal_bests[0].pace_gain_seconds_per_km).toBe('42.000');
    expect(parsed.personal_bests[1].best).toBeNull();
    expect(parsed.monthly).toHaveLength(22);
    expect(parsed.monthly[0].avg_pace_seconds_per_km).toBeNull();
    expect(parsed.yearly[0].delta).toBeNull();
    expect(parsed.yearly[1].delta?.distance_m).toBe('-1500.5');
  });
  it('accepts an account without any activity', () => {
    const parsed = parseRecords(empty());
    expect(parsed.monthly).toEqual([]);
    expect(parsed.yearly).toEqual([]);
    expect(parsed.totals.first_activity_date).toBeNull();
  });
  it('accepts a single run being both best and first, and a single partial first year', () => {
    const v = valid();
    v.personal_bests[0].first = { ...run(1, '2026-03-05', '330.000') };
    v.personal_bests[0].pace_gain_seconds_per_km = null;
    v.monthly = monthly().slice(12);
    v.yearly = [{ ...yearly()[1], delta: null, delta_basis: null }];
    expect(() => parseRecords(v)).not.toThrow();
  });
  it('accepts a partial current year followed by a later year with data', () => {
    const v = valid();
    v.monthly.push({ month_start: '2026-11-01', activity_count: 1, distance_m: '5000', avg_pace_seconds_per_km: '330.000' });
    v.monthly.push({ month_start: '2026-12-01', activity_count: 0, distance_m: '0', avg_pace_seconds_per_km: null });
    v.monthly.push({ month_start: '2027-01-01', activity_count: 1, distance_m: '5000', avg_pace_seconds_per_km: '330.000' });
    v.yearly.push({ year: 2027, activity_count: 1, distance_m: '5000.000', activity_days: 1, avg_pace_seconds_per_km: '330.000', is_partial: false,
      delta: { activity_count: -5, distance_m: '-25000.000', avg_pace_seconds_per_km: null }, delta_basis: 'previous_year' });
    const parsed = parseRecords(v);
    expect(parsed.yearly.map(row => row.is_partial)).toEqual([false, true, false]);
  });
  it('rejects malformed shapes before they reach the page', () => {
    const cases: [string, (v: any) => void][] = [
      ['month gap', v => { v.monthly.splice(5, 1); }],
      ['month repeated', v => { v.monthly[3] = { ...v.monthly[2] }; }],
      ['month order reversed', v => { v.monthly.reverse(); }],
      ['month not on the 1st', v => { v.monthly[0].month_start = '2025-01-02'; }],
      ['month invalid date', v => { v.monthly[0].month_start = '2025-13-01'; }],
      ['legacy month number', v => { v.monthly[0] = { month: 1, activity_count: 0, distance_m: '0', avg_pace_seconds_per_km: null }; }],
      ['negative distance', v => { v.monthly[0].distance_m = '-1'; }],
      ['negative month count', v => { v.monthly[0].activity_count = -1; }],
      ['year gap', v => { v.yearly[1].year = 2027; }],
      ['year descending', v => { v.yearly.reverse(); }],
      ['two partial rows', v => { v.yearly[0].is_partial = true; v.yearly[0].delta_basis = null; }],
      ['partial flag not boolean', v => { v.yearly[1].is_partial = 'yes'; }],
      ['first year has delta', v => { v.yearly[0].delta = { activity_count: 1, distance_m: '1', avg_pace_seconds_per_km: null }; v.yearly[0].delta_basis = 'previous_year'; }],
      ['later year without delta', v => { v.yearly[1].delta = null; }],
      ['delta without basis', v => { v.yearly[1].delta_basis = null; }],
      ['partial year with full-year basis', v => { v.yearly[1].delta_basis = 'previous_year'; }],
      ['delta distance not numeric', v => { v.yearly[1].delta.distance_m = 'abc'; }],
      ['delta count not integer', v => { v.yearly[1].delta.activity_count = 1.5; }],
      ['yearly empty but monthly not', v => { v.yearly = []; }],
      ['monthly empty but yearly not', v => { v.monthly = []; }],
      ['yearly starts in another year than monthly', v => { v.yearly.shift(); v.yearly[0].delta = null; v.yearly[0].delta_basis = null; }],
      ['first missing a field', v => { delete v.personal_bests[0].first.duration_seconds; }],
      ['first key missing', v => { delete v.personal_bests[0].first; }],
      ['first bad uuid', v => { v.personal_bests[0].first.activity_id = 'nope'; }],
      ['first bad date', v => { v.personal_bests[0].first.activity_date = '2025-02-30'; }],
      ['pace gain not numeric', v => { v.personal_bests[0].pace_gain_seconds_per_km = 'fast'; }],
      ['pace gain negative', v => { v.personal_bests[0].pace_gain_seconds_per_km = '-3'; }],
      ['pace gain zero', v => { v.personal_bests[0].pace_gain_seconds_per_km = '0'; }],
      ['pace gain key missing', v => { delete v.personal_bests[0].pace_gain_seconds_per_km; }],
      ['pace gain without a first run', v => { v.personal_bests[0].first = null; }],
      ['pace gain for the same activity', v => { v.personal_bests[0].first.activity_id = v.personal_bests[0].best.activity_id; }],
      ['best bad uuid', v => { v.personal_bests[0].best.activity_id = 'nope'; }],
      ['best qualifying_count 0', v => { v.personal_bests[0].best.qualifying_count = 0; }],
      ['categories swapped', v => { v.personal_bests.reverse(); }],
      ['only one category', v => { v.personal_bests.pop(); }],
      ['totals missing', v => { delete v.totals; }],
      ['totals negative distance', v => { v.totals.distance_m = '-5'; }],
      ['totals bad first date', v => { v.totals.first_activity_date = '2025-1-1'; }],
      ['weekly length', v => { v.weekly.pop(); }],
      ['weekly not ascending', v => { v.weekly[1].week_start = v.weekly[0].week_start; }],
      ['weekly days over 7', v => { v.weekly[0].active_days = 8; }],
      ['weekday length', v => { v.weekday.pop(); }],
      ['weekday order', v => { v.weekday[2].weekday = 5; }],
      ['wrong date assignment', v => { v.date_assignment = 'utc'; }],
      ['empty object', v => { Object.keys(v).forEach(key => delete v[key]); }]
    ];
    for (const [name, mutate] of cases) {
      const v = valid(); mutate(v);
      expect(() => parseRecords(v), name).toThrow('无效响应');
    }
    expect(() => parseRecords(null)).toThrow('无效响应');
    expect(() => parseRecords([])).toThrow('无效响应');
  });
  it('requests the showcase path without any query string', async () => {
    const seen: string[] = [];
    await readRecords(async (url, init) => { seen.push(String(url)); expect(init?.cache).toBe('no-store'); return Response.json({ data: valid(), error: null }); });
    expect(seen).toEqual(['/api/v1/showcase/statistics/records']);
  });
  it('maps an expired session to 401 and rejects an unrelated payload', async () => {
    await expect(readRecords(async () => new Response('x', { status: 401 }))).rejects.toMatchObject({ status: 401 });
    await expect(readRecords(respond({ nope: true }))).rejects.toThrow('无效响应');
  });
  it('formats signed distance and pace differences', () => {
    expect(signedDistance('42500')).toBe('+42.5 km');
    expect(signedDistance('-1500.5')).toBe('−1.5 km');
    expect(signedDistance(0)).toBe('0 km');
    expect(signedDistance(null)).toBe('—');
    expect(paceDelta('-42.456')).toBe('快 0:42 /km');
    expect(paceDelta('12')).toBe('慢 0:12 /km');
    expect(paceDelta(0)).toBe('持平');
    expect(paceDelta(null)).toBe('—');
  });
  it('formats month labels', () => {
    expect(monthLabel('2026-03-01')).toBe('2026-03');
    expect(monthLabel('2025-12-01')).toBe('2025-12');
  });
  it('words the banner in plain language without shifting dates', () => {
    expect(recordDate('2026-03-05', 2026)).toBe('3 月 5 日');
    expect(recordDate('2025-12-31', 2026)).toBe('2025 年 12 月 31 日');
    expect(recordDate('2026-01-01')).toBe('1 月 1 日');
    expect(recordSentence(run(1, '2026-03-05', '330.000'), 2026)).toBe('3 月 5 日，5.0 km，用了 27:30');
    expect(recordSentence({ ...run(1, '2024-09-20', '345.000'), distance_m: '10050.000', duration_seconds: '3467.000' }, 2026)).toBe('2024 年 9 月 20 日，10.1 km，用了 57:47');
    expect(gainWords('42.000')).toBe('42 秒');
    expect(gainWords(60)).toBe('1 分');
    expect(gainWords('65.4')).toBe('1 分 5 秒');
    expect(gainWords(0)).toBe('');
    expect(gainWords('-3')).toBe('');
    expect(gainWords(null)).toBe('');
  });
  it('formats the overview figure and start month', () => {
    expect(kmNumber('451000.000')).toBe('451');
    expect(kmNumber('1234567')).toBe('1,234.6');
    expect(kmNumber(0)).toBe('0');
    expect(kmNumber(null)).toBe('—');
    expect(recordMonth('2025-01-12')).toBe('2025 年 1 月');
    expect(recordMonth('2024-11-30')).toBe('2024 年 11 月');
  });
  it('maps the gain to a progress line between 20 % and 100 %', () => {
    expect(progressSpan('372.000', '42.000')).toBeCloseTo(0.2 + (42 / 372) / 0.25 * 0.8);
    expect(progressSpan(400, 100)).toBe(1);
    expect(progressSpan(400, 300)).toBe(1);
    expect(progressSpan(400, 1)).toBeGreaterThanOrEqual(0.2);
    expect(progressSpan(null, 42)).toBe(0.2);
    expect(progressSpan(372, null)).toBe(0.2);
    expect(progressSpan(0, 42)).toBe(0.2);
  });
  it('describes the records page for search engines', () => {
    expect(pageDescription('/records', 200, 'fallback')).toContain('最佳成绩');
    expect(pageDescription('/p/alice/records', 200, 'fallback')).toContain('最佳成绩');
  });
});
