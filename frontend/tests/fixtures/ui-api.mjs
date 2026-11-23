// Browser UI contract fixture: no database, no production auth bypass.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createWellbeing } from './ui-wellbeing.mjs';
import { createShoes } from './ui-shoes.mjs';
import { createAIAssistant } from './ui-ai-assistant.mjs';
/** @type {Record<string, any>} */
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'runner.with.a.long.email.address@example.com', username: 'runner', username_changed_at: null, display_name: '晨跑者', timezone: 'Asia/Shanghai', created_at: '2026-01-01T00:00:00Z', bio: '', profile_is_public: false, is_admin: true, is_active: true, showcase_enabled: true, together_allowed: false, together_enabled: false, wellbeing_allowed: true, wellbeing_enabled: true };
/** @type {Record<string, any>[]} */
const accounts = [{ ...user, password: 'Synthetic-ui-password-2026' }];
const sessions = new Map([['ui-runner', user.id]]);
/** @param {Record<string, unknown>} account */
const clean = account => Object.fromEntries(Object.entries(account).filter(([key]) => key !== 'password'));
const summary = { activity_count: 0, distance_m: 0, duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: 0, activity_days: 0, pace_eligible_count: 0, pace_eligible_distance_m: 0, avg_pace_seconds_per_km: null, quality_warning_count: 0, date_assignment: 'activity_local_date' };
/** @type {Record<string, number | null>} */
const goals = {week:null,month:null,year:null};
// Private wellbeing journal (synthetic, in memory); cleared whenever the owner signs in so each test starts empty.
const wellbeing = createWellbeing(() => user);
const shoes = createShoes(user.id);
const aiAssistant = createAIAssistant();
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
/**
 * Deterministic monthly/yearly period report fixture mirroring backend half-open and cutoff rules.
 * @param {string | null} period
 * @param {number} year
 * @param {number | null} month
 * @param {boolean} empty
 */
function reportFixture(period, year, month, empty) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: user.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const nextDay = (/** @type {string} */ iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const start = period === 'month' ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
  const end = period === 'year' ? `${year + 1}-01-01` : month === 12 ? `${year + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;
  const isFuture = start > today;
  const isPartial = !isFuture && start <= today && today < end;
  const tomorrow = nextDay(today);
  const dateFrom = start;
  const dateTo = isFuture ? start : isPartial ? (tomorrow < end ? tomorrow : end) : end;
  const cutoffDate = isPartial ? today : null;
  const base = { period, year, month: period === 'month' ? month : null, date_from: dateFrom, date_to: dateTo, is_partial: isPartial, cutoff_date: cutoffDate, today };
  if (empty || isFuture) return { ...summary, ...base };
  // Exact 2024 sample from backend test_statistics.py (Jan: 3/6km/1500s/375; Feb leap: 1/0km/0s/null; 2024: 4/6km/1500s/375).
  if (period === 'month' && year === 2024 && month === 1) {
    return { ...summary, ...base, activity_count: 3, distance_m: '6000.000', activity_days: 2, duration_sum_seconds: '1500.000', known_duration_count: 2, missing_duration_count: 1, pace_eligible_count: 2, pace_eligible_distance_m: '4000.000', avg_pace_seconds_per_km: '375.000', quality_warning_count: 1 };
  }
  if (period === 'month' && year === 2024 && month === 2) {
    return { ...summary, ...base, activity_count: 1, distance_m: '0.000', activity_days: 1, duration_sum_seconds: '0.000', known_duration_count: 1, missing_duration_count: 0, pace_eligible_count: 0, pace_eligible_distance_m: '0.000', avg_pace_seconds_per_km: null, quality_warning_count: 0 };
  }
  if (period === 'year' && year === 2024) {
    return { ...summary, ...base, activity_count: 4, distance_m: '6000.000', activity_days: 3, duration_sum_seconds: '1500.000', known_duration_count: 3, missing_duration_count: 1, pace_eligible_count: 2, pace_eligible_distance_m: '4000.000', avg_pace_seconds_per_km: '375.000', quality_warning_count: 1 };
  }
  if (period === 'month' && month !== null && year === 2025 && month >= 1 && month <= 12) {
    const distance = 10000 + (month - 1) * 1000;
    const pace = 372 - (month - 1) * 2;
    const duration = Math.round((distance / 1000) * pace);
    return { ...summary, ...base, activity_count: 2, distance_m: `${distance}.000`, activity_days: 2, duration_sum_seconds: `${duration}.000`, known_duration_count: 2, missing_duration_count: 0, pace_eligible_count: 2, pace_eligible_distance_m: `${distance}.000`, avg_pace_seconds_per_km: `${pace}.000`, quality_warning_count: 0 };
  }
  if (period === 'month' && month !== null && year >= 2026 && year === Number(today.slice(0, 4)) && month >= 1 && month <= Number(today.slice(5, 7))) {
    const idx = 12 + (month - 1);
    const distance = 10000 + idx * 1000;
    const pace = 372 - idx * 2;
    const duration = Math.round((distance / 1000) * pace);
    return { ...summary, ...base, activity_count: 2, distance_m: `${distance}.000`, activity_days: 2, duration_sum_seconds: `${duration}.000`, known_duration_count: 2, missing_duration_count: 0, pace_eligible_count: 2, pace_eligible_distance_m: `${distance}.000`, avg_pace_seconds_per_km: `${pace}.000`, quality_warning_count: 0 };
  }
  if (period === 'year' && year === 2025) {
    return { ...summary, ...base, activity_count: 24, distance_m: '186000.000', activity_days: 24, duration_sum_seconds: '66960.000', known_duration_count: 24, missing_duration_count: 0, pace_eligible_count: 24, pace_eligible_distance_m: '186000.000', avg_pace_seconds_per_km: '360.000', quality_warning_count: 0 };
  }
  if (period === 'year' && (year === 2026 || year === Number(today.slice(0, 4)))) {
    return { ...summary, ...base, activity_count: 20, distance_m: '265000.000', activity_days: 18, duration_sum_seconds: '88775.000', known_duration_count: 20, missing_duration_count: 0, pace_eligible_count: 20, pace_eligible_distance_m: '265000.000', avg_pace_seconds_per_km: '335.000', quality_warning_count: 0 };
  }
  return { ...summary, ...base };
}
/**
 * Deterministic synthetic Annual Story fixture (2025 full 3-city, 2026 partial single-city, 2024 trackless fallback, others empty).
 * @param {number} year
 */
function annualStoryFixture(year) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: user.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const nextDay = (/** @type {string} */ iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const isFuture = start > today;
  const isPartial = !isFuture && start <= today && today < end;
  const dateTo = isFuture ? start : isPartial ? (nextDay(today) < end ? nextDay(today) : end) : end;
  const base = {
    year,
    date_from: start,
    date_to: dateTo,
    is_partial: isPartial,
    cutoff_date: isPartial ? today : null,
    today,
    date_assignment: 'activity_local_date',
  };
  const emptyStory = {
    ...base,
    summary,
    longest_streak_days: 0,
    longest_streak_weeks: 0,
    first_run: null,
    longest_route: null,
    best_performance: null,
    explored_cities: { status: 'ready', total_cities: 0, new_cities_count: 0, total_regions: 0, located_activity_count: 0, unlocated_activity_count: 0, pending_activity_count: 0, items: [] },
    frequent_route: { status: 'none', group_id: null, name: null, city_name: null, run_count: 0, share_pct: 0, median_distance_m: null, first_date: null, last_date: null, first_pace_seconds_per_km: null, best_pace_seconds_per_km: null, avg_pace_seconds_per_km: null, pace_improvement_seconds_per_km: null, monthly_hits: Array(12).fill(0), shape: [], overlay_shapes: [] },
    footprint_timeline: { has_tracks: false, truncated: false, total_runs: 0, shown_runs: 0, monthly_distance_m: Array(12).fill('0.000'), monthly_activity_count: Array(12).fill(0), items: [] },
  };
  if (isFuture) return emptyStory;

  if (year === 2022) {
    const loop = [[120.10, 30.20], [120.12, 30.22], [120.14, 30.21]];
    return {
      ...base,
      summary: { ...summary, activity_count: 30, distance_m: '180000.000', activity_days: 28, duration_sum_seconds: '57600.000', known_duration_count: 30, missing_duration_count: 0, pace_eligible_count: 30, pace_eligible_distance_m: '180000.000', avg_pace_seconds_per_km: '320.000', quality_warning_count: 0 },
      longest_streak_days: 4,
      longest_streak_weeks: 6,
      first_run: { activity_id: '22000000-0000-4000-8000-000000000001', activity_date: '2022-01-01', timezone: 'America/New_York', started_at: '2022-01-01T12:30:00Z', title: '跨时区元旦晨跑', distance_m: '6000.000', duration_seconds: '1920.000', avg_pace_seconds_per_km: '320.000', city_name: null, shoe_name: null, has_track: true, shape: [loop] },
      longest_route: { activity_id: '22000000-0000-4000-8000-000000000030', activity_date: '2022-09-10', timezone: 'Asia/Shanghai', started_at: '2022-09-09T23:00:00Z', title: '秋日长距离', distance_m: '15000.000', duration_seconds: '4800.000', avg_pace_seconds_per_km: '320.000', city_name: null, shoe_name: null, has_track: true, shape: [loop], tied_count: 1, same_as_first: false },
      best_performance: { basis: 'standard_band', category: '10km', activity_id: '22000000-0000-4000-8000-000000000020', activity_date: '2022-07-08', timezone: 'Asia/Shanghai', started_at: '2022-07-07T23:00:00Z', title: '夏夜 10K', distance_m: '10000.000', duration_seconds: '3000.000', avg_pace_seconds_per_km: '300.000', city_name: null, has_track: true, shape: [loop], is_all_time_pb: false, pace_gain_seconds_per_km: null, other_bests: [] },
      explored_cities: { status: 'pending', total_cities: 0, new_cities_count: 0, total_regions: 0, located_activity_count: 0, unlocated_activity_count: 2, pending_activity_count: 28, items: [] },
      frequent_route: { status: 'building', group_id: null, name: null, city_name: null, run_count: 0, share_pct: 0, median_distance_m: null, first_date: null, last_date: null, first_pace_seconds_per_km: null, best_pace_seconds_per_km: null, avg_pace_seconds_per_km: null, pace_improvement_seconds_per_km: null, monthly_hits: Array(12).fill(0), shape: [], overlay_shapes: [] },
      footprint_timeline: {
        has_tracks: true,
        truncated: false,
        total_runs: 3,
        shown_runs: 3,
        monthly_distance_m: ['20000', '15000', '15000', '15000', '15000', '15000', '20000', '15000', '20000', '10000', '10000', '10000'],
        monthly_activity_count: [3, 2, 2, 3, 2, 3, 3, 2, 3, 3, 2, 2],
        items: [
          { activity_id: '22000000-0000-4000-8000-000000000001', activity_date: '2022-01-01', month: 1, title: '跨时区元旦晨跑', distance_m: '6000.000', cumulative_distance_m: '6000.000', avg_pace_seconds_per_km: '320.000', city_code: null, city_name: null, milestone: 'first', points: loop },
          { activity_id: '22000000-0000-4000-8000-000000000020', activity_date: '2022-07-08', month: 7, title: '夏夜 10K', distance_m: '10000.000', cumulative_distance_m: '115000.000', avg_pace_seconds_per_km: '300.000', city_code: null, city_name: null, milestone: 'best', points: loop },
          { activity_id: '22000000-0000-4000-8000-000000000030', activity_date: '2022-09-10', month: 9, title: '秋日长距离', distance_m: '15000.000', cumulative_distance_m: '180000.000', avg_pace_seconds_per_km: '320.000', city_code: null, city_name: null, milestone: 'longest', points: loop },
        ],
      },
    };
  }

  if (year === 2024) {
    return {
      ...base,
      summary: { ...summary, activity_count: 6, distance_m: '34200.000', activity_days: 6, duration_sum_seconds: '10800.000', known_duration_count: 5, missing_duration_count: 1, pace_eligible_count: 5, pace_eligible_distance_m: '29200.000', avg_pace_seconds_per_km: '370.000', quality_warning_count: 1 },
      longest_streak_days: 2,
      longest_streak_weeks: 3,
      first_run: { activity_id: '24000000-0000-4000-8000-000000000001', activity_date: '2024-03-10', timezone: 'Asia/Shanghai', started_at: '2024-03-10T12:15:00Z', title: '室内跑步机启程', distance_m: '4200.000', duration_seconds: '1596.000', avg_pace_seconds_per_km: '380.000', city_name: null, shoe_name: null, has_track: false, shape: [] },
      longest_route: { activity_id: '24000000-0000-4000-8000-000000000006', activity_date: '2024-11-09', timezone: 'Asia/Shanghai', started_at: '2024-11-09T11:00:00Z', title: '年度最长室内跑', distance_m: '8200.000', duration_seconds: '2952.000', avg_pace_seconds_per_km: '360.000', city_name: null, shoe_name: null, has_track: false, shape: [], tied_count: 1, same_as_first: false },
      best_performance: { basis: 'standard_band', category: '5km', activity_id: '24000000-0000-4000-8000-000000000005', activity_date: '2024-10-12', timezone: 'Asia/Shanghai', started_at: '2024-10-12T11:20:00Z', title: '室内 5K 提速', distance_m: '5100.000', duration_seconds: '1785.000', avg_pace_seconds_per_km: '350.000', city_name: null, has_track: false, shape: [], is_all_time_pb: false, pace_gain_seconds_per_km: '30.000', other_bests: [] },
      explored_cities: { status: 'ready', total_cities: 0, new_cities_count: 0, total_regions: 0, located_activity_count: 0, unlocated_activity_count: 6, pending_activity_count: 0, items: [] },
      frequent_route: emptyStory.frequent_route,
      footprint_timeline: {
        has_tracks: false,
        truncated: false,
        total_runs: 6,
        shown_runs: 6,
        monthly_distance_m: ['0', '0', '4200', '5000', '5500', '6200', '0', '0', '0', '5100', '8200', '0'],
        monthly_activity_count: [0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0],
        items: [
          { activity_id: '24000000-0000-4000-8000-000000000001', activity_date: '2024-03-10', month: 3, title: '室内跑步机启程', distance_m: '4200.000', cumulative_distance_m: '4200.000', avg_pace_seconds_per_km: '380.000', city_code: null, city_name: null, milestone: 'first', points: [] },
          { activity_id: '24000000-0000-4000-8000-000000000005', activity_date: '2024-10-12', month: 10, title: '室内 5K 提速', distance_m: '5100.000', cumulative_distance_m: '26000.000', avg_pace_seconds_per_km: '350.000', city_code: null, city_name: null, milestone: 'best', points: [] },
          { activity_id: '24000000-0000-4000-8000-000000000006', activity_date: '2024-11-09', month: 11, title: '年度最长室内跑', distance_m: '8200.000', cumulative_distance_m: '34200.000', avg_pace_seconds_per_km: '360.000', city_code: null, city_name: null, milestone: 'longest', points: [] },
        ],
      },
    };
  }

  const loopA = [[120.10, 30.20], [120.12, 30.22], [120.14, 30.21], [120.13, 30.19], [120.10, 30.20]];
  const loopB = [[120.101, 30.201], [120.121, 30.221], [120.141, 30.211], [120.131, 30.191], [120.101, 30.201]];
  const river = [[121.40, 31.18], [121.44, 31.22], [121.49, 31.25], [121.46, 31.19], [121.40, 31.18]];
  const coast = [[122.10, 29.85], [122.14, 29.88], [122.17, 29.86], [122.12, 29.83]];

  if (year === 2025) {
    return {
      ...base,
      summary: { ...summary, activity_count: 118, distance_m: '1042680.000', activity_days: 104, duration_sum_seconds: '329040.000', known_duration_count: 118, missing_duration_count: 0, pace_eligible_count: 118, pace_eligible_distance_m: '1042680.000', avg_pace_seconds_per_km: '316.000', quality_warning_count: 0 },
      longest_streak_days: 6,
      longest_streak_weeks: 19,
      first_run: { activity_id: '25000000-0000-4000-8000-000000000001', activity_date: '2025-01-01', timezone: 'Asia/Shanghai', started_at: '2024-12-31T23:12:00Z', title: '青岬海湾迎新慢跑', distance_m: '6240.000', duration_seconds: '2148.000', avg_pace_seconds_per_km: '344.000', city_name: '青岬市', shoe_name: '轻云 3 代', has_track: true, shape: [loopA] },
      longest_route: { activity_id: '25000000-0000-4000-8000-000000000090', activity_date: '2025-10-19', timezone: 'Asia/Shanghai', started_at: '2025-10-18T22:45:00Z', title: '桐溪秋日河滨半程挑战', distance_m: '21420.000', duration_seconds: '6492.000', avg_pace_seconds_per_km: '303.000', city_name: '桐溪市', shoe_name: '轻云 3 代', has_track: true, shape: [river], tied_count: 1, same_as_first: false },
      best_performance: {
        basis: 'standard_band',
        category: '10km',
        activity_id: '25000000-0000-4000-8000-000000000099',
        activity_date: '2025-11-08',
        timezone: 'Asia/Shanghai',
        started_at: '2025-11-07T23:05:00Z',
        title: '松风湖竞速 10K',
        distance_m: '10040.000',
        duration_seconds: '2658.000',
        avg_pace_seconds_per_km: '265.000',
        city_name: '青岬市',
        has_track: true,
        shape: [loopB],
        is_all_time_pb: true,
        pace_gain_seconds_per_km: '38.000',
        other_bests: [
          { category: '5km', activity_id: '25000000-0000-4000-8000-000000000080', activity_date: '2025-10-04', distance_m: '5020.000', duration_seconds: '1265.000', avg_pace_seconds_per_km: '252.000' },
          { category: '半马', activity_id: '25000000-0000-4000-8000-000000000090', activity_date: '2025-10-19', distance_m: '21420.000', duration_seconds: '6492.000', avg_pace_seconds_per_km: '303.000' },
        ],
      },
      explored_cities: {
        status: 'ready',
        total_cities: 3,
        new_cities_count: 2,
        total_regions: 2,
        located_activity_count: 115,
        unlocated_activity_count: 3,
        pending_activity_count: 0,
        items: [
          { code: 'C-QINGJIA', name: '青岬市', region_name: '岚海州', is_new: false, first_date: '2025-01-01', last_date: '2025-12-28', activity_count: 86, distance_m: '746880.000', lon: 120.12, lat: 30.21 },
          { code: 'C-TONGXI', name: '桐溪市', region_name: '云岭州', is_new: true, first_date: '2025-04-05', last_date: '2025-10-19', activity_count: 20, distance_m: '212400.000', lon: 121.45, lat: 31.22 },
          { code: 'C-BAISHA', name: '白沙洲', region_name: '晴澜州', is_new: true, first_date: '2025-09-14', last_date: '2025-09-21', activity_count: 9, distance_m: '83400.000', lon: 122.14, lat: 29.86 },
        ],
      },
      frequent_route: {
        status: 'ready',
        group_id: '25000000-0000-4000-8000-000000000777',
        name: '松风湖环湖 6K 绿道',
        city_name: '青岬市',
        run_count: 29,
        share_pct: 25,
        median_distance_m: '6120.000',
        first_date: '2025-01-11',
        last_date: '2025-12-22',
        first_pace_seconds_per_km: '339.000',
        best_pace_seconds_per_km: '289.000',
        avg_pace_seconds_per_km: '312.000',
        pace_improvement_seconds_per_km: '50.000',
        monthly_hits: [2, 2, 3, 2, 3, 2, 2, 2, 3, 3, 3, 2],
        shape: [loopA],
        overlay_shapes: [[loopA], [loopB]],
      },
      footprint_timeline: {
        has_tracks: true,
        truncated: false,
        total_runs: 6,
        shown_runs: 6,
        monthly_distance_m: ['72400', '64800', '88200', '96500', '91000', '76400', '84600', '94200', '89500', '124800', '93100', '67180'],
        monthly_activity_count: [9, 8, 10, 11, 10, 9, 10, 11, 10, 12, 10, 8],
        items: [
          { activity_id: '25000000-0000-4000-8000-000000000001', activity_date: '2025-01-01', month: 1, title: '青岬海湾迎新慢跑', distance_m: '6240.000', cumulative_distance_m: '6240.000', avg_pace_seconds_per_km: '344.000', city_code: 'C-QINGJIA', city_name: '青岬市', milestone: 'first', points: loopA },
          { activity_id: '25000000-0000-4000-8000-000000000020', activity_date: '2025-04-05', month: 4, title: '桐溪古桥春晨跑', distance_m: '8450.000', cumulative_distance_m: '312000.000', avg_pace_seconds_per_km: '325.000', city_code: 'C-TONGXI', city_name: '桐溪市', milestone: 'new_city', points: river },
          { activity_id: '25000000-0000-4000-8000-000000000050', activity_date: '2025-07-12', month: 7, title: '松风湖环湖 6K 绿道', distance_m: '6120.000', cumulative_distance_m: '582000.000', avg_pace_seconds_per_km: '310.000', city_code: 'C-QINGJIA', city_name: '青岬市', milestone: 'frequent', points: loopB },
          { activity_id: '25000000-0000-4000-8000-000000000070', activity_date: '2025-09-14', month: 9, title: '白沙洲落日跨海道', distance_m: '8860.000', cumulative_distance_m: '758000.000', avg_pace_seconds_per_km: '318.000', city_code: 'C-BAISHA', city_name: '白沙洲', milestone: 'new_city', points: coast },
          { activity_id: '25000000-0000-4000-8000-000000000090', activity_date: '2025-10-19', month: 10, title: '桐溪秋日河滨半程挑战', distance_m: '21420.000', cumulative_distance_m: '912000.000', avg_pace_seconds_per_km: '303.000', city_code: 'C-TONGXI', city_name: '桐溪市', milestone: 'longest', points: river },
          { activity_id: '25000000-0000-4000-8000-000000000099', activity_date: '2025-11-08', month: 11, title: '松风湖竞速 10K', distance_m: '10040.000', cumulative_distance_m: '1042680.000', avg_pace_seconds_per_km: '265.000', city_code: 'C-QINGJIA', city_name: '青岬市', milestone: 'best', points: loopB },
        ],
      },
    };
  }

  if (year === 2026 || year === Number(today.slice(0, 4))) {
    return {
      ...base,
      summary: { ...summary, activity_count: 76, distance_m: '684500.000', activity_days: 70, duration_sum_seconds: '210900.000', known_duration_count: 73, missing_duration_count: 3, pace_eligible_count: 73, pace_eligible_distance_m: '660000.000', avg_pace_seconds_per_km: '311.000', quality_warning_count: 3 },
      longest_streak_days: 5,
      longest_streak_weeks: 14,
      first_run: { activity_id: '26000000-0000-4000-8000-000000000001', activity_date: `${year}-01-03`, timezone: 'Asia/Shanghai', started_at: `${year}-01-02T23:25:00Z`, title: '青岬冬日启程跑', distance_m: '5120.000', duration_seconds: '1715.000', avg_pace_seconds_per_km: '335.000', city_name: '青岬市', shoe_name: '疾风 2', has_track: true, shape: [loopA] },
      longest_route: { activity_id: '26000000-0000-4000-8000-000000000050', activity_date: `${year}-09-26`, timezone: 'Asia/Shanghai', started_at: `${year}-09-25T22:38:00Z`, title: '岚海西岸长距离拉练', distance_m: '16480.000', duration_seconds: '5191.000', avg_pace_seconds_per_km: '315.000', city_name: '青岬市', shoe_name: '疾风 2', has_track: true, shape: [loopB], tied_count: 1, same_as_first: false },
      best_performance: { basis: 'standard_band', category: '5km', activity_id: '26000000-0000-4000-8000-000000000060', activity_date: `${year}-10-18`, timezone: 'Asia/Shanghai', started_at: `${year}-10-17T23:10:00Z`, title: '北岸 5K 节奏测试', distance_m: '5060.000', duration_seconds: '1255.000', avg_pace_seconds_per_km: '248.000', city_name: '青岬市', has_track: true, shape: [loopA], is_all_time_pb: false, pace_gain_seconds_per_km: '24.000', other_bests: [] },
      explored_cities: {
        status: 'pending',
        total_cities: 1,
        new_cities_count: 0,
        total_regions: 1,
        located_activity_count: 46,
        unlocated_activity_count: 2,
        pending_activity_count: 28,
        items: [{ code: 'C-QINGJIA', name: '青岬市', region_name: '岚海州', is_new: false, first_date: `${year}-01-03`, last_date: `${year}-11-15`, activity_count: 74, distance_m: '672100.000', lon: 120.12, lat: 30.21 }],
      },
      frequent_route: { status: 'building', group_id: null, name: null, city_name: null, run_count: 0, share_pct: 0, median_distance_m: null, first_date: null, last_date: null, first_pace_seconds_per_km: null, best_pace_seconds_per_km: null, avg_pace_seconds_per_km: null, pace_improvement_seconds_per_km: null, monthly_hits: Array(12).fill(0), shape: [], overlay_shapes: [] },
      footprint_timeline: {
        has_tracks: true,
        truncated: false,
        total_runs: 3,
        shown_runs: 3,
        monthly_distance_m: ['56200', '49000', '62400', '71800', '65000', '52100', '61500', '64200', '78600', '76400', '47300', '0'],
        monthly_activity_count: [7, 6, 7, 8, 7, 6, 7, 7, 8, 8, 5, 0],
        items: [
          { activity_id: '26000000-0000-4000-8000-000000000001', activity_date: `${year}-01-03`, month: 1, title: '青岬冬日启程跑', distance_m: '5120.000', cumulative_distance_m: '5120.000', avg_pace_seconds_per_km: '335.000', city_code: 'C-QINGJIA', city_name: '青岬市', milestone: 'first', points: loopA },
          { activity_id: '26000000-0000-4000-8000-000000000050', activity_date: `${year}-09-26`, month: 9, title: '岚海西岸长距离拉练', distance_m: '16480.000', cumulative_distance_m: '520000.000', avg_pace_seconds_per_km: '315.000', city_code: 'C-QINGJIA', city_name: '青岬市', milestone: 'longest', points: loopB },
          { activity_id: '26000000-0000-4000-8000-000000000060', activity_date: `${year}-10-18`, month: 10, title: '北岸 5K 节奏测试', distance_m: '5060.000', cumulative_distance_m: '684500.000', avg_pace_seconds_per_km: '248.000', city_code: 'C-QINGJIA', city_name: '青岬市', milestone: 'best', points: loopA },
        ],
      },
    };
  }
  return emptyStory;
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
  const send = (data, status = 200, message = '会话已过期', code = 'UI_FIXTURE') => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ data, error: status >= 400 ? { code, message } : null })); };
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
    if (found.is_admin) { Object.assign(user, {display_name:'晨跑者',bio:'',profile_is_public:false,together_allowed: false, together_enabled: false, wellbeing_allowed:true,wellbeing_enabled:true}); Object.assign(found,user); Object.assign(goals,{week:null,month:null,year:null}); wellbeing.reset(); shoes.reset(); aiAssistant.reset(); }
    const session = found.is_admin ? 'ui-runner' : randomUUID(); sessions.set(session, found.id);
    res.setHeader('Set-Cookie', `run_session=${session}; Path=/; HttpOnly; SameSite=Lax`); return send({ user: clean(found) });
  }
  if (url.pathname.endsWith('/auth/logout')) { sessions.delete(token); res.setHeader('Set-Cookie', 'run_session=; Path=/; Max-Age=0'); return send({ logged_out: true }); }
  if (url.pathname.endsWith('/auth/session')) return signedIn ? send({ user: current.is_admin ? user : clean(current) }) : send(null, 401);
  if (!showcase && await shoes.handle(req, url, send, current && { id: current.id, is_active: current.is_active })) return;
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
  if (url.pathname === '/api/v1/admin/version' && req.method === 'GET') {
    if (!signedIn) return send(null,401);
    if (!current.is_admin) return send(null,403,'仅站主可管理账号');
    return send({ version: '1.0.0', build: { release_id: '20261119163755-2d1d6c553e57', git_sha: '2d1d6c553e57', built_at: '2026-11-19T16:37:55Z' } });
  }
  if (url.pathname.startsWith('/api/v1/admin/users')) {
    if (!signedIn) return send(null,401);
    if (!current.is_admin) return send(null,403,'仅站主可管理用户');
    if (req.method === 'GET') {
      const match = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)(?:\/activities(?:\/([^/]+)(\/route)?)?)?$/);
      if (match) {
        const account = accounts.find(item => item.id === match[1]);
        if (!account) return send(null,404,'用户不存在');
        if (!url.pathname.includes('/activities')) return send(clean(account));
        const item = {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'合成河畔晨跑',notes:'合成备注',activity_date:'2026-10-13',timezone:'UTC',started_at:'2026-10-13T08:00:00Z',ended_at:null,distance_m:'1000',elapsed_seconds:'600',avg_pace_seconds_per_km:'600',avg_heart_rate_bpm:148,calories_kcal:120,steps:1800,temporal_quality:'manual',visibility:'private',allow_shared_route:false,quality_summary:{valid_point_count:2},metrics_version:'synthetic',has_route:true,created_at:'2026-10-13T00:00:00Z'};
        const items = account.username.startsWith('readonly_') ? [item, {...item,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'合成长跑',has_route:false}] : [];
        if (!match[2]) { const limit = Number(url.searchParams.get('limit') ?? 20), offset = Number(url.searchParams.get('offset') ?? 0); return send({items:items.slice(offset,offset+limit),total:items.length,limit,offset}); }
        const activity = items.find(row => row.id === match[2]);
        if (!activity) return send(null,404,'记录不存在');
        if (match[3]) return send({type:'FeatureCollection',start:[0,0],end:[0.01,0.01],features:[{type:'Feature',geometry:{type:'LineString',coordinates:[[0,0],[0.01,0.01]]},properties:{segment_index:0,point_count:2}}]});
        return send(activity);
      }
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
      const account = {...payload,id:randomUUID(),email:payload.email.toLowerCase(),bio:'',profile_is_public:false,is_admin:false,together_allowed: false, together_enabled: false, wellbeing_allowed:true,wellbeing_enabled:true,created_at:'2026-10-16T00:00:00Z'};
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
      if ('together_allowed' in payload) account.together_enabled = payload.together_allowed;
      if (!account.is_active) { account.showcase_enabled=false; revoke(); }
      if (account.is_admin) Object.assign(user,clean(account));
      return send(clean(account));
    }
    return send(null,405,'不支持的请求');
  }
  if (url.pathname === '/api/v1/admin/activities/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/owner') {
    if (!signedIn) return send(null,401);
    if (!current.is_admin) return send(null,403,'仅站主可管理用户');
    const account = accounts.findLast(item => item.username.startsWith('readonly_'));
    return account ? send({user_id:account.id}) : send(null,404,'记录不存在');
  }
  if (url.pathname === '/api/v1/together' && req.method === 'GET') return send({distance_m:0,count:0,participants:[],recent:[],tracks:[],next_cursor:null,tracks_truncated:false});
  const publicRead = req.method === 'GET' && (url.pathname.startsWith('/api/v1/public/') || url.pathname.startsWith('/api/v1/shared/'));
  if (!signedIn && !showcase && !publicRead) return send(null, 401);
  if (signedIn && req.method === 'GET' && /^\/api\/v1\/me\/activities\/[^/]+\/diary$/.test(url.pathname)) {
    return send({ diary: null });
  }
  if (url.pathname === '/api/v1/me' && req.method === 'GET') return send(current?.is_admin ? user : clean(current ?? user));
  if (url.pathname === '/api/v1/me/username' && req.method === 'PATCH') {
    if (!current) return send(null,401);
    if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'请求校验失败');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (!/^[a-z0-9_]{3,30}$/.test(payload.username)) return send(null,422,'用户名格式不合法');
    if (accounts.some(account => account.id !== current.id && account.username === payload.username)) return send(null,409,'用户名已被注册');
    if (payload.username !== current.username) { current.username = payload.username; current.username_changed_at = new Date().toISOString(); if (current.is_admin) Object.assign(user, clean(current)); }
    return send(current.is_admin ? user : clean(current));
  }
  if (url.pathname === '/api/v1/me/password' && req.method === 'PATCH') {
    if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null,403,'请求校验失败');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (!current || payload.current_password !== current.password) return send(null,400,'当前密码不正确');
    current.password = payload.new_password;
    for (const [key,id] of sessions) if (id === current.id) sessions.delete(key);
    return send({password_changed:true});
  }
  if (url.pathname.startsWith('/api/v1/me/wellbeing')) return !signedIn ? send(null, 401) : !current.wellbeing_allowed || !current.wellbeing_enabled ? send(null, 404) : wellbeing.handle(req, url, res);
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
    const value = JSON.parse(body); if ('together_enabled' in value) value.together_allowed = value.together_enabled; Object.assign(current ?? user, value);
    if (current?.is_admin) Object.assign(user,clean(current));
    return send(clean(current ?? user));
  }
  if (url.pathname.startsWith('/api/v1/ai-assistant/')) return !signedIn || showcase ? send(null, 401) : aiAssistant.handle(req, url, res, current.id, send);
  if (url.pathname === '/api/v1/activities/categories') return send([]);
  if (url.pathname === '/api/v1/activities') return send({ items: [], total: 0, limit: Number(url.searchParams.get('limit') ?? 20), offset: Number(url.searchParams.get('offset') ?? 0) });
  if (url.pathname === '/api/v1/footprints/all') return send({status:'ready',generated_at:'2026-10-15T00:00:00Z',refreshing:false,result:{scope:'all',type:'FeatureCollection',features:[],mode:url.searchParams.get('mode')??'tracks',activity_count:0,visible_activity_count:0,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0}});
  if (url.pathname === '/api/v1/footprints/provinces') return send({ year:url.searchParams.has('year')?Number(url.searchParams.get('year')):null,total:34,provinces:[],activity_count:0,located_activity_count:0 });
  if (url.pathname === '/api/v1/footprints/global') return send({ year:url.searchParams.has('year')?Number(url.searchParams.get('year')):null,activity_count:0,located_activity_count:0,region_count:0,city_count:0,countries:[],region_features:{type:'FeatureCollection',features:[]} });
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
    const period = url.searchParams.get('period');
    const result = { period, date_from: from, date_to: to, week_start: 'monday', date_assignment: 'activity_local_date', buckets: [] };
    if (showcase) return send({ ...result, buckets: [{ ...summary, bucket_start: from, bucket_end: to, is_partial: true }] });
    if (!signedIn) return send(null, 401);
    if (!from || !to || (period !== 'week' && period !== 'month')) return send(null, 422, '趋势查询参数不合法');
    const start = new Date(`${from}T00:00:00Z`);
    const year = start.getUTCFullYear(), month = start.getUTCMonth() + 1;
    const report = reportFixture(period === 'month' ? 'year' : 'month', year, period === 'month' ? null : month, false);
    /** @type {Record<string, any>[]} */
    const buckets = [];
    for (let cursor = from; cursor < to; ) {
      const date = new Date(`${cursor}T00:00:00Z`);
      const weekday = (date.getUTCDay() + 6) % 7;
      const boundary = (period === 'week' ? new Date(+date + (7 - weekday) * 86400000) :
        new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))).toISOString().slice(0, 10);
      const end = boundary < to ? boundary : to;
      buckets.push({ ...summary, bucket_start: cursor, bucket_end: end, is_partial: end !== boundary || (period === 'week' && weekday !== 0) });
      cursor = end;
    }
    const weights = buckets.map((_, i) => [4, 6, 8, 7, 10, 6, 5, 8, 9, 12, 7, 8][i]);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    let remainingDistance = Number(report.distance_m);
    let remainingCount = report.activity_count;
    let remainingDays = report.activity_days;
    let remainingKnown = report.known_duration_count;
    let remainingMissing = report.missing_duration_count;
    let remainingPaceEligible = report.pace_eligible_count;
    const basePace = report.avg_pace_seconds_per_km === null ? null : Number(report.avg_pace_seconds_per_km);
    const paceOffsets = [14, 10, 5, 2, -2, -5, 4, -4, -7, -12, -3, 8];
    buckets.forEach((bucket, i) => {
      const isLast = i === buckets.length - 1;
      const dist = isLast ? remainingDistance : Math.round(Number(report.distance_m) * weights[i] / weightTotal);
      remainingDistance -= dist;
      const count = isLast ? remainingCount : Math.min(remainingCount, Math.max(report.activity_count > 0 ? 1 : 0, Math.round(report.activity_count * weights[i] / weightTotal)));
      remainingCount -= count;
      const days = isLast ? Math.min(count, remainingDays) : Math.min(count, remainingDays, Math.max(count > 0 ? 1 : 0, Math.round(report.activity_days * weights[i] / weightTotal)));
      remainingDays -= days;
      const missing = isLast ? Math.min(count, remainingMissing) : Math.min(count, remainingMissing);
      remainingMissing -= missing;
      const known = Math.min(count - missing, remainingKnown);
      remainingKnown -= known;
      const paceCount = isLast ? Math.min(known, remainingPaceEligible) : Math.min(known, remainingPaceEligible);
      remainingPaceEligible -= paceCount;
      const bucketPace = basePace !== null && paceCount > 0 && dist > 0 ? Math.max(240, basePace + paceOffsets[i % paceOffsets.length]) : null;
      bucket.distance_m = dist;
      bucket.activity_count = count;
      bucket.activity_days = days;
      bucket.known_duration_count = known;
      bucket.missing_duration_count = count - known;
      bucket.duration_sum_seconds = known === 0 ? null : dist > 0 && bucketPace !== null ? Math.round((dist / 1000) * bucketPace) : 0;
      bucket.pace_eligible_count = bucketPace !== null ? paceCount : 0;
      bucket.pace_eligible_distance_m = bucketPace !== null ? dist : 0;
      bucket.avg_pace_seconds_per_km = bucketPace;
    });
    return send({ ...result, buckets });
  }
  if (url.pathname.endsWith('/statistics/records')) return send(recordsFixture(url.searchParams.get('empty') === '1'));
  if (url.pathname.endsWith('/statistics/report')) {
    if (showcase) return send(null, 404, '接口不存在');
    if (!signedIn) return send(null, 401);
    const period = url.searchParams.get('period');
    const year = Number(url.searchParams.get('year'));
    const monthParam = url.searchParams.get('month');
    const month = monthParam === null ? null : Number(monthParam);
    if ((period !== 'month' && period !== 'year') || !Number.isInteger(year) || year < 1900 || year > 2100) return send(null, 422, '报告查询参数不合法');
    if (period === 'month' && (!Number.isInteger(month) || Number(month) < 1 || Number(month) > 12)) return send(null, 422, '月度报告需要提供 1–12 的月份');
    if (period === 'year' && month !== null) return send(null, 422, '年度报告不支持月份参数');
    return send(reportFixture(period, year, month, url.searchParams.get('empty') === '1'));
  }
  if (url.pathname.endsWith('/statistics/annual-story')) {
    if (showcase) return send(null, 404, '接口不存在');
    if (!signedIn) return send(null, 401);
    const keys = [...url.searchParams.keys()];
    const year = Number(url.searchParams.get('year'));
    if (keys.some((k) => k !== 'year') || url.searchParams.getAll('year').length !== 1 || !Number.isInteger(year) || year < 1900 || year > 2100) {
      return send(null, 422, '年度故事查询包含不支持的参数');
    }
    return send(annualStoryFixture(year));
  }
  const missingActivity = '00000000-0000-4000-8000-000000000404';
  const activityDetail = url.pathname.match(/^\/api\/v1\/activities\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (activityDetail && !showcase && activityDetail[1] === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') return send(null,404,'活动不存在');
  if (activityDetail && req.method === 'GET' && activityDetail[1].toLowerCase() === missingActivity) return send(null, 404, '活动不存在');
  if (activityDetail && req.method === 'GET') return send({ id: activityDetail[1], title: '合成活动', activity_date: '2026-10-13', timezone: 'Asia/Shanghai', started_at: '2026-10-13T00:00:00Z', ended_at: '2026-10-13T00:30:00Z', distance_m: '1000', elapsed_seconds: '600', avg_pace_seconds_per_km: '600', temporal_quality: 'complete', visibility: 'public', allow_shared_route: false, quality_summary: {}, metrics_version: 'gpx-v1', has_route: false, created_at: '2026-10-13T01:00:00Z', notes: '', category: '', tags: [] });
  const publicActivity = url.pathname.match(/^\/api\/v1\/public\/activities\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  const publicSummary = { id: publicActivity?.[1] ?? '11111111-1111-4111-8111-111111111111', title: '合成分享', activity_date: '2026-10-13', distance_m: '1000', elapsed_seconds: 600, avg_pace_seconds_per_km: 600, author: { username: 'runner', display_name: '晨跑者' }, has_shared_route: false };
  if (publicActivity && req.method === 'GET' && publicActivity[1].toLowerCase() === missingActivity) return send(null, 404, '分享不存在');
  if (publicActivity && req.method === 'GET') return send(publicSummary);
  if (url.pathname === '/api/v1/shared/synthetic-token' && req.method === 'GET') return send(publicSummary);
  return send(null, 404, '合成测试数据为空');
}).listen(Number(process.env.UI_API_PORT ?? 8191), '127.0.0.1');
