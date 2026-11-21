/**
 * Direction C — 1080×1920 Canvas 2D Poster Renderer ("奔跑存根 · Tactile Runner's Receipt")
 * Physical serrated receipt stub with side punch notches, rubber stamp, punch-card dot blocks,
 * dotted-leader metrics, and purely decorative mileage-proportion barcode.
 */
import { monthDay } from '../shared/data.js';

const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

function palette(theme) {
  if (theme === 'dark') {
    return {
      desk: '#201e1c',
      paper: '#312f2c',
      paperBorder: '#494540',
      capBg: '#1c1b19',
      capInk: '#77d4ac',
      markBg: '#77d4ac',
      markInk: '#10251b',
      ink: '#f2f0ee',
      muted: '#b1aca6',
      primary: '#77d4ac',
      gold: '#f5c519',
      line: '#494540',
      well: '#272523',
    };
  }
  return {
    desk: '#eaece4',
    paper: '#fcfcf7',
    paperBorder: '#d8ded2',
    capBg: '#f5c519',
    capInk: '#1e2c22',
    markBg: '#1e2c22',
    markInk: '#f5c519',
    ink: '#1f2d23',
    muted: '#5c695e',
    primary: '#17745c',
    gold: '#e0ab00',
    line: '#d6ddd0',
    well: '#f2f4ec',
  };
}

function drawText(ctx, text, x, y, size, color, weight = 400, align = 'left', family = FONT, maxW = 820) {
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${family}`;
  const m = ctx.measureText(text).width;
  if (m > maxW) ctx.font = `${weight} ${Math.floor((size * maxW) / m)}px ${family}`;
  ctx.fillText(text, x, y);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

function drawSerratedEdge(ctx, x, y, width, teeth, toothH, down = true) {
  const step = width / teeth;
  for (let i = 0; i < teeth; i++) {
    const x0 = x + i * step;
    const xm = x0 + step / 2;
    const x1 = x0 + step;
    ctx.lineTo(xm, down ? y + toothH : y - toothH);
    ctx.lineTo(x1, y);
  }
}

export function renderPosterC(vm, theme = 'light') {
  const p = palette(theme);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');

  // Desk backdrop
  ctx.fillStyle = p.desk;
  ctx.fillRect(0, 0, 1080, 1920);

  // Subtle paper receipt body with serrated bottom edge
  const tx = 76;
  const ty = 64;
  const tw = 928;
  const th = 1774;

  ctx.save();
  ctx.shadowColor = theme === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(20,38,28,0.14)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  ctx.beginPath();
  ctx.moveTo(tx + 34, ty);
  ctx.lineTo(tx + tw - 34, ty);
  ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + 34);
  ctx.lineTo(tx + tw, ty + th - 16);
  drawSerratedEdge(ctx, tx + tw, ty + th - 16, -tw, 28, 16, true);
  ctx.lineTo(tx, ty + 34);
  ctx.quadraticCurveTo(tx, ty, tx + 34, ty);
  ctx.closePath();
  ctx.fillStyle = p.paper;
  ctx.fill();
  ctx.restore();

  // Clip header cap cleanly to rounded top
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(tx, ty, tw, 128, [34, 34, 0, 0]);
  ctx.fillStyle = p.capBg;
  ctx.fill();
  ctx.restore();

  // Brand in cap
  ctx.beginPath();
  ctx.roundRect(tx + 44, ty + 34, 58, 58, 16);
  ctx.fillStyle = p.markBg;
  ctx.fill();
  drawText(ctx, 'R', tx + 73, ty + 76, 34, p.markInk, 700, 'center');
  drawText(ctx, 'RUNNOTE', tx + 118, ty + 75, 32, p.capInk, 700, 'left', MONO, 300);
  drawText(ctx, vm.period === 'year' ? `ANNUAL RECEIPT · ${vm.year}` : `MONTHLY RECEIPT · ${vm.year}.${String(vm.month).padStart(2, '0')}`, tx + tw - 44, ty + 73, 24, p.capInk, 700, 'right', MONO, 460);

  // Stub 01: Title + Hero Distance + Rubber Stamp
  drawText(ctx, vm.title, tx + 48, 284, 56, p.ink, 700, 'left', FONT, 600);
  drawText(
    ctx,
    vm.cutoff ? `${vm.rangeText}  ·  进行中 截至 ${monthDay(vm.cutoff)}` : vm.rangeText,
    tx + 48,
    336,
    25,
    p.muted,
    500,
    'left',
    MONO,
    620,
  );

  // Tilted Rubber Stamp on right
  ctx.save();
  ctx.translate(tx + tw - 134, 348);
  ctx.rotate(-0.16);
  ctx.beginPath();
  ctx.arc(0, 0, 88, 0, Math.PI * 2);
  ctx.fillStyle = theme === 'dark' ? 'rgba(119,212,172,0.08)' : 'rgba(23,116,92,0.06)';
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
  drawText(ctx, vm.cutoff ? 'IN PROGRESS' : 'SEALED', 0, -34, 17, p.primary, 700, 'center', MONO, 130);
  drawText(ctx, vm.derived.activeRatioShort.split(' ')[0], 0, 14, 42, p.primary, 700, 'center', FONT, 130);
  drawText(ctx, vm.period === 'year' ? 'ACTIVE MOS' : 'ACTIVE WKS', 0, 46, 15, p.primary, 700, 'center', MONO, 130);
  ctx.restore();

  // Giant Distance
  drawText(ctx, 'TOTAL MILEAGE · 核销里程', tx + 48, 430, 22, p.primary, 700, 'left', MONO, 500);
  const dw = drawText(ctx, vm.distanceText, tx + 44, 594, 182, p.ink, 700, 'left', FONT, 660);
  drawText(ctx, 'KM', tx + 44 + dw + 18, 594, 52, p.primary, 700, 'left', MONO, 120);
  drawText(
    ctx,
    `等效 ${vm.derived.marathonsText}  ·  单次均距 ${vm.derived.avgRunKmText}`,
    tx + 48,
    654,
    26,
    p.muted,
    500,
    'left',
    FONT,
    800,
  );

  // Perforation 1
  function perforation(y) {
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

  // Stub 02: Punch-Card Rhythm Matrix (y: 758..1194)
  drawText(ctx, '02 · PUNCH-CARD RHYTHM', tx + 48, 792, 22, p.primary, 700, 'left', MONO, 420);
  drawText(ctx, `PEAK · ${vm.derived.peakLabel} ${vm.derived.peakKmText}`, tx + tw - 48, 792, 23, p.ink, 700, 'right', MONO, 420);

  // Well container
  ctx.beginPath();
  ctx.roundRect(tx + 44, 824, tw - 88, 344, 24);
  ctx.fillStyle = p.well;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  const cols = vm.buckets.length;
  const innerX = tx + 68;
  const innerW = tw - 136;
  const colW = innerW / cols;
  const maxD = Math.max(vm.maxDist, 1000);
  const maxBlocks = 10;
  const blockH = 18;
  const blockGap = 7;
  const stackBottom = 1106;

  vm.buckets.forEach((b, i) => {
    const cx = innerX + colW * (i + 0.5);
    const bw = Math.min(colW * 0.68, 54);
    if (b.distance !== null && b.distance > 0) {
      const count = Math.max(1, Math.round((b.distance / maxD) * maxBlocks));
      for (let k = 0; k < count; k++) {
        const by = stackBottom - (k + 1) * blockH - k * blockGap;
        ctx.beginPath();
        ctx.roundRect(cx - bw / 2, by, bw, blockH, 5);
        ctx.fillStyle = b.isPeak ? p.gold : p.primary;
        ctx.globalAlpha = b.isPeak ? 1 : 0.82;
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
    drawText(ctx, b.shortLabel, cx, 1146, 22, b.isPeak ? p.ink : p.muted, b.isPeak ? 700 : 500, 'center', FONT, colW - 2);
  });

  perforation(1224);

  // Stub 03: Dotted-Leader Metrics Ledger (y: 1272..1580)
  drawText(ctx, '03 · VERIFIED SUMMARY', tx + 48, 1296, 22, p.primary, 700, 'left', MONO, 420);
  drawText(ctx, `FASTEST ${vm.derived.fastestLabel} · ${vm.derived.fastestPaceText}`, tx + tw - 48, 1296, 22, p.muted, 600, 'right', MONO, 420);

  vm.metrics.forEach((m, idx) => {
    const ry = 1368 + idx * 72;
    const lw = drawText(ctx, m.label, tx + 48, ry, 30, p.muted, 500, 'left', FONT, 240);
    const valStr = m.unit ? `${m.value} ${m.unit}` : m.value;
    const rw = drawText(ctx, valStr, tx + tw - 48, ry, 42, p.ink, 700, 'right', FONT, 420);

    // Dotted leader line between label & value
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

  if (vm.coverageText) {
    drawText(ctx, `注：${vm.coverageText}`, tx + 48, 1638, 22, p.muted, 500, 'left', FONT, 800);
  }

  // Purely decorative Mileage Fingerprint Barcode (no personal data encoded)
  const bcLeft = tx + 48;
  const bcW = tw - 96;
  const bcBase = 1748;
  const bars = 36;
  const barStep = bcW / bars;
  for (let i = 0; i < bars; i++) {
    const b = vm.buckets[i % vm.buckets.length];
    const ratio = b.distance ? b.distance / maxD : 0.14;
    const h = 24 + ratio * 52;
    const w = Math.max(4, barStep * (0.35 + ratio * 0.45));
    ctx.fillStyle = p.ink;
    ctx.globalAlpha = 0.78;
    ctx.fillRect(bcLeft + i * barStep, bcBase - h, w, h);
  }
  ctx.globalAlpha = 1;

  drawText(ctx, 'MILEAGE FINGERPRINT · RUNNOTE', tx + 48, 1786, 20, p.muted, 700, 'left', MONO, 460);
  drawText(ctx, `${vm.activityCount} RUNS · ${vm.activityDays} DAYS`, tx + tw - 48, 1786, 20, p.muted, 700, 'right', MONO, 380);

  return canvas;
}
