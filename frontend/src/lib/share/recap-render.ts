import { monthDay, recapPeak, type Recap } from '#lib/recap.ts';
import { posterPalette } from '#lib/share/route-poster-render.ts';

export async function renderRecap(recap: Recap, element: HTMLElement): Promise<Blob> {
  const palette = posterPalette(element);
  const css = getComputedStyle(element);
  const tint = css.getPropertyValue('--header-tint').trim();
  const ink = css.getPropertyValue('--header-ink').trim();
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法生成图片');
    function text(value: string, x: number, y: number, size: number, color: string, weight = 400, width = 912) {
      const drawing = ctx!;
      drawing.font = `${weight} ${size}px ${palette.font}`;
      const measured = drawing.measureText(value).width;
      if (measured > width) drawing.font = `${weight} ${Math.floor((size * width) / measured)}px ${palette.font}`;
      drawing.fillStyle = color;
      drawing.fillText(value, x, y);
      return drawing.measureText(value).width;
    }
    function shape(x: number, y: number, width: number, height: number, radius: number, fill: string) {
      ctx!.beginPath();
      ctx!.roundRect(x, y, width, height, radius);
      ctx!.fillStyle = fill;
      ctx!.fill();
    }
    ctx.fillStyle = palette.surface;
    ctx.fillRect(0, 0, 1080, 1920);
    shape(84, 90, 64, 64, 32, palette.route);
    ctx.textAlign = 'center';
    text('R', 116, 135, 36, palette.brandInk, 700);
    ctx.textAlign = 'start';
    text('RunNote', 164, 135, 36, palette.foreground, 700);
    ctx.textAlign = 'right';
    text(recap.range, 996, 123, 28, palette.muted, 400, 560);
    if (recap.cutoff) text(`进行中 · 截至 ${monthDay(recap.cutoff)}`, 996, 159, 26, palette.muted, 400, 560);
    ctx.textAlign = 'start';
    text(recap.title, 84, 310, 72, palette.foreground, 700);

    shape(84, 370, 912, 326, 36, tint);
    text('总里程', 136, 464, 34, ink, 600);
    const distanceWidth = text(recap.distance, 136, 623, 168, palette.route, 700, 690);
    text('km', 154 + distanceWidth, 623, 52, palette.route, 600, 85);

    text(recap.period === 'year' ? '每月里程' : '每周里程', 84, 819, 42, palette.foreground, 600);
    const peak = recapPeak(recap);
    if (peak) text(peak, 84, 873, 30, palette.muted);
    const base = 1220;
    const slot = 912 / recap.buckets.length;
    ctx.fillStyle = palette.line;
    ctx.fillRect(84, base, 912, 2);
    recap.buckets.forEach((bucket, index) => {
      const center = 84 + slot * (index + 0.5);
      const width = Math.min(slot * 0.62, 78);
      if (bucket.distance) {
        const height = Math.max(1, (bucket.distance / recap.max) * 272);
        ctx.globalAlpha = bucket.peak ? 1 : 0.6;
        shape(center - width / 2, base - height, width, height, Math.min(10, height / 2), palette.route);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'center';
      text(bucket.label, center, 1268, 25, palette.muted, 400, slot - 4);
    });
    ctx.textAlign = 'start';

    recap.metrics.forEach((metric, i) => {
      const x = 84 + (i % 2) * 476;
      const y = 1380 + Math.floor(i / 2) * 170;
      ctx.fillStyle = palette.line;
      ctx.fillRect(x, y, 436, 2);
      text(metric.label, x, y + 52, 30, palette.muted);
      const valueWidth = text(metric.value, x, y + 125, 64, palette.foreground, 700, metric.unit ? 352 : 436);
      if (metric.unit) text(metric.unit, x + valueWidth + 12, y + 125, 28, palette.muted, 400, 72);
    });
    if (recap.coverage) text(recap.coverage, 84, 1800, 28, palette.muted);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('分享图生成失败，请重试'))), 'image/png'),
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
