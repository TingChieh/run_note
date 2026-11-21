/**
 * Direction A (Chronicle Scroll) 1080×1920 9:16 offline Canvas 2D poster renderer.
 *
 * Strict privacy whitelist:
 * - Generic RunNote brand, year, date range, aggregate stats, abstract normalized route silhouettes
 *   (no real street map, no exact lat/lon, no start/end pins), and user-controlled toggles for
 *   city names and route titles.
 * - Never draws email, username, notes, filenames, activity IDs, or wellbeing data.
 */

import type { AnnualStory } from '#lib/api/annual-story.ts';
import {
  computeGeoBounds,
  formatGain,
  formatStoryPaceCompact,
  makeCanvasProjector,
  storyKm,
  storyRangeText,
  storyShortDate,
} from '#lib/story.ts';

const POSTER_W = 1080;
const POSTER_H = 1920;
const MONO_FONT = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

export interface StoryPosterOptions {
  theme?: 'light' | 'dark';
  hideCities?: boolean;
  hideRouteNames?: boolean;
  scale?: number;
}

interface PosterPalette {
  dark: boolean;
  font: string;
  mono: string;
  bg: string;
  headerBg: string;
  headerInk: string;
  headerMuted: string;
  surface: string;
  ink: string;
  muted: string;
  primary: string;
  line: string;
  forest: string;
  forestDeep: string;
  gold: string;
  brandBg: string;
  brandInk: string;
}

function readPosterPalette(element: HTMLElement | null, theme: 'light' | 'dark'): PosterPalette {
  const dark = theme === 'dark';
  const css = element ? getComputedStyle(element) : null;
  const font =
    css?.getPropertyValue('--font-body').trim() ||
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif";
  const mono = css?.getPropertyValue('--font-mono').trim() || MONO_FONT;

  return dark
    ? {
        dark: true,
        font,
        mono,
        bg: '#23211f',
        headerBg: '#34312e',
        headerInk: '#f2f0ee',
        headerMuted: '#b1aca6',
        surface: '#312f2c',
        ink: '#f2f0ee',
        muted: '#b1aca6',
        primary: '#77d4ac',
        line: '#46433f',
        forest: '#1b221f',
        forestDeep: '#121715',
        gold: '#f5d36c',
        brandBg: '#f2f0ee',
        brandInk: '#1d1c1a',
      }
    : {
        dark: false,
        font,
        mono,
        bg: '#f6f7f4',
        headerBg: '#fbf0bd',
        headerInk: '#2a2a12',
        headerMuted: '#5a5628',
        surface: '#ffffff',
        ink: '#202d23',
        muted: '#5c695e',
        primary: '#17745c',
        line: '#dce3d6',
        forest: '#124e3d',
        forestDeep: '#0b3529',
        gold: '#f5c519',
        brandBg: '#218538',
        brandInk: '#ffffff',
      };
}

function drawText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight: 400 | 500 | 600 | 700,
  maxWidth: number,
  align: CanvasTextAlign = 'left',
  family?: string,
) {
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = color;
  const fontFamily = family ?? 'sans-serif';
  let current = size;
  ctx.font = `${weight} ${current}px ${fontFamily}`;
  const measured = ctx.measureText(value).width;
  if (measured > maxWidth && measured > 0) {
    current = Math.max(16, Math.floor((size * maxWidth) / measured));
    ctx.font = `${weight} ${current}px ${fontFamily}`;
  }
  ctx.fillText(value, x, y, maxWidth);
  ctx.restore();
}

function drawAbstractArtwork(
  ctx: CanvasRenderingContext2D,
  story: AnnualStory,
  box: { x: number; y: number; w: number; h: number; r: number },
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, box.r);
  ctx.clip();

  // Subtle topographic contour rings inside the dark hero frame.
  ctx.strokeStyle = 'rgba(156,228,195,0.08)';
  ctx.lineWidth = 1.5;
  for (const [rx, ry, rad] of [
    [0.24, 0.42, 165],
    [0.24, 0.42, 245],
    [0.78, 0.3, 140],
    [0.78, 0.3, 215],
  ] as const) {
    ctx.beginPath();
    ctx.arc(box.x + box.w * rx, box.y + box.h * ry, rad, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tl = story.footprint_timeline;
  const allPts = tl.items.flatMap((item) => item.points);
  const cityPts: [number, number][] = story.explored_cities.items.map((c) => [c.lon, c.lat]);
  const bounds = tl.has_tracks ? computeGeoBounds([...allPts, ...cityPts]) : null;

  if (!bounds) {
    // 12-month orbital pulse fallback when there are no GPS tracks.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2 - 42;
    const rad = 160;
    const monthly = tl.monthly_distance_m.map((m) => Number(m));
    const maxM = Math.max(1, ...monthly);
    ctx.strokeStyle = 'rgba(183,215,203,0.22)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();

    monthly.forEach((m, i) => {
      const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
      const len = m > 0 ? 18 + (m / maxM) * 62 : 10;
      ctx.strokeStyle = m > 0 ? '#9ce4c3' : 'rgba(183,215,203,0.18)';
      ctx.lineWidth = m > 0 ? 12 : 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (rad - 10), cy + Math.sin(a) * (rad - 10));
      ctx.lineTo(cx + Math.cos(a) * (rad + len), cy + Math.sin(a) * (rad + len));
      ctx.stroke();
    });
    ctx.restore();
    return;
  }

  const spread = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const multiCity = story.explored_cities.items.length >= 2 && spread > 0.0005;

  // In multi-city years, add a translucent full-scale silhouette of the longest route as backdrop
  // so the hero keeps unmistakable running-route movement alongside the city constellation.
  const longestShape = story.longest_route?.shape ?? [];
  if (multiCity && longestShape.length > 0) {
    const lPts = longestShape.flat();
    const lBounds = computeGeoBounds(lPts);
    if (lBounds) {
      const lProj = makeCanvasProjector(lBounds, box.w - 140, box.h - 230, 32);
      ctx.save();
      ctx.strokeStyle = 'rgba(156,228,195,0.14)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const line of longestShape) {
        if (line.length < 2) continue;
        ctx.beginPath();
        const p0 = lProj(line[0]);
        ctx.moveTo(box.x + 70 + p0[0], box.y + 34 + p0[1]);
        for (let i = 1; i < line.length; i++) {
          const pt = lProj(line[i]);
          ctx.lineTo(box.x + 70 + pt[0], box.y + 34 + pt[1]);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  const proj = makeCanvasProjector(bounds, box.w - 120, box.h - 230, 56);
  const offsetX = box.x + 60;
  const offsetY = box.y + 24;

  if (multiCity) {
    const orderedCities = [...story.explored_cities.items].sort((a, b) => a.first_date.localeCompare(b.first_date));
    const coords = orderedCities.map((c) => {
      const pt = proj([c.lon, c.lat]);
      return { city: c, x: offsetX + pt[0], y: offsetY + pt[1] };
    });
    // Dashed constellation arcs linking cities in chronological discovery order.
    ctx.save();
    ctx.setLineDash?.([10, 10]);
    ctx.strokeStyle = 'rgba(245,197,25,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    coords.forEach((node, idx) => {
      if (idx === 0) ctx.moveTo(node.x, node.y);
      else ctx.lineTo(node.x, node.y);
    });
    ctx.stroke();
    ctx.restore();

    const maxCount = Math.max(1, ...orderedCities.map((c) => c.activity_count));
    for (const node of coords) {
      const radius = 16 + Math.sqrt(node.city.activity_count / maxCount) * 24;
      ctx.fillStyle = node.city.is_new ? 'rgba(245,197,25,0.22)' : 'rgba(156,228,195,0.22)';
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = node.city.is_new ? '#f5c519' : '#9ce4c3';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = node.city.is_new ? '#f5c519' : '#ffffff';
      ctx.beginPath();
      ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of tl.items) {
    if (item.points.length < 2) continue;
    ctx.strokeStyle = item.milestone === 'longest' ? '#f5c519' : item.milestone ? '#9ce4c3' : 'rgba(156,228,195,0.34)';
    ctx.lineWidth = item.milestone ? 5 : 2.5;
    ctx.beginPath();
    const p0 = proj(item.points[0]);
    ctx.moveTo(offsetX + p0[0], offsetY + p0[1]);
    for (let i = 1; i < item.points.length; i++) {
      const pt = proj(item.points[i]);
      ctx.lineTo(offsetX + pt[0], offsetY + pt[1]);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStoryPoster(
  ctx: CanvasRenderingContext2D,
  story: AnnualStory,
  element: HTMLElement | null,
  options: StoryPosterOptions = {},
): void {
  const theme = options.theme ?? 'light';
  const hideCities = Boolean(options.hideCities);
  const hideRoutes = Boolean(options.hideRouteNames);
  const p = readPosterPalette(element, theme);

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // Top warm editorial band
  ctx.fillStyle = p.headerBg;
  ctx.fillRect(0, 0, POSTER_W, 240);

  // Brand mark
  ctx.save();
  ctx.fillStyle = p.brandBg;
  ctx.beginPath();
  ctx.roundRect(72, 64, 48, 48, 13);
  ctx.fill();
  ctx.fillStyle = p.brandInk;
  ctx.font = `italic 700 28px ${p.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', 96, 89);
  ctx.restore();

  drawText(ctx, `RUNNOTE · ANNUAL STORY ${story.year}`, 140, 88, 22, p.headerMuted, 600, 620, 'left', p.mono);
  drawText(ctx, `${story.year} 跑步年度故事`, 140, 128, 38, p.headerInk, 700, 680, 'left', p.font);
  drawText(
    ctx,
    storyRangeText(story) + (story.is_partial ? ' · 进行中' : ''),
    72,
    200,
    24,
    p.headerMuted,
    500,
    920,
    'left',
    p.mono,
  );

  // Abstract footprint frame
  const artBox = { x: 72, y: 280, w: POSTER_W - 144, h: 660, r: 32 };
  const grad = ctx.createLinearGradient(artBox.x, artBox.y, artBox.x + artBox.w, artBox.y + artBox.h);
  grad.addColorStop(0, p.forest);
  grad.addColorStop(1, p.forestDeep);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(artBox.x, artBox.y, artBox.w, artBox.h, artBox.r);
  ctx.fill();

  drawAbstractArtwork(ctx, story, artBox);

  drawText(
    ctx,
    `${storyKm(story.summary.distance_m)} km`,
    artBox.x + 48,
    artBox.y + artBox.h - 86,
    82,
    '#ffffff',
    700,
    680,
    'left',
    p.font,
  );
  const avgPace = formatStoryPaceCompact(story.summary.avg_pace_seconds_per_km);
  drawText(
    ctx,
    `${story.summary.activity_count} 次出发 · ${story.summary.activity_days} 天在路上 · 均配 ${avgPace}${avgPace === '—' ? '' : '/km'}`,
    artBox.x + 48,
    artBox.y + artBox.h - 38,
    26,
    '#b7d7cb',
    500,
    artBox.w - 96,
    'left',
    p.font,
  );

  const citySummary = (() => {
    const ec = story.explored_cities;
    if (ec.total_cities === 0) return '室内与无定位记录';
    if (hideCities) return `跨越 ${ec.total_cities} 座城`;
    const names = ec.items.slice(0, 4).map((c) => c.name);
    return names.join(' · ') + (ec.items.length > 4 ? ` 等 ${ec.items.length} 城` : '');
  })();

  const routeOr = (title: string | null | undefined, fallback: string) => (hideRoutes || !title ? fallback : title);

  const first = story.first_run;
  const longest = story.longest_route;
  const best = story.best_performance;
  const freq = story.frequent_route;

  const beats = [
    {
      tag: '01 年度第一跑',
      main: first ? `${storyShortDate(first.activity_date)} · ${storyKm(first.distance_m)} km` : '—',
      sub: first ? routeOr(first.title, '开年首跑记录') : '暂无记录',
    },
    {
      tag: '02 年度最长路线',
      main: longest ? `${storyKm(longest.distance_m)} km` : '—',
      sub: longest
        ? `${storyShortDate(longest.activity_date)} · ${routeOr(longest.title, longest.has_track ? '单次最长路线' : '单次最长记录')}`
        : '暂无记录',
    },
    {
      tag: '03 最佳表现',
      main: best
        ? best.avg_pace_seconds_per_km !== null
          ? `${best.category} · ${formatStoryPaceCompact(best.avg_pace_seconds_per_km)}/km`
          : `${best.category} · ${storyKm(best.distance_m)} km`
        : '—',
      sub: best
        ? best.pace_gain_seconds_per_km
          ? `较当年首次快了 ${formatGain(best.pace_gain_seconds_per_km)}`
          : best.is_all_time_pb
            ? '刷新个人历史 PB'
            : storyShortDate(best.activity_date)
        : '暂无记录',
    },
    {
      tag: '04 探索城市',
      main:
        story.explored_cities.total_cities > 0
          ? `${story.explored_cities.total_cities} 座城${story.explored_cities.new_cities_count > 0 ? ` · +${story.explored_cities.new_cities_count} 新城` : ''}`
          : '室内无定位',
      sub: citySummary,
    },
    {
      tag: '05 最常跑路线',
      main: freq.status === 'ready' ? `${freq.run_count} 次重逢` : '每次都是新路',
      sub:
        freq.status === 'ready'
          ? `${routeOr(freq.name, '年度常跑路线')}${freq.pace_improvement_seconds_per_km ? ` · 提速 ${formatGain(freq.pace_improvement_seconds_per_km)}` : ''}`
          : '全年未重复同一户外轨迹',
    },
  ];

  let y = 995;
  for (const b of beats) {
    ctx.fillStyle = p.surface;
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(72, y, POSTER_W - 144, 144, 24);
    ctx.fill();
    ctx.stroke();

    drawText(ctx, b.tag, 108, y + 48, 22, p.primary, 600, 360, 'left', p.font);
    drawText(ctx, b.main, 108, y + 104, 40, p.ink, 700, 520, 'left', p.font);
    drawText(ctx, b.sub, POSTER_W - 108, y + 98, 24, p.muted, 500, 390, 'right', p.font);
    y += 162;
  }

  drawText(
    ctx,
    'RunNote · 抽象足迹示意，不含精确坐标与起终点',
    POSTER_W / 2,
    POSTER_H - 52,
    22,
    p.muted,
    500,
    POSTER_W - 144,
    'center',
    p.font,
  );
}

export async function renderStoryPosterBlob(
  story: AnnualStory,
  element: HTMLElement | null,
  options: StoryPosterOptions = {},
): Promise<Blob> {
  const scale = options.scale ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(POSTER_W * scale);
  canvas.height = Math.round(POSTER_H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持画布渲染');
  if (scale !== 1) ctx.scale(scale, scale);
  drawStoryPoster(ctx, story, element, options);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('无法生成年度故事海报 PNG');
  return blob;
}
