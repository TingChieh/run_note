import { ActivityError, request } from './activities';

/** Private health diary. Everything here is the owner's own data: nothing is cached, stored locally or sent to a third party. */
export const RATING_KEYS = ['mood', 'anxiety', 'energy', 'focus', 'functioning', 'sleep_quality'] as const;
export type RatingKey = typeof RATING_KEYS[number];
export type Regimen = 'scheduled' | 'as_needed';
export type CsvKind = 'entries' | 'doses' | 'symptoms';
export type TrendDays = 7 | 14 | 30;

export interface Entry { entry_date: string; mood: number | null; anxiety: number | null; energy: number | null; focus: number | null; functioning: number | null; sleep_hours: number | null; sleep_quality: number | null; note: string | null; updated_at: string }
/** One intake: a pill count (the usual way), and/or an amount with a unit (derived from the strength of one pill, or typed). */
export interface Dose { id: string; entry_date: string; medication_name: string; medication_id: string | null; pills: number | null; dose_amount: number | null; dose_unit: string | null; taken_at: string; regimen: Regimen; note: string | null }
export interface Symptom { id: string; entry_date: string; dose_id: string | null; symptom: string; severity: number | null; onset_at: string | null; duration_minutes: number | null; affects_daily_life: boolean | null }
export interface DayData { date: string; today: string; timezone: string; entry: Entry | null; doses: Dose[]; symptoms: Symptom[] }
export interface DayMark { date: string; has_entry: boolean; dose_count: number; symptom_count: number }
export interface EntryList { items: Entry[]; total: number; limit: number; offset: number }
/** A medicine on the user's own list, with its usual dose. History keeps its own copy of the name. */
/** Pills on hand = restocks and counts minus the pills of the doses logged against the medicine; `null` until a first count or restock. */
export interface Stock { pills: number; boxes: number | null; loose_pills: number | null; avg_daily_pills: number | null; days_left: number | null }
export interface Medication { id: string; name: string; count_unit: string; pills_per_box: number | null; strength_amount: number | null; strength_unit: string | null; default_pills: number | null; regimen: Regimen; side_effects: string[]; dose_count: number; last_taken_at: string | null; stock: Stock | null }
export interface MedicationDraft { name: string; count_unit: string; pills_per_box: number | null; strength_amount: number | null; strength_unit: string | null; default_pills: number | null; regimen: Regimen; side_effects: string[] }
export interface BatchResult { created: number; skipped_existing: number; skipped_future: number }
/** A side effect on the user's own list of one-tap choices. */
export interface SymptomName { id: string; name: string; event_count: number }
export interface TrendDay { date: string; mood: number | null; anxiety: number | null; energy: number | null; focus: number | null; functioning: number | null; sleep_hours: number | null; sleep_quality: number | null; dose_count: number; symptom_count: number; symptom_max_severity: number | null }
export interface SymptomStat { symptom: string; count: number; days: number; avg_severity: number | null; max_severity: number | null; affects_daily_life_count: number }
export interface Trends { days: TrendDays; start: string; end: string; timezone: string; recorded_days: number; series: TrendDay[]; symptoms: SymptomStat[] }
export interface RatingStat { key: RatingKey; answered_days: number; mean: number | null; min: number | null; max: number | null; first: number | null; last: number | null }
export interface DoseChange { date: string; taken_at: string; pills: number | null; dose_amount: number | null; dose_unit: string | null; kind: 'first_in_range' | 'changed' }
export interface MedicationStat { name: string; dose_count: number; scheduled_count: number; as_needed_count: number; total_pills: number; first_taken_at: string; last_taken_at: string; timeline: DoseChange[] }
export interface PrecedingDose { medication_name: string; minutes_before: number }
export interface SymptomEvent extends Symptom { preceding_dose: PrecedingDose | null }
export interface Report {
  start: string; end: string; timezone: string; generated_on: string;
  series: TrendDay[];
  coverage: { days_in_range: number; days_with_entry: number; days_without_entry: number; missing_dates: string[]; unanswered: Record<string, number> };
  ratings: RatingStat[];
  weekly: { week_start: string; entries: number; mood_mean: number | null; anxiety_mean: number | null }[];
  sleep: { answered_days: number; mean_hours: number | null; min_hours: number | null; max_hours: number | null; quality_answered_days: number; mean_quality: number | null };
  medications: MedicationStat[]; doses: Dose[]; symptoms: SymptomStat[]; symptom_events: SymptomEvent[];
  notes: { date: string; note: string }[];
}
/** The answers of one day's form. `null` means unanswered and is saved as NULL, never 0. */
export type EntryDraft = Pick<Entry, RatingKey | 'sleep_hours' | 'note'>;
export interface DoseDraft { medication_name: string; medication_id?: string | null; pills?: number | null; dose_amount?: number | null; dose_unit?: string | null; taken_at: string; regimen: Regimen; note: string | null }
export interface SymptomDraft { entry_date: string; dose_id?: string | null; symptom: string; severity?: number | null; onset_at: string | null; duration_minutes: number | null; affects_daily_life: boolean | null }

export const RATING_LABELS: Record<RatingKey, { name: string; direction: 'worse' | 'better'; hint: string; low: string; high: string }> = {
  mood: { name: '开心程度', direction: 'better', hint: '越高越开心', low: '很不开心', high: '非常开心' },
  anxiety: { name: '焦虑', direction: 'worse', hint: '越高越严重', low: '没有焦虑', high: '极度焦虑' },
  energy: { name: '精力', direction: 'better', hint: '越高越好', low: '几乎没有', high: '精力充沛' },
  focus: { name: '注意力', direction: 'better', hint: '越高越好', low: '难以集中', high: '很容易集中' },
  functioning: { name: '日常功能', direction: 'better', hint: '越高越好', low: '几乎无法应对日常事务', high: '日常事务都能应对' },
  sleep_quality: { name: '睡眠质量', direction: 'better', hint: '越高越好', low: '很差', high: '很好' }
};
export const COMMON_SYMPTOMS = ['困倦、嗜睡', '头晕', '恶心', '头痛', '心悸', '出汗', '失眠', '食欲变化', '坐立不安'];
export const COMMON_UNITS = ['mg', 'μg', 'g', 'ml'];
/** What one "piece" of a medicine is called. */
export const COUNT_UNITS = ['颗', '片', '粒', '袋', '支', '滴'];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const time = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === v;
};
const instant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const rating = (v: unknown, nullable = true) => v === null ? nullable : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10;
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown, nullable = false) => v === null ? nullable : typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number, nullable = false) => v === null ? nullable : typeof v === 'string' && [...v].length <= max;
function invalid(): never { throw new ActivityError('健康日记服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE'); }

export function parseEntry(v: unknown): Entry {
  if (!object(v) || !isoDate(v.entry_date) || !RATING_KEYS.every(k => rating(v[k])) || !finite(v.sleep_hours, true) || (v.sleep_hours !== null && (Number(v.sleep_hours) < 0 || Number(v.sleep_hours) > 24))
    || !text(v.note, 2000, true) || !instant(v.updated_at)) invalid();
  return v as unknown as Entry;
}
export function parseDose(v: unknown): Dose {
  if (!object(v) || typeof v.id !== 'string' || !uuid.test(v.id) || !isoDate(v.entry_date) || !text(v.medication_name, 80) || !(v.medication_name as string).length
    || !(v.medication_id === null || (typeof v.medication_id === 'string' && uuid.test(v.medication_id)))
    || !(v.pills === null || (finite(v.pills) && Number(v.pills) > 0 && Number(v.pills) <= 1000))
    || !(v.dose_amount === null || (finite(v.dose_amount) && Number(v.dose_amount) > 0)) || !(v.dose_unit === null || (text(v.dose_unit, 16) && (v.dose_unit as string).length > 0))
    || (v.dose_amount === null) !== (v.dose_unit === null) || (v.pills === null && v.dose_amount === null)
    || !instant(v.taken_at) || (v.regimen !== 'scheduled' && v.regimen !== 'as_needed') || !text(v.note, 500, true)) invalid();
  return v as unknown as Dose;
}
export function parseSymptom(v: unknown): Symptom {
  if (!object(v) || typeof v.id !== 'string' || !uuid.test(v.id) || !isoDate(v.entry_date) || !(v.dose_id === null || (typeof v.dose_id === 'string' && uuid.test(v.dose_id))) || !text(v.symptom, 40) || !(v.symptom as string).length || !rating(v.severity)
    || !(v.onset_at === null || instant(v.onset_at)) || !(v.duration_minutes === null || (count(v.duration_minutes) && Number(v.duration_minutes) >= 1 && Number(v.duration_minutes) <= 10080))
    || !(v.affects_daily_life === null || typeof v.affects_daily_life === 'boolean')) invalid();
  return v as unknown as Symptom;
}
const list = <T>(v: unknown, parse: (item: unknown) => T): T[] => { if (!Array.isArray(v)) invalid(); return v.map(parse); };
export function parseDay(v: unknown): DayData {
  if (!object(v) || !isoDate(v.date) || !isoDate(v.today) || typeof v.timezone !== 'string' || !v.timezone) invalid();
  const day = v as Record<string, unknown>;
  const entry = day.entry === null ? null : parseEntry(day.entry);
  const doses = list(day.doses, parseDose), symptoms = list(day.symptoms, parseSymptom);
  if (entry && entry.entry_date !== day.date || doses.some(d => d.entry_date !== day.date) || symptoms.some(s => s.entry_date !== day.date)) invalid();
  return { date: day.date as string, today: day.today as string, timezone: day.timezone as string, entry, doses, symptoms };
}
const parseMark = (v: unknown): DayMark => {
  if (!object(v) || !isoDate(v.date) || typeof v.has_entry !== 'boolean' || !count(v.dose_count) || !count(v.symptom_count)) invalid();
  return v as unknown as DayMark;
};
export function parseEntryList(v: unknown, limit: number, offset: number): EntryList {
  if (!object(v) || !count(v.total) || v.limit !== limit || v.offset !== offset) invalid();
  return { items: list(v.items, parseEntry), total: v.total as number, limit, offset };
}
function parseStock(v: unknown): Stock | null {
  if (v === null) return null;
  if (!object(v) || !finite(v.pills) || !(v.boxes === null || count(v.boxes)) || !(v.loose_pills === null || (finite(v.loose_pills) && Number(v.loose_pills) >= 0))
    || !(v.avg_daily_pills === null || (finite(v.avg_daily_pills) && Number(v.avg_daily_pills) > 0)) || !(v.days_left === null || (finite(v.days_left) && Number(v.days_left) >= 0))) invalid();
  return v as unknown as Stock;
}
export function parseMedication(v: unknown): Medication {
  if (!object(v) || typeof v.id !== 'string' || !uuid.test(v.id) || !text(v.name, 80) || !(v.name as string).length || !text(v.count_unit, 8) || !(v.count_unit as string).length
    || !(v.pills_per_box === null || (count(v.pills_per_box) && Number(v.pills_per_box) >= 1 && Number(v.pills_per_box) <= 10000))
    || !(v.strength_amount === null || (finite(v.strength_amount) && Number(v.strength_amount) > 0)) || !(v.strength_unit === null || (text(v.strength_unit, 16) && (v.strength_unit as string).length > 0)) || (v.strength_amount === null) !== (v.strength_unit === null)
    || !(v.default_pills === null || (finite(v.default_pills) && Number(v.default_pills) > 0 && Number(v.default_pills) <= 1000))
    || !Array.isArray(v.side_effects) || v.side_effects.length > 20 || !v.side_effects.every(n => typeof n === 'string' && n.length > 0 && text(n, 40))
    || (v.regimen !== 'scheduled' && v.regimen !== 'as_needed') || !count(v.dose_count) || !(v.last_taken_at === null || instant(v.last_taken_at))) invalid();
  return { ...(v as unknown as Medication), stock: parseStock(v.stock) };
}
export function parseSymptomName(v: unknown): SymptomName {
  if (!object(v) || typeof v.id !== 'string' || !uuid.test(v.id) || !text(v.name, 40) || !(v.name as string).length || !count(v.event_count)) invalid();
  return v as unknown as SymptomName;
}
const parseStat = (v: unknown): SymptomStat => {
  if (!object(v) || !text(v.symptom, 40) || !count(v.count) || !count(v.days) || !finite(v.avg_severity, true) || !rating(v.max_severity) || !count(v.affects_daily_life_count)) invalid();
  return v as unknown as SymptomStat;
};
/** The daily points of a range: one per day in order, each rating a whole number 0–10 or null (a gap, never 0). */
function parseSeries(items: unknown[]): TrendDay[] {
  return items.map((item, i) => {
    if (!object(item) || !isoDate(item.date) || !RATING_KEYS.every(k => rating(item[k])) || !finite(item.sleep_hours, true) || !count(item.dose_count) || !count(item.symptom_count) || !rating(item.symptom_max_severity)) invalid();
    if (i > 0 && Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${(items[i - 1] as { date: string }).date}T00:00:00Z`) !== 86400000) invalid();
    return item as unknown as TrendDay;
  });
}
export function parseTrends(v: unknown, days: TrendDays): Trends {
  if (!object(v) || v.days !== days || !isoDate(v.start) || !isoDate(v.end) || typeof v.timezone !== 'string' || !count(v.recorded_days) || !Array.isArray(v.series) || v.series.length !== days) invalid();
  const series = parseSeries(v.series as unknown[]);
  if (series[0].date !== v.start || series[days - 1].date !== v.end) invalid();
  return { days, start: v.start as string, end: v.end as string, timezone: v.timezone as string, recorded_days: v.recorded_days as number, series, symptoms: list(v.symptoms, parseStat) };
}
function parseReport(v: unknown): Report {
  if (!object(v) || !isoDate(v.start) || !isoDate(v.end) || !isoDate(v.generated_on) || typeof v.timezone !== 'string') invalid();
  const r = v as Record<string, unknown>;
  const c = r.coverage;
  if (!Array.isArray(r.series)) invalid();
  const series = parseSeries(r.series);
  if (!object(c) || !count(c.days_in_range) || !count(c.days_with_entry) || !count(c.days_without_entry) || !Array.isArray(c.missing_dates) || !c.missing_dates.every(isoDate) || !object(c.unanswered)) invalid();
  if (!object(c) || series.length !== c.days_in_range || series[0].date !== v.start || series[series.length - 1].date !== v.end) invalid();
  if (!Array.isArray(r.ratings) || r.ratings.length !== RATING_KEYS.length || !r.ratings.every((item, i) => object(item) && item.key === RATING_KEYS[i] && count(item.answered_days) && finite(item.mean, true) && rating(item.min) && rating(item.max) && rating(item.first) && rating(item.last))) invalid();
  if (!Array.isArray(r.weekly) || !r.weekly.every(w => object(w) && isoDate(w.week_start) && count(w.entries) && finite(w.mood_mean, true) && finite(w.anxiety_mean, true))) invalid();
  const s = r.sleep;
  if (!object(s) || !count(s.answered_days) || !finite(s.mean_hours, true) || !finite(s.min_hours, true) || !finite(s.max_hours, true) || !count(s.quality_answered_days) || !finite(s.mean_quality, true)) invalid();
  if (!Array.isArray(r.medications) || !r.medications.every(m => object(m) && text(m.name, 80) && count(m.dose_count) && count(m.scheduled_count) && count(m.as_needed_count) && finite(m.total_pills) && instant(m.first_taken_at) && instant(m.last_taken_at)
    && Array.isArray(m.timeline) && m.timeline.every(x => object(x) && isoDate(x.date) && instant(x.taken_at) && finite(x.pills, true) && finite(x.dose_amount, true) && text(x.dose_unit, 16, true) && (x.kind === 'first_in_range' || x.kind === 'changed')))) invalid();
  const events = list(r.symptom_events, item => {
    const symptom = parseSymptom(item);
    const p = (item as Record<string, unknown>).preceding_dose;
    if (!(p === null || object(p) && text(p.medication_name, 80) && count(p.minutes_before))) invalid();
    return { ...symptom, preceding_dose: p as PrecedingDose | null };
  });
  if (!Array.isArray(r.notes) || !r.notes.every(n => object(n) && isoDate(n.date) && text(n.note, 2000))) invalid();
  return { ...(r as unknown as Report), series, doses: list(r.doses, parseDose), symptoms: list(r.symptoms, parseStat), symptom_events: events };
}

const BASE = '/api/v1/me/wellbeing';
async function csrf(fetcher: typeof fetch): Promise<string> {
  const data = await request('/api/v1/auth/csrf', {}, fetcher);
  if (!object(data) || typeof data.csrf_token !== 'string' || !data.csrf_token) invalid();
  return data.csrf_token;
}
async function write(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown, fetcher: typeof fetch): Promise<unknown> {
  return request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf(fetcher) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, fetcher);
}
const checkDay = (day: string) => { if (!isoDate(day)) throw new ActivityError('日期无效', 422); };
const checkId = (id: string) => { if (!uuid.test(id)) throw new ActivityError('找不到这条记录', 404); };
const deleted = (v: unknown) => { if (!object(v) || v.deleted !== true) invalid(); };

export async function readDay(day: string, fetcher: typeof fetch = fetch): Promise<DayData> {
  checkDay(day);
  const data = parseDay(await request(`${BASE}/days/${day}`, {}, fetcher));
  if (data.date !== day) invalid();
  return data;
}
export async function readMarks(from: string, to: string, fetcher: typeof fetch = fetch): Promise<DayMark[]> {
  checkDay(from); checkDay(to);
  return list(await request(`${BASE}/days?from=${from}&to=${to}`, {}, fetcher), parseMark);
}
export async function readEntries(offset: number, limit = 20, fetcher: typeof fetch = fetch): Promise<EntryList> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) invalid();
  return parseEntryList(await request(`${BASE}/entries?limit=${limit}&offset=${offset}`, {}, fetcher), limit, offset);
}
export async function readMedications(fetcher: typeof fetch = fetch): Promise<Medication[]> {
  return list(await request(`${BASE}/medications`, {}, fetcher), parseMedication);
}
export async function createMedication(draft: MedicationDraft, fetcher: typeof fetch = fetch): Promise<Medication> { return parseMedication(await write('/medications', 'POST', draft, fetcher)); }
export async function updateMedication(id: string, draft: Partial<MedicationDraft>, fetcher: typeof fetch = fetch): Promise<Medication> {
  checkId(id);
  const medication = parseMedication(await write(`/medications/${id}`, 'PATCH', draft, fetcher));
  if (medication.id !== id) invalid();
  return medication;
}
export async function restockMedication(id: string, boxes: number, pills: number, fetcher: typeof fetch = fetch): Promise<Medication> {
  checkId(id);
  const medication = parseMedication(await write(`/medications/${id}/stock`, 'POST', { boxes, pills }, fetcher));
  if (medication.id !== id) invalid();
  return medication;
}
/** A stocktake: what is on the shelf now. The server stores the difference. */
export async function countMedication(id: string, boxes: number, pills: number, fetcher: typeof fetch = fetch): Promise<Medication> {
  checkId(id);
  const medication = parseMedication(await write(`/medications/${id}/stock/count`, 'POST', { boxes, pills }, fetcher));
  if (medication.id !== id) invalid();
  return medication;
}
export async function batchDoses(input: { medication_id: string; pills: number | null; start_date: string; end_date: string; times: string[]; note: string | null }, fetcher: typeof fetch = fetch): Promise<BatchResult> {
  checkId(input.medication_id); checkDay(input.start_date); checkDay(input.end_date);
  const v = await write('/doses/batch', 'POST', input, fetcher);
  if (!object(v) || !count(v.created) || !count(v.skipped_existing) || !count(v.skipped_future)) invalid();
  return v as unknown as BatchResult;
}
export async function deleteMedication(id: string, fetcher: typeof fetch = fetch): Promise<void> { checkId(id); deleted(await write(`/medications/${id}`, 'DELETE', undefined, fetcher)); }
export async function readSymptomNames(fetcher: typeof fetch = fetch): Promise<SymptomName[]> { return list(await request(`${BASE}/symptom-names`, {}, fetcher), parseSymptomName); }
export async function createSymptomName(name: string, fetcher: typeof fetch = fetch): Promise<SymptomName> { return parseSymptomName(await write('/symptom-names', 'POST', { name }, fetcher)); }
export async function deleteSymptomName(id: string, fetcher: typeof fetch = fetch): Promise<void> { checkId(id); deleted(await write(`/symptom-names/${id}`, 'DELETE', undefined, fetcher)); }
/** `basedOn` is the `updated_at` of the version the form was loaded from, or null for an empty day. */
export async function saveEntry(day: string, draft: EntryDraft, basedOn: string | null, fetcher: typeof fetch = fetch): Promise<Entry> {
  checkDay(day);
  const entry = parseEntry(await write(`/days/${day}/entry`, 'PUT', { ...draft, based_on: basedOn }, fetcher));
  if (entry.entry_date !== day) invalid();
  return entry;
}
export async function deleteEntry(day: string, fetcher: typeof fetch = fetch): Promise<void> { checkDay(day); deleted(await write(`/days/${day}/entry`, 'DELETE', undefined, fetcher)); }
export async function createDose(draft: DoseDraft, fetcher: typeof fetch = fetch): Promise<Dose> { return parseDose(await write('/doses', 'POST', draft, fetcher)); }
export async function updateDose(id: string, draft: Partial<DoseDraft>, fetcher: typeof fetch = fetch): Promise<Dose> {
  checkId(id);
  const dose = parseDose(await write(`/doses/${id}`, 'PATCH', draft, fetcher));
  if (dose.id !== id) invalid();
  return dose;
}
export async function deleteDose(id: string, fetcher: typeof fetch = fetch): Promise<void> { checkId(id); deleted(await write(`/doses/${id}`, 'DELETE', undefined, fetcher)); }
export async function createSymptom(draft: SymptomDraft, fetcher: typeof fetch = fetch): Promise<Symptom> { return parseSymptom(await write('/symptoms', 'POST', draft, fetcher)); }
export async function updateSymptom(id: string, draft: Partial<SymptomDraft>, fetcher: typeof fetch = fetch): Promise<Symptom> {
  checkId(id);
  const symptom = parseSymptom(await write(`/symptoms/${id}`, 'PATCH', draft, fetcher));
  if (symptom.id !== id) invalid();
  return symptom;
}
export async function deleteSymptom(id: string, fetcher: typeof fetch = fetch): Promise<void> { checkId(id); deleted(await write(`/symptoms/${id}`, 'DELETE', undefined, fetcher)); }
export async function readTrends(days: TrendDays, fetcher: typeof fetch = fetch): Promise<Trends> {
  if (![7, 14, 30].includes(days)) invalid();
  return parseTrends(await request(`${BASE}/trends?days=${days}`, {}, fetcher), days);
}
export async function readReport(from: string, to: string, fetcher: typeof fetch = fetch): Promise<Report> {
  checkDay(from); checkDay(to);
  const report = parseReport(await request(`${BASE}/report?from=${from}&to=${to}`, {}, fetcher));
  if (report.start !== from || report.end !== to) invalid();
  return report;
}
/** Fetches the CSV for the signed-in owner; the caller saves the Blob. Nothing is kept by the page. */
export async function downloadCsv(kind: CsvKind, from: string, to: string, fetcher: typeof fetch = fetch): Promise<Blob> {
  checkDay(from); checkDay(to);
  let response: Response;
  try { response = await fetcher(`${BASE}/report.csv?from=${from}&to=${to}&kind=${kind}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
  catch { throw new ActivityError('无法连接服务，请稍后重试', 503, 'NETWORK_ERROR'); }
  if (response.status === 401) throw new ActivityError('登录已过期，请重新登录', 401, 'AUTH_REQUIRED');
  if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('text/csv')) throw new ActivityError(`导出失败（${response.status}），请稍后重试`, response.status);
  return response.blob();
}

// ---- Pure helpers (also covered by unit tests) ----

/** Completion of a day: how many of the eight answers were given. */
export function answeredCount(entry: EntryDraft | Entry | null): { answered: number; total: number } {
  const keys = [...RATING_KEYS, 'sleep_hours'] as const;
  const total = keys.length + 1;
  if (!entry) return { answered: 0, total };
  return { answered: keys.filter(k => entry[k] !== null).length + (entry.note ? 1 : 0), total };
}
export const emptyDraft = (): EntryDraft => ({ mood: null, anxiety: null, energy: null, focus: null, functioning: null, sleep_hours: null, sleep_quality: null, note: null });
export const draftOf = (entry: Entry | null): EntryDraft => entry ? { mood: entry.mood, anxiety: entry.anxiety, energy: entry.energy, focus: entry.focus, functioning: entry.functioning, sleep_hours: entry.sleep_hours, sleep_quality: entry.sleep_quality, note: entry.note } : emptyDraft();
export const normalizeDraft = (d: EntryDraft): EntryDraft => ({ ...d, note: d.note && d.note.trim() ? d.note.trim() : null });
export const draftChanged = (a: EntryDraft, b: EntryDraft) => JSON.stringify(normalizeDraft(a)) !== JSON.stringify(normalizeDraft(b));
export const draftEmpty = (d: EntryDraft) => answeredCount(normalizeDraft(d)).answered === 0;

/** Local wall-clock `YYYY-MM-DDTHH:mm` in `timezone` for an instant, for `datetime-local` inputs. */
export function localInput(value: string | number | Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
/** The UTC instant of a wall-clock time `YYYY-MM-DDTHH:mm` in `timezone`. Handles DST by re-checking the offset. */
export function instantFromLocal(local: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new ActivityError('时间格式无效', 422);
  const wall = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const shown = Date.parse(`${localInput(guess, timezone)}:00Z`);
    guess += wall - shown;
  }
  return new Date(guess).toISOString();
}
export const dateLabel = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${'周日周一周二周三周四周五周六'.slice(date.getUTCDay() * 2, date.getUTCDay() * 2 + 2)}`;
};
export const shortDate = (day: string) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;
export const timeLabel = (value: string, timezone: string) => localInput(value, timezone).slice(11);
export const addDays = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
export function monthBounds(month: string): { from: string; to: string; first: number; days: number } {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, first: (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7, days };
}
/** Sleep duration for reading: 7.42 → "7 小时 25 分" (two decimals hold whole minutes exactly). */
export function hoursText(hours: number): string {
  const minutes = Math.round(hours * 60), h = Math.floor(minutes / 60), m = minutes % 60;
  return h === 0 ? `${m} 分` : m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}
export const durationLabel = (minutes: number | null) => minutes === null ? '' : minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`;
export const gapLabel = (minutes: number) => minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}前`;
const trim = (n: number, digits = 3) => String(+n.toFixed(digits));
/** "1.5 颗（18.75 mg）", "2 颗", or "10 mg" for an old amount-only dose. */
export function doseText(dose: { pills?: number | null; dose_amount: number | null; dose_unit: string | null }, countUnit = '颗'): string {
  const pills = dose.pills ?? null;
  const amount = dose.dose_amount !== null && dose.dose_unit ? `${trim(dose.dose_amount)} ${dose.dose_unit}` : '';
  if (pills !== null) return amount ? `${trim(pills, 2)} ${countUnit}（${amount}）` : `${trim(pills, 2)} ${countUnit}`;
  return amount || '—';
}
export const pillsText = (pills: number, countUnit = '颗') => `${trim(pills, 2)} ${countUnit}`;
/** The stock on hand in words: "2 盒 5 颗（共 61 颗）"; a negative count means more was logged than was counted in. */
export function stockText(med: Pick<Medication, 'count_unit' | 'stock'>): string {
  const stock = med.stock;
  if (!stock) return '还没有记录库存';
  if (stock.pills <= 0) return stock.pills === 0 ? `已用完（0 ${med.count_unit}）` : `库存不足：记录的比盘点的多 ${trim(-stock.pills, 2)} ${med.count_unit}，请盘点`;
  const total = pillsText(stock.pills, med.count_unit);
  return stock.boxes !== null && stock.loose_pills !== null ? `${stock.boxes} 盒 ${trim(stock.loose_pills, 2)} ${med.count_unit}（共 ${total}）` : total;
}
/** How long the stock lasts at the pace of the last 14 days. Arithmetic on the user's own log, not advice. */
export function supplyText(med: Pick<Medication, 'count_unit' | 'stock'>): string {
  const stock = med.stock;
  if (!stock || stock.avg_daily_pills === null) return '';
  if (stock.days_left === 0) return '';
  return `按近 14 天平均每天 ${trim(stock.avg_daily_pills, 2)} ${med.count_unit}，约可吃 ${trim(stock.days_left ?? 0, 1)} 天`;
}

/**
 * The nearest dose taken before `onset` (within 24 h), as a time-order fact only.
 * It says nothing about cause; the report uses the same rule on the server.
 */
export function precedingDose(onset: string | null, doses: Dose[]): PrecedingDose | null {
  if (!onset) return null;
  const at = Date.parse(onset);
  const earlier = doses.filter(d => Date.parse(d.taken_at) <= at && at - Date.parse(d.taken_at) <= 86400000);
  if (!earlier.length) return null;
  const last = earlier.reduce((a, b) => Date.parse(b.taken_at) > Date.parse(a.taken_at) ? b : a);
  return { medication_name: last.medication_name, minutes_before: Math.floor((at - Date.parse(last.taken_at)) / 60000) };
}
/** The account-local calendar day for `now` (en-CA formats as YYYY-MM-DD). */
export const todayIn = (timezone: string, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const monthLabel = (month: string) => `${month.slice(0, 4)}年${+month.slice(5, 7)}月`;
export const shiftMonth = (month: string, delta: number) => { const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + delta, 1)); return d.toISOString().slice(0, 7); };
export const dateTimeLabel = (value: string, timezone: string) => localInput(value, timezone).replace('T', ' ');
