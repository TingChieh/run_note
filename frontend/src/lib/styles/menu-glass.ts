import { createGlass, engine } from '../vendor/liquidglass/liquid-glass.js';
import { glassOptics, readGlassSettings, watchGlassSettings, type GlassSettings } from './liquid-glass-settings.ts';

/** Chromium refracts the menu. Firefox keeps the CSS blur. WebKit uses the static rim. */
export function attachMenuGlass(panel: HTMLElement, settings: GlassSettings, scale = .7, radius = 24) {
  if (engine !== 'webkit') {
    return createGlass(panel, {
      mode: 'backdrop', fit: true, radius, ...glassOptics(settings, scale), chroma: 0,
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

/**
 * Floating chrome (the top navigation): the same refracting optics as the glass buttons (including their default 2px backdrop blur). Solid in reduced-transparency and forced-colors.
 * WebKit cannot refract, and a near-opaque static rim there lets the content underneath ghost through unblurred, so it gets plain frosted glass instead:
 * the `rn-frosted-glass` class (a real CSS backdrop blur and a low fill, see app.css). No inline backdrop-filter is set, so the stylesheet decides.
 */
/**
 * Per-bar optics on top of the shared (tuner-driven) settings: `refraction` scales the displacement, `frost` adds
 * backdrop blur in px. The phone tab bar sits over charts and lists while they scroll, so it bends less and frosts
 * more to keep its labels readable (brand.md §12, Liquid Glass boundaries). The desktop top bar is the unscaled base
 * optics (x1, no extra blur): the owner asked for it to stay exactly as it was, so do not tune it with the tab bar.
 */
export type ChromeGlass = { refraction: number; frost: number };
export const TOP_BAR_GLASS: ChromeGlass = { refraction: 1, frost: 0 };
export const TAB_BAR_GLASS: ChromeGlass = { refraction: 0.4, frost: 4 };

export function attachFloatingGlass(node: HTMLElement, recipe: ChromeGlass = TOP_BAR_GLASS): () => void {
  const queries = [matchMedia('(prefers-reduced-transparency: reduce)'), matchMedia('(forced-colors: active)')];
  const tuned = (value: GlassSettings): GlassSettings => ({ ...value, blur: value.blur + recipe.frost });
  const optics = (value: GlassSettings) => ({ ...glassOptics(tuned(value), recipe.refraction), chroma: 0 });
  let handle: ReturnType<typeof attachMenuGlass> | undefined;
  let stop: (() => void) | undefined;
  const detach = () => {
    stop?.(); stop = undefined;
    handle?.destroy(); handle = undefined;
    node.classList.remove('rn-frosted-glass');
  };
  const sync = () => {
    if (queries.some(query => query.matches)) { detach(); return; }
    if (engine === 'webkit') { node.classList.add('rn-frosted-glass'); return; }
    if (handle) return;
    handle = attachMenuGlass(node, tuned(readGlassSettings()), recipe.refraction, 9999);
    stop = watchGlassSettings(value => handle?.update(optics(value)));
  };
  queries.forEach(query => query.addEventListener('change', sync));
  sync();
  return () => { queries.forEach(query => query.removeEventListener('change', sync)); detach(); };
}
