import type { Summary } from '../../src/lib/api/statistics';
import type { Report, Snapshot } from '../../src/lib/api/ai';
import type { Page } from '@playwright/test';
import { sampleActivity } from './activities';
export const summary: Summary = { activity_count: 8, distance_m: '42123.456', duration_sum_seconds: 14400, known_duration_count: 8, missing_duration_count: 0, activity_days: 8, pace_eligible_count: 8, pace_eligible_distance_m: '42123.456', avg_pace_seconds_per_km: '341.8', quality_warning_count: 1, date_assignment: 'activity_local_date' };
const snapshot: Snapshot = { schema_version: 'running-summary-v1', date_from: '2026-09-14', date_to: '2026-10-12', summary, weeks: [{ ...summary, bucket_start: '2026-09-14', bucket_end: '2026-09-21', distance_change_pct: null }], average_runs_per_week: '2', evidence_limited: false, limitations: ['缺少心率数据，建议仅供参考。'] };
export const report: Report = { id: '55555555-5555-4555-8555-555555555555', date_from: snapshot.date_from, date_to: snapshot.date_to, status: 'succeeded', stats_snapshot: snapshot, analysis: { trend_summary: '近期保持稳定运动节奏。', recommendations: ['安排轻松跑，逐步增加跑量。'], limitations: '仅依据运动汇总数据。' }, model: 'mock-only', prompt_version: 'v1', error_code: null, created_at: '2026-10-14T01:00:00Z', finished_at: '2026-10-14T01:00:01Z', is_stale: false };
export async function installAI(page: Page) {
  const state = { reports: [] as Report[], calls: [] as { key: string; body: unknown }[], failGenerate: false, failContext: false, failHistory: false, failDetail: false, configured: true, empty: false, quota: 3 };
  await page.route(/\/api\/v1\/ai-reports(?:\?|\/|$)/, async route => {
    const req = route.request(), url = new URL(req.url());
    const send = (data: unknown, failed = false) => route.fulfill({ status: failed ? 503 : 200, json: { data, error: failed ? { code: 'UNKNOWN_FAILURE', message: '模拟服务暂时失败，请重试' } : null } });
    if (url.pathname.endsWith('/context')) return send({ configured: state.configured, model: 'mock-only', daily_limit: 3, attempts_today: 3-state.quota, remaining_today: state.quota, date_from: snapshot.date_from, date_to: snapshot.date_to, stats_snapshot: { ...snapshot, summary: state.empty ? { ...summary, activity_count: 0, distance_m: 0 } : summary } }, state.failContext);
    if (req.method() === 'POST') { state.calls.push({ key: req.headers()['idempotency-key'], body: req.postDataJSON() }); if (state.failGenerate) return send(null, true); state.reports = [report]; return send(report); }
    if (req.method() === 'DELETE') { state.reports=[]; return send({}); }
    if (url.pathname.endsWith(report.id)) return send(state.reports.find(item=>item.id===report.id) ?? report, state.failDetail);
    return send({ items: state.reports, total: state.reports.length, offset: 0, limit: 10 }, state.failHistory);
  });
  return state;
}
export async function installPublic(page: Page) {
  const state = { closed: false, empty: false, reads: [] as string[] };
  const activity = { ...sampleActivity, author: { username: 'runner', display_name: '晨跑者', email: 'PRIVATE_EMAIL_SENTINEL' }, has_shared_route: false, notes: 'PRIVATE_NOTES_SENTINEL', coordinates: 'PRIVATE_GPS_SENTINEL', gpx_filename: 'PRIVATE_GPX_SENTINEL' };
  await page.route(/\/api\/v1\/(public|shared)\//, route => {
    const url = new URL(route.request().url()); state.reads.push(url.pathname);
    const send = (data: unknown) => route.fulfill({ status: state.closed ? 404 : 200, json: { data: state.closed ? null : data, error: state.closed ? { message: '公开内容已关闭或撤销' } : null } });
    if (url.pathname.endsWith('/calendar')) {
      const year=Number(url.searchParams.get('year')); const days=[];
      for(let d=new Date(`${year}-01-01T00:00:00Z`);d.getUTCFullYear()===year;d=new Date(d.getTime()+86400000)) days.push({ date:d.toISOString().slice(0,10), activity_count: !state.empty && d.toISOString().startsWith('2026-10-13') ? 1 : 0, distance_m: !state.empty && d.toISOString().startsWith('2026-10-13') ? 5123.456 : 0, duration_sum_seconds:null, known_duration_count:0, missing_duration_count:0 });
      return send({ year, days, activity_count: state.empty?0:1, distance_m:state.empty?0:5123.456, date_assignment:'activity_local_date' });
    }
    if(url.pathname.endsWith('/activities')) { const day=url.searchParams.get('activity_date'); const items=state.empty || day && day!=='2026-10-13'?[]:[activity]; return send({ items,total:items.length,offset:0,limit:20 }); }
    if(url.pathname.includes('/users/')) return send({ username:'runner',display_name:'晨跑者',bio:'记录每一次出发。',summary:state.empty?{...summary,activity_count:0,distance_m:0,activity_days:0}:summary,email:'PRIVATE_EMAIL_SENTINEL',notes:'PRIVATE_NOTES_SENTINEL' });
    return send(activity);
  });
  return state;
}
