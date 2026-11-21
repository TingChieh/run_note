/**
 * Direction B — 1080×1920 Canvas 2D Poster Renderer ("环道计时仪 · Stadium Telemetry")
 * Centerpiece radial 12-month dial (year) or concentric stadium lanes (month).
 * Strict privacy whitelist only.
 */
import { monthDay } from '../shared/data.js';

const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

function palette(theme) {
  if (theme === 'dark') {
    return {
      bg: '#23211f',
      card: '#302e2c',
      dialWell: '#1a1917',
      ink: '#f2f0ee',
      muted: '#b1aca6',
      primary: '#77d4ac',
      primaryMuted: '#417660',
      gold: '#f5c519',
      line: '#45423e',
      brandBg: '#f2f0ee',
      brandInk: '#1d1c1a',
    };
  }
  return {
    bg: '#f5f6f2',
    card: '#ffffff',
    dialWell: '#f1f5f0',
    ink: '#202d23',
    muted: '#5c695e',
    primary: '#17745c',
    primaryMuted: '#91c4b2',
    gold: '#e6ae00',
    line: '#dce3d6',
    brandBg: '#218538',
    brandInk: '#ffffff',
  };
}

function drawText(ctx, text, x, y, size, color, weight = 400, align = 'left', family = FONT, maxW = 920) {
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${family}`;
  const m = ctx.measureText(text).width;
  if (m > maxW) ctx.font = `${weight} ${Math.floor((size * maxW) / m)}px ${family}`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function renderPosterB(vm, theme = 'light') {
  const p = palette(theme);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, 1080, 1920);

  // Outer architectural frame
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(44, 44, 992, 1832, 48);
  ctx.stroke();

  // Top Header
  ctx.beginPath();
  ctx.roundRect(88, 92, 58, 58, 18);
  ctx.fillStyle = p.brandBg;
  ctx.fill();
  drawText(ctx, 'R', 117, 134, 34, p.brandInk, 700, 'center');
  drawText(ctx, 'RunNote', 164, 133, 34, p.ink, 700, 'left');

  const statusTxt = vm.cutoff ? `LIVE · 截至 ${monthDay(vm.cutoff)}` : 'SEALED TELEMETRY';
  drawText(ctx, statusTxt, 992, 114, 22, p.primary, 700, 'right', MONO, 460);
  drawText(ctx, vm.rangeText, 992, 148, 24, p.muted, 400, 'right', MONO, 460);

  // Title
  drawText(ctx, vm.title, 540, 256, 62, p.ink, 700, 'center', FONT, 900);
  drawText(
    ctx,
    `400m 标准跑道等效 ${vm.derived.trackLapsText}  ·  ${vm.derived.activeRatioText}`,
    540,
    308,
    26,
    p.muted,
    500,
    'center',
    FONT,
    900,
  );

  // Centerpiece Dial Card (y: 356..1260)
  const cx = 540;
  const cy = 816;
  ctx.beginPath();
  ctx.arc(cx, cy, 412, 0, Math.PI * 2);
  ctx.fillStyle = p.card;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Subtle concentric track guide rings
  [185, 255, 325, 385].forEach((r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  if (vm.period === 'year') {
    // 12 Radial Sectors
    const maxD = Math.max(vm.maxDist, 1000);
    const innerR = 192;
    const maxOuterR = 368;
    const step = (Math.PI * 2) / 12;

    vm.buckets.forEach((b, i) => {
      const midA = -Math.PI / 2 + i * step;
      const a0 = midA - step * 0.34;
      const a1 = midA + step * 0.34;

      if (b.distance !== null && b.distance > 0) {
        const outR = innerR + 18 + (b.distance / maxD) * (maxOuterR - innerR - 18);
        ctx.beginPath();
        ctx.arc(cx, cy, outR, a0, a1);
        ctx.arc(cx, cy, innerR, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = b.isPeak ? p.gold : p.primary;
        ctx.globalAlpha = b.isPeak ? 1 : 0.78;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, innerR + 14, a0, a1);
        ctx.strokeStyle = p.line;
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // Month label on outer bezel
      const lx = cx + Math.cos(midA) * 392;
      const ly = cy + Math.sin(midA) * 392 + 8;
      drawText(ctx, b.shortLabel, lx, ly, 21, b.isPeak ? p.ink : p.muted, b.isPeak ? 700 : 500, 'center', FONT, 64);
    });
  } else {
    // Monthly: Concentric Stadium Track Lanes
    const maxD = Math.max(vm.maxDist, 1000);
    const startA = Math.PI * 0.75;
    const fullSweep = Math.PI * 1.5;
    const n = vm.buckets.length;
    const outerR = 366;
    const gap = 36;

    vm.buckets.forEach((b, i) => {
      const r = outerR - i * gap;
      // Track base lane
      ctx.beginPath();
      ctx.arc(cx, cy, r, startA, startA + fullSweep);
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      ctx.stroke();

      if (b.distance !== null && b.distance > 0) {
        const sweep = Math.max(0.12, (b.distance / maxD) * fullSweep);
        ctx.beginPath();
        ctx.arc(cx, cy, r, startA, startA + sweep);
        ctx.strokeStyle = b.isPeak ? p.gold : p.primary;
        ctx.lineWidth = 22;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Lane label at start
      const lx = cx + Math.cos(startA - 0.14) * r;
      const ly = cy + Math.sin(startA - 0.14) * r + 7;
      drawText(ctx, b.shortLabel, lx, ly, 20, b.isPeak ? p.ink : p.muted, 700, 'center', MONO, 50);
    });
  }

  // Center Dial Well
  ctx.beginPath();
  ctx.arc(cx, cy, 174, 0, Math.PI * 2);
  ctx.fillStyle = p.dialWell;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawText(ctx, 'TOTAL KM', cx, cy - 66, 22, p.muted, 700, 'center', MONO, 240);
  drawText(ctx, vm.distanceText, cx, cy + 28, 104, p.primary, 700, 'center', FONT, 300);
  drawText(ctx, '公里', cx, cy + 84, 30, p.muted, 600, 'center', FONT, 200);

  // Peak Pill below Dial
  const peakBanner = `峰值 ${vm.derived.peakLabel} · ${vm.derived.peakKmText}   |   最快均配 ${vm.derived.fastestLabel} · ${vm.derived.fastestPaceText}`;
  ctx.beginPath();
  ctx.roundRect(108, 1266, 864, 68, 34);
  ctx.fillStyle = p.card;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, peakBanner, 540, 1309, 25, p.ink, 600, 'center', FONT, 820);

  // Chronograph 2x2 Metrics
  const accents = [p.primary, '#86a912', '#4bb6df', p.gold];
  vm.metrics.forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 88 + col * 468;
    const y = 1384 + row * 174;
    const w = 436;
    const h = 148;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 26);
    ctx.fillStyle = p.card;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Left accent bar
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 32, 8, h - 64, 4);
    ctx.fillStyle = accents[idx];
    ctx.fill();

    drawText(ctx, m.label, x + 48, y + 54, 26, p.muted, 500, 'left');
    drawText(
      ctx,
      m.unit ? `${m.value} ${m.unit}` : m.value,
      x + 48,
      y + 118,
      54,
      p.ink,
      700,
      'left',
      FONT,
      364,
    );
  });

  // Footer Telemetry Line
  const footLeft = vm.coverageText ? vm.coverageText : `单次均距 ${vm.derived.avgRunKmText} · 等效 ${vm.derived.marathonsText}`;
  drawText(ctx, footLeft, 88, 1814, 24, p.muted, 500, 'left', FONT, 600);
  drawText(ctx, 'RUNNOTE · TRACK TELEMETRY', 992, 1814, 21, p.muted, 700, 'right', MONO, 340);

  return canvas;
}
