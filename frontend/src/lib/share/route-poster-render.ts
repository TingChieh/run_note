import type { PosterData } from './route-poster-data.ts';

export interface PosterPalette {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  route: string;
  line: string;
  heading: string;
  headingInk: string;
  brandInk: string;
  font: string;
}

/** Resolve the same semantic theme tokens as the surrounding RunNote UI. */
export function posterPalette(element: HTMLElement): PosterPalette {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return { background: token('background'), surface: token('surface'), foreground: token('foreground'),
    muted: token('muted-foreground'), route: token('primary'), line: token('border'),
    heading: token('sport-yellow'), headingInk: token('sport-heading-ink'),
    brandInk: token('primary-foreground'), font: token('font-body') };
}

export const posterPeriod = (month?: string) => month ? `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月` : '全部记录';

/** Output is raster pixels only. No original track or user metadata enters the file. */
export async function renderPoster(data: PosterData, palette: PosterPalette): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1920;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法生成图片，请换一个浏览器重试');
    ctx.fillStyle = palette.background; ctx.fillRect(0, 0, 1080, 1920);
    const text = (value: string, x: number, y: number, size: number, color = palette.foreground, weight = 400, maxWidth?: number) => {
      ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${palette.font}`;
      if (maxWidth) ctx.fillText(value, x, y, maxWidth); else ctx.fillText(value, x, y);
    };
    const panel = (x: number, y: number, width: number, height: number, fill: string, radius = 32) => {
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = palette.line; ctx.lineWidth = 1; ctx.stroke();
    };
    panel(54, 42, 48, 48, palette.route, 14);
    text('R', 65, 78, 34, palette.brandInk, 700);
    text('RunNote', 118, 79, 35, palette.foreground, 650);
    text('每一步，都算数', 794, 76, 25, palette.muted);
    panel(48, 128, 984, 330, palette.heading);
    text(data.month ? '这个月，我跑了' : '已累计跑了', 82, 200, 40, palette.headingInk, 500);
    text(data.kilometers, 74, 351, data.kilometers.length > 8 ? 104 : 142, palette.headingInk, 650, 790);
    text('公里', 911, 345, 31, palette.headingInk);
    text(posterPeriod(data.month), 84, 414, 25, palette.headingInk);

    panel(48, 490, 984, 1036, palette.surface);
    const columns = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(data.cells.length * 10 / 12))));
    const rows = Math.ceil(data.cells.length / columns), cellWidth = 920 / columns;
    const cellHeight = Math.min(190, 956 / rows), gridTop = 530 + (956 - rows * cellHeight) / 2;
    for (let i = 0; i < data.cells.length; i++) {
      const drawing = data.cells[i], column = i % columns, row = Math.floor(i / columns);
      const x = 80 + column * cellWidth, y = gridTop + row * cellHeight;
      const scale = Math.min((cellWidth - 18) / 360, (cellHeight - 22) / 220);
      ctx.save(); ctx.translate(x + (cellWidth - 360 * scale) / 2, y + (cellHeight - 220 * scale) / 2); ctx.scale(scale, scale);
      ctx.strokeStyle = palette.route; ctx.fillStyle = palette.route;
      ctx.lineWidth = 2.2 / scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const path of drawing.paths) ctx.stroke(new Path2D(path));
      for (const [px, py] of drawing.points) { ctx.beginPath(); ctx.arc(px, py, 2.2 / scale, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    text(`随机展示 ${data.cells.length} / ${data.routeCount} 条轨迹`, 76, 1582, 24, palette.muted);
    panel(48, 1630, 984, 218, palette.surface);
    text('距离约等于', 80, 1680, 24, palette.muted);
    text(data.halfMarathons, 75, 1770, 82, palette.foreground, 550, 340);
    text('次半程马拉松', 80, 1816, 24, palette.muted);
    text('每次出发，都留下了足迹', 575, 1680, 24, palette.muted);
    text(`${data.activityCount.toLocaleString('zh-CN')} 次跑步`, 575, 1748, 42, palette.foreground, 550, 420);
    text(`${data.activityDays.toLocaleString('zh-CN')} 个活动日`, 575, 1810, 29, palette.muted, 400, 420);
    text('统计覆盖所选范围全部记录 · 半马为距离折算', 76, 1894, 21, palette.muted);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败，请重试')), 'image/png'));
  } finally { canvas.width = 0; canvas.height = 0; }
}
