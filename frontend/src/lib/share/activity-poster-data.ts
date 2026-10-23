import { ActivityError, activityDuration, formatDuration, readActivity, readRoute, type Activity, type Route } from '#lib/api/activities.ts';

export interface ActivityPosterData {
  title: string;
  date: string;
  weekday: string;
  kilometers: string;
  duration: string;
  pace: string;
  route: Route | null;
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const changed = () => new ActivityError('记录已变化，请重新生成分享图', 409, 'POSTER_DATA_CHANGED');
const metric = (value: unknown) => value === null || value === undefined ? null : Number(value);

export function posterPace(seconds: unknown): string {
  const value = metric(seconds);
  if (value === null || !Number.isFinite(value) || value <= 0) return '—';
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)}′${String(rounded % 60).padStart(2, '0')}″`;
}

export function activityPosterFields(activity: Activity): Omit<ActivityPosterData, 'route'> {
  const distance = metric(activity.distance_m);
  return {
    title: activity.title || '未命名活动',
    date: activity.activity_date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y} 年 ${Number(m)} 月 ${Number(d)} 日`),
    weekday: weekdays[new Date(`${activity.activity_date}T00:00:00Z`).getUTCDay()] ?? '',
    kilometers: distance === null || !Number.isFinite(distance) ? '—' : (distance / 1000).toFixed(2),
    duration: formatDuration(activityDuration(activity)),
    pace: posterPace(activity.avg_pace_seconds_per_km),
  };
}

const signature = (activity: Activity) =>
  JSON.stringify([activity.title, activity.distance_m, activityDuration(activity), activity.avg_pace_seconds_per_km, activity.has_route]);

/** Own data only: callers pass a fetcher bound to the authenticated own-data API. */
export async function loadActivityPoster({ id, withRoute, fetcher = fetch, cancelled = () => false }: {
  id: string; withRoute: boolean; fetcher?: typeof fetch; cancelled?: () => boolean;
}): Promise<ActivityPosterData> {
  const ensureActive = () => { if (cancelled()) throw new DOMException('已取消读取', 'AbortError'); };
  ensureActive();
  const activity = await readActivity(id, fetcher, true);
  ensureActive();
  let route: Route | null = null;
  if (withRoute) {
    if (!activity.has_route) throw new ActivityError('这条记录没有可用于分享的轨迹，请选择其他样式', 422, 'POSTER_NO_ROUTES');
    route = await readRoute(id, fetcher);
    ensureActive();
  }
  const final = await readActivity(id, fetcher, true);
  ensureActive();
  if (signature(final) !== signature(activity)) throw changed();
  return { ...activityPosterFields(activity), route };
}
