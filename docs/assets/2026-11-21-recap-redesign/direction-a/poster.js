/**
 * Direction A — 1080×1920 Canvas 2D Poster Renderer ("跑道年鉴 · Editorial Monolith")
 * Strict whitelist only: period, cutoff, aggregate totals, non-geo bucket distribution, RunNote brand.
 * Zero external fonts or images.
 */
import { formatKm, monthDay } from '../shared/data.js';

const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";

function getPalette(theme) {
  if (theme === 'dark') {
    return {
      topBgA: '#1d2420',
      topBgB: '#121614',
      bottomBg: '#292725',
      cardBg: '#33312f',
      topInk: '#f2f0ee',
      topMuted: '#a6b5ad',
      heroNum: '#77d4ac',
      gold: '#f5d36c',
      ink: '#f2f0ee',
      muted: '#b1aca6',
      primary: '#77d4ac',
      primaryFillTop: 'rgba(119, 212, 172, 0.34)',
      primaryFillBottom: 'rgba(119, 212, 172, 0.02)',
      line: '#46433f',
      brandBg: '#f2f0ee',
      brandInk: '#1d1c1a',
    };
  }
  return {
    topBgA: '#155946',
    topBgB: '#0c362a',
    bottomBg: '#f6f7f4',
    cardBg: '#ffffff',
    topInk: '#f7f8f5',
    topMuted: '#b7d7cb',
    heroNum: '#ffffff',
    gold: '#f5c519',
    ink: '#202d23',
    muted: '#5c695e',
    primary: '#17745c',
    primaryFillTop: 'rgba(23, 116, 92, 0.28)',
    primaryFillBottom: 'rgba(23, 116, 92, 0.02)',
    line: '#dce3d6',
    brandBg: '#f5c519',
    brandInk: '#12382b',
  };
}

function drawText(ctx, text, x, y, size, color, weight = 400, maxWidth = 912, align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  const measured = ctx.measureText(text).width;
  if (measured > maxWidth) {
    ctx.font = `${weight} ${Math.floor((size * maxWidth) / measured)}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

export function renderPosterA(vm, theme = 'light') {
  const p = getPalette(theme);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');

  // 1. Full bleed top monolith surface (0..820)
  const heroH = 820;
  const bgGrad = ctx.createLinearGradient(0, 0, 1080, heroH);
  bgGrad.addColorStop(0, p.topBgA);
  bgGrad.addColorStop(1, p.topBgB);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1080, heroH);

  // Subtle architectural track-arc watermark in top monolith
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 1080, heroH);
  ctx.clip();
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.roundRect(420 + i * 38, -140 + i * 38, 860 - i * 76, 620 - i * 76, 310 - i * 38);
    ctx.strokeStyle = theme === 'dark' ? `rgba(119, 212, 172, ${0.14 - i * 0.025})` : `rgba(245, 197, 25, ${0.22 - i * 0.04})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // Bottom warm editorial paper surface (820..1920)
  ctx.fillStyle = p.bottomBg;
  ctx.fillRect(0, heroH, 1080, 1920 - heroH);

  // 2. Top Brand Bar
  ctx.beginPath();
  ctx.roundRect(84, 82, 58, 58, 18);
  ctx.fillStyle = p.brandBg;
  ctx.fill();
  drawText(ctx, 'R', 113, 125, 34, p.brandInk, 700, 48, 'center');
  drawText(ctx, 'RunNote', 160, 124, 34, p.topInk, 700, 320, 'left');

  drawText(ctx, vm.issueTag, 996, 108, 22, p.gold, 700, 440, 'right');
  drawText(ctx, vm.rangeText, 996, 142, 24, p.topMuted, 400, 440, 'right');

  // Hairline rule under brand bar
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(84, 178, 912, 1.5);

  // 3. Period Title & In-progress badge
  drawText(ctx, vm.title, 84, 272, 62, p.topInk, 700, 912, 'left');
  if (vm.cutoff) {
    const pillText = `进行中 · 截至 ${monthDay(vm.cutoff)}`;
    ctx.save();
    ctx.font = `600 24px ${FONT}`;
    const pw = ctx.measureText(pillText).width + 44;
    ctx.beginPath();
    ctx.roundRect(84, 304, pw, 46, 23);
    ctx.fillStyle = 'rgba(245, 197, 25, 0.16)';
    ctx.fill();
    ctx.strokeStyle = p.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    drawText(ctx, pillText, 106, 336, 24, p.gold, 600, 460, 'left');
  }

  // 4. Giant Hero Numeral
  drawText(ctx, 'TOTAL DISTANCE · 总里程', 84, 428, 24, p.topMuted, 600, 600, 'left');
  const distW = drawText(ctx, vm.distanceText, 80, 622, 212, p.heroNum, 700, 770, 'left');
  drawText(ctx, 'km', 80 + distW + 22, 622, 64, p.gold, 600, 140, 'left');

  // Scale ruler bar inside hero
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.roundRect(84, 684, 912, 10, 5);
  ctx.fill();

  const barRatio = Math.min(1, Math.max(0.14, vm.derived.peakSharePct / 100 * 2.2));
  const fillGrad = ctx.createLinearGradient(84, 0, 84 + 912 * barRatio, 0);
  fillGrad.addColorStop(0, p.gold);
  fillGrad.addColorStop(1, '#9ce4c3');
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.roundRect(84, 684, 912 * barRatio, 10, 5);
  ctx.fill();

  drawText(
    ctx,
    `等效 ${vm.derived.marathonsText}  ·  ${vm.derived.activeRatioText}`,
    84,
    744,
    27,
    p.topMuted,
    500,
    640,
    'left',
  );
  drawText(
    ctx,
    `单次均距 ${vm.derived.avgRunKmText}`,
    996,
    744,
    27,
    p.topInk,
    600,
    300,
    'right',
  );

  // 5. Lower Section — Smooth Mileage Terrain Card (y: 868..1372)
  ctx.beginPath();
  ctx.roundRect(64, 868, 952, 496, 36);
  ctx.fillStyle = p.cardBg;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawText(
    ctx,
    vm.period === 'year' ? '02 · 全年里程地形' : '02 · 本月周度地形',
    112,
    936,
    32,
    p.ink,
    700,
    460,
    'left',
  );
  if (vm.derived.peakLabel) {
    drawText(
      ctx,
      `峰值 ${vm.derived.peakLabel} · ${vm.derived.peakKmText}`,
      968,
      936,
      26,
      p.primary,
      600,
      440,
      'right',
    );
  }

  // Terrain geometry
  const chartLeft = 112;
  const chartRight = 968;
  const chartTop = 996;
  const chartBottom = 1266;
  const chartW = chartRight - chartLeft;
  const chartH = chartBottom - chartTop;
  const n = vm.buckets.length;
  const stepX = n > 1 ? chartW / (n - 1) : chartW;
  const maxVal = Math.max(vm.maxDist, 1000);

  // Subtle horizontal guide lines
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1.5;
  for (let g = 0; g <= 2; g++) {
    const gy = chartBottom - (chartH * g) / 2;
    ctx.beginPath();
    ctx.moveTo(chartLeft, gy);
    ctx.lineTo(chartRight, gy);
    ctx.stroke();
  }

  const pts = vm.buckets.map((b, i) => {
    const x = n === 1 ? chartLeft + chartW / 2 : chartLeft + i * stepX;
    const y = b.distance === null ? null : chartBottom - (b.distance / maxVal) * (chartH - 22);
    return { x, y, b };
  });

  const validPts = pts.filter((pt) => pt.y !== null);
  if (validPts.length >= 2) {
    // Smooth monotone-ish cubic spline area fill
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
    areaGrad.addColorStop(0, p.primaryFillTop);
    areaGrad.addColorStop(1, p.primaryFillBottom);
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Stroke curve
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

  // Vertical stems & points + labels
  pts.forEach((pt) => {
    if (pt.y !== null) {
      if (pt.b.isPeak) {
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
        ctx.strokeStyle = p.cardBg;
        ctx.stroke();
        ctx.restore();

        // Peak numeric badge above point
        const peakTxt = `${formatKm(pt.b.distance, 1)}`;
        drawText(ctx, peakTxt, pt.x, pt.y - 24, 24, p.ink, 700, 120, 'center');
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = p.primary;
        ctx.fill();
      }
    }
    drawText(
      ctx,
      pt.b.shortLabel,
      pt.x,
      chartBottom + 44,
      23,
      pt.b.isPeak ? p.ink : p.muted,
      pt.b.isPeak ? 700 : 500,
      78,
      'center',
    );
  });

  // 6. Editorial 2x2 Metric Ledger (y: 1412..1748)
  vm.metrics.forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 64 + col * 492;
    const y = 1412 + row * 172;
    const w = 460;
    const h = 148;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 28);
    ctx.fillStyle = p.cardBg;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    drawText(ctx, m.label, x + 36, y + 52, 26, p.muted, 500, 360, 'left');
    const vw = drawText(ctx, m.value, x + 36, y + 118, 60, p.ink, 700, m.unit ? 300 : 388, 'left');
    if (m.unit) {
      drawText(ctx, m.unit, x + 36 + vw + 12, y + 118, 26, p.muted, 500, 96, 'left');
    }
  });

  // 7. Editorial Colophon Footer
  ctx.fillStyle = p.line;
  ctx.fillRect(64, 1790, 952, 2);
  const leftFoot = vm.coverageText ? vm.coverageText : `最快均配 ${vm.derived.fastestLabel} · ${vm.derived.fastestPaceText}`;
  drawText(ctx, leftFoot, 64, 1848, 25, p.muted, 500, 620, 'left');
  drawText(ctx, 'RUNNOTE · PERSONAL RECAP', 1016, 1848, 22, p.muted, 700, 340, 'right');

  return canvas;
}
