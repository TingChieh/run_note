import type { AnnualStory, LonLat, StoryMilestone } from '#lib/api/annual-story.ts';
import { formatDuration, formatPace, type Metric } from '#lib/api/activities.ts';

export type StoryChapterId = 'first' | 'longest' | 'best' | 'cities' | 'frequent';

const MARATHON_M = 42195;

export function storyHref(year: number): string {
  return `/workspace/records/story?year=${year}`;
}

export function storyYearSelection(params: Pick<URLSearchParams, 'get'>, fallbackYear: number): number {
  const raw = params.get('year') ?? '';
  if (/^(19\d{2}|20\d{2}|2100)$/.test(raw)) return Number(raw);
  return Math.min(2100, Math.max(1900, fallbackYear));
}

export function storyTitle(year: number): string {
  return `${year} 跑步年度故事`;
}

export function storyFilename(year: number, theme: 'light' | 'dark'): string {
  return `runnote-annual-story-${year}-${theme}.png`;
}

export function storyKm(metres: Metric, digits = 2): string {
  if (metres === null || metres === undefined) return '—';
  const val = Number(metres);
  if (!Number.isFinite(val)) return '—';
  return (val / 1000).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function storyShortDate(iso: string): string {
  return iso.slice(5).replace('-', '.');
}

export function storyMonthDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

export function storyRangeText(
  story: Pick<AnnualStory, 'date_from' | 'date_to' | 'is_partial' | 'cutoff_date'>,
): string {
  if (story.date_from === story.date_to) return '尚未开始';
  const start = story.date_from.replaceAll('-', '.');
  if (story.is_partial && story.cutoff_date) {
    return `${start} — ${story.cutoff_date.replaceAll('-', '.')}`;
  }
  const endDate = new Date(Date.parse(`${story.date_to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return `${start} — ${endDate.replaceAll('-', '.')}`;
}

export function storyDurationHours(seconds: Metric): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total < 0) return '—';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

export function storyLocalClock(startedAt: string | null, timezone: string): string {
  if (!startedAt) return '';
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '';
  }
}

export function storyCoverage(story: AnnualStory): string {
  const notes: string[] = [];
  const { summary, explored_cities, frequent_route, footprint_timeline } = story;
  if (summary.missing_duration_count > 0) {
    notes.push(`用时覆盖 ${summary.known_duration_count}/${summary.activity_count} 次`);
  }
  if (summary.pace_eligible_count < summary.activity_count) {
    notes.push(`配速覆盖 ${summary.pace_eligible_count}/${summary.activity_count} 次`);
  }
  if (!footprint_timeline.has_tracks && summary.activity_count > 0) {
    notes.push('无户外 GPS 轨迹，自动启用节律脉冲回放');
  } else if (footprint_timeline.truncated) {
    notes.push(`足迹动画精选 ${footprint_timeline.shown_runs}/${footprint_timeline.total_runs} 次（保留全部里程碑）`);
  }
  if (explored_cities.status === 'pending') {
    notes.push(
      explored_cities.pending_activity_count > 0
        ? `有 ${explored_cities.pending_activity_count} 条轨迹的城市统计仍在后台计算`
        : '部分城市统计仍在后台计算',
    );
  }
  if (frequent_route.status === 'building') {
    notes.push('常跑路线仍在后台归并');
  }
  return notes.join(' · ');
}

export function storyLeadSentence(story: AnnualStory): string {
  const { summary, first_run, explored_cities } = story;
  if (summary.activity_count === 0) return '';
  const distM = Number(summary.distance_m);
  const marathons = distM > 0 ? (distM / MARATHON_M).toFixed(1) : null;
  const startPhrase = first_run ? `从 ${storyMonthDay(first_run.activity_date)} 出发，` : '';
  if (explored_cities.status === 'pending') {
    if (explored_cities.total_cities > 0) {
      return `${startPhrase}已点亮 ${explored_cities.total_cities} 座城（部分轨迹仍在计算），累计奔跑 ${storyKm(summary.distance_m)} km（${summary.activity_count} 次）。`;
    }
    return `${startPhrase}共记录 ${summary.activity_count} 次奔跑、累计 ${storyKm(summary.distance_m)} km（城市足迹仍在计算）。`;
  }
  if (explored_cities.total_cities > 1) {
    return `${startPhrase}全年跑过 ${explored_cities.total_cities} 座城、累计 ${storyKm(summary.distance_m)} km${marathons ? `，相当于 ${marathons} 场全马` : ''}。`;
  }
  if (explored_cities.total_cities === 1) {
    const cityName = explored_cities.items[0].name;
    return `${startPhrase}这一年深耕${cityName}，累计奔跑 ${storyKm(summary.distance_m)} km（${summary.activity_count} 次）。`;
  }
  return `${startPhrase}共记录 ${summary.activity_count} 次奔跑、累计 ${storyKm(summary.distance_m)} km。`;
}

export function milestoneLabel(milestone: StoryMilestone | null): string {
  if (milestone === 'first') return '年度第一跑';
  if (milestone === 'longest') return '年度最长路线';
  if (milestone === 'best') return '年度最佳表现';
  if (milestone === 'new_city') return '点亮新城市';
  if (milestone === 'frequent') return '最常跑路线';
  return '';
}

export function formatGain(gainSeconds: Metric): string {
  if (gainSeconds === null || gainSeconds === undefined) return '';
  const sec = Math.round(Number(gainSeconds));
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒/km` : `${s}"/km`;
}

export function formatStoryPaceCompact(pace: Metric): string {
  if (pace === null || pace === undefined) return '—';
  return formatPace(pace).replace(/ \/km$/, '');
}

export function formatStoryDuration(seconds: Metric): string {
  return formatDuration(seconds);
}

export interface NormalizedBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  shiftAntimeridian: boolean;
}

/**
 * Compute an antimeridian-safe planar Mercator bounding box so tracks anywhere on Earth
 * (including across +-180 deg) normalize cleanly into an abstract offline canvas.
 */
export function computeGeoBounds(points: LonLat[]): NormalizedBounds | null {
  if (!points.length) return null;
  let rawMinX = Infinity;
  let rawMaxX = -Infinity;
  for (const [lon] of points) {
    if (lon < rawMinX) rawMinX = lon;
    if (lon > rawMaxX) rawMaxX = lon;
  }
  const shiftAntimeridian = rawMaxX - rawMinX > 180;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [lon, lat] of points) {
    const [x, y] = projectGeo(lon, lat, shiftAntimeridian);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  const spanX = Math.max(0.0005, maxX - minX);
  const spanY = Math.max(0.0005, maxY - minY);
  const padX = spanX * 0.14;
  const padY = spanY * 0.14;
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
    shiftAntimeridian,
  };
}

export function projectGeo(lon: number, lat: number, shiftAntimeridian = false): [number, number] {
  const adjLon = shiftAntimeridian && lon < 0 ? lon + 360 : lon;
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const mercY = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  // Flip Y so north is up on canvas.
  return [(adjLon * Math.PI) / 180, -mercY];
}

export function makeCanvasProjector(
  bounds: NormalizedBounds,
  width: number,
  height: number,
  padding = 34,
): (pt: LonLat) => [number, number] {
  const innerW = Math.max(32, width - padding * 2);
  const innerH = Math.max(32, height - padding * 2);
  const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offX = padding + (innerW - spanX * scale) / 2;
  const offY = padding + (innerH - spanY * scale) / 2;

  return ([lon, lat]) => {
    const [x, y] = projectGeo(lon, lat, bounds.shiftAntimeridian);
    return [offX + (x - bounds.minX) * scale, offY + (y - bounds.minY) * scale];
  };
}
