import { km, monthDay, recapPeak, type Recap, type RecapPosterStyle } from '#lib/recap.ts';
import { posterPalette } from '#lib/share/route-poster-render.ts';

const POSTER_W = 1080;
const POSTER_H = 1920;
const MONO_FONT = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

export interface RecapRenderOptions {
  style?: RecapPosterStyle;
  scale?: number;
}

interface ResolvedPalette {
  dark: boolean;
  font: string;
  mono: string;
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  primary: string;
  line: string;
  brandBg: string;
  brandInk: string;
  forest: string;
  forestDeep: string;
  forestInk: string;
  forestMuted: string;
  heroNum: string;
  gold: string;
  paper: string;
  desk: string;
  well: string;
  sportGreen: string;
  sportBlue: string;
  sportYellow: string;
}

function readPalette(element: HTMLElement): ResolvedPalette {
  const base = posterPalette(element);
  const css = getComputedStyle(element);
  const token = (name: string, fallback: string) => css.getPropertyValue(`--${name}`).trim() || fallback;
  const dark =
    css.colorScheme.includes('dark') ||
    element.closest('[data-poster-theme]')?.getAttribute('data-poster-theme') === 'dark';

  return {
    dark,
    font: base.font || "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
    mono: token('font-mono', MONO_FONT),
    background: base.background || (dark ? '#292725' : '#f6f7f4'),
    surface: base.surface || (dark ? '#33312f' : '#ffffff'),
    foreground: base.foreground || (dark ? '#f2f0ee' : '#202d23'),
    muted: base.muted || (dark ? '#b1aca6' : '#5c695e'),
    primary: base.route || (dark ? '#77d4ac' : '#17745c'),
    line: base.line || (dark ? '#46433f' : '#e0e6da'),
    brandBg: token('sport-brand', dark ? '#f2f0ee' : '#218538'),
    brandInk: token('brand-foreground', dark ? '#1d1c1a' : '#ffffff'),
    forest: token('recap-forest', dark ? '#1e2421' : '#124e3d'),
    forestDeep: token('recap-forest-deep', dark ? '#151917' : '#0b3529'),
    forestInk: token('recap-forest-ink', dark ? '#f2f0ee' : '#f6f7f4'),
    forestMuted: token('recap-forest-muted', dark ? '#a9b6ae' : '#b7d7cb'),
    heroNum: token('recap-hero-num', dark ? '#77d4ac' : '#ffffff'),
    gold: token('recap-gold', dark ? '#f5d36c' : '#f5c519'),
    paper: token('recap-paper', dark ? '#312f2c' : '#fcfcf7'),
    desk: token('recap-desk', dark ? '#201e1c' : '#eaece4'),
    well: token('recap-well', dark ? '#272523' : '#f2f4ec'),
    sportGreen: token('sport-green', '#86a912'),
    sportBlue: token('sport-blue', '#4bb6df'),
    sportYellow: token('sport-yellow-accent', '#f5c519'),
  };
}

function drawText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 400,
  maxWidth = 912,
  align: CanvasTextAlign = 'left',
  family?: string,
): number {
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = color;
  const fontFamily = family ?? 'sans-serif';
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  const measured = ctx.measureText(value).width;
  if (measured > maxWidth && measured > 0) {
    const shrunk = Math.max(12, Math.floor((size * maxWidth) / measured));
    ctx.font = `${weight} ${shrunk}px ${fontFamily}`;
  }
  ctx.fillText(value, x, y);
  const rendered = ctx.measureText(value).width;
  ctx.restore();
  return rendered;
}

function drawEditorial(ctx: CanvasRenderingContext2D, recap: Recap, p: ResolvedPalette) {
  const heroH = 820;
  const topGrad = ctx.createLinearGradient(0, 0, POSTER_W, heroH);
  topGrad.addColorStop(0, p.forest);
  topGrad.addColorStop(1, p.forestDeep);
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, POSTER_W, heroH);

  // Subtle concentric track-arc motif inside top monolith.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, POSTER_W, heroH);
  ctx.clip();
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.roundRect(420 + i * 38, -140 + i * 38, 860 - i * 76, 620 - i * 76, 310 - i * 38);
    ctx.strokeStyle = p.dark
      ? `rgba(119, 212, 172, ${(0.14 - i * 0.025).toFixed(3)})`
      : `rgba(245, 197, 25, ${(0.22 - i * 0.04).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // Warm paper lower half.
  ctx.fillStyle = p.background;
  ctx.fillRect(0, heroH, POSTER_W, POSTER_H - heroH);

  // Brand header bar.
  ctx.beginPath();
  ctx.roundRect(84, 82, 58, 58, 18);
  ctx.fillStyle = p.dark ? p.brandBg : p.gold;
  ctx.fill();
  drawText(ctx, 'R', 113, 125, 34, p.dark ? p.brandInk : '#12382b', 700, 48, 'center', p.font);
  drawText(ctx, 'RunNote', 160, 124, 34, p.forestInk, 700, 300, 'left', p.font);

  drawText(ctx, recap.issueTag, 996, 108, 22, p.gold, 700, 440, 'right', p.mono);
  drawText(ctx, recap.range, 996, 142, 24, p.forestMuted, 400, 460, 'right', p.font);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fillRect(84, 178, 912, 1.5);

  // Title & cutoff pill.
  drawText(ctx, recap.title, 84, 272, 62, p.forestInk, 700, 912, 'left', p.font);
  if (recap.cutoff) {
    const pillText = `进行中 · 截至 ${monthDay(recap.cutoff)}`;
    ctx.save();
    ctx.font = `600 24px ${p.font}`;
    const pillW = Math.min(500, ctx.measureText(pillText).width + 44);
    ctx.beginPath();
    ctx.roundRect(84, 304, pillW, 46, 23);
    ctx.fillStyle = 'rgba(245, 197, 25, 0.16)';
    ctx.fill();
    ctx.strokeStyle = p.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    drawText(ctx, pillText, 106, 336, 24, p.gold, 600, 456, 'left', p.font);
  }

  // Hero distance numeral.
  drawText(ctx, 'TOTAL DISTANCE · 总里程', 84, 428, 24, p.forestMuted, 600, 620, 'left', p.font);
  const distW = drawText(ctx, recap.distance, 80, 616, 196, p.heroNum, 700, 760, 'left', p.font);
  drawText(ctx, 'km', 80 + distW + 20, 616, 62, p.gold, 600, 140, 'left', p.font);

  // Peak/active ruler bar.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.roundRect(84, 684, 912, 10, 5);
  ctx.fill();

  const ratioBase =
    recap.derived.peakSharePct > 0
      ? (recap.derived.peakSharePct / 100) * 2.2
      : recap.derived.observedCount > 0
        ? recap.derived.activeCount / recap.derived.observedCount
        : 0;
  if (ratioBase > 0) {
    const barRatio = Math.min(1, Math.max(0.12, ratioBase));
    const fillGrad = ctx.createLinearGradient(84, 0, 84 + 912 * barRatio, 0);
    fillGrad.addColorStop(0, p.gold);
    fillGrad.addColorStop(1, '#9ce4c3');
    ctx.fillStyle = fillGrad;
    ctx.beginPath();
    ctx.roundRect(84, 684, 912 * barRatio, 10, 5);
    ctx.fill();
  }

  const leftHeroFact =
    recap.derived.marathons > 0
      ? `等效 ${recap.derived.marathonsText}  ·  ${recap.derived.activeRatioText}`
      : recap.derived.activeRatioText;
  drawText(ctx, leftHeroFact, 84, 744, 26, p.forestMuted, 500, 620, 'left', p.font);
  if (recap.derived.avgRunDistanceM !== null) {
    drawText(ctx, `单次均距 ${recap.derived.avgRunKmText}`, 996, 744, 26, p.forestInk, 600, 300, 'right', p.font);
  }

  // Chapter 02: Smooth mileage terrain card.
  ctx.beginPath();
  ctx.roundRect(64, 868, 952, 496, 36);
  ctx.fillStyle = p.surface;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawText(
    ctx,
    recap.period === 'year' ? '02 · 全年里程地形' : '02 · 本月周度地形',
    112,
    936,
    32,
    p.foreground,
    700,
    430,
    'left',
    p.font,
  );
  const peakText = recapPeak(recap);
  if (peakText) {
    drawText(ctx, peakText, 968, 936, 25, p.primary, 600, 460, 'right', p.font);
  }

  const chartLeft = 112;
  const chartRight = 968;
  const chartTop = 1002;
  const chartBottom = 1266;
  const chartW = chartRight - chartLeft;
  const chartH = chartBottom - chartTop;
  const n = recap.buckets.length;
  const stepX = n > 1 ? chartW / (n - 1) : chartW;
  const maxVal = Math.max(recap.max, 1);

  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1.5;
  for (let g = 0; g <= 2; g++) {
    const gy = chartBottom - (chartH * g) / 2;
    ctx.beginPath();
    ctx.moveTo(chartLeft, gy);
    ctx.lineTo(chartRight, gy);
    ctx.stroke();
  }

  const pts = recap.buckets.map((bucket, index) => {
    const x = n === 1 ? chartLeft + chartW / 2 : chartLeft + index * stepX;
    const y =
      bucket.distance === null
        ? null
        : recap.max > 0
          ? chartBottom - (bucket.distance / maxVal) * (chartH - 26)
          : chartBottom;
    return { x, y, bucket };
  });

  const validPts = pts.filter(
    (pt): pt is { x: number; y: number; bucket: (typeof recap.buckets)[number] } => pt.y !== null,
  );
  if (validPts.length >= 2 && recap.max > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(validPts[0].x, chartBottom);
    ctx.lineTo(validPts[0].x, validPts[0].y);
    for (let i = 0; i < validPts.length - 1; i++) {
      const curr = validPts[i];
      const next = validPts[i + 1];
      const cx = (curr.x + next.x) / 2;
      ctx.bezierCurveTo(cx, curr.y, cx, next.y, next.x, next.y);
    }
    ctx.lineTo(validPts[validPts.length - 1].x, chartBottom);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
    areaGrad.addColorStop(0, p.dark ? 'rgba(119, 212, 172, 0.34)' : 'rgba(23, 116, 92, 0.28)');
    areaGrad.addColorStop(1, p.dark ? 'rgba(119, 212, 172, 0.02)' : 'rgba(23, 116, 92, 0.02)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(validPts[0].x, validPts[0].y);
    for (let i = 0; i < validPts.length - 1; i++) {
      const curr = validPts[i];
      const next = validPts[i + 1];
      const cx = (curr.x + next.x) / 2;
      ctx.bezierCurveTo(cx, curr.y, cx, next.y, next.x, next.y);
    }
    ctx.strokeStyle = p.primary;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Draw points, peak anchor stems, and x-axis labels.
  let labeledPeaks = 0;
  pts.forEach((pt) => {
    if (pt.y !== null) {
      if (pt.bucket.peak && pt.bucket.distance !== null && pt.bucket.distance > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x, chartBottom);
        ctx.strokeStyle = p.gold;
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = p.gold;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = p.surface;
        ctx.stroke();
        ctx.restore();

        if (labeledPeaks < 2) {
          drawText(ctx, km(pt.bucket.distance, 1), pt.x, pt.y - 24, 24, p.foreground, 700, 110, 'center', p.font);
          labeledPeaks++;
        }
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, validPts.length === 1 ? 10 : 6, 0, Math.PI * 2);
        ctx.fillStyle = p.primary;
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(pt.x, chartBottom, 4, 0, Math.PI * 2);
      ctx.fillStyle = p.line;
      ctx.fill();
    }
    drawText(
      ctx,
      pt.bucket.shortLabel,
      pt.x,
      chartBottom + 46,
      23,
      pt.bucket.peak ? p.foreground : p.muted,
      pt.bucket.peak ? 700 : 500,
      Math.max(46, chartW / Math.max(1, n) - 4),
      'center',
      p.font,
    );
  });

  // 2x2 editorial metric ledger.
  recap.metrics.forEach((metric, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 64 + col * 492;
    const y = 1412 + row * 172;
    const w = 460;
    const h = 148;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 28);
    ctx.fillStyle = p.surface;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    drawText(ctx, metric.label, x + 36, y + 52, 26, p.muted, 500, 380, 'left', p.font);
    const vw = drawText(
      ctx,
      metric.value,
      x + 36,
      y + 118,
      58,
      p.foreground,
      700,
      metric.unit ? 304 : 388,
      'left',
      p.font,
    );
    if (metric.unit) {
      drawText(ctx, metric.unit, x + 36 + vw + 12, y + 118, 26, p.muted, 500, 92, 'left', p.font);
    }
  });

  // Colophon footer.
  ctx.fillStyle = p.line;
  ctx.fillRect(64, 1790, 952, 2);
  const footLeft = recap.coverage
    ? recap.coverage
    : recap.derived.fastestPace !== null
      ? `${recap.derived.fastestTied ? '并列最快均配' : '最快均配'} ${recap.derived.fastestLabel} · ${recap.derived.fastestPaceText}`
      : `${recap.derived.activeRatioText}`;
  drawText(ctx, footLeft, 64, 1848, 24, p.muted, 500, 620, 'left', p.font);
  drawText(ctx, 'RUNNOTE · PERSONAL RECAP', 1016, 1848, 22, p.muted, 700, 340, 'right', p.mono);
}

function drawTelemetry(ctx: CanvasRenderingContext2D, recap: Recap, p: ResolvedPalette) {
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // Outer telemetry frame.
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(44, 44, 992, 1832, 48);
  ctx.stroke();

  // Top header.
  ctx.beginPath();
  ctx.roundRect(88, 92, 58, 58, 18);
  ctx.fillStyle = p.brandBg;
  ctx.fill();
  drawText(ctx, 'R', 117, 134, 34, p.brandInk, 700, 48, 'center', p.font);
  drawText(ctx, 'RunNote', 164, 133, 34, p.foreground, 700, 300, 'left', p.font);

  const statusText = recap.cutoff ? `进行中 · 截至 ${monthDay(recap.cutoff)}` : 'SEALED TELEMETRY';
  drawText(ctx, statusText, 992, 114, 22, p.primary, 700, 460, 'right', p.mono);
  drawText(ctx, recap.range, 992, 148, 24, p.muted, 400, 460, 'right', p.mono);

  // Title & 400m track laps subtitle.
  drawText(ctx, recap.title, 540, 256, 60, p.foreground, 700, 900, 'center', p.font);
  const subText =
    recap.derived.trackLaps > 0
      ? `400m 标准跑道等效 ${recap.derived.trackLapsText}  ·  ${recap.derived.activeRatioText}`
      : recap.derived.activeRatioText;
  drawText(ctx, subText, 540, 308, 25, p.muted, 500, 900, 'center', p.font);

  // Centerpiece radial dial.
  const cx = 540;
  const cy = 816;
  ctx.beginPath();
  ctx.arc(cx, cy, 412, 0, Math.PI * 2);
  ctx.fillStyle = p.surface;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  [185, 255, 325, 385].forEach((r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  const maxD = Math.max(recap.max, 1);
  const dialGold = p.dark ? p.gold : '#e6ae00';

  if (recap.period === 'year') {
    const innerR = 192;
    const maxOuterR = 368;
    const count = Math.max(1, recap.buckets.length);
    const step = (Math.PI * 2) / count;

    recap.buckets.forEach((bucket, index) => {
      const midA = -Math.PI / 2 + index * step;
      const a0 = midA - step * 0.34;
      const a1 = midA + step * 0.34;
      if (bucket.distance !== null && bucket.distance > 0 && recap.max > 0) {
        const outR = innerR + 18 + (bucket.distance / maxD) * (maxOuterR - innerR - 18);
        ctx.beginPath();
        ctx.arc(cx, cy, outR, a0, a1);
        ctx.arc(cx, cy, innerR, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = bucket.peak ? dialGold : p.primary;
        ctx.globalAlpha = bucket.peak ? 1 : 0.78;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, innerR + 14, a0, a1);
        ctx.strokeStyle = p.line;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      const lx = cx + Math.cos(midA) * 392;
      const ly = cy + Math.sin(midA) * 392 + 8;
      drawText(
        ctx,
        bucket.shortLabel,
        lx,
        ly,
        21,
        bucket.peak ? p.foreground : p.muted,
        bucket.peak ? 700 : 500,
        64,
        'center',
        p.font,
      );
    });
  } else {
    const startA = Math.PI * 0.75;
    const fullSweep = Math.PI * 1.5;
    const n = recap.buckets.length;
    const outerR = 366;
    const gap = n > 5 ? 30 : 36;
    const laneWidth = n > 5 ? 18 : 22;

    recap.buckets.forEach((bucket, index) => {
      const r = outerR - index * gap;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startA, startA + fullSweep);
      ctx.strokeStyle = p.line;
      ctx.lineWidth = laneWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      if (bucket.distance !== null && bucket.distance > 0 && recap.max > 0) {
        const sweep = Math.max(0.12, (bucket.distance / maxD) * fullSweep);
        ctx.beginPath();
        ctx.arc(cx, cy, r, startA, startA + sweep);
        ctx.strokeStyle = bucket.peak ? dialGold : p.primary;
        ctx.lineWidth = laneWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      const lx = cx + Math.cos(startA - 0.14) * r;
      const ly = cy + Math.sin(startA - 0.14) * r + 7;
      drawText(ctx, bucket.shortLabel, lx, ly, 20, bucket.peak ? p.foreground : p.muted, 700, 50, 'center', p.mono);
    });
  }

  // Center well.
  ctx.beginPath();
  ctx.arc(cx, cy, 174, 0, Math.PI * 2);
  ctx.fillStyle = p.well;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawText(ctx, 'TOTAL KM', cx, cy - 66, 22, p.muted, 700, 240, 'center', p.mono);
  drawText(ctx, recap.distance, cx, cy + 28, 96, p.primary, 700, 296, 'center', p.font);
  drawText(ctx, '公里', cx, cy + 84, 30, p.muted, 600, 200, 'center', p.font);

  // Peak & fastest callout pill.
  const calloutParts: string[] = [];
  const peakBanner = recapPeak(recap);
  if (peakBanner) calloutParts.push(peakBanner);
  if (recap.derived.fastestPace !== null) {
    calloutParts.push(
      `${recap.derived.fastestTied ? '并列最快均配' : '最快均配'} ${recap.derived.fastestLabel} · ${recap.derived.fastestPaceText}`,
    );
  }
  if (!calloutParts.length) calloutParts.push(recap.derived.activeRatioText);

  ctx.beginPath();
  ctx.roundRect(108, 1266, 864, 68, 34);
  ctx.fillStyle = p.surface;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, calloutParts.join('   |   '), 540, 1309, 24, p.foreground, 600, 810, 'center', p.font);

  // Chronograph 2x2 metrics with colored left bars.
  const accents = [p.primary, p.sportGreen, p.sportBlue, p.sportYellow];
  recap.metrics.forEach((metric, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 88 + col * 468;
    const y = 1384 + row * 174;
    const w = 436;
    const h = 148;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 26);
    ctx.fillStyle = p.surface;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(x + 20, y + 32, 8, h - 64, 4);
    ctx.fillStyle = accents[idx % accents.length];
    ctx.fill();

    drawText(ctx, metric.label, x + 48, y + 54, 26, p.muted, 500, 360, 'left', p.font);
    const valueText = metric.unit ? `${metric.value} ${metric.unit}` : metric.value;
    drawText(ctx, valueText, x + 48, y + 118, 52, p.foreground, 700, 364, 'left', p.font);
  });

  // Footer telemetry line.
  const footParts: string[] = [];
  if (recap.coverage) {
    footParts.push(recap.coverage);
  } else {
    if (recap.derived.avgRunDistanceM !== null) footParts.push(`单次均距 ${recap.derived.avgRunKmText}`);
    if (recap.derived.marathons > 0) footParts.push(`等效 ${recap.derived.marathonsText}`);
  }
  drawText(
    ctx,
    footParts.join(' · ') || recap.derived.activeRatioText,
    88,
    1814,
    24,
    p.muted,
    500,
    590,
    'left',
    p.font,
  );
  drawText(ctx, 'RUNNOTE · TRACK TELEMETRY', 992, 1814, 21, p.muted, 700, 340, 'right', p.mono);
}

function drawSerratedEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  teeth: number,
  toothH: number,
) {
  const step = width / teeth;
  for (let i = 0; i < teeth; i++) {
    const x0 = x + i * step;
    const xm = x0 + step / 2;
    const x1 = x0 + step;
    ctx.lineTo(xm, y + toothH);
    ctx.lineTo(x1, y);
  }
}

function drawReceipt(ctx: CanvasRenderingContext2D, recap: Recap, p: ResolvedPalette) {
  const capBg = p.dark ? '#1c1b19' : '#f5c519';
  const capInk = p.dark ? '#77d4ac' : '#1e2c22';
  const markBg = p.dark ? '#77d4ac' : '#1e2c22';
  const markInk = p.dark ? '#10251b' : '#f5c519';
  const receiptGold = p.dark ? '#f5c519' : '#e0ab00';

  // Desk backdrop.
  ctx.fillStyle = p.desk;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // Tactile paper body with serrated bottom tear edge.
  const tx = 76;
  const ty = 64;
  const tw = 928;
  const th = 1774;

  ctx.save();
  ctx.shadowColor = p.dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(20, 38, 28, 0.14)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  ctx.beginPath();
  ctx.moveTo(tx + 34, ty);
  ctx.lineTo(tx + tw - 34, ty);
  ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + 34);
  ctx.lineTo(tx + tw, ty + th - 16);
  drawSerratedEdge(ctx, tx + tw, ty + th - 16, -tw, 28, 16);
  ctx.lineTo(tx, ty + 34);
  ctx.quadraticCurveTo(tx, ty, tx + 34, ty);
  ctx.closePath();
  ctx.fillStyle = p.paper;
  ctx.fill();
  ctx.restore();

  // Top ticket cap.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(tx, ty, tw, 128, [34, 34, 0, 0]);
  ctx.fillStyle = capBg;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.roundRect(tx + 44, ty + 34, 58, 58, 16);
  ctx.fillStyle = markBg;
  ctx.fill();
  drawText(ctx, 'R', tx + 73, ty + 76, 34, markInk, 700, 48, 'center', p.font);
  drawText(ctx, 'RunNote', tx + 118, ty + 75, 32, capInk, 700, 280, 'left', p.mono);
  const issueCode =
    recap.period === 'year'
      ? `ANNUAL RECEIPT · ${recap.year}`
      : `MONTHLY RECEIPT · ${recap.year}.${String(recap.month).padStart(2, '0')}`;
  drawText(ctx, issueCode, tx + tw - 44, ty + 73, 24, capInk, 700, 460, 'right', p.mono);

  // Stub 01: Title, range, cutoff, rubber stamp, giant mileage.
  drawText(ctx, recap.title, tx + 48, 280, 54, p.foreground, 700, 590, 'left', p.font);
  drawText(ctx, recap.range, tx + 48, 330, 24, p.muted, 500, 590, 'left', p.mono);
  if (recap.cutoff) {
    drawText(ctx, `进行中 · 截至 ${monthDay(recap.cutoff)}`, tx + 48, 366, 23, p.primary, 600, 590, 'left', p.font);
  }

  // Tilted double-ring circular completion stamp.
  ctx.save();
  ctx.translate(tx + tw - 134, 348);
  ctx.rotate(-0.16);
  ctx.beginPath();
  ctx.arc(0, 0, 88, 0, Math.PI * 2);
  ctx.fillStyle = p.dark ? 'rgba(119, 212, 172, 0.08)' : 'rgba(23, 116, 92, 0.06)';
  ctx.fill();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = p.primary;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, 74, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawText(ctx, recap.cutoff ? 'IN PROGRESS' : 'SEALED', 0, -34, 16, p.primary, 700, 126, 'center', p.mono);
  drawText(ctx, recap.derived.activeRatioCompact, 0, 14, 42, p.primary, 700, 126, 'center', p.font);
  drawText(
    ctx,
    recap.period === 'year' ? 'ACTIVE MOS' : 'ACTIVE WKS',
    0,
    46,
    15,
    p.primary,
    700,
    126,
    'center',
    p.mono,
  );
  ctx.restore();

  drawText(ctx, 'TOTAL MILEAGE · 核销里程', tx + 48, 434, 22, p.primary, 700, 540, 'left', p.mono);
  const dw = drawText(ctx, recap.distance, tx + 44, 594, 174, p.foreground, 700, 660, 'left', p.font);
  drawText(ctx, 'KM', tx + 44 + dw + 18, 594, 50, p.primary, 700, 120, 'left', p.mono);

  const eqParts: string[] = [];
  if (recap.derived.marathons > 0) eqParts.push(`等效 ${recap.derived.marathonsText}`);
  if (recap.derived.avgRunDistanceM !== null) eqParts.push(`单次均距 ${recap.derived.avgRunKmText}`);
  if (eqParts.length) {
    drawText(ctx, eqParts.join('  ·  '), tx + 48, 654, 25, p.muted, 500, 820, 'left', p.font);
  }

  // Perforated tear divider helper.
  function perforation(y: number) {
    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(tx + 36, y);
    ctx.lineTo(tx + tw - 36, y);
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    for (const nx of [tx, tx + tw]) {
      ctx.beginPath();
      ctx.arc(nx, y, 26, 0, Math.PI * 2);
      ctx.fillStyle = p.desk;
      ctx.fill();
    }
  }

  perforation(718);

  // Stub 02: Punch-card rhythm matrix.
  drawText(ctx, '02 · PUNCH-CARD RHYTHM', tx + 48, 792, 22, p.primary, 700, 410, 'left', p.mono);
  if (recap.max > 0 && recap.derived.peakLabel) {
    const peakTag = `${recap.derived.peakTied ? 'TIED PEAK' : 'PEAK'} · ${recap.derived.peakLabel} ${km(recap.max, 1)} km`;
    drawText(ctx, peakTag, tx + tw - 48, 792, 22, p.foreground, 700, 440, 'right', p.mono);
  }

  ctx.beginPath();
  ctx.roundRect(tx + 44, 824, tw - 88, 344, 24);
  ctx.fillStyle = p.well;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  const cols = Math.max(1, recap.buckets.length);
  const innerX = tx + 68;
  const innerW = tw - 136;
  const colW = innerW / cols;
  const maxD = Math.max(recap.max, 1);
  const maxBlocks = 10;
  const blockH = 18;
  const blockGap = 7;
  const stackBottom = 1106;

  recap.buckets.forEach((bucket, index) => {
    const cx = innerX + colW * (index + 0.5);
    const bw = Math.min(colW * 0.68, 54);
    if (bucket.distance !== null && bucket.distance > 0 && recap.max > 0) {
      const count = Math.max(1, Math.round((bucket.distance / maxD) * maxBlocks));
      for (let k = 0; k < count; k++) {
        const by = stackBottom - (k + 1) * blockH - k * blockGap;
        ctx.beginPath();
        ctx.roundRect(cx - bw / 2, by, bw, blockH, 5);
        ctx.fillStyle = bucket.peak ? receiptGold : p.primary;
        ctx.globalAlpha = bucket.peak ? 1 : 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else {
      const by = stackBottom - blockH;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx - bw / 2, by, bw, blockH, 5);
      ctx.stroke();
      ctx.restore();
    }
    drawText(
      ctx,
      bucket.shortLabel,
      cx,
      1146,
      22,
      bucket.peak ? p.foreground : p.muted,
      bucket.peak ? 700 : 500,
      Math.max(36, colW - 2),
      'center',
      p.font,
    );
  });

  perforation(1224);

  // Stub 03: Dotted-leader metrics ledger + decorative mileage fingerprint.
  drawText(ctx, '03 · VERIFIED SUMMARY', tx + 48, 1294, 22, p.primary, 700, 390, 'left', p.mono);
  if (recap.derived.fastestPace !== null) {
    const fastTag = `${recap.derived.fastestTied ? 'TIED FASTEST' : 'FASTEST'} ${recap.derived.fastestLabel} · ${recap.derived.fastestPaceText}`;
    drawText(ctx, fastTag, tx + tw - 48, 1294, 21, p.muted, 600, 440, 'right', p.mono);
  }

  recap.metrics.forEach((metric, idx) => {
    const ry = 1364 + idx * 70;
    const lw = drawText(ctx, metric.label, tx + 48, ry, 29, p.muted, 500, 240, 'left', p.font);
    const valStr = metric.unit ? `${metric.value} ${metric.unit}` : metric.value;
    const rw = drawText(ctx, valStr, tx + tw - 48, ry, 40, p.foreground, 700, 430, 'right', p.font);

    const lx0 = tx + 48 + lw + 22;
    const lx1 = tx + tw - 48 - rw - 22;
    if (lx1 > lx0 + 20) {
      ctx.save();
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.moveTo(lx0, ry - 8);
      ctx.lineTo(lx1, ry - 8);
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  });

  if (recap.coverage) {
    drawText(ctx, `注：${recap.coverage}`, tx + 48, 1632, 22, p.muted, 500, 832, 'left', p.font);
  }

  // Purely decorative mileage-proportion fingerprint bars (NOT a scannable barcode; zero personal metadata).
  const bcLeft = tx + 48;
  const bcW = tw - 96;
  const bcBase = 1748;
  const bars = 36;
  const barStep = bcW / bars;
  for (let i = 0; i < bars; i++) {
    const bucket = recap.buckets[i % recap.buckets.length];
    const ratio = bucket && bucket.distance !== null && recap.max > 0 ? bucket.distance / maxD : 0.14;
    const h = 24 + ratio * 52;
    const w = Math.max(4, barStep * (0.35 + ratio * 0.45));
    ctx.fillStyle = p.foreground;
    ctx.globalAlpha = 0.78;
    ctx.fillRect(bcLeft + i * barStep, bcBase - h, w, h);
  }
  ctx.globalAlpha = 1;

  drawText(ctx, 'MILEAGE FINGERPRINT · RUNNOTE', tx + 48, 1786, 20, p.muted, 700, 460, 'left', p.mono);
  drawText(
    ctx,
    `${recap.activityCount.toLocaleString('zh-CN')} RUNS · ${recap.activityDays.toLocaleString('zh-CN')} DAYS`,
    tx + tw - 48,
    1786,
    20,
    p.muted,
    700,
    380,
    'right',
    p.mono,
  );
}

/**
 * Draw a 9:16 recap poster on a local Canvas 2D context.
 * Strictly renders whitelisted aggregate data only; zero external network requests.
 */
export async function renderRecap(recap: Recap, element: HTMLElement, options: RecapRenderOptions = {}): Promise<Blob> {
  const style = options.style ?? 'editorial';
  const scale = options.scale ?? 1;
  const palette = readPalette(element);
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(POSTER_W * scale);
  canvas.height = Math.round(POSTER_H * scale);
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法生成图片');
    if (scale !== 1) ctx.scale(scale, scale);

    if (style === 'telemetry') {
      drawTelemetry(ctx, recap, palette);
    } else if (style === 'receipt') {
      drawReceipt(ctx, recap, palette);
    } else {
      drawEditorial(ctx, recap, palette);
    }

    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('分享图生成失败，请重试'))), 'image/png'),
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
