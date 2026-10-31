import { createGlass, createSpring } from '../vendor/liquidglass/liquid-glass.js';
import { contentOptics, type GlassSettings } from './liquid-glass-settings.ts';

/**
 * A liquid glass knob for a round slider: the same lens, rim and spring press as the project's linear glass slider (`enhanceSlider`),
 * built from its `.rn-slider-decoration / -lens / -thumb / -shadow` classes. The lens refracts a copy of `source` (the ring), so the
 * ring bends under the knob; the copy is refreshed with `sync()` whenever the ring changes.
 */
export function attachKnobGlass(host: HTMLElement, source: () => SVGSVGElement | null, settings: GlassSettings, rest = 30) {
  const bleed = 16;
  const span = (className: string) => { const node = document.createElement('span'); node.className = className; return node; };
  const decoration = span('rn-slider-decoration'); decoration.setAttribute('aria-hidden', 'true');
  const layer = span('rn-slider-lens'), shadow = span('rn-slider-shadow'), thumb = span('rn-slider-thumb');
  decoration.append(layer, shadow, thumb); host.append(decoration);
  const glass = createGlass(layer, { clip: true, ...contentOptics(settings, .43) });
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let x = 0, y = 0, press = 0, shown = false;
  function render() {
    const size = rest * (1 + (motion.matches ? 0 : .4 * press));
    for (const node of [thumb, shadow]) Object.assign(node.style, { width: `${size}px`, height: `${size}px`, borderRadius: `${size / 2}px`, transform: `translate(${x - size / 2}px, ${y - size / 2}px)`, visibility: shown ? 'visible' : 'hidden' });
    layer.style.visibility = shown ? 'visible' : 'hidden'; // an unset dial has no knob, and no lens either
    thumb.style.opacity = String(1 - Math.min(1, Math.max(0, press)));
    shadow.style.opacity = String(Math.min(1, Math.max(0, press)));
    glass.update({ x: x - size / 2 + bleed, y: y - size / 2 + bleed, width: size, height: size, radius: size / 2 });
  }
  const pressure = createSpring(0, (value: number) => { press = value; render(); }, { stiffness: 600, damping: 36 });
  /** Refreshes the lens's copy of the ring, so what is bent under the knob is the ring as it is now. */
  function sync() {
    layer.querySelector('svg')?.remove();
    const svg = source();
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    Object.assign(copy.style, { position: 'absolute', left: `${bleed}px`, top: `${bleed}px`, width: `${host.clientWidth}px`, height: `${host.clientHeight}px` });
    layer.prepend(copy);
  }
  return {
    /** Puts the knob's centre at (cx, cy) pixels in the host, or hides it. */
    move(cx: number, cy: number, visible = true) { x = cx; y = cy; shown = visible; render(); },
    press(on: boolean) { pressure.set(on && !motion.matches ? 1 : 0, { immediate: motion.matches }); },
    sync,
    update(next: GlassSettings) { glass.update(contentOptics(next, .43)); render(); },
    destroy() { pressure.stop(); glass.destroy(); decoration.remove(); }
  };
}
