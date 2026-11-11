import { glassOptics, readGlassSettings, watchGlassSettings, type GlassSettings } from './liquid-glass-settings.ts';
import { watchSystemTheme } from '../components/system-theme.ts';

/** Native-control adaptation of upstream LgButton / Surface; see vendor README for provenance. */
export function liquidGlass(root: HTMLElement) {
  let disposed = false;
  let cleanup: (() => void) | undefined;
  void Promise.all([
    import('../vendor/liquidglass/liquid-glass.js'),
    import('./liquid-glass-indicator.ts'),
    import('./liquid-glass-slider.ts'),
    import('./liquid-glass-select.ts'),
    import('./liquid-glass-switch.ts'),
  ])
    .then(
      ([
        { createGlass, createSpring, engine },
        { enhanceNavigation, enhanceSegmented },
        { enhanceSlider },
        { enhanceSelect },
        { enhanceSwitch },
      ]) => {
        if (disposed) return;
        const selector =
          'button:not(.rn-switch):not(.compact-switch > button):not(.settings-tabs > button):not(.maplibregl-ctrl-zoom-in):not(.maplibregl-ctrl-zoom-out):not([data-date]):not(.history-card):not(.wall-card):not(.rn-menu-option):not(.rn-select-toggle), a.button-primary, a.button-secondary, .maplibregl-ctrl-group:has(> .maplibregl-ctrl-zoom-in)';
        const preferences = [
          matchMedia('(prefers-reduced-transparency: reduce)'),
          matchMedia('(forced-colors: active)'),
        ];
        const nativeSelect = matchMedia('(hover: none) and (pointer: coarse)');
        const keepsBlur = (element: HTMLElement) =>
          element.matches('button.bg-primary, .button-primary, button.save, button.apply-button, a.button-primary');
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        // Reads (measure) and writes (apply) are split so a batch of controls costs one layout, not one each.
        type Metrics = { W: number; H: number; left: number; right: number; viewport: number; radius: string } | null;
        type Control = {
          prepare(): void;
          measure(): Metrics;
          apply(metrics: Metrics): void;
          render(): void;
          release(): void;
          surface: HTMLElement;
          destroy(): void;
        };
        const controls = new Map<HTMLElement, Control>();
        const renderAll = (list: Control[]) => {
          const metrics = list.map((control) => control.measure());
          list.forEach((control, index) => control.apply(metrics[index]));
        };
        const backdrops = new Map<HTMLElement, number>();
        const enhancements = new Map<HTMLElement, { update(settings: GlassSettings): void; destroy(): void }>();
        const enhancementSelector =
          '.app-sidebar nav, .settings-tabs, .compact-switch, .rn-slider > input[type="range"], .rn-switch-track, select:not([multiple]):not([inert])';
        let settings = readGlassSettings();
        const previousOpacity = root.style.getPropertyValue('--glass-opacity');
        let frame = 0;
        const resize = new ResizeObserver((entries) => {
          renderAll(entries.flatMap((entry) => controls.get(entry.target as HTMLElement) ?? []));
          align();
        });
        const optics = (element: HTMLElement) => {
          const grouped = !!element.closest('.mode-switch');
          return {
            ...glassOptics(settings, grouped ? 0.4 : 1),
            specular: settings.highlight * (grouped ? 0.3 : 1),
            bezel: settings.bezel * (grouped ? 0.4375 : 1),
          };
        };
        // Upstream's no-backdrop fallback stays frosted even when optical blur is zero.
        const fallback = () => `blur(${16 + settings.blur}px) saturate(1.6)`;
        const span = (className: string) => {
          const node = document.createElement('span');
          node.className = className;
          return node;
        };
        const place = (node: HTMLElement, x: number, y: number, width: number, height: number, radius: number) => {
          Object.assign(node.style, {
            width: `${width}px`,
            height: `${height}px`,
            borderRadius: `${radius}px`,
            transform: `translate(${x}px, ${y}px)`,
          });
        };
        const aligners = new Set<() => void>();
        let alignFrame = 0;
        // Only the dev preview registers aligners; skip the per-scroll frame when there is nothing to align.
        function align() {
          if (!alignFrame && aligners.size)
            alignFrame = requestAnimationFrame(() => {
              alignFrame = 0;
              aligners.forEach((fn) => fn());
            });
        }
        // `isStatic` is read by the caller for the whole batch before any control is changed.
        function enhance(element: HTMLElement, isStatic: boolean): Control {
          const isZoomGroup = element.matches('.maplibregl-ctrl-group:has(> .maplibregl-ctrl-zoom-in)');
          const stableBackdrop = !!element.closest('[data-glass-stable]');
          const surface = span('rn-glass-surface');
          surface.setAttribute('aria-hidden', 'true');
          const body = span('rn-glass-body');
          const shadow = span('rn-glass-shadow'),
            layer = span('rn-glass-layer'),
            tint = span('rn-glass-tint');
          body.append(shadow, layer, tint);
          surface.append(body);
          // Do not wrap or move Svelte-owned labels, icons or other business DOM.
          element.prepend(surface);
          element.classList.add('rn-glass-control');
          const previousPosition = element.style.position;
          if (isStatic) element.style.position = 'relative';
          // Only the explicitly marked dev preview's CSS background is copied, never private DOM/maps.
          const source = element.closest<HTMLElement>('[data-glass-backdrop]');
          const copy = source ? span('rn-glass-copy') : null;
          if (copy) layer.append(copy);
          const copied = !!copy;
          // Backdrop URL filters exist only in Chromium. A blur on every control freezes WebKit,
          // so only its primary actions stay frosted. Firefox keeps the original CSS blur fallback.
          const staticGlass = engine === 'webkit' && !copied && !keepsBlur(element);
          const frosted = !copied && engine !== 'blink' && !staticGlass;
          if (staticGlass) element.classList.add('rn-glass-static');
          const glass = createGlass(layer, {
            mode: copied ? 'content' : 'backdrop',
            clip: true,
            ...optics(element),
            chroma: copied ? settings.chroma : 0,
            fallback: frosted ? fallback() : 'none',
          });
          const bleed = 12;
          let press = 0,
            alive = true,
            geometry = '';
          const syncCopy = () => {
            if (!copy || !source) return;
            const style = getComputedStyle(source),
              rect = source.getBoundingClientRect(),
              lr = layer.getBoundingClientRect();
            Object.assign(copy.style, {
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              backgroundColor: style.backgroundColor,
              backgroundImage: style.backgroundImage,
              backgroundSize: style.backgroundSize,
              backgroundPosition: style.backgroundPosition,
              backgroundRepeat: style.backgroundRepeat,
              transformOrigin: `${element.getBoundingClientRect().left + element.clientWidth / 2 - rect.left}px ${element.getBoundingClientRect().top + element.clientHeight / 2 - rect.top}px`,
              transform: `translate(${rect.left - lr.left}px, ${rect.top - lr.top}px) scale(${1 + 0.06 * press}, ${1 - 0.025 * press})`,
            });
          };
          let published = '',
            clipMargin = '',
            surfaceTransform = '';
          function measure(): Metrics {
            const W = element.clientWidth,
              H = element.clientHeight;
            if (!alive || !W || !H) return null;
            const bounds = element.getBoundingClientRect();
            return {
              W,
              H,
              left: bounds.left,
              right: bounds.right,
              viewport: document.documentElement.clientWidth,
              radius: getComputedStyle(element).borderTopLeftRadius,
            };
          }
          // Only changed values touch the styles, so an unchanged control leaves the layout clean for the next read.
          function apply(metrics: Metrics) {
            if (!alive) return;
            // Publish the spring so filled content (an avatar) can deform with the glass; text and line icons hide that.
            const pressed = press.toFixed(3);
            if (pressed !== published) {
              published = pressed;
              element.style.setProperty('--glass-press', pressed);
            }
            if (!metrics) return;
            const { W, H } = metrics;
            // Bleed is visual only; controls resting on a viewport edge must not widen the page.
            const margin = `${Math.max(0, Math.min(bleed, metrics.left, metrics.viewport - metrics.right))}px`;
            if (margin !== clipMargin) {
              clipMargin = margin;
              surface.style.overflowClipMargin = margin;
            }
            // Updating an SVG backdrop URL every spring frame invalidates the
            // optical surface over a live WebGL map. Keep its atlas/clip stable and
            // composite the same pressure deformation on the existing surface.
            const lensPress = stableBackdrop ? 0 : press;
            if (stableBackdrop) {
              const transform = `scale(${1 + (10 * press) / W}, ${Math.max(1, H - 4 * press) / H})`;
              if (transform !== surfaceTransform) {
                surfaceTransform = transform;
                surface.style.transform = transform;
              }
            }
            const x = bleed - 5 * lensPress,
              y = bleed + 2 * lensPress;
            const width = W + 10 * lensPress,
              height = Math.max(1, H - 4 * lensPress);
            const radius = Math.min(parseFloat(metrics.radius) || 0, width / 2, height / 2);
            const key = `${x}|${y}|${width}|${height}|${radius}`;
            if (key !== geometry) {
              geometry = key;
              place(shadow, x, y, width, height, radius);
              place(tint, x, y, width, height, radius);
              const base = optics(element);
              glass.update({
                x,
                y,
                width,
                height,
                radius,
                ...base,
                refraction: base.refraction * (1 + 0.6 * lensPress),
                specular: base.specular * (1 + 0.2 * lensPress),
                chroma: copied ? settings.chroma : 0,
              });
              if (!copied && engine !== 'blink') place(layer, x, y, width, height, radius);
            }
            syncCopy();
          }
          function render() {
            apply(measure());
          }
          const spring = createSpring(
            0,
            (value) => {
              press = value;
              render();
            },
            { stiffness: 600, damping: 36 },
          );
          const release = () => spring.set(0, { immediate: motion.matches });
          const down = () => {
            if (isZoomGroup || element.matches(':disabled, [aria-disabled="true"]') || motion.matches) return;
            spring.set(1);
          };
          const keyDown = (event: KeyboardEvent) => {
            if (!event.repeat && [' ', 'Enter'].includes(event.key)) down();
          };
          const keyUp = (event: KeyboardEvent) => {
            if ([' ', 'Enter'].includes(event.key)) release();
          };
          element.addEventListener('pointerdown', down);
          for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur'])
            element.addEventListener(type, release);
          element.addEventListener('keydown', keyDown);
          element.addEventListener('keyup', keyUp);
          // Before each render pass: new glass settings redraw the lens; the size is checked by the geometry key.
          let preparedFor: GlassSettings | undefined;
          const prepare = () => {
            if (preparedFor !== settings) {
              preparedFor = settings;
              geometry = '';
              if (!copied && engine !== 'blink') {
                const filter = staticGlass ? 'none' : fallback();
                layer.style.backdropFilter = filter;
                layer.style.setProperty('-webkit-backdrop-filter', filter);
              }
            }
            if (element.matches(':disabled, [aria-disabled="true"]')) release();
          };
          if (source) {
            aligners.add(syncCopy);
            backdrops.set(source, (backdrops.get(source) ?? 0) + 1);
            resize.observe(source);
          }
          resize.observe(element);
          return {
            surface,
            prepare,
            measure,
            apply,
            render,
            release,
            destroy() {
              alive = false;
              spring.stop();
              element.style.removeProperty('--glass-press');
              glass.destroy();
              resize.unobserve(element);
              aligners.delete(syncCopy);
              if (source) {
                const remaining = (backdrops.get(source) ?? 1) - 1;
                if (remaining) backdrops.set(source, remaining);
                else {
                  backdrops.delete(source);
                  resize.unobserve(source);
                }
              }
              element.removeEventListener('pointerdown', down);
              for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur'])
                element.removeEventListener(type, release);
              element.removeEventListener('keydown', keyDown);
              element.removeEventListener('keyup', keyUp);
              surface.remove();
              element.classList.remove('rn-glass-control');
              element.style.position = previousPosition;
            },
          };
        }
        // Controls inside [data-glass-rigid] sit on a backdrop that scrolls with them, so their live backdrop filter re-renders to the same image every frame.
        // While the page scrolls, CSS pauses it (see liquid-glass.css) and it returns shortly after the last scroll event.
        let scrollTimer: ReturnType<typeof setTimeout> | undefined;
        const scrolled = (event: Event) => {
          align();
          if (event.target !== document) return;
          root.classList.add('rn-scrolling');
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => root.classList.remove('rn-scrolling'), 150);
        };
        function reconcile() {
          frame = 0;
          root.style.setProperty('--glass-opacity', String(1 - settings.transparency / 100));
          const enabled = !preferences.some((query) => query.matches);
          for (const [element, control] of controls) {
            if (
              !enabled ||
              !root.contains(element) ||
              !element.matches(selector) ||
              !element.contains(control.surface)
            ) {
              control.destroy();
              controls.delete(element);
            }
          }
          for (const [element, enhancement] of enhancements) {
            const native =
              element instanceof HTMLSelectElement &&
              (nativeSelect.matches || typeof HTMLElement.prototype.showPopover !== 'function');
            if (!enabled || native || !root.contains(element) || !element.matches(enhancementSelector)) {
              enhancement.destroy();
              enhancements.delete(element);
            }
          }
          if (!enabled) return;
          const found = [...root.querySelectorAll<HTMLElement>(selector)];
          // Read every new control's position before the first one is changed: one style pass for the batch.
          const fresh = found.filter((element) => !controls.has(element));
          const statics = new Set(fresh.filter((element) => getComputedStyle(element).position === 'static'));
          for (const element of fresh) controls.set(element, enhance(element, statics.has(element)));
          const live = found.map((element) => controls.get(element)!);
          live.forEach((control) => control.prepare());
          renderAll(live);
          for (const element of root.querySelectorAll<HTMLElement>(enhancementSelector)) {
            const existing = enhancements.get(element);
            if (existing) {
              existing.update(settings);
              continue;
            }
            if (element instanceof HTMLSelectElement) {
              if (
                !nativeSelect.matches &&
                typeof HTMLElement.prototype.showPopover === 'function' &&
                element.size <= 1 &&
                !element.querySelector('optgroup')
              )
                enhancements.set(element, enhanceSelect(element, root, settings));
            } else if (element instanceof HTMLInputElement) enhancements.set(element, enhanceSlider(element, settings));
            else if (element.classList.contains('rn-switch-track'))
              enhancements.set(element, enhanceSwitch(element, settings));
            else if (element.matches('.settings-tabs, .compact-switch'))
              enhancements.set(element, enhanceSegmented(element, settings));
            else enhancements.set(element, enhanceNavigation(element, settings));
          }
        }
        const schedule = () => {
          if (!frame) frame = requestAnimationFrame(reconcile);
        };
        const unwatch = watchGlassSettings((value) => {
          settings = value;
          schedule();
        });
        const observer = new MutationObserver((records) => {
          if (
            records.some(
              (record) =>
                !(
                  record.target instanceof Element &&
                  record.target.closest(
                    '.rn-moving-copy, .rn-slider-decoration, .rn-switch-decoration, .rn-glass-menu, .rn-select-toggle',
                  )
                ) &&
                (record.type === 'attributes' ||
                  [...record.addedNodes, ...record.removedNodes].some(
                    (node) =>
                      !(
                        node instanceof HTMLElement &&
                        node.matches(
                          '.rn-glass-surface, .rn-moving-copy, .rn-moving-outline, .rn-slider-decoration, .rn-switch-decoration, .rn-glass-menu, .rn-select-toggle',
                        )
                      ),
                  )),
            )
          )
            schedule();
        });
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'aria-disabled'],
        });
        const releaseAll = () => controls.forEach((control) => control.release());
        const relayout = () => {
          renderAll([...controls.values()]);
          align();
        };
        preferences.forEach((query) => query.addEventListener('change', schedule));
        nativeSelect.addEventListener('change', schedule);
        motion.addEventListener('change', releaseAll);
        const unwatchTheme = watchSystemTheme(() => align());
        window.addEventListener('blur', releaseAll);
        window.addEventListener('scroll', scrolled, { capture: true, passive: true });
        window.addEventListener('resize', relayout);
        reconcile();
        cleanup = () => {
          observer.disconnect();
          resize.disconnect();
          unwatch();
          preferences.forEach((query) => query.removeEventListener('change', schedule));
          nativeSelect.removeEventListener('change', schedule);
          motion.removeEventListener('change', releaseAll);
          unwatchTheme();
          window.removeEventListener('blur', releaseAll);
          window.removeEventListener('scroll', scrolled, true);
          clearTimeout(scrollTimer);
          root.classList.remove('rn-scrolling');
          window.removeEventListener('resize', relayout);
          if (frame) cancelAnimationFrame(frame);
          if (alignFrame) cancelAnimationFrame(alignFrame);
          for (const control of controls.values()) control.destroy();
          for (const enhancement of enhancements.values()) enhancement.destroy();
          enhancements.clear();
          controls.clear();
          aligners.clear();
          backdrops.clear();
          if (previousOpacity) root.style.setProperty('--glass-opacity', previousOpacity);
          else root.style.removeProperty('--glass-opacity');
        };
      },
    )
    .catch(() => {
      /* Shared CSS stays usable if the optional optics module cannot load. */
    });
  return {
    destroy() {
      disposed = true;
      cleanup?.();
    },
  };
}
