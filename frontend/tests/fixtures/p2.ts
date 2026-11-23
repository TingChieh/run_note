import type { Summary } from '../../src/lib/api/statistics';
import type { Page } from '@playwright/test';
import { sampleActivity } from './activities';
export const summary: Summary = { activity_count: 8, distance_m: '42123.456', duration_sum_seconds: 14400, known_duration_count: 8, missing_duration_count: 0, activity_days: 8, pace_eligible_count: 8, pace_eligible_distance_m: '42123.456', avg_pace_seconds_per_km: '341.8', quality_warning_count: 1, date_assignment: 'activity_local_date' };
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
