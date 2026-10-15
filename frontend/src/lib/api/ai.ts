import { ActivityError, type Metric } from './activities';
import type { Summary } from './statistics';
export interface DeviceMetrics {
  heart_rate_record_count: number; heart_rate_weighted_count: number;
  heart_rate_weighted_duration_seconds: Metric; avg_heart_rate_bpm: Metric;
  calories_record_count: number; calories_kcal: number | null;
  steps_record_count: number; steps: number | null;
}
export interface Snapshot {
  schema_version: 'running-summary-v1' | 'running-summary-v2'; device_metrics?: DeviceMetrics; date_from: string; date_to: string; summary: Summary;
  weeks: (Summary & { bucket_start: string; bucket_end: string; distance_change_pct: Metric; device_metrics?: DeviceMetrics })[];
  average_runs_per_week: string; evidence_limited: boolean; limitations: string[];
}
export interface Analysis { trend_summary: string; recommendations: string[]; limitations: string }
export interface Report { id: string; date_from: string; date_to: string; status: 'pending' | 'succeeded' | 'failed'; stats_snapshot: Snapshot; analysis: Analysis | null; model: string; prompt_version: string; error_code: string | null; created_at: string; finished_at: string | null; is_stale: boolean }
export interface Context { configured: boolean; model: string | null; daily_limit: number; attempts_today: number; remaining_today: number; date_from: string; date_to: string; stats_snapshot: Snapshot }
export interface ReportList { items: Report[]; total: number; limit: number; offset: number }
export interface Create { date_from: string; date_to: string; consent_to_send_summary: true }
export class AIError extends ActivityError { constructor(message: string, status: number, code: string, public reportId: string | null = null) { super(message,status,code); } }
// Unknown server failures may occur after the provider has already completed.
// Only known pre-call rejections or a persisted report confirm the outcome.
export function confirmedRequestOutcome(cause: unknown): boolean {
  return cause instanceof AIError && (!!cause.reportId || [
    'AI_NOT_CONFIGURED', 'AI_QUOTA_EXCEEDED', 'AI_DATA_INSUFFICIENT',
    'VALIDATION_ERROR', 'IDEMPOTENCY_CONFLICT', 'REPORT_DELETED',
  ].includes(cause.code));
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never { throw new AIError('分析服务返回无效响应',502,'INVALID_RESPONSE'); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = (v: unknown) => (typeof v === 'string' && v.trim() !== '' || typeof v === 'number') && Number.isFinite(Number(v));
function validateDeviceMetrics(value: unknown, total: number): void {
  if (!object(value)) invalid();
  const count = (key: string, max = total) => {
    const v = value[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) invalid();
    return v;
  };
  const hr = count('heart_rate_record_count');
  const weighted = count('heart_rate_weighted_count', hr);
  for (const [key, n] of [['calories_kcal', count('calories_record_count')], ['steps', count('steps_record_count')]] as const) {
    const v = value[key];
    if (n === 0 ? v !== null : typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) invalid();
  }
  const duration = value.heart_rate_weighted_duration_seconds, bpm = value.avg_heart_rate_bpm;
  if (weighted === 0) {
    if (duration !== null || bpm !== null) invalid();
  } else if (!numeric(duration) || Number(duration) <= 0 || !numeric(bpm) || Number(bpm) < 1 || Number(bpm) > 300) invalid();
}
function snapshot(value: unknown): Snapshot {
  if (!object(value) || !['running-summary-v1', 'running-summary-v2'].includes(String(value.schema_version)) || !object(value.summary) || !Array.isArray(value.weeks) || typeof value.evidence_limited !== 'boolean' || !Array.isArray(value.limitations) || !value.limitations.every(v => typeof v === 'string') || !numeric(value.average_runs_per_week)) invalid();
  for (const s of [value.summary, ...value.weeks]) {
    if (!object(s) || !Number.isInteger(s.activity_count) || Number(s.activity_count) < 0 || !numeric(s.distance_m) || Number(s.distance_m) < 0 || s.avg_pace_seconds_per_km !== null && !numeric(s.avg_pace_seconds_per_km)) invalid();
  }
  if (value.schema_version === 'running-summary-v2') {
    validateDeviceMetrics(value.device_metrics, Number(value.summary.activity_count));
    for (const week of value.weeks) validateDeviceMetrics(week.device_metrics, Number(week.activity_count));
  }
  return value as unknown as Snapshot;
}
export function parseReport(value: unknown): Report {
  if (!object(value) || typeof value.id !== 'string' || !uuid.test(value.id) || !['pending','succeeded','failed'].includes(String(value.status)) || typeof value.is_stale !== 'boolean' || typeof value.model !== 'string') invalid();
  snapshot(value.stats_snapshot);
  if (value.analysis !== null) {
    const a = value.analysis;
    if (!object(a) || typeof a.trend_summary !== 'string' || typeof a.limitations !== 'string' || !Array.isArray(a.recommendations) || !a.recommendations.every(v => typeof v === 'string')) invalid();
  }
  if (value.status === 'succeeded' && !value.analysis || value.status !== 'succeeded' && value.analysis !== null) invalid();
  return value as unknown as Report;
}
async function request(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch, timeout = 8000): Promise<unknown> {
  let r: Response;
  try { r = await fetcher(path,{ ...init,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(timeout) }); }
  catch { throw new AIError('连接中断，结果尚未确认。请读取历史，或按原请求标识重试以防重复调用。',503,'NETWORK_ERROR'); }
  let body;
  try { body = await r.json(); } catch { throw new AIError('服务响应无法读取，请先确认历史记录',502,'INVALID_RESPONSE'); }
  if (!r.ok || body?.error) {
    const error = body?.error, id = error?.details?.find((d: {report_id?: string}) => typeof d.report_id === 'string')?.report_id;
    let message = error?.message ?? '分析请求失败';
    const retry = r.headers.get('Retry-After');
    if (r.status === 429 && retry && /^\d+$/.test(retry)) message += `，请在 ${retry} 秒后重试`;
    throw new AIError(message,r.status,error?.code ?? 'REQUEST_FAILED',typeof id === 'string' && uuid.test(id) ? id : null);
  }
  if (!object(body?.data)) invalid();
  return body.data;
}
async function csrf(fetcher: typeof fetch) {
  const c = await request('/api/v1/auth/csrf',{},fetcher);
  if (!object(c) || typeof c.csrf_token !== 'string' || !c.csrf_token) invalid();
  return c.csrf_token;
}
export async function readContext(from?: string, to?: string): Promise<Context> {
  const v = await request('/api/v1/ai-reports/context' + (from && to ? `?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}` : ''));
  if (!object(v) || typeof v.configured !== 'boolean' || !Number.isInteger(v.remaining_today) || typeof v.date_from !== 'string' || typeof v.date_to !== 'string') invalid();
  snapshot(v.stats_snapshot); return v as unknown as Context;
}
export async function readReports(offset = 0): Promise<ReportList> {
  const v = await request(`/api/v1/ai-reports?limit=10&offset=${offset}`);
  if (!object(v) || !Array.isArray(v.items) || !Number.isInteger(v.total)) invalid();
  return {items:v.items.map(parseReport),total:Number(v.total),limit:10,offset};
}
export const readReport = async (id: string) => { if (!uuid.test(id)) invalid(); return parseReport(await request('/api/v1/ai-reports/'+id)); };
export async function generateReport(payload: Create, key: string, fetcher: typeof fetch = fetch): Promise<Report> {
  if (!uuid.test(key)) invalid();
  return parseReport(await request('/api/v1/ai-reports',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':await csrf(fetcher),'Idempotency-Key':key},body:JSON.stringify(payload)},fetcher,45000));
}
export async function deleteReport(id: string) { if (!uuid.test(id)) invalid(); await request('/api/v1/ai-reports/'+id,{method:'DELETE',headers:{'X-CSRF-Token':await csrf(fetch)}}); }
