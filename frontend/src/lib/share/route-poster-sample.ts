import { posterStats, type PosterCell, type PosterData } from './route-poster-data.ts';

/** Deterministic synthetic loops in the 360×220 drawing box; never derived from real tracks. */
function sampleCell(index: number): PosterCell {
  const points = 18, rx = 70 + (index * 37) % 60, ry = 45 + (index * 23) % 40;
  const path: string[] = [];
  for (let i = 0; i <= points; i++) {
    const angle = i / points * Math.PI * 2;
    const wobble = 1 + .18 * Math.sin(angle * (2 + index % 3) + index);
    const x = 180 + Math.cos(angle) * rx * wobble, y = 110 + Math.sin(angle) * ry * wobble;
    path.push(`${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return { paths: [path.join(' ')], points: [] };
}

/** Shown instantly before the viewer's own data arrives; it is labelled as an example and cannot be saved. */
export const posterSample: PosterData = {
  month: undefined, routeCount: 48, activityCount: 128, activityDays: 96,
  ...posterStats(642300), cells: Array.from({ length: 48 }, (_, i) => sampleCell(i)),
};
