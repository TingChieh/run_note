import { createGlass, engine } from '../vendor/liquidglass/liquid-glass.js';
import { glassOptics, type GlassSettings } from './liquid-glass-settings.ts';

/** Chromium refracts the menu. Firefox keeps the CSS blur. WebKit uses the static rim. */
export function attachMenuGlass(panel: HTMLElement, settings: GlassSettings) {
  if (engine !== 'webkit') {
    return createGlass(panel, {
      mode: 'backdrop', fit: true, radius: 24, ...glassOptics(settings, .7), chroma: 0,
      fallback: `blur(${16 + settings.blur}px) saturate(1.6)`,
    });
  }
  panel.classList.add('rn-static-glass');
  panel.style.backdropFilter = 'none';
  panel.style.setProperty('-webkit-backdrop-filter', 'none');
  return {
    update() {},
    destroy() {
      panel.classList.remove('rn-static-glass');
      panel.style.backdropFilter = '';
      panel.style.removeProperty('-webkit-backdrop-filter');
    },
  };
}
