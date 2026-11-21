/**
 * Offline HiDPI Canvas 2D renderer for Direction A (Chronicle Scroll) route & footprint stages.
 * Zero external map tiles, zero network requests; reads RunNote theme tokens dynamically.
 */

import type { AnnualStory, LonLat } from '#lib/api/annual-story.ts';
import { computeGeoBounds, makeCanvasProjector, milestoneLabel, storyKm, storyShortDate } from '#lib/story.ts';

export type StageMode = 'first' | 'longest' | 'best' | 'cities' | 'frequent' | 'annual';

export interface StageRenderOptions {
  story: AnnualStory;
  mode: StageMode;
  progress?: number;
  selectedCityCode?: string | null;
  dark?: boolean;
}

interface StagePalette {
  bgTop: string;
  bgBottom: string;
  grid: string;
  contour: string;
  routeDim: string;
  routeBright: string;
  gold: string;
  coral: string;
  blue: string;
  ink: string;
  muted: string;
  pillBg: string;
  pillBorder: string;
  font: string;
}

function readStagePalette(element: HTMLElement, darkOverride?: boolean): StagePalette {
  const css = getComputedStyle(element);
  const dark = darkOverride ?? document.documentElement.getAttribute('data-theme') === 'dark';
  const font = css.getPropertyValue('--font-body').trim() || 'system-ui, sans-serif';
  if (dark) {
    return {
      bgTop: '#262422',
      bgBottom: '#1e1d1b',
      grid: 'rgba(255,255,255,0.045)',
      contour: 'rgba(119,212,172,0.12)',
      routeDim: 'rgba(119,212,172,0.28)',
      routeBright: '#77d4ac',
      gold: '#f5d36c',
      coral: '#f06373',
      blue: '#7cc7f2',
      ink: '#f2f0ee',
      muted: '#b1aca6',
      pillBg: 'rgba(38,36,34,0.9)',
      pillBorder: 'rgba(255,255,255,0.14)',
      font,
    };
  }
  return {
    bgTop: '#f3f6ef',
    bgBottom: '#e9efe4',
    grid: 'rgba(23,116,92,0.06)',
    contour: 'rgba(23,116,92,0.12)',
    routeDim: 'rgba(23,116,92,0.25)',
    routeBright: '#17745c',
    gold: '#c68a00',
    coral: '#d9485b',
    blue: '#2689b2',
    ink: '#202d23',
    muted: '#5c695e',
    pillBg: 'rgba(255,255,255,0.92)',
    pillBorder: 'rgba(23,116,92,0.16)',
    font,
  };
}

function drawGridBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, p: StagePalette) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, p.bgTop);
  grad.addColorStop(1, p.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 36; x < w; x += 36) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 36; y < h; y += 36) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();

  // Subtle decorative abstract compass arcs
  ctx.save();
  ctx.strokeStyle = p.contour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(w * 0.84, h * 0.2, Math.min(w, h) * 0.28, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.16, h * 0.82, Math.min(w, h) * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  pts: LonLat[],
  proj: (pt: LonLat) => [number, number],
  fraction = 1,
): [number, number] | null {
  if (pts.length < 2 || fraction <= 0) return null;
  const maxSeg = (pts.length - 1) * Math.min(1, fraction);
  const full = Math.floor(maxSeg);
  const rem = maxSeg - full;
  ctx.beginPath();
  const p0 = proj(pts[0]);
  ctx.moveTo(p0[0], p0[1]);
  let last = p0;
  for (let i = 1; i <= full && i < pts.length; i++) {
    const pt = proj(pts[i]);
    ctx.lineTo(pt[0], pt[1]);
    last = pt;
  }
  if (rem > 0 && full + 1 < pts.length) {
    const a = proj(pts[full]);
    const b = proj(pts[full + 1]);
    last = [a[0] + (b[0] - a[0]) * rem, a[1] + (b[1] - a[1]) * rem];
    ctx.lineTo(last[0], last[1]);
  }
  ctx.stroke();
  return last;
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  w: number,
  x: number,
  y: number,
  text: string,
  p: StagePalette,
  accent: string,
) {
  ctx.save();
  ctx.font = `600 11px ${p.font}`;
  const tw = Math.min(w - 36, ctx.measureText(text).width);
  const bw = tw + 18;
  const bh = 24;
  const bx = Math.max(10, Math.min(w - bw - 10, x - bw / 2));
  const by = Math.max(10, y - bh - 10);

  ctx.fillStyle = p.pillBg;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = p.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5, bw - 14);
  ctx.restore();
}

function drawDistanceRulerFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  title: string,
  distanceM: number,
  subtitle: string,
  p: StagePalette,
  accent: string,
) {
  const padX = Math.max(28, w * 0.1);
  const barW = w - padX * 2;
  const cy = h * 0.52;
  const marathonFrac = Math.min(1, distanceM / 42195);

  ctx.save();
  ctx.fillStyle = p.muted;
  ctx.font = `600 12px ${p.font}`;
  ctx.textAlign = 'left';
  ctx.fillText('无 GPS 轨迹 · 里程标尺示意', padX, cy - 52);

  ctx.fillStyle = p.ink;
  ctx.font = `700 32px ${p.font}`;
  ctx.fillText(`${storyKm(distanceM)} km`, padX, cy - 16);

  ctx.fillStyle = p.contour;
  ctx.beginPath();
  ctx.roundRect(padX, cy + 6, barW, 14, 7);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(padX, cy + 6, Math.max(18, barW * marathonFrac), 14, 7);
  ctx.fill();

  // Reference ticks: 5K, 10K, Half, Full
  for (const [label, m] of [
    ['5K', 5000],
    ['10K', 10000],
    ['半马', 21097],
    ['全马', 42195],
  ] as const) {
    const tx = padX + barW * (m / 42195);
    ctx.strokeStyle = p.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx, cy + 24);
    ctx.lineTo(tx, cy + 30);
    ctx.stroke();
    ctx.fillStyle = p.muted;
    ctx.font = `500 10px ${p.font}`;
    ctx.textAlign = m === 42195 ? 'right' : 'center';
    ctx.fillText(label, tx, cy + 44);
  }

  ctx.fillStyle = p.muted;
  ctx.font = `500 12px ${p.font}`;
  ctx.textAlign = 'left';
  ctx.fillText(`${title} · ${subtitle}`, padX, cy + 72, barW);
  ctx.restore();
}

function drawCalendarPulseFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  story: AnnualStory,
  progress: number,
  p: StagePalette,
) {
  const cx = w / 2;
  const cy = h / 2 + 4;
  const r = Math.min(w, h) * 0.3;
  const monthlyM = story.footprint_timeline.monthly_distance_m.map((m) => Number(m));
  const maxM = Math.max(1, ...monthlyM);
  const limit = progress * 12;

  ctx.save();
  ctx.strokeStyle = p.contour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  monthlyM.forEach((m, idx) => {
    const angle = -Math.PI / 2 + (idx / 12) * Math.PI * 2;
    const frac = Math.max(0, Math.min(1, limit - idx));
    const len = (m / maxM) * (r * 0.42) * frac;
    ctx.strokeStyle = frac > 0 && m > 0 ? p.routeBright : p.contour;
    ctx.lineWidth = m > 0 ? 7 : 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * (r - 6), cy + Math.sin(angle) * (r - 6));
    ctx.lineTo(cx + Math.cos(angle) * (r + len + 6), cy + Math.sin(angle) * (r + len + 6));
    ctx.stroke();

    const lx = cx + Math.cos(angle) * (r - 22);
    const ly = cy + Math.sin(angle) * (r - 22);
    ctx.fillStyle = frac > 0 ? p.ink : p.muted;
    ctx.font = `600 11px ${p.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${idx + 1}月`, lx, ly);
  });

  const shownKm = (Number(story.summary.distance_m) / 1000) * progress;
  const shownRuns = Math.round(story.summary.activity_count * progress);
  ctx.fillStyle = p.ink;
  ctx.font = `700 26px ${p.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${shownKm.toFixed(1)} km`, cx, cy - 8);
  ctx.fillStyle = p.muted;
  ctx.font = `500 12px ${p.font}`;
  ctx.fillText(`节律脉冲回放 · ${shownRuns}/${story.summary.activity_count} 次`, cx, cy + 16);
  ctx.restore();
}

export function renderStoryStage(canvas: HTMLCanvasElement, options: StageRenderOptions): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(240, Math.round(rect.width || canvas.clientWidth || 640));
  const h = Math.max(200, Math.round(rect.height || canvas.clientHeight || 420));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  const p = readStagePalette(canvas, options.dark);
  const { story, mode } = options;
  const progress = Math.max(0, Math.min(1, options.progress ?? 1));
  drawGridBackdrop(ctx, w, h, p);

  if (mode === 'first' || mode === 'longest' || mode === 'best') {
    const beat = mode === 'first' ? story.first_run : mode === 'longest' ? story.longest_route : story.best_performance;
    const accent = mode === 'longest' ? p.gold : mode === 'best' ? p.coral : p.routeBright;
    if (!beat) {
      ctx.restore();
      return;
    }
    const flat = beat.shape.flat();
    const bounds = computeGeoBounds(flat);
    if (!beat.has_track || !bounds) {
      drawDistanceRulerFallback(ctx, w, h, beat.title, Number(beat.distance_m), beat.activity_date, p, accent);
      ctx.restore();
      return;
    }
    const proj = makeCanvasProjector(bounds, w, h, 42);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of beat.shape) {
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 10;
      strokePolyline(ctx, line, proj, 1);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3.4;
      strokePolyline(ctx, line, proj, Math.max(0.15, progress));
    }
    const firstPt = proj(beat.shape[0][0]);
    const lastLine = beat.shape[beat.shape.length - 1];
    const lastPt = proj(lastLine[lastLine.length - 1]);
    ctx.fillStyle = p.routeBright;
    ctx.beginPath();
    ctx.arc(firstPt[0], firstPt[1], 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.gold;
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawBadge(ctx, w, w / 2, h - 10, `${beat.title} · ${storyKm(beat.distance_m)} km`, p, accent);
    ctx.restore();
    return;
  }

  if (mode === 'cities') {
    const cities = story.explored_cities.items;
    if (!cities.length) {
      drawCalendarPulseFallback(ctx, w, h, story, 1, p);
      ctx.restore();
      return;
    }
    const allPts: LonLat[] = [
      ...cities.map((c): LonLat => [c.lon, c.lat]),
      ...story.footprint_timeline.items.flatMap((t) => t.points),
    ];
    const bounds = computeGeoBounds(allPts);
    if (!bounds) {
      ctx.restore();
      return;
    }
    const proj = makeCanvasProjector(bounds, w, h, 42);

    ctx.save();
    ctx.lineWidth = 1.25;
    for (const t of story.footprint_timeline.items) {
      if (t.points.length < 2) continue;
      const active = !options.selectedCityCode || t.city_code === options.selectedCityCode;
      ctx.strokeStyle = active ? p.routeDim : 'rgba(128,128,128,0.12)';
      strokePolyline(ctx, t.points, proj, 1);
    }

    if (cities.length > 1) {
      ctx.strokeStyle = p.blue;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 5]);
      const home = proj([cities[0].lon, cities[0].lat]);
      for (let i = 1; i < cities.length; i++) {
        const pt = proj([cities[i].lon, cities[i].lat]);
        ctx.beginPath();
        ctx.moveTo(home[0], home[1]);
        ctx.quadraticCurveTo((home[0] + pt[0]) / 2, (home[1] + pt[1]) / 2 - 26, pt[0], pt[1]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    const maxDist = Math.max(1, ...cities.map((c) => Number(c.distance_m)));
    for (const c of cities) {
      const pt = proj([c.lon, c.lat]);
      const rad = 10 + Math.sqrt(Number(c.distance_m) / maxDist) * 18;
      const isSelected = options.selectedCityCode === c.code;
      ctx.fillStyle = c.is_new ? p.gold : p.routeBright;
      ctx.globalAlpha = isSelected ? 0.35 : 0.18;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], isSelected ? rad + 5 : rad, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = isSelected ? p.ink : c.is_new ? p.gold : p.routeBright;
      ctx.lineWidth = isSelected ? 2.4 : 1.6;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], rad, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = c.is_new ? p.gold : p.routeBright;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = p.ink;
      ctx.font = `${isSelected ? 700 : 600} 11px ${p.font}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${c.name}${c.is_new ? ' ★' : ''}`, pt[0], pt[1] + rad + 14);
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  if (mode === 'frequent') {
    const fr = story.frequent_route;
    if (fr.status !== 'ready' || !fr.shape.length) {
      drawCalendarPulseFallback(ctx, w, h, story, 1, p);
      ctx.restore();
      return;
    }
    const allPts = [...fr.shape.flat(), ...fr.overlay_shapes.flatMap((s) => s.flat())];
    const bounds = computeGeoBounds(allPts);
    if (!bounds) {
      ctx.restore();
      return;
    }
    const proj = makeCanvasProjector(bounds, w, h, 44);
    const overlays = fr.overlay_shapes.length ? fr.overlay_shapes : [fr.shape];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    overlays.forEach((shape, idx) => {
      const last = idx === overlays.length - 1;
      ctx.strokeStyle = last ? p.gold : p.routeBright;
      ctx.globalAlpha = last ? 0.92 : 0.2;
      ctx.lineWidth = last ? 3 : 2.2;
      for (const line of shape) strokePolyline(ctx, line, proj, 1);
    });
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    for (const line of fr.shape) strokePolyline(ctx, line, proj, 1);
    ctx.restore();

    drawBadge(ctx, w, w / 2, h - 10, `${fr.name ?? '常跑路线'} · 重逢 ${fr.run_count} 次`, p, p.gold);
    ctx.restore();
    return;
  }

  // mode === 'annual'
  const tl = story.footprint_timeline;
  if (!tl.has_tracks) {
    drawCalendarPulseFallback(ctx, w, h, story, progress, p);
    ctx.restore();
    return;
  }

  const allPts: LonLat[] = [
    ...tl.items.flatMap((t) => t.points),
    ...story.explored_cities.items.map((c): LonLat => [c.lon, c.lat]),
  ];
  const bounds = computeGeoBounds(allPts);
  if (!bounds) {
    drawCalendarPulseFallback(ctx, w, h, story, progress, p);
    ctx.restore();
    return;
  }
  const proj = makeCanvasProjector(bounds, w, h, 34);
  const total = tl.items.length;
  const cursor = progress * total;
  const fullIdx = Math.floor(cursor);
  const partial = cursor - fullIdx;
  const cityByCode = new Map(story.explored_cities.items.map((c) => [c.code, c]));
  const litCities = new Set<string>();
  const drawnArcs = new Set<string>();

  // Chronological travel arcs
  ctx.save();
  ctx.strokeStyle = p.gold;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 5]);
  let prevCity: (typeof story.explored_cities.items)[number] | null = null;
  for (let i = 0; i <= Math.min(fullIdx, total - 1); i++) {
    const code = tl.items[i].city_code;
    const city = code ? (cityByCode.get(code) ?? null) : null;
    if (!city) continue;
    litCities.add(city.code);
    if (prevCity && prevCity.code !== city.code) {
      const edge = `${prevCity.code}->${city.code}`;
      if (!drawnArcs.has(edge)) {
        drawnArcs.add(edge);
        const a = proj([prevCity.lon, prevCity.lat]);
        const b = proj([city.lon, city.lat]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 24, b[0], b[1]);
        ctx.stroke();
      }
    }
    prevCity = city;
  }
  ctx.restore();

  // Tracks up to progress cursor
  let activeHead: [number, number] | null = null;
  let activeItem: (typeof tl.items)[number] | null = null;
  for (let i = 0; i < total; i++) {
    if (i > fullIdx) break;
    const item = tl.items[i];
    if (item.points.length < 2) continue;
    const isCurrent = i === fullIdx && progress < 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (isCurrent) {
      ctx.strokeStyle = p.gold;
      ctx.lineWidth = 3.2;
      activeHead = strokePolyline(ctx, item.points, proj, Math.max(0.15, partial));
      activeItem = item;
    } else if (item.milestone) {
      ctx.strokeStyle = item.milestone === 'longest' ? p.gold : item.milestone === 'best' ? p.coral : p.routeBright;
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.92;
      strokePolyline(ctx, item.points, proj, 1);
    } else {
      ctx.strokeStyle = p.routeDim;
      ctx.lineWidth = 1.4;
      strokePolyline(ctx, item.points, proj, 1);
    }
    ctx.restore();
  }

  // City beacons
  for (const c of story.explored_cities.items) {
    const pt = proj([c.lon, c.lat]);
    const lit = litCities.has(c.code);
    ctx.save();
    if (lit) {
      ctx.fillStyle = c.is_new ? p.gold : p.routeBright;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], c.is_new ? 16 : 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.ink;
      ctx.font = `600 11px ${p.font}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${c.name}${c.is_new ? ' ★' : ''}`, pt[0], pt[1] + 16);
    } else {
      ctx.fillStyle = p.contour;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (activeHead && activeItem) {
    ctx.save();
    ctx.fillStyle = p.gold;
    ctx.beginPath();
    ctx.arc(activeHead[0], activeHead[1], 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const tag = milestoneLabel(activeItem.milestone);
    const label = tag
      ? `${storyShortDate(activeItem.activity_date)} · ${tag}`
      : `${storyShortDate(activeItem.activity_date)} · ${storyKm(activeItem.distance_m, 1)} km`;
    drawBadge(ctx, w, activeHead[0], activeHead[1], label, p, p.gold);
  } else if (progress >= 0.999) {
    drawBadge(ctx, w, w / 2, h - 10, `${story.year} 全年足迹 · ${story.summary.activity_count} 次`, p, p.routeBright);
  }

  ctx.restore();
}
