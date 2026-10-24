import { brandInitial } from '../site.ts';
import { routeDrawing, routeEndpoints } from '../api/route-drawing.ts';
import type { ActivityPosterData } from './activity-poster-data.ts';
import type { PosterBrand, PosterPalette } from './route-poster-render.ts';

export const activityPosterStyles = [
  { id: 'trace', name: '路线大图', description: '轨迹为主 · 数字在底部', routes: true },
  { id: 'sport', name: '运动海报', description: '绿色主视觉 · 醒目里程', routes: true },
  { id: 'ticket', name: '跑步票根', description: '虚线存根 · 小轨迹清单', routes: true },
  { id: 'numeral', name: '大字里程', description: '纯数字排版 · 不含轨迹', routes: false },
] as const;
export type ActivityPosterStyle = typeof activityPosterStyles[number]['id'];
export const activityPosterHasRoute = (style: ActivityPosterStyle) =>
  activityPosterStyles.some(preset => preset.id === style && preset.routes);

/** Output is raster pixels only; the route is redrawn locally and never leaves the browser. */
export async function renderActivityPoster(data: ActivityPosterData, palette: PosterPalette,
  style: ActivityPosterStyle = 'trace', brand: PosterBrand = { title: 'RunNote', logo: null }): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1920;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法生成图片，请换一个浏览器重试');
    ctx.fillStyle = palette.background; ctx.fillRect(0, 0, 1080, 1920);
    const text = (value: string, x: number, y: number, size: number, color = palette.foreground, weight = 400, maxWidth?: number, align: CanvasTextAlign = 'left') => {
      ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${palette.font}`; ctx.textAlign = align;
      if (maxWidth) ctx.fillText(value, x, y, maxWidth); else ctx.fillText(value, x, y);
      ctx.textAlign = 'left';
    };
    const panel = (x: number, y: number, width: number, height: number, fill: string, radius = 32, stroke = true) => {
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = palette.line; ctx.lineWidth = 2; ctx.stroke(); }
    };
    const line = (x: number, y: number, width: number) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.strokeStyle = palette.line; ctx.lineWidth = 2; ctx.stroke();
    };
    const dot = (point: [number, number], radius: number, fill: string, ring: string) => {
      ctx.beginPath(); ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ring; ctx.lineWidth = radius / 3; ctx.stroke();
    };
    const route = (x: number, y: number, width: number, height: number, color: string, stroke: number, ring: string, endColor: string, startColor = palette.success) => {
      if (!data.route) return;
      const drawing = routeDrawing(data.route, width, height), ends = routeEndpoints(data.route, width, height);
      ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = color; ctx.globalAlpha = .14; ctx.lineWidth = stroke * 3;
      for (const path of drawing.paths) ctx.stroke(new Path2D(path));
      ctx.globalAlpha = 1; ctx.lineWidth = stroke;
      for (const path of drawing.paths) ctx.stroke(new Path2D(path));
      dot(ends.start, stroke * 1.7, startColor, ring); dot(ends.end, stroke * 1.7, endColor, ring);
      ctx.restore();
    };
    const stat = (label: string, value: string, x: number, y: number, color = palette.foreground, maxWidth = 400) => {
      text(label, x, y, 32, palette.muted); text(value, x, y + 74, 66, color, 600, maxWidth);
    };
    const mark = (x: number, y: number, ink: string, tile = palette.route, letter = palette.brandInk) => {
      if (brand.logo) {
        ctx.save(); ctx.beginPath(); ctx.roundRect(x, y - 48, 56, 56, 16); ctx.clip();
        ctx.drawImage(brand.logo, x, y - 48, 56, 56); ctx.restore();
      } else {
        panel(x, y - 48, 56, 56, tile, 16, false);
        text(brandInitial(brand.title), x + 28, y - 6, 36, letter, 700, 34, 'center');
      }
      text(brand.title, x + 76, y - 4, 38, ink, 700, 520);
    };
    // Right edge of a figure drawn at the given size, so its unit can follow it.
    const after = (value: string, x: number, size: number, weight: number, maxWidth: number) => {
      ctx.font = `${weight} ${size}px ${palette.font}`; return x + Math.min(maxWidth, ctx.measureText(value).width) + 24;
    };
    const when = `${data.date} · ${data.weekday}`;

    switch (style) {
      case 'trace':
        mark(110, 150, palette.route);
        text(when, 970, 146, 32, palette.muted, 400, 480, 'right');
        text(data.title, 110, 262, 56, palette.foreground, 600, 860);
        route(110, 380, 860, 700, palette.route, 10, palette.background, palette.foreground);
        line(110, 1300, 860);
        text(data.kilometers, 104, 1520, 230, palette.foreground, 700, 560);
        text('公里', after(data.kilometers, 104, 230, 700, 560), 1520, 56, palette.muted);
        stat('用时', data.duration, 110, 1650);
        stat('平均配速', `${data.pace}/公里`, 560, 1650, palette.foreground, 410);
        break;
      case 'sport':
        panel(0, -60, 1080, 1300, palette.route, 60, false);
        mark(90, 150, palette.brandInk, palette.brandInk, palette.route);
        text(data.date, 990, 146, 32, palette.brandInk, 400, 480, 'right');
        route(150, 220, 780, 640, palette.heading, 14, palette.route, palette.foreground, palette.brandInk);
        text(data.kilometers, 84, 1130, 250, palette.brandInk, 700, 700);
        text('公里', after(data.kilometers, 84, 250, 700, 700), 1130, 60, palette.brandInk);
        text(data.title, 90, 1400, 52, palette.foreground, 600, 900);
        text(data.weekday, 90, 1465, 34, palette.muted);
        stat('用时', data.duration, 90, 1590);
        stat('平均配速', `${data.pace}/公里`, 560, 1590, palette.foreground, 430);
        break;
      case 'ticket': {
        panel(110, 170, 860, 1580, palette.surface, 44);
        ctx.save(); ctx.beginPath(); ctx.roundRect(110, 170, 860, 1580, 44); ctx.clip();
        ctx.fillStyle = palette.heading; ctx.fillRect(110, 170, 860, 190); ctx.restore();
        text(brand.title, 190, 290, 64, palette.headingInk, 700, 440);

        text('RUN TICKET', 890, 288, 36, palette.headingInk, 700, 300, 'right');
        text(when, 190, 470, 36, palette.muted, 400, 700);
        text(data.title, 190, 600, 58, palette.foreground, 600, 700);
        route(220, 620, 640, 380, palette.route, 8, palette.surface, palette.foreground);
        ctx.save(); ctx.setLineDash([14, 12]); line(150, 1100, 780); ctx.restore();
        for (const x of [110, 970]) { ctx.beginPath(); ctx.arc(x, 1100, 32, 0, Math.PI * 2); ctx.fillStyle = palette.background; ctx.fill(); }
        text(data.kilometers, 190, 1290, 180, palette.foreground, 700, 480);
        text('公里', after(data.kilometers, 190, 180, 700, 480), 1290, 50, palette.muted);
        for (const [i, [label, value]] of [['用时', data.duration], ['平均配速', `${data.pace}/公里`]].entries()) {
          const y = 1430 + i * 100;
          text(label, 190, y, 38, palette.muted); text(value, 890, y, 46, palette.foreground, 600, 440, 'right');
        }
        break;
      }
      case 'numeral': {
        mark(110, 150, palette.route);
        text(data.weekday, 970, 146, 34, palette.muted, 400, 200, 'right');
        text(data.date, 110, 260, 44, palette.muted, 400, 860);
        const [whole, fraction = ''] = data.kilometers.split('.');
        text(whole, 90, 930, 520, palette.route, 700, 880);
        text(fraction ? `.${fraction}` : '', 110, 1230, 190, palette.foreground, 700, 400);
        text('公里', 110 + (fraction ? 340 : 0), 1230, 64, palette.muted);
        for (const [i, [label, value]] of [['标题', data.title], ['用时', data.duration], ['平均配速', `${data.pace}/公里`]].entries()) {
          const y = 1480 + i * 140;
          line(110, y - 70, 860);
          text(label, 110, y, 40, palette.muted); text(value, 970, y, 56, palette.foreground, 600, 620, 'right');
        }
        line(110, 1810, 860);
        break;
      }
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败，请重试')), 'image/png'));
  } finally { canvas.width = 0; canvas.height = 0; }
}
