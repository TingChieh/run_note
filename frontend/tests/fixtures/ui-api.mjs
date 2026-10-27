// Browser UI contract fixture: no database, no production auth bypass.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
/** @type {Record<string, any>} */
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'runner.with.a.long.email.address@example.com', username: 'runner', display_name: '晨跑者', timezone: 'Asia/Shanghai', created_at: '2026-01-01T00:00:00Z', bio: '', profile_is_public: false, is_admin: true, is_active: true, showcase_enabled: true };
/** @type {Record<string, any>[]} */
const accounts = [{ ...user, password: 'Synthetic-ui-password-2026' }];
const sessions = new Map([['ui-runner', user.id]]);
/** @param {Record<string, unknown>} account */
const clean = account => Object.fromEntries(Object.entries(account).filter(([key]) => key !== 'password'));
const summary = { activity_count: 0, distance_m: 0, duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: 0, activity_days: 0, pace_eligible_count: 0, pace_eligible_distance_m: 0, avg_pace_seconds_per_km: null, quality_warning_count: 0, date_assignment: 'activity_local_date' };
/** @type {Record<string, number | null>} */
const goals = {week:null,month:null,year:null};
/** @type {Record<string, any>} */
const site = { title: 'RunNote', subtitle: '跑步与足迹', footer_tagline: '记录每一步，看见你的进步。', description: '汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。', default_theme: 'system', favicon_url: null, logo_url: null };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** @type {Map<string, Buffer>} */
const images = new Map();
/** @type {Map<string, Buffer>} */
const avatars = new Map();
const version = () => randomUUID().replaceAll('-', '').slice(0, 16);
const siteFields = ['title', 'subtitle', 'footer_tagline', 'description', 'default_theme'];
/**
 * Personal records, v2 (whole-history overview). `empty` mimics an account without any activity;
 * only this synthetic API recognises `?empty=1` on the records URL.
 * @param {boolean} empty
 */
function recordsFixture(empty) {
  // 22 months, 2025-01 .. 2026-10; two runs a month, distance grows and pace gets faster.
  const monthly = empty ? [] : Array.from({ length: 22 }, (_, i) => ({
    month_start: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
    activity_count: 2, distance_m: String(10000 + i * 1000), avg_pace_seconds_per_km: String(372 - i * 2)
  }));
  const sum = (/** @type {number} */ year) => monthly.filter(m => m.month_start.startsWith(`${year}-`)).reduce((t, m) => ({ n: t.n + m.activity_count, d: t.d + Number(m.distance_m) }), { n: 0, d: 0 });
  const y25 = sum(2025), y26 = sum(2026);
  const yearly = empty ? [] : [
    { year: 2025, activity_count: y25.n, distance_m: `${y25.d}.000`, activity_days: y25.n, avg_pace_seconds_per_km: '360.000', is_partial: false, delta: null, delta_basis: null },
    { year: 2026, activity_count: y26.n, distance_m: `${y26.d}.000`, activity_days: y26.n - 2, avg_pace_seconds_per_km: '335.000', is_partial: true,
      delta: { activity_count: 4, distance_m: '52000.000', avg_pace_seconds_per_km: '-18.000' }, delta_basis: 'previous_year_same_period' }
  ];
  // 26 weeks from 2026-05-04; active days cycle 0..3 and the latest week has 5, so every dot level appears.
  const base = Date.UTC(2026, 4, 4);
  return {
    date_assignment: 'activity_local_date',
    personal_bests: [
      empty ? { category: '5km', best: null, first: null, pace_gain_seconds_per_km: null }
        : {
          category: '5km',
          best: { activity_id: '11111111-1111-4111-8111-111111111111', activity_date: '2026-03-05', distance_m: '5000.000', duration_seconds: '1650.000', avg_pace_seconds_per_km: '330.000', qualifying_count: 4 },
          first: { activity_id: '22222222-2222-4222-8222-222222222222', activity_date: '2025-01-12', distance_m: '5000.000', duration_seconds: '1860.000', avg_pace_seconds_per_km: '372.000' },
          pace_gain_seconds_per_km: '42.000'
        },
      { category: '10km', best: null, first: null, pace_gain_seconds_per_km: null }
    ],
    totals: empty ? { activity_count: 0, distance_m: '0', activity_days: 0, avg_pace_seconds_per_km: null, first_activity_date: null }
      : { activity_count: y25.n + y26.n, distance_m: `${y25.d + y26.d}.000`, activity_days: y25.n + y26.n - 2, avg_pace_seconds_per_km: '347.000', first_activity_date: '2025-01-12' },
    monthly,
    weekly: Array.from({ length: 26 }, (_, i) => ({ week_start: new Date(base + i * 7 * 86400000).toISOString().slice(0, 10), active_days: empty ? 0 : i === 25 ? 5 : i % 4 })),
    weekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i, activity_count: empty ? 0 : i })),
    yearly
  };
}
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const avatarRoute = url.pathname.match(/^\/api\/v1\/showcase(?:\/users\/([a-z0-9_]+))?\/avatar$/);
  const named = url.pathname.match(/^\/api\/v1\/showcase\/users\/([a-z0-9_]+)(\/.*)$/);
  const subject = named ? accounts.find(item => item.username === named[1]) : accounts[0];
  const showcase = url.pathname.startsWith('/api/v1/showcase/');
  if (named) url.pathname = '/api/v1/showcase' + named[2];
  if (showcase && url.pathname !== '/api/v1/showcase/profile') url.pathname = url.pathname.replace('/api/v1/showcase/', '/api/v1/').replace('/api/v1/running-goals', '/api/v1/me/running-goals');
  const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('run_session='))?.slice(12) ?? '';
  const current = accounts.find(item => item.id === sessions.get(token));
  const signedIn = current?.is_active === true;
  /** @param {unknown} data */
  const send = (data, status = 200, message = '会话已过期') => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ data, error: status >= 400 ? { code: 'UI_FIXTURE', message } : null })); };
  if (showcase && req.method !== 'GET') return send(null,405,'展示页面仅支持读取');
  if (named && (!subject?.is_active || !subject.showcase_enabled)) return send(null,404,'展示页面不存在');
  if (url.pathname === '/api/v1/showcase/profile') {
    const owner = named ? subject : user;
    const stamp = typeof owner?.avatar_url === 'string' ? owner.avatar_url.split('?v=')[1] : null;
    const avatar_url = stamp ? `/api/v1/showcase${named ? `/users/${named[1]}` : ''}/avatar?v=${stamp}` : null;
    return send({display_name:owner?.display_name,timezone:owner?.timezone,avatar_url});
  }
  if (url.pathname.endsWith('/auth/register')) return send(null,403,'本站不开放注册');
  if (url.pathname === '/api/health') return send({ status: 'ok' });
  if (url.pathname.endsWith('/auth/csrf')) return send({ csrf_token: 'ui-csrf' });
  if (url.pathname.endsWith('/auth/login')) {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const found = accounts.find(item => item.email === payload.email || item.is_admin && payload.email === 'runner@example.com');
    if (!found?.is_active || !found.is_admin && found.password !== payload.password) return send(null,401,'邮箱或密码不正确');
    if (found.is_admin) { Object.assign(user, {display_name:'晨跑者',bio:'',profile_is_public:false}); Object.assign(found,user); Object.assign(goals,{week:null,month:null,year:null}); }
    const session = found.is_admin ? 'ui-runner' : randomUUID(); sessions.set(session, found.id);
    res.setHeader('Set-Cookie', `run_session=${session}; Path=/; HttpOnly; SameSite=Lax`); return send({ user: clean(found) });
  }
  if (url.pathname.endsWith('/auth/logout')) { sessions.delete(token); res.setHeader('Set-Cookie', 'run_session=; Path=/; Max-Age=0'); return send({ logged_out: true }); }
  if (url.pathname.endsWith('/auth/session')) return signedIn ? send({ user: current.is_admin ? user : clean(current) }) : send(null, 401);
  if (url.pathname === '/api/v1/site' && req.method === 'GET') return send(site);
  if (url.pathname === '/api/v1/site' && req.method === 'PATCH') {
    if (!signedIn) return send(null,401);
    if (!current.is_admin) return send(null,403,'仅站主可修改站点设置');
    if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'请求校验失败');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    for (const key of siteFields) if (key in payload) site[key] = payload[key];
    return send(site);
  }
  const siteImage = url.pathname.match(/^\/api\/v1\/site\/images\/(favicon|logo)$/);
  if (siteImage) {
    const kind = siteImage[1];
    if (req.method === 'GET') {
      if (!images.has(kind)) return send(null,404,'图片不存在');
      res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-store'}); return res.end(images.get(kind));
    }
    if (!signedIn) return send(null,401);
    if (!current.is_admin) return send(null,403,'仅站主可修改站点设置');
    if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'请求校验失败');
    for await (const chunk of req) void chunk;
    if (req.method === 'PUT') { images.set(kind, png); site[`${kind}_url`] = `/api/v1/site/images/${kind}?v=${version()}`; return send(site); }
    if (req.method === 'DELETE') { images.delete(kind); site[`${kind}_url`] = null; return send(site); }
    return send(null,405,'不支持的请求');
  }
  if (avatarRoute && req.method === 'GET') {
    const owner = avatarRoute[1] ? accounts.find(item => item.username === avatarRoute[1]) : accounts[0];
    if (!owner || !avatars.has(owner.id) || (avatarRoute[1] && (!owner.is_active || !owner.showcase_enabled))) return send(null,404,'头像不存在');
    res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-store'}); return res.end(avatars.get(owner.id));
  }
  if (url.pathname === '/api/v1/me/avatar') {
    if (!signedIn) return send(null,401);
    if (req.method === 'GET') {
      if (!avatars.has(current.id)) return send(null,404,'头像不存在');
      res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-store'}); return res.end(avatars.get(current.id));
    }
    if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'请求校验失败');
    for await (const chunk of req) void chunk;
    if (req.method === 'PUT') { avatars.set(current.id, png); current.avatar_url = `/api/v1/me/avatar?v=${version()}`; }
    else if (req.method === 'DELETE') { avatars.delete(current.id); current.avatar_url = null; }
    else return send(null,405,'不支持的请求');
    if (current.is_admin) Object.assign(user, clean(current));
    return send({avatar_url: current.avatar_url});
  }
  if (url.pathname.startsWith('/api/v1/admin/users')) {
    if (!signedIn) return send(null,401);
    if (!current.is_admin) return send(null,403,'仅站主可管理用户');
    if (req.method === 'GET') {
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const active = url.searchParams.get('is_active');
      const rows = accounts.filter(item => (!search || item.email.includes(search) || item.username.includes(search)) && (active === null || item.is_active === (active === 'true')));
      const limit = Number(url.searchParams.get('limit') ?? 20), offset = Number(url.searchParams.get('offset') ?? 0);
      return send({items:rows.slice(offset,offset+limit).map(clean),total:rows.length,limit,offset});
    }
    if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'请求校验失败');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/users') {
      if (accounts.some(item => item.email === payload.email || item.username === payload.username)) return send(null,409,'邮箱或用户名已存在');
      const account = {...payload,id:randomUUID(),email:payload.email.toLowerCase(),bio:'',profile_is_public:false,is_admin:false,created_at:'2026-10-16T00:00:00Z'};
      accounts.push(account); return send(clean(account),201);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/users/batch-delete') {
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) return send(null,422,'请选择 1–100 个不同的用户');
      const targets = accounts.filter(item => ids.includes(item.id));
      if (targets.some(item => item.is_admin)) return send(null,409,'不能删除站主账号');
      for (const target of targets) {
        accounts.splice(accounts.indexOf(target), 1);
        for (const [key,id] of sessions) if (id === target.id) sessions.delete(key);
      }
      return send({deleted:true,deleted_count:targets.length});
    }
    const account = accounts.find(item => item.id === url.pathname.split('/')[5]);
    if (!account) return send(null,404,'用户不存在');
    if (account.is_admin && ('is_active' in payload || 'showcase_enabled' in payload || 'email' in payload || url.pathname.endsWith('/reset-password'))) return send(null,409,'站主账号受保护');
    const revoke = () => { for (const [key,id] of sessions) if (id === account.id) sessions.delete(key); };
    if (req.method === 'POST' && url.pathname.endsWith('/reset-password')) { account.password = payload.new_password; revoke(); return send({password_reset:true}); }
    if (req.method === 'PATCH') {
      if (payload.email && account.email !== payload.email) revoke();
      Object.assign(account,payload);
      if (!account.is_active) { account.showcase_enabled=false; revoke(); }
      if (account.is_admin) Object.assign(user,clean(account));
      return send(clean(account));
    }
    return send(null,405,'不支持的请求');
  }
  const publicRead = req.method === 'GET' && (url.pathname.startsWith('/api/v1/public/') || url.pathname.startsWith('/api/v1/shared/'));
  if (!signedIn && !showcase && !publicRead) return send(null, 401);
  if (url.pathname === '/api/v1/me' && req.method === 'GET') return send(current?.is_admin ? user : clean(current ?? user));
  if (url.pathname === '/api/v1/me/password' && req.method === 'PATCH') {
    if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'请求校验失败');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (!current || payload.current_password !== current.password) return send(null,400,'当前密码不正确');
    current.password = payload.new_password;
    for (const [key,id] of sessions) if (id === current.id) sessions.delete(key);
    return send({password_changed:true});
  }
  if (url.pathname === '/api/v1/me/running-goals') return send(goals);
  if (url.pathname.startsWith('/api/v1/me/running-goals/') && req.method === 'PUT') {
    const period = url.pathname.split('/').at(-1);
    if (!period || !(period in goals) || req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'目标保存请求无效');
    let body = ''; for await (const chunk of req) body += chunk;
    const { target_km } = JSON.parse(body); goals[period] = target_km;
    return send({period,target_km});
  }
  if (url.pathname === '/api/v1/me' && req.method === 'PATCH') {
    let body = ''; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body); Object.assign(current ?? user, value);
    if (current?.is_admin) Object.assign(user,clean(current));
    return send(clean(current ?? user));
  }
  if (url.pathname === '/api/v1/ai-reports') return send({items:[],total:0,limit:Number(url.searchParams.get('limit')??10),offset:Number(url.searchParams.get('offset')??0)});
  if (url.pathname === '/api/v1/activities/categories') return send([]);
  if (url.pathname === '/api/v1/activities') return send({ items: [], total: 0, limit: Number(url.searchParams.get('limit') ?? 20), offset: Number(url.searchParams.get('offset') ?? 0) });
  if (url.pathname === '/api/v1/footprints/all') return send({status:'ready',generated_at:'2026-10-15T00:00:00Z',refreshing:false,result:{scope:'all',type:'FeatureCollection',features:[],mode:url.searchParams.get('mode')??'tracks',activity_count:0,visible_activity_count:0,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0}});
  if (url.pathname === '/api/v1/footprints/provinces') return send({ year:url.searchParams.has('year')?Number(url.searchParams.get('year')):null,total:34,provinces:[],activity_count:0,located_activity_count:0 });
  if (url.pathname.endsWith('/statistics/streaks')) {
    const today = new Intl.DateTimeFormat('sv-SE',{timeZone:user.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const monday = new Date(`${today}T00:00:00Z`); monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
    return send({today,current_days:0,longest_days:0,current_weeks:0,longest_weeks:0,week:Array.from({length:7},(_,i)=>({date:new Date(+monday+i*86400000).toISOString().slice(0,10),active:false}))});
  }
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
  if (url.pathname.endsWith('/statistics/records')) return send(recordsFixture(url.searchParams.get('empty') === '1'));
  const missingActivity = '00000000-0000-4000-8000-000000000404';
  const activityDetail = url.pathname.match(/^\/api\/v1\/activities\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (activityDetail && req.method === 'GET' && activityDetail[1].toLowerCase() === missingActivity) return send(null, 404, '活动不存在');
  if (activityDetail && req.method === 'GET') return send({ id: activityDetail[1], title: '合成活动', activity_date: '2026-10-13', timezone: 'Asia/Shanghai', started_at: '2026-10-13T00:00:00Z', ended_at: '2026-10-13T00:30:00Z', distance_m: '1000', elapsed_seconds: '600', avg_pace_seconds_per_km: '600', temporal_quality: 'complete', visibility: 'public', allow_shared_route: false, quality_summary: {}, metrics_version: 'gpx-v1', has_route: false, created_at: '2026-10-13T01:00:00Z', notes: '', category: '', tags: [] });
  const publicActivity = url.pathname.match(/^\/api\/v1\/public\/activities\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  const publicSummary = { id: publicActivity?.[1] ?? '11111111-1111-4111-8111-111111111111', title: '合成分享', activity_date: '2026-10-13', distance_m: '1000', elapsed_seconds: 600, avg_pace_seconds_per_km: 600, author: { username: 'runner', display_name: '晨跑者' }, has_shared_route: false };
  if (publicActivity && req.method === 'GET' && publicActivity[1].toLowerCase() === missingActivity) return send(null, 404, '分享不存在');
  if (publicActivity && req.method === 'GET') return send(publicSummary);
  if (url.pathname === '/api/v1/shared/synthetic-token' && req.method === 'GET') return send(publicSummary);
  return send(null, 404, '合成测试数据为空');
}).listen(Number(process.env.UI_API_PORT ?? 8191), '127.0.0.1');
