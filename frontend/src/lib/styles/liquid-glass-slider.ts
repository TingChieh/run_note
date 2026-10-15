import { createGlass, createSpring } from '../vendor/liquidglass/liquid-glass.js';
import { glassOptics, type GlassSettings } from './liquid-glass-settings.ts';

export function enhanceSlider(input: HTMLInputElement, settings: GlassSettings) {
  const host = input.parentElement!;
  const decoration = document.createElement('span'); decoration.className = 'rn-slider-decoration'; decoration.setAttribute('aria-hidden', 'true');
  const track = document.createElement('span'); track.className = 'rn-slider-track';
  const fill = document.createElement('span'); fill.className = 'rn-slider-fill'; track.append(fill);
  const layer = document.createElement('span'); layer.className = 'rn-slider-lens';
  const copiedTrack = track.cloneNode(true) as HTMLElement; layer.append(copiedTrack);
  const thumb = document.createElement('span'); thumb.className = 'rn-slider-thumb';
  const shadow = document.createElement('span'); shadow.className = 'rn-slider-shadow';
  decoration.append(track, layer, shadow, thumb); host.append(decoration); host.classList.add('rn-slider-ready');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const fraction = () => Math.min(1, Math.max(0, (input.valueAsNumber - Number(input.min || 0)) / (Number(input.max || 100) - Number(input.min || 0) || 1)));
  let t = fraction(), velocity = 0, press = 0;
  const glass = createGlass(layer, { clip: true, ...glassOptics(settings, .43) });
  function render() {
    const width = host.clientWidth, bleed = 16;
    if (!width) return;
    const stretch = motion.matches ? 0 : Math.min(10, Math.abs(velocity) * 1.2);
    const w = 36 + 16 * press + stretch, h = 24 + 8 * press;
    const x = 18 + t * (width - 36) - w / 2, y = (44 - h) / 2;
    host.style.setProperty('--slider-fraction', String(t));
    for (const node of [thumb, shadow]) Object.assign(node.style, { width: `${w}px`, height: `${h}px`, borderRadius: `${h / 2}px`, transform: `translate(${x}px, ${y}px)` });
    thumb.style.opacity = String(1 - Math.min(1, Math.max(0, press)));
    shadow.style.opacity = String(Math.min(1, Math.max(0, press)));
    glass.update({ x: x + bleed, y: y + bleed, width: w, height: h, radius: h / 2 });
  }
  const position = createSpring(t, (value, speed) => { t = value; velocity = speed; render(); }, { stiffness: 900, damping: 50 });
  const pressure = createSpring(0, value => { press = value; render(); }, { stiffness: 600, damping: 36 });
  const sync = () => position.set(fraction(), { immediate: motion.matches });
  const down = () => { if (!input.disabled && !motion.matches) pressure.set(1); };
  const release = () => pressure.set(0, { immediate: motion.matches });
  const keyDown = (event: KeyboardEvent) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) down(); };
  input.addEventListener('input', sync); input.addEventListener('change', sync); input.addEventListener('pointerdown', down); input.addEventListener('keydown', keyDown);
  for (const type of ['pointerup', 'pointercancel', 'blur', 'keyup']) input.addEventListener(type, release);
  window.addEventListener('pointerup', release); window.addEventListener('blur', release); motion.addEventListener('change', release);
  const resize = new ResizeObserver(render); resize.observe(host); render();
  return { update(next: GlassSettings) { glass.update(glassOptics(next, .43)); sync(); if (input.disabled) release(); }, destroy() {
    resize.disconnect(); position.stop(); pressure.stop(); glass.destroy(); decoration.remove(); host.classList.remove('rn-slider-ready'); host.style.removeProperty('--slider-fraction');
    input.removeEventListener('input', sync); input.removeEventListener('change', sync); input.removeEventListener('pointerdown', down); input.removeEventListener('keydown', keyDown);
    for (const type of ['pointerup', 'pointercancel', 'blur', 'keyup']) input.removeEventListener(type, release);
    window.removeEventListener('pointerup', release); window.removeEventListener('blur', release); motion.removeEventListener('change', release);
  } };
}
