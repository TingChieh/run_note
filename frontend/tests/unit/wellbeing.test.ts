import { describe, expect, it } from 'vitest';
import {
  batchDoses, countMedication, restockMedication, addDays, answeredCount, hoursText, createDose, dateLabel, deleteEntry, downloadCsv, draftChanged, draftEmpty, draftOf, durationLabel, emptyDraft, gapLabel, instantFromLocal, localInput, monthBounds,
  normalizeDraft, parseDay, parseDose, parseEntry, parseMedication, parseSymptomName, doseText, pillsText, stockText, supplyText, parseTrends, precedingDose, readDay, readTrends, saveEntry, shiftMonth, todayIn, type Dose
} from '../../src/lib/api/wellbeing';
import { ActivityError } from '../../src/lib/api/activities';
import { isProtected } from '../../src/lib/api/auth';
import { contextPath, viewContext } from '../../src/lib/api/view-context';
import { pageNoindex, robotsTxt } from '../../src/lib/seo';

const ID = '11111111-1111-4111-8111-111111111111';
const entry = (over: Record<string, unknown> = {}) => ({ entry_date: '2026-10-10', mood: 3, anxiety: null, energy: 0, focus: null, functioning: null, sleep_hours: 7.5, sleep_quality: null, note: null, updated_at: '2026-10-10T01:00:00.123456Z', ...over });
const dose = (over: Record<string, unknown> = {}) => ({ id: ID, entry_date: '2026-10-10', medication_name: '示例药物', medication_id: null, pills: null, dose_amount: 12.5, dose_unit: 'mg', taken_at: '2026-10-10T00:00:00Z', regimen: 'scheduled', note: null, ...over });
const day = (over: Record<string, unknown> = {}) => ({ date: '2026-10-10', today: '2026-10-29', timezone: 'Asia/Shanghai', entry: entry(), doses: [dose()], symptoms: [], ...over });
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data, error: null, meta: { request_id: 'x' } }), { status, headers: { 'Content-Type': 'application/json' } });

describe('response validation', () => {
  it('accepts a real zero and keeps unanswered as null', () => {
    const parsed = parseEntry(entry());
    expect(parsed.energy).toBe(0);
    expect(parsed.anxiety).toBeNull();
  });
  it('rejects out of range, wrongly typed and malformed values', () => {
    for (const bad of [entry({ mood: 11 }), entry({ mood: 2.5 }), entry({ mood: '3' }), entry({ sleep_hours: 25 }), entry({ note: 'x'.repeat(2001) }), entry({ entry_date: '2026-02-30' }), entry({ updated_at: 'yesterday' }), null, []])
      expect(() => parseEntry(bad)).toThrow(ActivityError);
  });
  it('requires every record of a day to belong to that day', () => {
    expect(parseDay(day()).doses).toHaveLength(1);
    expect(() => parseDay(day({ doses: [dose({ entry_date: '2026-10-11' })] }))).toThrow(ActivityError);
    expect(() => parseDay(day({ entry: entry({ entry_date: '2026-10-11' }) }))).toThrow(ActivityError);
    expect(() => parseDay(day({ doses: [dose({ id: 'nope' })] }))).toThrow(ActivityError);
    expect(() => parseDay(day({ doses: [dose({ dose_amount: 0 })] }))).toThrow(ActivityError);
  });
  it('checks the trend series is one gap-free run of days of the requested length', () => {
    const series = (n: number) => Array.from({ length: n }, (_, i) => ({ date: addDays('2026-10-01', i), mood: i === 2 ? null : 4, anxiety: null, energy: null, focus: null, functioning: null, sleep_hours: null, sleep_quality: null, dose_count: 0, symptom_count: 0, symptom_max_severity: null }));
    const trends = (n: number, over: Record<string, unknown> = {}) => ({ days: n, start: '2026-10-01', end: addDays('2026-10-01', n - 1), timezone: 'Asia/Shanghai', recorded_days: 6, series: series(n), symptoms: [], ...over });
    expect(parseTrends(trends(7), 7).series[2].mood).toBeNull();
    expect(() => parseTrends(trends(7), 30)).toThrow(ActivityError);
    expect(() => parseTrends(trends(7, { series: series(6) }), 7)).toThrow(ActivityError);
    const skipped = series(7); skipped[3].date = '2026-10-09';
    expect(() => parseTrends(trends(7, { series: skipped }), 7)).toThrow(ActivityError);
  });
});

describe('medicine list, stock and pill doses', () => {
  const stock = (over: Record<string, unknown> = {}) => ({ pills: 61, boxes: 2, loose_pills: 5, avg_daily_pills: 1.5, days_left: 40.7, ...over });
  const med = (over: Record<string, unknown> = {}) => ({ id: ID, name: '示例药物', count_unit: '颗', pills_per_box: 28, strength_amount: 12.5, strength_unit: 'mg', default_pills: 1, regimen: 'scheduled', side_effects: ['恶心', '出汗'], dose_count: 2, last_taken_at: '2026-10-10T00:00:00Z', stock: stock(), ...over });
  it('accepts a full medicine, a bare one, and one with no stock yet', () => {
    expect(parseMedication(med()).stock?.pills).toBe(61);
    expect(parseMedication(med()).side_effects).toEqual(['恶心', '出汗']);
    expect(parseMedication(med({ side_effects: [] })).side_effects).toEqual([]);
    const bare = parseMedication(med({ pills_per_box: null, strength_amount: null, strength_unit: null, default_pills: null, last_taken_at: null, dose_count: 0, stock: null }));
    expect(bare.stock).toBeNull();
    expect(parseMedication(med({ stock: stock({ pills: -3, boxes: null, loose_pills: null, avg_daily_pills: null, days_left: null }) })).stock?.pills).toBe(-3);
  });
  it('rejects bad box sizes, strengths, pill counts, stock and ids', () => {
    for (const bad of [med({ pills_per_box: 0 }), med({ pills_per_box: 2.5 }), med({ strength_unit: null }), med({ strength_amount: 0 }), med({ default_pills: 0 }), med({ default_pills: 1001 }), med({ count_unit: '' }), med({ id: 'nope' }), med({ name: '' }),
      med({ regimen: 'daily' }), med({ dose_count: -1 }), med({ last_taken_at: 'soon' }), med({ stock: { pills: 'x' } }), med({ stock: stock({ days_left: -1 }) }), med({ stock: undefined }),
      med({ side_effects: undefined }), med({ side_effects: '恶心' }), med({ side_effects: [''] }), med({ side_effects: [3] }), med({ side_effects: ['x'.repeat(41)] }), med({ side_effects: Array.from({ length: 21 }, (_, i) => `s${i}`) })])
      expect(() => parseMedication(bad)).toThrow(ActivityError);
  });
  it('accepts a dose given as pills, as an amount, or both, and rejects one with neither', () => {
    expect(parseDose(dose({ pills: 1.5, dose_amount: 18.75 })).pills).toBe(1.5);
    expect(parseDose(dose({ pills: 2, dose_amount: null, dose_unit: null })).dose_amount).toBeNull();
    expect(parseDose(dose()).pills).toBeNull();
    for (const bad of [dose({ pills: null, dose_amount: null, dose_unit: null }), dose({ pills: 0 }), dose({ pills: 1001 }), dose({ dose_unit: null }), dose({ dose_amount: null }), dose({ medication_id: 'nope' }), dose({ pills: '1' })])
      expect(() => parseDose(bad)).toThrow(ActivityError);
  });
  it('reads doses and stock in words', () => {
    expect(doseText({ pills: 1.5, dose_amount: 18.75, dose_unit: 'mg' })).toBe('1.5 颗（18.75 mg）');
    expect(doseText({ pills: 2, dose_amount: null, dose_unit: null }, '片')).toBe('2 片');
    expect(doseText({ pills: null, dose_amount: 10, dose_unit: 'mg' })).toBe('10 mg');
    expect(pillsText(0.5)).toBe('0.5 颗');
    expect(stockText({ count_unit: '颗', stock: null })).toBe('还没有记录库存');
    expect(stockText({ count_unit: '颗', stock: stock() })).toBe('2 盒 5 颗（共 61 颗）');
    expect(stockText({ count_unit: '片', stock: stock({ pills: 12, boxes: null, loose_pills: null }) })).toBe('12 片');
    expect(stockText({ count_unit: '颗', stock: stock({ pills: 0, boxes: 0, loose_pills: 0 }) })).toBe('已用完（0 颗）');
    expect(stockText({ count_unit: '颗', stock: stock({ pills: -3, boxes: null, loose_pills: null }) })).toContain('请盘点');
    expect(supplyText({ count_unit: '颗', stock: stock() })).toBe('按近 14 天平均每天 1.5 颗，约可吃 40.7 天');
    expect(supplyText({ count_unit: '颗', stock: stock({ avg_daily_pills: null, days_left: null }) })).toBe('');
    expect(supplyText({ count_unit: '颗', stock: stock({ pills: 0, days_left: 0 }) })).toBe('');
    expect(supplyText({ count_unit: '颗', stock: null })).toBe('');
  });
  it('validates side-effect names', () => {
    expect(parseSymptomName({ id: ID, name: '口干', event_count: 0 }).name).toBe('口干');
    for (const bad of [{ id: ID, name: '', event_count: 0 }, { id: ID, name: 'x'.repeat(41), event_count: 0 }, { id: 'nope', name: 'a', event_count: 0 }, { id: ID, name: 'a', event_count: -1 }])
      expect(() => parseSymptomName(bad)).toThrow(ActivityError);
  });
});

describe('requests', () => {
  it('sends writes with the CSRF token and the optimistic base version', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url === '/api/v1/auth/csrf' ? ok({ csrf_token: 'token-1' }) : ok(entry());
    }) as unknown as typeof fetch;
    await saveEntry('2026-10-10', normalizeDraft({ ...emptyDraft(), mood: 3, note: '  ' }), '2026-10-10T01:00:00Z', fetcher);
    const put = calls.find(call => call.url.endsWith('/entry'))!;
    expect(put.init?.method).toBe('PUT');
    expect((put.init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('token-1');
    expect(JSON.parse(put.init!.body as string)).toMatchObject({ mood: 3, note: null, anxiety: null, based_on: '2026-10-10T01:00:00Z' });
  });
  it('refuses bad ids and dates before any request', async () => {
    let called = false;
    const fetcher = (async () => { called = true; return ok({}); }) as unknown as typeof fetch;
    await expect(readDay('2026-13-01', fetcher)).rejects.toThrow(ActivityError);
    await expect(deleteEntry('nope', fetcher)).rejects.toThrow(ActivityError);
    await expect(readTrends(90 as 7, fetcher)).rejects.toThrow(); // only 7, 14 or 30 days
    expect(called).toBe(false);
  });
  it('maps 401 to a login-expired error and surfaces the conflict code', async () => {
    const unauthorized = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(readDay('2026-10-10', unauthorized)).rejects.toMatchObject({ status: 401 });
    const conflict = (async (url: string) => url === '/api/v1/auth/csrf' ? ok({ csrf_token: 't' }) : new Response(JSON.stringify({ data: null, error: { code: 'ENTRY_CHANGED', message: '已更新' }, meta: { request_id: 'x' } }), { status: 409 })) as unknown as typeof fetch;
    await expect(saveEntry('2026-10-10', { ...emptyDraft(), mood: 1 }, null, conflict)).rejects.toMatchObject({ status: 409, code: 'ENTRY_CHANGED' });
  });
  it('sends a pill dose with the medicine id, and stock requests with boxes and loose pills', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/csrf') return ok({ csrf_token: 't' });
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      if (url.endsWith('/doses/batch')) return ok({ created: 14, skipped_existing: 0, skipped_future: 0 }, 201);
      if (url.includes('/stock')) return ok({ id: ID, name: 'a', count_unit: '颗', pills_per_box: 28, strength_amount: null, strength_unit: null, default_pills: null, regimen: 'scheduled', side_effects: [], dose_count: 0, last_taken_at: null, stock: { pills: 61, boxes: 2, loose_pills: 5, avg_daily_pills: null, days_left: null } });
      return ok(dose({ pills: 1, medication_id: ID }), 201);
    }) as unknown as typeof fetch;
    await createDose({ medication_name: '示例药物', medication_id: ID, pills: 1, taken_at: '2026-10-10T00:00:00Z', regimen: 'scheduled', note: null }, fetcher);
    await countMedication(ID, 2, 5, fetcher);
    await restockMedication(ID, 1, 0, fetcher);
    const result = await batchDoses({ medication_id: ID, pills: null, start_date: '2026-10-01', end_date: '2026-10-07', times: ['08:00', '20:00'], note: null }, fetcher);
    expect(calls.map(c => c.url.replace('/api/v1/me/wellbeing', ''))).toEqual(['/doses', `/medications/${ID}/stock/count`, `/medications/${ID}/stock`, '/doses/batch']);
    expect(calls[0].body).toMatchObject({ medication_id: ID, pills: 1 });
    expect(calls[1].body).toEqual({ boxes: 2, pills: 5 });
    expect(result.created).toBe(14);
    await expect(countMedication('nope', 1, 0, fetcher)).rejects.toThrow(ActivityError);
    await expect(batchDoses({ medication_id: ID, pills: 1, start_date: '2026-13-01', end_date: '2026-10-07', times: ['08:00'], note: null }, fetcher)).rejects.toThrow(ActivityError);
  });
  it('does not create a dose from an invalid server answer', async () => {
    const fetcher = (async (url: string) => url === '/api/v1/auth/csrf' ? ok({ csrf_token: 't' }) : ok(dose({ dose_amount: -1 }))) as unknown as typeof fetch;
    await expect(createDose({ medication_name: 'x', dose_amount: 1, dose_unit: 'mg', taken_at: '2026-10-10T00:00:00Z', regimen: 'scheduled', note: null }, fetcher)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('only accepts a CSV body for the export', async () => {
    const csv = (async () => new Response('a,b', { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })) as unknown as typeof fetch;
    expect(await (await downloadCsv('entries', '2026-10-01', '2026-10-31', csv)).text()).toBe('a,b');
    const html = (async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch;
    await expect(downloadCsv('doses', '2026-10-01', '2026-10-31', html)).rejects.toThrow(ActivityError);
  });
});

describe('drafts', () => {
  it('counts answers and treats a blank note as unanswered', () => {
    expect(answeredCount(null)).toEqual({ answered: 0, total: 8 });
    expect(answeredCount({ ...emptyDraft(), mood: 0, note: 'x' })).toEqual({ answered: 2, total: 8 });
    expect(draftEmpty({ ...emptyDraft(), note: '   ' })).toBe(true);
    expect(draftEmpty({ ...emptyDraft(), energy: 0 })).toBe(false);
  });
  it('detects edits but ignores whitespace-only note changes', () => {
    const base = draftOf(parseEntry(entry()));
    expect(draftChanged(base, { ...base })).toBe(false);
    expect(draftChanged(base, { ...base, note: '   ' })).toBe(false);
    expect(draftChanged(base, { ...base, mood: 4 })).toBe(true);
    expect(draftChanged(base, { ...base, anxiety: 0 })).toBe(true);
  });
});

describe('time helpers', () => {
  it('turns wall-clock input into the right instant for the account timezone', () => {
    expect(instantFromLocal('2026-10-11T00:30', 'Asia/Shanghai')).toBe('2026-10-10T16:30:00.000Z');
    expect(instantFromLocal('2026-10-10T12:30', 'America/New_York')).toBe('2026-10-10T16:30:00.000Z');
    expect(localInput('2026-10-10T16:30:00Z', 'Asia/Shanghai')).toBe('2026-10-11T00:30');
    expect(localInput('2026-10-10T16:30:00Z', 'America/New_York')).toBe('2026-10-10T12:30');
  });
  it('round-trips across a daylight-saving change', () => {
    for (const local of ['2026-03-08T01:30', '2026-03-08T03:30', '2026-11-01T00:30', '2026-11-01T03:00']) expect(localInput(instantFromLocal(local, 'America/New_York'), 'America/New_York')).toBe(local);
  });
  it('knows today in the account timezone across midnight', () => {
    const instant = new Date('2026-10-10T16:30:00Z');
    expect(todayIn('Asia/Shanghai', instant)).toBe('2026-10-11');
    expect(todayIn('America/New_York', instant)).toBe('2026-10-10');
  });
  it('formats dates, months and durations', () => {
    expect(dateLabel('2026-10-29')).toBe('2026年10月29日 周四');
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28', first: 6, days: 28 });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(durationLabel(null)).toBe('');
    expect(durationLabel(90)).toBe('1 小时 30 分钟');
    expect(gapLabel(45)).toBe('45 分钟前');
    expect(gapLabel(120)).toBe('2 小时前');
  });
});

describe('dose and symptom order', () => {
  const doses = [dose({ id: ID, taken_at: '2026-10-10T00:00:00Z', medication_name: '甲' }), dose({ id: '22222222-2222-4222-8222-222222222222', taken_at: '2026-10-10T04:00:00Z', medication_name: '乙' })] as Dose[];
  it('names the nearest earlier dose and nothing causal', () => {
    expect(precedingDose('2026-10-10T05:30:00Z', doses)).toEqual({ medication_name: '乙', minutes_before: 90 });
    expect(precedingDose('2026-10-09T23:00:00Z', doses)).toBeNull();
    expect(precedingDose('2026-10-12T00:00:00Z', doses)).toBeNull();
    expect(precedingDose(null, doses)).toBeNull();
  });
});

describe('privacy surfaces', () => {
  it('keeps the diary behind login, out of search and out of the public context', () => {
    expect(isProtected('/wellbeing')).toBe(true);
    expect(isProtected('/workspace/wellbeing')).toBe(true);
    expect(pageNoindex('/wellbeing', 200)).toBe(true);
    expect(pageNoindex('/workspace/wellbeing', 200)).toBe(true);
    expect(robotsTxt('https://example.com')).toContain('Disallow: /wellbeing');
    expect(contextPath(viewContext('/workspace/wellbeing'), '/wellbeing')).toBe('/workspace/wellbeing');
    expect(contextPath(viewContext('/wellbeing', true), '/wellbeing')).toBe('/wellbeing');
    expect(viewContext('/p/someone/wellbeing').manage).toBe(false);
  });
});

describe('sleep duration text', () => {
  it('reads decimal hours as hours and minutes, exactly for whole minutes', () => {
    expect(hoursText(7.5)).toBe('7 小时 30 分');
    expect(hoursText(8)).toBe('8 小时');
    expect(hoursText(0.75)).toBe('45 分');
    expect(hoursText(0)).toBe('0 分');
    expect(hoursText(7.42)).toBe('7 小时 25 分');
    for (let minutes = 0; minutes <= 1440; minutes++) {
      const stored = Math.round(minutes / 60 * 100) / 100;
      expect(Math.round(stored * 60)).toBe(minutes);
    }
  });
});
