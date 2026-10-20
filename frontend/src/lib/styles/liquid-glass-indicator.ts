import { createGlass, createSpring } from '../vendor/liquidglass/liquid-glass.js';
import { glassOptics, type GlassSettings } from './liquid-glass-settings.ts';

/** Decorative copy of known navigation/option labels; never copies arbitrary page content. */
export function createIndicator(host: HTMLElement, items: HTMLElement[], initial: GlassSettings, axis: 'x' | 'y' = 'y', start = 0) {
  const horizontal = axis === 'x';
  const copy = document.createElement('span'), outline = document.createElement('span');
  copy.className = 'rn-moving-copy'; outline.className = 'rn-moving-outline';
  for (const node of [copy, outline]) node.setAttribute('aria-hidden', 'true');
  const labels = items.map(item => {
    const label = document.createElement('span'); label.className = 'rn-moving-label';
    const icon = item.querySelector('svg'); if (icon) label.append(icon.cloneNode(true));
    const text = document.createElement('span'); text.textContent = item.textContent?.trim() ?? '';
    label.append(text); copy.append(label); return label;
  });
  host.append(outline, copy);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const glass = createGlass(copy, { clip: true, ...glassOptics(initial, .55), chroma: 0 });
  let index = start, pos = 0, velocity = 0, press = 0, alive = true;
  function render() {
    if (!alive || !items[index]) return;
    const item = items[index];
    const stretch = motion.matches ? 0 : Math.min(12, Math.abs(velocity) * .018);
    const width = Math.max(1, item.offsetWidth - 4 * press) + (horizontal ? stretch : 0);
    const height = item.offsetHeight + (horizontal ? 0 : stretch) + 6 * press;
    const x = horizontal ? pos - stretch / 2 + 2 * press : item.offsetLeft + 2 * press;
    const top = horizontal ? item.offsetTop - 3 * press : pos - stretch / 2 - 3 * press;
    glass.update({ x, y: top - host.scrollTop, width, height, radius: height / 2 });
    Object.assign(outline.style, { width: `${width}px`, height: `${height}px`, borderRadius: `${height / 2}px`, transform: `translate(${x}px, ${top}px)` });
  }
  const spring = createSpring(0, (value, speed) => { pos = value; velocity = speed; render(); }, { stiffness: 380, damping: 30 });
  const pressure = createSpring(0, value => { press = value; render(); }, { stiffness: 550, damping: 32 });
  function move(next: number, immediate = false) {
    if (!items[next]) return;
    index = next; spring.set(horizontal ? items[next].offsetLeft : items[next].offsetTop, { immediate: immediate || motion.matches });
  }
  function refresh() {
    // Keep the filtered copy viewport-sized, even for a scrolling 201-year menu.
    Object.assign(copy.style, { height: `${host.clientHeight}px`, width: `${host.clientWidth}px`, transform: `translateY(${host.scrollTop}px)` });
    items.forEach((item, i) => {
      const style = getComputedStyle(item);
      Object.assign(labels[i].style, { left: `${item.offsetLeft}px`, top: `${item.offsetTop - host.scrollTop}px`, width: `${item.offsetWidth}px`, height: `${item.offsetHeight}px`, padding: style.padding, gap: style.gap, font: style.font, letterSpacing: style.letterSpacing });
    });
    move(index, true);
  }
  const changedMotion = () => { pressure.set(0, { immediate: true }); move(index, true); };
  motion.addEventListener('change', changedMotion);
  const resize = new ResizeObserver(refresh); resize.observe(host);
  host.addEventListener('scroll', refresh, { passive: true });
  refresh();
  return { move, refresh, press(value: number) { pressure.set(motion.matches ? 0 : value); },
    update(settings: GlassSettings) { glass.update({ ...glassOptics(settings, .55), chroma: 0 }); },
    destroy() { alive = false; resize.disconnect(); host.removeEventListener('scroll', refresh); motion.removeEventListener('change', changedMotion); spring.stop(); pressure.stop(); glass.destroy(); copy.remove(); outline.remove(); }
  };
}

export function enhanceNavigation(nav: HTMLElement, settings: GlassSettings) {
  const read = () => [...nav.querySelectorAll<HTMLAnchorElement>(':scope > .nav-link')];
  let current = settings, links = read(), stop = build(nav, links, settings);
  // Links appear after the session resolves (e.g. the admin entry), so a stale link list must be rebuilt.
  const sameLinks = () => { const next = read(); return next.length === links.length && next.every((link, i) => link === links[i]); };
  return { update(next: GlassSettings) {
    current = next;
    if (sameLinks()) { stop.update(next); return; }
    stop.destroy(); links = read(); stop = build(nav, links, current);
  }, destroy() { stop.destroy(); } };
}

function build(nav: HTMLElement, links: HTMLAnchorElement[], settings: GlassSettings) {
  const indicator = createIndicator(nav, links, settings);
  nav.classList.add('rn-liquid-navigation');
  const currentIndex = () => Math.max(0, links.findIndex(link => link.getAttribute('aria-current') === 'page'));
  const restore = () => { indicator.press(0); indicator.move(currentIndex()); };
  const handlers = links.map((link, index) => {
    const move = () => indicator.move(index);
    const down = () => indicator.press(1);
    link.addEventListener('pointerenter', move); link.addEventListener('focus', move); link.addEventListener('pointerdown', down);
    return () => { link.removeEventListener('pointerenter', move); link.removeEventListener('focus', move); link.removeEventListener('pointerdown', down); };
  });
  const focusOut = (event: FocusEvent) => { if (!nav.contains(event.relatedTarget as Node | null)) restore(); };
  const release = () => indicator.press(0);
  const observer = new MutationObserver(restore);
  links.forEach(link => observer.observe(link, { attributes: true, attributeFilter: ['aria-current'] }));
  nav.addEventListener('pointerleave', restore); nav.addEventListener('focusout', focusOut);
  window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release); window.addEventListener('blur', restore);
  indicator.move(currentIndex(), true);
  return { update: indicator.update, destroy() {
    observer.disconnect(); handlers.forEach(remove => remove()); indicator.destroy(); nav.classList.remove('rn-liquid-navigation');
    nav.removeEventListener('pointerleave', restore); nav.removeEventListener('focusout', focusOut);
    window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); window.removeEventListener('blur', restore);
  } };
}

/** Horizontal variant for `.settings-tabs` links and `.compact-switch` buttons: a glass lens glides under the active one. */
export function enhanceSegmented(group: HTMLElement, settings: GlassSettings) {
  const read = () => [...group.querySelectorAll<HTMLElement>(':scope > a, :scope > button')];
  let items = read(), current = settings, stop = buildSegmented(group, items, settings);
  const same = () => { const next = read(); return next.length === items.length && next.every((item, i) => item === items[i]); };
  return { update(next: GlassSettings) {
    current = next;
    if (same()) { stop.update(next); return; }
    stop.destroy(); items = read(); stop = buildSegmented(group, items, current);
  }, destroy() { stop.destroy(); } };
}

// The lens position survives route changes, so the lens glides from the old tab to the new one after a page swap.
const lensIndex = new Map<string, number>();

function buildSegmented(group: HTMLElement, items: HTMLElement[], settings: GlassSettings) {
  const key0 = group.getAttribute('aria-label') ?? '';
  const indicator = createIndicator(group, items, settings, 'x', Math.min(lensIndex.get(key0) ?? 0, items.length - 1));
  group.classList.add('rn-liquid-navigation');
  const key = group.getAttribute('aria-label') ?? '';
  const active = (item: HTMLElement) => item.getAttribute('aria-current') === 'page' || item.getAttribute('aria-pressed') === 'true';
  const currentIndex = () => Math.max(0, items.findIndex(active));
  const go = (index: number, immediate = false) => { lensIndex.set(key, index); indicator.move(index, immediate); };
  // A clicked link keeps the lens on it while the next page loads, instead of snapping back to the old tab.
  let pending = -1, pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const restore = () => { indicator.press(0); go(pending >= 0 ? pending : currentIndex()); };
  const settle = () => { pending = -1; restore(); };
  const release = () => indicator.press(0);
  const handlers = items.map((item, index) => {
    const move = () => go(index), down = () => indicator.press(1);
    const click = () => { pending = index; clearTimeout(pendingTimer); pendingTimer = setTimeout(settle, 2500); };
    item.addEventListener('pointerenter', move); item.addEventListener('focus', move); item.addEventListener('pointerdown', down); item.addEventListener('click', click);
    return () => { item.removeEventListener('pointerenter', move); item.removeEventListener('focus', move); item.removeEventListener('pointerdown', down); item.removeEventListener('click', click); };
  });
  const focusOut = (event: FocusEvent) => { if (!group.contains(event.relatedTarget as Node | null)) restore(); };
  const observer = new MutationObserver(settle);
  items.forEach(item => observer.observe(item, { attributes: true, attributeFilter: ['aria-current', 'aria-pressed'] }));
  group.addEventListener('pointerleave', restore); group.addEventListener('focusout', focusOut);
  window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release); window.addEventListener('blur', restore);
  const target = currentIndex(), from = Math.min(lensIndex.get(key) ?? target, items.length - 1);
  go(from, true);
  if (from !== target) requestAnimationFrame(() => go(currentIndex()));
  return { update: indicator.update, destroy() {
    observer.disconnect(); clearTimeout(pendingTimer); handlers.forEach(remove => remove()); indicator.destroy(); group.classList.remove('rn-liquid-navigation');
    group.removeEventListener('pointerleave', restore); group.removeEventListener('focusout', focusOut);
    window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); window.removeEventListener('blur', restore);
  } };
}
