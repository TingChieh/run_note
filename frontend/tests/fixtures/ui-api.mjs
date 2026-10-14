// Browser UI contract fixture: no database, no production auth bypass.
import { createServer } from 'node:http';
const user = { id: 'ui-runner', email: 'runner.with.a.long.email.address@example.com', username: 'runner', display_name: '晨跑者', timezone: 'Asia/Shanghai', created_at: '2026-01-01T00:00:00Z', bio: '', profile_is_public: false };
const summary = { activity_count: 0, distance_m: 0, duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: 0, activity_days: 0, pace_eligible_count: 0, pace_eligible_distance_m: 0, avg_pace_seconds_per_km: null, quality_warning_count: 0, date_assignment: 'activity_local_date' };
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const signedIn = req.headers.cookie?.includes('run_session=ui-runner');
  /** @param {unknown} data */
  const send = (data, status = 200, message = '会话已过期') => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ data, error: status >= 400 ? { code: 'UI_FIXTURE', message } : null })); };
  if (url.pathname === '/api/health') return send({ status: 'ok' });
  if (url.pathname.endsWith('/auth/csrf')) return send({ csrf_token: 'ui-csrf' });
  if ((url.pathname.endsWith('/auth/login') || url.pathname.endsWith('/auth/register'))) { Object.assign(user, {display_name:'晨跑者',bio:'',profile_is_public:false}); res.setHeader('Set-Cookie', 'run_session=ui-runner; Path=/; HttpOnly; SameSite=Lax'); return send({ user }); }
  if (url.pathname.endsWith('/auth/logout')) { res.setHeader('Set-Cookie', 'run_session=; Path=/; Max-Age=0'); return send({ logged_out: true }); }
  if (url.pathname.endsWith('/auth/session')) return signedIn ? send({ user }) : send(null, 401);
  if (!signedIn) return send(null, 401);
  if (url.pathname === '/api/v1/me' && req.method === 'PATCH') {
    let body = ''; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body); Object.assign(user, { display_name: value.display_name, bio: value.bio, profile_is_public: value.profile_is_public }); return send(user);
  }
  if (url.pathname === '/api/v1/activities') return send({ items: [], total: 0, limit: 20, offset: 0 });
  if (url.pathname.endsWith('/statistics/summary')) return send(summary);
  if (url.pathname.endsWith('/statistics/calendar')) {
    const year = Number(url.searchParams.get('year')); const days = [];
    for (let d = new Date(`${year}-01-01T00:00:00Z`); d.getUTCFullYear() === year; d = new Date(d.getTime() + 86400000)) days.push({ date: d.toISOString().slice(0,10), activity_count: 0, distance_m: 0, duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: 0 });
    return send({ year, metric: url.searchParams.get('metric'), days, activity_count: 0, distance_m: 0, date_assignment: 'activity_local_date' });
  }
  if (url.pathname.endsWith('/statistics/trends')) {
    const from = url.searchParams.get('date_from'), to = url.searchParams.get('date_to');
    return send({ period: url.searchParams.get('period'), date_from: from, date_to: to, week_start: 'monday', date_assignment: 'activity_local_date', buckets: [{ ...summary, bucket_start: from, bucket_end: to, is_partial: true }] });
  }
  return send(null, 404, '合成测试数据为空');
}).listen(8191, '127.0.0.1');
