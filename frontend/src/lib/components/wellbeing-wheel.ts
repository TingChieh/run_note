/** Geometry of the "days as one big circle" widget: a ring cut into equal slices, the first at the top, going clockwise, in a 100×100 view box. */
export const OUTER = 45;
export const INNER = 30;
const GAP = 1.6;
export const polar = (radius: number, degrees: number): [number, number] => [50 + radius * Math.cos(degrees * Math.PI / 180), 50 + radius * Math.sin(degrees * Math.PI / 180)];
/** The shape of slice `index` of `count`: a ring segment with a small gap on either side. */
export function slice(index: number, count: number): string {
  const step = 360 / count, from = -90 + index * step + GAP / 2, to = -90 + (index + 1) * step - GAP / 2;
  const [x0, y0] = polar(OUTER, from), [x1, y1] = polar(OUTER, to), [x2, y2] = polar(INNER, to), [x3, y3] = polar(INNER, from);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0} ${y0}A${OUTER} ${OUTER} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${INNER} ${INNER} 0 ${large} 0 ${x3} ${y3}Z`;
}
/** The middle of a slice, in percent of the wheel: where its number goes. */
export const centre = (index: number, count: number) => polar((OUTER + INNER) / 2, -90 + (index + 0.5) * (360 / count));
