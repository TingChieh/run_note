import { createSpring } from '../vendor/liquidglass/liquid-glass.js';

/** Only the central card owns pointer feedback; all updates stay on its DOM. */
export function cardTilt(node: HTMLElement, enabled: boolean) {
  const media = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let x = 0, y = 0, highlight = 0, disposed = false;
  // Listen on the untilted slot: the rotating card would otherwise slide out
  // from under a pointer near its edge, leave, reset and flicker.
  const target = node.parentElement ?? node;
  function paint() {
    if (disposed) return;
    node.style.setProperty('--card-rotate-x', `${-y * 11}deg`);
    node.style.setProperty('--card-rotate-y', `${x * 13}deg`);
    node.style.setProperty('--card-shift-x', `${x * 6}px`);
    node.style.setProperty('--card-shift-y', `${y * 6}px`);
    node.style.setProperty('--card-light-x', `${(x + 1) * 50}%`);
    node.style.setProperty('--card-light-y', `${(y + 1) * 50}%`);
    node.style.setProperty('--card-highlight', String(highlight));
  }
  const springX = createSpring(0, value => { x = value; paint(); }, { stiffness: 300, damping: 26 });
  const springY = createSpring(0, value => { y = value; paint(); }, { stiffness: 300, damping: 26 });
  const light = createSpring(0, value => { highlight = value; paint(); }, { stiffness: 300, damping: 30 });
  function reset(immediate = false) {
    springX.set(0, { immediate }); springY.set(0, { immediate }); light.set(0, { immediate });
  }
  function move(event: PointerEvent) {
    if (!enabled || !media.matches || event.pointerType !== 'mouse') return;
    // The slot does not inherit the pointer rotation, so its bounds remain stable.
    const bounds = target.getBoundingClientRect();
    const normalized = (position: number, start: number, size: number) => Math.max(-1, Math.min(1, (position - start) / size * 2 - 1));
    springX.set(normalized(event.clientX, bounds.left, bounds.width));
    springY.set(normalized(event.clientY, bounds.top, bounds.height));
    light.set(1);
  }
  const leave = () => reset();
  const preference = () => reset(true);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerleave', leave);
  target.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  media.addEventListener('change', preference);
  return {
    update(value: boolean) { if (value !== enabled) { enabled = value; reset(true); } },
    destroy() {
      disposed = true; springX.stop(); springY.stop(); light.stop();
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerleave', leave);
      target.removeEventListener('pointercancel', leave);
      window.removeEventListener('blur', leave);
      media.removeEventListener('change', preference);
      for (const key of ['rotate-x', 'rotate-y', 'shift-x', 'shift-y', 'light-x', 'light-y', 'highlight']) node.style.removeProperty(`--card-${key}`);
    }
  };
}
