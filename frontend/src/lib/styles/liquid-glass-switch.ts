import { createGlass, createSpring } from '../vendor/liquidglass/liquid-glass.js';
import { switchOptics, type GlassSettings } from './liquid-glass-settings.ts';

/** Glass thumb for `button.rn-switch > .rn-switch-track`; the static CSS thumb stays as the fallback. */
export function enhanceSwitch(host: HTMLElement, settings: GlassSettings) {
  const button = host.closest<HTMLElement>('.rn-switch')!;
  const decoration = document.createElement('span'); decoration.className = 'rn-switch-decoration'; decoration.setAttribute('aria-hidden', 'true');
  const layer = document.createElement('span'); layer.className = 'rn-switch-lens';
  const copy = document.createElement('span'); copy.className = 'rn-switch-copy'; layer.append(copy);
  const thumb = document.createElement('span'); thumb.className = 'rn-switch-thumb';
  const shadow = document.createElement('span'); shadow.className = 'rn-switch-shadow';
  decoration.append(layer, shadow, thumb); host.append(decoration); host.classList.add('rn-switch-ready');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const checked = () => button.getAttribute('aria-checked') === 'true';
  let t = checked() ? 1 : 0, velocity = 0, press = 0;
  const glass = createGlass(layer, { clip: true, ...switchOptics(settings) });
  function render() {
    const W = host.clientWidth, H = host.clientHeight, bleed = 16;
    if (!W || !H) return;
    const stretch = motion.matches ? 0 : Math.min(10, Math.abs(velocity) * 1.6);
    const w = 36 + 14 * press + stretch, h = 24 + 16 * press - stretch * .2;
    const x = 20 + (W - 40) * t - w / 2, y = H / 2 - h / 2;
    host.style.setProperty('--press', press.toFixed(3));
    for (const node of [thumb, shadow]) Object.assign(node.style, { width: `${w}px`, height: `${h}px`, borderRadius: `${h / 2}px`, transform: `translate(${x}px, ${y}px)` });
    thumb.style.opacity = String(1 - Math.min(1, Math.max(0, press)));
    shadow.style.opacity = String(Math.min(1, Math.max(0, press)));
    glass.update({ x: x + bleed, y: y + bleed, width: w, height: h, radius: h / 2 });
  }
  const position = createSpring(t, (value, speed) => { t = value; velocity = speed; render(); }, { stiffness: 420, damping: 30 });
  const pressure = createSpring(0, value => { press = value; render(); }, { stiffness: 600, damping: 36 });
  const sync = () => position.set(checked() ? 1 : 0, { immediate: motion.matches });
  const down = () => { if (!(button as HTMLButtonElement).disabled && !motion.matches) pressure.set(1); };
  const release = () => pressure.set(0, { immediate: motion.matches });
  const watch = new MutationObserver(sync); watch.observe(button, { attributes: true, attributeFilter: ['aria-checked'] });
  button.addEventListener('pointerdown', down);
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) button.addEventListener(type, release);
  const resize = new ResizeObserver(render); resize.observe(host); render();
  return { update(next: GlassSettings) { glass.update(switchOptics(next)); sync(); if ((button as HTMLButtonElement).disabled) release(); }, destroy() {
    watch.disconnect(); resize.disconnect(); position.stop(); pressure.stop(); glass.destroy(); decoration.remove(); host.classList.remove('rn-switch-ready'); host.style.removeProperty('--press');
    button.removeEventListener('pointerdown', down);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) button.removeEventListener(type, release);
  } };
}
