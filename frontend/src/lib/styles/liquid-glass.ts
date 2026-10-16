import { glassOptics, readGlassSettings, watchGlassSettings, type GlassSettings } from './liquid-glass-settings.ts';
import { watchSystemTheme } from '../components/system-theme.ts';

/** Native-control adaptation of upstream LgButton / Surface; see vendor README for provenance. */
export function liquidGlass(root: HTMLElement) {
  let disposed = false;
  let cleanup: (() => void) | undefined;
  void Promise.all([import('../vendor/liquidglass/liquid-glass.js'), import('./liquid-glass-indicator.ts'),
    import('./liquid-glass-slider.ts'), import('./liquid-glass-select.ts')]).then(([{ createGlass, createSpring, engine }, { enhanceNavigation }, { enhanceSlider }, { enhanceSelect }]) => {
    if (disposed) return;
    const selector = 'button:not(.maplibregl-ctrl-zoom-in):not(.maplibregl-ctrl-zoom-out):not([data-date]):not(.history-card):not(.wall-card):not(.rn-menu-option):not(.rn-select-toggle), a.button-primary, a.button-secondary, .maplibregl-ctrl-group:has(> .maplibregl-ctrl-zoom-in)';
    const preferences = [matchMedia('(prefers-reduced-transparency: reduce)'), matchMedia('(forced-colors: active)')];
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const controls = new Map<HTMLElement, { update(): void; render(): void; release(): void; surface: HTMLElement; destroy(): void }>();
    const backdrops = new Map<HTMLElement, number>();
    const enhancements = new Map<HTMLElement, { update(settings: GlassSettings): void; destroy(): void }>();
    const enhancementSelector = '.app-sidebar nav, .rn-slider > input[type="range"], select:not([multiple])';
    let settings = readGlassSettings();
    const previousOpacity = root.style.getPropertyValue('--glass-opacity');
    let frame = 0;
    const resize = new ResizeObserver(entries => {
      for (const entry of entries) controls.get(entry.target as HTMLElement)?.render();
      align();
    });
    const optics = (element: HTMLElement) => {
      const grouped = !!element.closest('.mode-switch');
      return { ...glassOptics(settings, grouped ? .4 : 1),
        specular: settings.highlight * (grouped ? .3 : 1), bezel: settings.bezel * (grouped ? .4375 : 1) };
    };
    // Upstream's no-backdrop fallback stays frosted even when optical blur is zero.
    const fallback = () => `blur(${16 + settings.blur}px) saturate(1.6)`;
    const span = (className: string) => {
      const node = document.createElement('span'); node.className = className; return node;
    };
    const place = (node: HTMLElement, x: number, y: number, width: number, height: number, radius: number) => {
      Object.assign(node.style, { width: `${width}px`, height: `${height}px`, borderRadius: `${radius}px`, transform: `translate(${x}px, ${y}px)` });
    };
    const aligners = new Set<() => void>();
    let alignFrame = 0;
    function align() { if (!alignFrame) alignFrame = requestAnimationFrame(() => { alignFrame = 0; aligners.forEach(fn => fn()); }); }
    function enhance(element: HTMLElement) {
      const isZoomGroup = element.matches('.maplibregl-ctrl-group:has(> .maplibregl-ctrl-zoom-in)');
      const surface = span('rn-glass-surface'); surface.setAttribute('aria-hidden', 'true');
      const body = span('rn-glass-body');
      const shadow = span('rn-glass-shadow'), layer = span('rn-glass-layer'), tint = span('rn-glass-tint');
      body.append(shadow, layer, tint); surface.append(body);
      // Do not wrap or move Svelte-owned labels, icons or other business DOM.
      element.prepend(surface); element.classList.add('rn-glass-control');
      const previousPosition = element.style.position;
      if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
      // Only the explicitly marked dev preview's CSS background is copied, never private DOM/maps.
      const source = element.closest<HTMLElement>('[data-glass-backdrop]');
      const copy = source ? span('rn-glass-copy') : null;
      if (copy) layer.append(copy);
      const copied = !!copy;
      const glass = createGlass(layer, { mode: copied ? 'content' : 'backdrop', clip: true,
        ...optics(element), chroma: copied ? settings.chroma : 0, mapScale: 1, fallback: fallback() });
      const bleed = 12;
      let press = 0, alive = true, geometry = '';
      const syncCopy = () => {
        if (!copy || !source) return;
        const style = getComputedStyle(source), rect = source.getBoundingClientRect(), lr = layer.getBoundingClientRect();
        Object.assign(copy.style, { width: `${rect.width}px`, height: `${rect.height}px`,
          backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize, backgroundPosition: style.backgroundPosition,
          backgroundRepeat: style.backgroundRepeat,
          transformOrigin: `${element.getBoundingClientRect().left + element.clientWidth / 2 - rect.left}px ${element.getBoundingClientRect().top + element.clientHeight / 2 - rect.top}px`,
          transform: `translate(${rect.left - lr.left}px, ${rect.top - lr.top}px) scale(${1 + .06 * press}, ${1 - .025 * press})` });
      };
      function render() {
        if (!alive) return;
        const W = element.clientWidth, H = element.clientHeight;
        if (!W || !H) return;
        // Bleed is visual only; controls resting on a viewport edge must not widen the page.
        const bounds = element.getBoundingClientRect();
        surface.style.overflowClipMargin = `${Math.max(0, Math.min(bleed, bounds.left, document.documentElement.clientWidth - bounds.right))}px`;
        const x = bleed - 5 * press, y = bleed + 2 * press;
        const width = W + 10 * press, height = Math.max(1, H - 4 * press);
        const cssRadius = getComputedStyle(element).borderTopLeftRadius;
        const radius = Math.min(parseFloat(cssRadius) || 0, width / 2, height / 2);
        const key = `${x}|${y}|${width}|${height}|${radius}`;
        if (key !== geometry) {
          geometry = key;
          place(shadow, x, y, width, height, radius); place(tint, x, y, width, height, radius);
          const base = optics(element);
          glass.update({ x, y, width, height, radius, ...base,
            refraction: base.refraction * (1 + .6 * press), specular: base.specular * (1 + .2 * press),
            chroma: copied ? settings.chroma : 0 });
          if (!copied && engine !== 'blink') place(layer, x, y, width, height, radius);
        }
        syncCopy();
      }
      const spring = createSpring(0, value => { press = value; render(); }, { stiffness: 600, damping: 36 });
      const release = () => spring.set(0, { immediate: motion.matches });
      const down = () => {
        if (isZoomGroup || element.matches(':disabled, [aria-disabled="true"]') || motion.matches) return;
        spring.set(1);
      };
      const keyDown = (event: KeyboardEvent) => { if (!event.repeat && [' ', 'Enter'].includes(event.key)) down(); };
      const keyUp = (event: KeyboardEvent) => { if ([' ', 'Enter'].includes(event.key)) release(); };
      element.addEventListener('pointerdown', down);
      for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) element.addEventListener(type, release);
      element.addEventListener('keydown', keyDown); element.addEventListener('keyup', keyUp);
      const update = () => {
        geometry = '';
        if (!copied && engine !== 'blink') {
          layer.style.backdropFilter = fallback(); layer.style.setProperty('-webkit-backdrop-filter', fallback());
        }
        if (element.matches(':disabled, [aria-disabled="true"]')) release();
        render();
      };
      if (source) {
        aligners.add(syncCopy); backdrops.set(source, (backdrops.get(source) ?? 0) + 1); resize.observe(source);
      }
      resize.observe(element); update();
      return { surface, update, render, release, destroy() {
        alive = false; spring.stop(); glass.destroy(); resize.unobserve(element); aligners.delete(syncCopy);
        if (source) {
          const remaining = (backdrops.get(source) ?? 1) - 1;
          if (remaining) backdrops.set(source, remaining); else { backdrops.delete(source); resize.unobserve(source); }
        }
        element.removeEventListener('pointerdown', down);
        for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) element.removeEventListener(type, release);
        element.removeEventListener('keydown', keyDown); element.removeEventListener('keyup', keyUp);
        surface.remove(); element.classList.remove('rn-glass-control'); element.style.position = previousPosition;
      } };
    }
    function reconcile() {
      frame = 0;
      root.style.setProperty('--glass-opacity', String(1 - settings.transparency / 100));
      const enabled = !preferences.some(query => query.matches);
      for (const [element, control] of controls) {
        if (!enabled || !root.contains(element) || !element.matches(selector) || !element.contains(control.surface)) {
          control.destroy(); controls.delete(element);
        }
      }
      for (const [element, enhancement] of enhancements) {
        if (!enabled || !root.contains(element) || !element.matches(enhancementSelector)) {
          enhancement.destroy(); enhancements.delete(element);
        }
      }
      if (!enabled) return;
      for (const element of root.querySelectorAll<HTMLElement>(selector)) {
        const control = controls.get(element);
        if (control) control.update(); else controls.set(element, enhance(element));
      }
      for (const element of root.querySelectorAll<HTMLElement>(enhancementSelector)) {
        const existing = enhancements.get(element);
        if (existing) { existing.update(settings); continue; }
        if (element instanceof HTMLSelectElement) {
          if ('showPopover' in HTMLElement.prototype && element.size <= 1 && !element.querySelector('optgroup')) enhancements.set(element, enhanceSelect(element, root, settings));
        } else if (element instanceof HTMLInputElement) enhancements.set(element, enhanceSlider(element, settings));
        else enhancements.set(element, enhanceNavigation(element, settings));
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(reconcile); };
    const unwatch = watchGlassSettings(value => { settings = value; schedule(); });
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest('.rn-moving-copy, .rn-slider-decoration, .rn-glass-menu, .rn-select-toggle')) &&
        (record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node => !(node instanceof HTMLElement && node.matches('.rn-glass-surface, .rn-moving-copy, .rn-moving-outline, .rn-slider-decoration, .rn-glass-menu, .rn-select-toggle')))))) schedule();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
    const releaseAll = () => controls.forEach(control => control.release());
    const relayout = () => { controls.forEach(control => control.render()); align(); };
    preferences.forEach(query => query.addEventListener('change', schedule));
    motion.addEventListener('change', releaseAll);
    const unwatchTheme = watchSystemTheme(() => align());
    window.addEventListener('blur', releaseAll); window.addEventListener('scroll', align, { capture: true, passive: true });
    window.addEventListener('resize', relayout);
    reconcile();
    cleanup = () => {
      observer.disconnect(); resize.disconnect(); unwatch();
      preferences.forEach(query => query.removeEventListener('change', schedule)); motion.removeEventListener('change', releaseAll);
      unwatchTheme();
      window.removeEventListener('blur', releaseAll); window.removeEventListener('scroll', align, true); window.removeEventListener('resize', relayout);
      if (frame) cancelAnimationFrame(frame); if (alignFrame) cancelAnimationFrame(alignFrame);
      for (const control of controls.values()) control.destroy();
      for (const enhancement of enhancements.values()) enhancement.destroy();
      enhancements.clear();
      controls.clear(); aligners.clear(); backdrops.clear();
      if (previousOpacity) root.style.setProperty('--glass-opacity', previousOpacity); else root.style.removeProperty('--glass-opacity');
    };
  }).catch(() => { /* Shared CSS stays usable if the optional optics module cannot load. */ });
  return { destroy() { disposed = true; cleanup?.(); } };
}
