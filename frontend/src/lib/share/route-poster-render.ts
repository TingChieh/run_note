import type { PosterData } from './route-poster-data.ts';

export const posterStyles = [
  { id: 'classic', name: '经典足迹', description: '黄色页头 · 规整网格', routes: true },
  { id: 'gallery', name: '极简画廊', description: '舒展留白 · 纯粹路线', routes: true },
  { id: 'sport', name: '运动海报', description: '绿色主视觉 · 醒目数字', routes: true },
  { id: 'journal', name: '足迹手账', description: '路线小卡 · 轻微错落', routes: true },
  { id: 'numeral', name: '大字里程', description: '纯数字排版 · 不含轨迹', routes: false },
  { id: 'ticket', name: '跑步票根', description: '清单存根 · 不含轨迹', routes: false },
  { id: 'medal', name: '半马勋章', description: '圆环徽章 · 不含轨迹', routes: false },
  { id: 'stripe', name: '动感斜纹', description: '运动色带 · 不含轨迹', routes: false },
] as const;
export type PosterStyle = typeof posterStyles[number]['id'];
export const posterHasRoutes = (style: PosterStyle) => posterStyles.some(preset => preset.id === style && preset.routes);

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

type Box = { x: number; y: number; width: number; height: number };

/** Output is raster pixels only. No original track or user metadata enters the file. */
export async function renderPoster(data: PosterData, palette: PosterPalette, style: PosterStyle = 'classic'): Promise<Blob> {
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
    const line = (x: number, y: number, width: number) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y);
      ctx.strokeStyle = palette.line; ctx.lineWidth = 1; ctx.stroke();
    };
    const route = (drawing: PosterData['cells'][number], box: Box) => {
      const scale = Math.min(box.width / 360, box.height / 220);
      ctx.save(); ctx.translate(box.x + (box.width - 360 * scale) / 2, box.y + (box.height - 220 * scale) / 2); ctx.scale(scale, scale);
      ctx.strokeStyle = palette.route; ctx.fillStyle = palette.route;
      ctx.lineWidth = 2.2 / scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const path of drawing.paths) ctx.stroke(new Path2D(path));
      for (const [px, py] of drawing.points) { ctx.beginPath(); ctx.arc(px, py, 2.2 / scale, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    };
    const grid = (box: Box, cards = false) => {
      if (!data.cells.length) return;
      const columns = Math.min(data.cells.length, 10, Math.max(3, Math.ceil(Math.sqrt(data.cells.length * box.width / box.height))));
      const rows = Math.ceil(data.cells.length / columns);
      const cellWidth = Math.min(320, box.width / columns), cellHeight = Math.min(220, box.height / rows);
      const top = box.y + (box.height - rows * cellHeight) / 2;
      for (let i = 0; i < data.cells.length; i++) {
        const row = Math.floor(i / columns), inRow = Math.min(columns, data.cells.length - row * columns);
        const x = box.x + (box.width - inRow * cellWidth) / 2 + (i % columns) * cellWidth;
        const y = top + row * cellHeight;
        if (cards) {
          const width = cellWidth - 12, height = cellHeight - 12;
          ctx.save(); ctx.translate(x + cellWidth / 2, y + cellHeight / 2 + (i % 3 - 1) * 2); ctx.rotate((i % 3 - 1) * .022);
          panel(-width / 2, -height / 2, width, height, palette.surface, Math.min(14, width / 8));
          text(String(i + 1).padStart(2, '0'), -width / 2 + 8, -height / 2 + 15, 12, palette.muted, 500);
          route(data.cells[i], { x: -width / 2 + 6, y: -height / 2 + 22, width: width - 12, height: height - 28 });
          ctx.restore();
        } else route(data.cells[i], { x: x + 9, y: y + 11, width: cellWidth - 18, height: cellHeight - 22 });
      }
    };
    const aligned = (align: CanvasTextAlign, ...args: Parameters<typeof text>) => { ctx.textAlign = align; text(...args); ctx.textAlign = 'left'; };
    const dashed = (y: number, notches: [number, number]) => {
      ctx.save(); ctx.setLineDash([14, 12]); line(150, y, 780); ctx.restore();
      for (const x of notches) {
        ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.fillStyle = palette.background; ctx.fill();
      }
    };
    // Place a unit right after a large figure instead of pinning it to the page edge.
    const figure = (value: string, x: number, y: number, size: number, weight: number, maxWidth: number, unit: string) => {
      text(value, x, y, size, palette.foreground, weight, maxWidth);
      ctx.font = `${weight} ${size}px ${palette.font}`;
      text(unit, x + Math.min(ctx.measureText(value).width, maxWidth) + 20, y - 8, 34, palette.muted);
    };
    const count = `${data.activityCount.toLocaleString('zh-CN')} 次`, days = `${data.activityDays.toLocaleString('zh-CN')} 天`;
    const lead = data.month ? '这个月，我跑了' : '已累计跑了';
    const sample = (y: number) => text(`随机展示 ${data.cells.length} / ${data.routeCount} 条轨迹`, 76, y, 24, palette.muted);
    const stats = (top: number) => {
      const items = [
        { label: '跑步次数', value: `${data.activityCount.toLocaleString('zh-CN')} 次`, unit: '' },
        { label: '活动天数', value: `${data.activityDays.toLocaleString('zh-CN')} 天`, unit: '' },
        { label: '距离约等于', value: data.halfMarathons, unit: '次半程马拉松' },
      ];
      for (const [i, item] of items.entries()) {
        const x = 80 + i * 324;
        text(item.label, x, top + 36, 24, palette.muted);
        text(item.value, x - 2, top + 106, 55, palette.foreground, 600, 280);
        if (item.unit) text(item.unit, x, top + 148, 22, palette.muted);
      }
    };

    panel(54, 42, 48, 48, palette.route, 14);
    text('R', 65, 78, 34, palette.brandInk, 700);
    text('RunNote', 118, 79, 35, palette.foreground, 650);
    text('每一步，都算数', 794, 76, 25, palette.muted);

    switch (style) {
      case 'classic':
        panel(48, 128, 984, 330, palette.heading);
        text(data.month ? '这个月，我跑了' : '已累计跑了', 82, 200, 40, palette.headingInk, 500);
        text(data.kilometers, 74, 351, data.kilometers.length > 8 ? 104 : 142, palette.headingInk, 650, 790);
        text('公里', 911, 345, 31, palette.headingInk);
        text(posterPeriod(data.month), 84, 414, 25, palette.headingInk);
        panel(48, 490, 984, 1036, palette.surface);
        grid({x:80,y:530,width:920,height:956});
        sample(1582);
        panel(48, 1630, 984, 218, palette.surface);
        text('距离约等于', 80, 1680, 24, palette.muted);
        text(data.halfMarathons, 75, 1770, 82, palette.foreground, 550, 340);
        text('次半程马拉松', 80, 1816, 24, palette.muted);
        text('每次出发，都留下了足迹', 575, 1680, 24, palette.muted);
        text(`${data.activityCount.toLocaleString('zh-CN')} 次跑步`, 575, 1748, 42, palette.foreground, 550, 420);
        text(`${data.activityDays.toLocaleString('zh-CN')} 个活动日`, 575, 1810, 29, palette.muted, 400, 420);
        break;
      case 'gallery':
        text('我的跑步足迹', 76, 190, 34, palette.muted, 500);
        text(data.kilometers, 64, 350, 164, palette.foreground, 600, 810);
        text('公里', 916, 343, 31, palette.muted);
        text(posterPeriod(data.month), 76, 416, 26, palette.muted);
        line(76, 460, 928);
        grid({x:64,y:504,width:952,height:1080});
        sample(1648);
        line(76, 1700, 928);
        stats(1710);
        break;
      case 'sport':
        panel(48, 128, 984, 388, palette.route);
        text(posterPeriod(data.month), 82, 192, 26, palette.brandInk);
        text('每一步，都算数', 82, 262, 46, palette.brandInk, 650);
        text(data.kilometers, 70, 421, 146, palette.brandInk, 750, 810);
        text('公里', 916, 410, 31, palette.brandInk);
        ctx.fillStyle = palette.heading; ctx.fillRect(82, 466, 140, 8);
        ctx.strokeStyle = palette.heading; ctx.lineWidth = 9;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(870 + i * 38, 218); ctx.lineTo(918 + i * 38, 160); ctx.stroke(); }
        panel(48, 550, 984, 1040, palette.surface);
        grid({x:80,y:580,width:920,height:980});
        sample(1644);
        panel(48, 1690, 984, 174, palette.surface);
        stats(1690);
        break;
      case 'journal':
        text('我的足迹收藏', 76, 190, 52, palette.foreground, 600);
        line(76, 218, 928);
        text(posterPeriod(data.month), 76, 270, 26, palette.muted);
        text(data.kilometers, 70, 380, 112, palette.foreground, 600, 800);
        text('公里', 916, 371, 31, palette.muted);
        grid({x:64,y:440,width:952,height:1152}, true);
        sample(1648);
        line(76, 1700, 928);
        stats(1710);
        break;
      // The styles below intentionally draw summary figures only, never route shapes.
      case 'numeral': {
        text(lead, 76, 300, 44, palette.muted, 500);
        text(posterPeriod(data.month), 76, 362, 28, palette.muted);
        text(data.kilometers, 64, 700, Math.min(300, Math.floor(1560 / data.kilometers.length)), palette.foreground, 700, 940);
        text('公里', 80, 800, 52, palette.foreground, 600);
        ctx.fillStyle = palette.route; ctx.fillRect(80, 846, 180, 14);
        const rows = [['跑步次数', count, ''], ['活动天数', days, ''], ['距离约等于', data.halfMarathons, '次半程马拉松']];
        for (const [i, [label, value, unit]] of rows.entries()) {
          const top = 980 + i * 240;
          line(76, top, 928);
          text(label, 80, top + 80, 30, palette.muted);
          if (unit) text(unit, 80, top + 124, 24, palette.muted);
          aligned('right', value, 1004, top + 160, 92, palette.foreground, 600, 560);
        }
        line(76, 1700, 928);
        text('每次出发，都留下了足迹', 76, 1790, 26, palette.muted);
        break;
      }
      case 'ticket': {
        panel(96, 160, 888, 1640, palette.surface, 40);
        text('跑步存根', 150, 260, 30, palette.muted, 500);
        aligned('right', posterPeriod(data.month), 930, 260, 28, palette.muted);
        text(data.month ? '本月跑步清单' : '我的跑步清单', 150, 366, 60, palette.foreground, 650, 780);
        dashed(450, [96, 984]);
        const rows = [['总距离', `${data.kilometers} 公里`], ['跑步次数', count], ['活动天数', days], ['距离约等于', `${data.halfMarathons} 次半程马拉松`]];
        for (const [i, [label, value]] of rows.entries()) {
          const y = 560 + i * 150;
          text(label, 150, y, 32, palette.muted);
          aligned('right', value, 930, y, 48, palette.foreground, 600, 500);
          if (i < rows.length - 1) line(150, y + 56, 780);
        }
        dashed(1120, [96, 984]);
        text('合计里程', 150, 1220, 30, palette.muted);
        aligned('right', data.kilometers, 850, 1396, 150, palette.foreground, 700, 680);
        text('公里', 866, 1392, 32, palette.muted);
        // Decorative bars derived from the visible totals only.
        const digits = `${data.kilometers}${data.activityCount}${data.activityDays}`.replace(/\D/g, '') || '0';
        ctx.fillStyle = palette.foreground;
        for (let x = 150, i = 0; x < 922; i++) {
          const width = 3 + Number(digits[i % digits.length]) % 4 * 3;
          ctx.fillRect(x, 1500, Math.min(width, 930 - x), 150);
          x += width + 6 + (i * 7 + Number(digits[(i + 1) % digits.length])) % 3 * 3;
        }
        text('每次出发，都留下了足迹', 150, 1730, 26, palette.muted);
        break;
      }
      case 'medal': {
        text(lead, 76, 210, 40, palette.muted, 500);
        figure(data.kilometers, 70, 370, data.kilometers.length > 8 ? 112 : 150, 650, 790, '公里');
        text(posterPeriod(data.month), 76, 432, 26, palette.muted);
        const [cx, cy] = [540, 1000];
        ctx.strokeStyle = palette.line; ctx.lineWidth = 6; ctx.lineCap = 'round';
        for (let i = 0; i < 60; i++) {
          const angle = i / 60 * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * 372, cy + Math.sin(angle) * 372);
          ctx.lineTo(cx + Math.cos(angle) * 398, cy + Math.sin(angle) * 398); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(cx, cy, 330, 0, Math.PI * 2); ctx.strokeStyle = palette.route; ctx.lineWidth = 28; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 286, 0, Math.PI * 2); ctx.strokeStyle = palette.heading; ctx.lineWidth = 8; ctx.stroke();
        ctx.lineCap = 'butt';
        aligned('center', '距离约等于', cx, cy - 120, 34, palette.muted);
        aligned('center', data.halfMarathons, cx, cy + 80, data.halfMarathons.length > 5 ? 150 : 190, palette.foreground, 700, 470);
        aligned('center', '次半程马拉松', cx, cy + 160, 34, palette.muted);
        line(76, 1500, 928);
        for (const [i, [label, value]] of [['跑步次数', count], ['活动天数', days]].entries()) {
          text(label, 80 + i * 500, 1590, 26, palette.muted);
          text(value, 78 + i * 500, 1672, 64, palette.foreground, 600, 420);
        }
        line(76, 1720, 928);
        text('每次出发，都留下了足迹', 76, 1800, 26, palette.muted);
        break;
      }
      case 'stripe': {
        ctx.save(); ctx.beginPath(); ctx.roundRect(48, 128, 984, 700, 32); ctx.clip();
        ctx.fillStyle = palette.route; ctx.fillRect(48, 128, 984, 700);
        ctx.fillStyle = palette.heading;
        for (let i = 0; i < 5; i++) {
          const x = 600 + i * 120, width = i % 2 ? 26 : 64;
          ctx.beginPath(); ctx.moveTo(x, 828); ctx.lineTo(x + width, 828); ctx.lineTo(x + width + 300, 128); ctx.lineTo(x + 300, 128); ctx.fill();
        }
        ctx.restore();
        text(posterPeriod(data.month), 82, 210, 28, palette.brandInk);
        text('跑出自己的节奏', 82, 300, 56, palette.brandInk, 700, 500);
        text(`${data.activityCount.toLocaleString('zh-CN')} 次出发`, 82, 760, 44, palette.brandInk, 600, 480);
        text(lead, 76, 960, 40, palette.muted, 500);
        figure(data.kilometers, 64, 1200, data.kilometers.length > 8 ? 130 : 190, 750, 820, '公里');
        ctx.fillStyle = palette.heading; ctx.fillRect(76, 1250, 220, 14);
        line(76, 1400, 928);
        stats(1400);
        line(76, 1600, 928);
        text('每次出发，都留下了足迹', 76, 1700, 26, palette.muted);
        break;
      }
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败，请重试')), 'image/png'));
  } finally { canvas.width = 0; canvas.height = 0; }
}
