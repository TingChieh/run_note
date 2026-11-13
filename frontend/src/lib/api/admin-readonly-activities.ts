import {
  ActivityError,
  parseActivity,
  request,
  unwrapRoute,
  type Activity,
  type ActivityList,
  type Route,
} from '#lib/api/activities.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never {
  throw new ActivityError('活动服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE');
}
function path(userId: string): string {
  if (!uuid.test(userId)) throw new ActivityError('找不到用户', 404);
  return `/api/v1/admin/users/${userId}/activities`;
}
export async function readAdminActivities(
  userId: string,
  offset = 0,
  fetcher: typeof fetch = fetch,
): Promise<ActivityList> {
  const limit = 20;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) invalid();
  const value = await request(`${path(userId)}?limit=${limit}&offset=${offset}`, {}, fetcher);
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.total) ||
    Number(value.total) < 0 ||
    value.items.length > limit ||
    value.items.length > Number(value.total) ||
    value.limit !== limit ||
    value.offset !== offset
  )
    invalid();
  return { items: value.items.map(parseActivity), total: Number(value.total), limit, offset };
}
export async function readAdminActivity(userId: string, id: string, fetcher: typeof fetch = fetch): Promise<Activity> {
  if (!uuid.test(id)) throw new ActivityError('找不到这条活动', 404);
  const value = parseActivity(await request(`${path(userId)}/${id}`, {}, fetcher));
  if (value.id !== id || typeof value.notes !== 'string') invalid();
  return value;
}
export async function readAdminRoute(userId: string, id: string, fetcher: typeof fetch = fetch): Promise<Route> {
  if (!uuid.test(id)) throw new ActivityError('找不到这条活动', 404);
  return unwrapRoute(await request(`${path(userId)}/${id}/route`, {}, fetcher));
}
