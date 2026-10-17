import { ActivityError, readActivities, readRoute } from '#lib/api/activities.ts';
import { readRange, type DateRange } from '#lib/api/milestones.ts';
import { routeDrawing } from '#lib/api/route-drawing.ts';
import { readSummary } from '#lib/api/statistics.ts';

export type PosterCell = ReturnType<typeof routeDrawing>;
export interface PosterData {
  month: string | undefined;
  routeCount: number;
  activityCount: number;
  activityDays: number;
  kilometers: string;
  halfMarathons: string;
  cells: PosterCell[];
}

export function posterMonthRange(month: string): DateRange {
  if (!/^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ActivityError('请选择 1900–2100 年的有效月份', 422);
  }
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  return { from: `${month}-01`, to: number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01` };
}

export function posterStats(distance: number) {
  return { kilometers: (distance / 1000).toFixed(1), halfMarathons: (distance / 21097.5).toFixed(1) };
}

/** Totals only (one request), enough for the route-free poster styles. */
export async function loadPosterSummary({ month, fetcher = fetch, cancelled = () => false }: {
  month?: string; fetcher?: typeof fetch; cancelled?: () => boolean;
}): Promise<PosterData> {
  const range = month === undefined ? undefined : posterMonthRange(month);
  if (cancelled()) throw new DOMException('已取消读取', 'AbortError');
  const summary = await (range ? readRange(range, fetcher) : readSummary(undefined, fetcher));
  if (cancelled()) throw new DOMException('已取消读取', 'AbortError');
  if (!summary.activity_count) throw new ActivityError('这个范围没有跑步记录，请选择其他范围', 422, 'POSTER_EMPTY');
  return { month, routeCount: 0, activityCount: summary.activity_count, activityDays: summary.activity_days,
    ...posterStats(Number(summary.distance_m)), cells: [] };
}

const changed = () => new ActivityError('记录已变化，请重新生成分享图', 409, 'POSTER_DATA_CHANGED');

export async function loadPoster({ month, fetcher = fetch, random = Math.random,
  cancelled = () => false, onprogress = () => {} }: {
  month?: string;
  random?: () => number;
  fetcher?: typeof fetch;
  cancelled?: () => boolean;
  onprogress?: (completed: number, total: number, phase: 'records' | 'routes') => void;
}): Promise<PosterData> {
  const range = month === undefined ? undefined : posterMonthRange(month);
  const ensureActive = () => { if (cancelled()) throw new DOMException('已取消生成', 'AbortError'); };
  const summary = () => range ? readRange(range, fetcher) : readSummary(undefined, fetcher);
  ensureActive();
  const initial = await summary();
  ensureActive();
  if (!initial.activity_count) throw new ActivityError('这个范围没有跑步记录，请选择其他范围', 422, 'POSTER_EMPTY');
  const sampled: string[] = [], ids = new Set<string>();
  let offset = 0, routeCount = 0;
  // Reservoir sampling gives every eligible route the same chance, across all list pages.
  while (offset < initial.activity_count) {
    ensureActive();
    if (offset > 1000000) throw new ActivityError('记录超出当前查询范围，请按月份生成分享图', 422);
    const limit = Math.min(100, initial.activity_count - offset);
    const result = await readActivities(fetcher, offset, undefined, undefined, month, limit);
    ensureActive();
    if (result.total !== initial.activity_count || result.items.length !== limit) throw changed();
    for (const item of result.items) {
      if (ids.has(item.id) || month && !item.activity_date.startsWith(`${month}-`)) throw changed();
      ids.add(item.id);
      if (!item.has_route) continue;
      routeCount++;
      if (sampled.length < 120) sampled.push(item.id);
      else {
        const index = Math.floor(random() * routeCount);
        if (index < 120) sampled[index] = item.id;
      }
    }
    offset += result.items.length;
    onprogress(offset, initial.activity_count, 'records');
  }
  ensureActive();
  if (!sampled.length) throw new ActivityError('这个范围没有可用于分享的轨迹，请选择其他范围', 422, 'POSTER_NO_ROUTES');
  // Mix the visual order as well, including when all eligible records fit on one image.
  for (let i = sampled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [sampled[i], sampled[j]] = [sampled[j], sampled[i]];
  }
  const cells: PosterCell[] = Array(sampled.length);
  let cursor = 0, completed = 0, failed = false;
  const workers = Array.from({ length: Math.min(4, sampled.length) }, async () => {
    while (!failed) {
      ensureActive();
      const index = cursor++;
      if (index >= sampled.length) return;
      try {
        const route = await readRoute(sampled[index], fetcher);
        ensureActive();
        cells[index] = routeDrawing(route);
        onprogress(++completed, sampled.length, 'routes');
      } catch (cause) { failed = true; throw cause; }
    }
  });
  const results = await Promise.allSettled(workers);
  ensureActive();
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  // Authentication errors take precedence over a sibling route failure.
  const auth = errors.find(result => result.reason instanceof ActivityError && result.reason.status === 401);
  if (auth) throw auth.reason;
  if (errors.length) throw errors[0].reason;
  const final = await summary();
  ensureActive();
  if (final.activity_count !== initial.activity_count || final.activity_days !== initial.activity_days ||
      Number(final.distance_m) !== Number(initial.distance_m)) throw changed();
  return { month, routeCount,
    activityCount: initial.activity_count, activityDays: initial.activity_days,
    ...posterStats(Number(initial.distance_m)), cells };
}
