/** Geometry of the round sliders: a 270° ring that starts at the lower left, runs clockwise over the top, and ends at the lower right. */
export const START = 135;
export const SWEEP = 270;
export const CENTER = 50;
const rad = (degrees: number) => degrees * Math.PI / 180;

/** A point on a ring of radius `r` (in a 100×100 view box) at `fraction` (0–1) of the way round. */
export function pointAt(r: number, fraction: number): [number, number] {
  const angle = rad(START + SWEEP * fraction);
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}
/** An SVG arc along the ring from its start to `fraction` of the way round. */
export function arcPath(r: number, fraction: number): string {
  const [x0, y0] = pointAt(r, 0), [x1, y1] = pointAt(r, fraction);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${SWEEP * fraction > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
/** How far round the ring a pointer is, from its offset to the centre; the opening at the bottom snaps to the nearer end (`previous` breaks the tie). */
export function fractionAt(dx: number, dy: number, previous: number): number {
  const rel = (Math.atan2(dy, dx) * 180 / Math.PI - START + 720) % 360;
  return rel > SWEEP ? (previous >= 0.5 ? 1 : 0) : rel / SWEEP;
}
/** The value for a fraction of the way round, on a grid of `step` between `min` and `max`. */
export function valueAt(fraction: number, min: number, max: number, step: number): number {
  return Math.min(max, Math.max(min, min + Math.round(fraction * (max - min) / step) * step));
}

/**
 * A typed sleep duration as decimal hours (two decimals): "7:25", "7.5", "7h25m" or "7时25分", "7" (hours). Minutes must be under 60, the total at most 24 hours.
 * Returns null for anything else, so the caller can say it was not understood.
 */
export function parseDuration(text: string): number | null {
  const value = text.trim().replace(/：/g, ':').replace(/\s+/g, '');
  let hours: number, minutes = 0;
  let match: RegExpMatchArray | null;
  if ((match = /^(\d{1,2}):(\d{1,2})$/.exec(value))) { hours = Number(match[1]); minutes = Number(match[2]); }
  else if ((match = /^(\d{1,2})(?:h|时|小时)(?:(\d{1,2})(?:m|min|分|分钟)?)?$/i.exec(value))) { hours = Number(match[1]); minutes = match[2] === undefined ? 0 : Number(match[2]); }
  else if ((match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(value))) { hours = Number(match[1]); minutes = match[2] === undefined ? 0 : Math.round(Number(`0.${match[2]}`) * 60); }
  else return null;
  if (minutes > 59 || hours * 60 + minutes > 24 * 60) return null;
  return Math.round((hours + minutes / 60) * 100) / 100;
}

/** An eased move of a number towards a target (≈180 ms), for rings that glide instead of jumping; reduced-motion users get the jump. */
export function createTween(initial: number, onUpdate: (value: number) => void) {
  let current = initial, frame = 0;
  return {
    to(target: number, instant = false) {
      cancelAnimationFrame(frame);
      const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (instant || calm || current === target) { current = target; onUpdate(current); return; }
      const from = current, started = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - started) / 180);
        current = from + (target - from) * (1 - (1 - k) ** 3);
        onUpdate(current);
        if (k < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
    stop() { cancelAnimationFrame(frame); }
  };
}
