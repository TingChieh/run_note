import { createSpring } from '../vendor/liquidglass/liquid-glass.js';

/** Only the central card owns pointer feedback; all updates stay on its DOM. */
export function cardTilt(node: HTMLElement, enabled: boolean) {
  const media = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let x = 0, y = 0, highlight = 0, disposed = false;
  function paint() {
    if (disposed) return;
    node.style.setProperty('--card-rotate-x', `${-y * 5}deg`);
    node.style.setProperty('--card-rotate-y', `${x * 6}deg`);
    node.style.setProperty('--card-shift-x', `${x * 2}px`);
    node.style.setProperty('--card-shift-y', `${y * 2}px`);
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
    const bounds = node.parentElement!.getBoundingClientRect();
    const normalized = (position: number, start: number, size: number) => Math.max(-1, Math.min(1, (position - start) / size * 2 - 1));
    springX.set(normalized(event.clientX, bounds.left, bounds.width));
    springY.set(normalized(event.clientY, bounds.top, bounds.height));
    light.set(1);
  }
  const leave = () => reset();
  const preference = () => reset(true);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  media.addEventListener('change', preference);
  return {
    update(value: boolean) { if (value !== enabled) { enabled = value; reset(true); } },
    destroy() {
      disposed = true; springX.stop(); springY.stop(); light.stop();
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointercancel', leave);
      window.removeEventListener('blur', leave);
      media.removeEventListener('change', preference);
      for (const key of ['rotate-x', 'rotate-y', 'shift-x', 'shift-y', 'light-x', 'light-y', 'highlight']) node.style.removeProperty(`--card-${key}`);
    }
  };
}
