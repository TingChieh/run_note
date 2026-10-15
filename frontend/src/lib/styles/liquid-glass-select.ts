import { createGlass } from '../vendor/liquidglass/liquid-glass.js';
import { createIndicator } from './liquid-glass-indicator.ts';
import { glassOptics, type GlassSettings } from './liquid-glass-settings.ts';
import { createSelectToggle } from './liquid-glass-select-toggle.ts';

let nextId = 0;

/** Progressive enhancement: the original select owns form values and Svelte bindings. */
export function enhanceSelect(select: HTMLSelectElement, root: HTMLElement, initial: GlassSettings) {
  const panel = document.createElement('div'); panel.className = 'rn-glass-menu'; panel.popover = 'auto';
  panel.id = `rn-select-${++nextId}`; panel.setAttribute('role', 'listbox');
  const labelText = () => {
    const label = select.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
    label?.querySelectorAll('select').forEach(node => node.remove());
    return select.getAttribute('aria-label') ?? label?.textContent?.trim() ?? '选项';
  };
  // Nested auto popovers must remain inside their parent to preserve the calendar stack.
  (select.closest<HTMLElement>('dialog, [popover]') ?? root).append(panel);
  const previous = new Map(['aria-expanded', 'aria-controls', 'aria-activedescendant'].map(name => [name, select.getAttribute(name)]));
  select.setAttribute('aria-controls', panel.id); select.setAttribute('aria-expanded', 'false'); select.classList.add('rn-liquid-select');
  let settings = initial, active = 0, buttons: HTMLButtonElement[] = [];
  let indicator: ReturnType<typeof createIndicator> | undefined;
  let glass: ReturnType<typeof createGlass> | undefined;
  let search = '', searchAt = 0;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerWasOpen = false;
  const isOpen = () => panel.matches(':popover-open');
  const arrow = createSelectToggle(select, panel.id, wasOpen => {
    if (isOpen() || wasOpen) close(); else show();
    select.focus({ preventScroll: true });
  });
  function release() {
    clearTimeout(cleanupTimer); cleanupTimer = undefined;
    select.setAttribute('aria-expanded', 'false'); select.removeAttribute('aria-activedescendant');
    arrow.expanded(false);
    indicator?.destroy(); indicator = undefined; glass?.destroy(); glass = undefined;
  }
  function position() {
    if (!isOpen()) return;
    const rect = select.getBoundingClientRect(), margin = 12, gap = 8;
    const width = Math.min(Math.max(rect.width, 192), innerWidth - margin * 2);
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(44, Math.min(320, innerHeight - margin * 2))}px`;
    panel.style.left = `${Math.max(margin, Math.min(rect.left, innerWidth - width - margin))}px`;
    const height = panel.offsetHeight;
    const desired = rect.bottom + gap + height <= innerHeight - margin ? rect.bottom + gap : rect.top - gap - height;
    panel.style.transformOrigin = desired < rect.top ? 'bottom center' : 'top center';
    panel.style.top = `${Math.max(margin, Math.min(desired, innerHeight - height - margin))}px`;
  }
  function close() { if (isOpen()) panel.hidePopover(); }
  function highlight(index: number, immediate = false) {
    active = index;
    if (!buttons[index]) return;
    select.setAttribute('aria-activedescendant', buttons[index].id);
    indicator?.move(index, immediate);
    // Scroll only the menu; scrollIntoView can move the page/calendar and invalidate its anchor.
    const button = buttons[index];
    if (button.offsetTop < panel.scrollTop) panel.scrollTop = button.offsetTop;
    else if (button.offsetTop + button.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = button.offsetTop + button.offsetHeight - panel.clientHeight;
    }
  }
  function choose(index: number) {
    const option = select.options[index];
    if (!option || option.disabled || select.disabled) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close(); select.focus({ preventScroll: true });
  }
  function show() {
    if (select.disabled || isOpen()) return;
    release();
    panel.setAttribute('aria-label', `${labelText()}选项`);
    buttons = [...select.options].map((option, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'rn-menu-option';
      button.id = `${panel.id}-${index}`; button.tabIndex = -1; button.textContent = option.label;
      button.disabled = option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(option.selected));
      button.addEventListener('pointerdown', event => event.preventDefault());
      // Enter can fire when the animated panel moves under a stationary pointer.
      // Only actual pointer motion should override a keyboard selection.
      button.addEventListener('pointermove', () => { if (!button.disabled && active !== index) highlight(index); });
      button.addEventListener('click', () => choose(index));
      return button;
    });
    panel.replaceChildren(...buttons);
    panel.showPopover(); position();
    select.setAttribute('aria-expanded', 'true');
    arrow.expanded(true);
    glass = createGlass(panel, { mode: 'backdrop', fit: true, radius: 24, ...glassOptics(settings, .7), chroma: 0, fallback: `blur(${16 + settings.blur}px) saturate(1.6)` });
    indicator = createIndicator(panel, buttons, settings);
    highlight(Math.max(0, select.selectedIndex), true);
    select.focus({ preventScroll: true }); search = '';
  }
  function step(delta: number) {
    for (let count = 1; count <= buttons.length; count++) {
      const index = (active + delta * count + buttons.length * 2) % buttons.length;
      if (!buttons[index].disabled) { highlight(index); return; }
    }
  }
  const click = (event: MouseEvent) => {
    event.preventDefault();
    if (isOpen() || pointerWasOpen) close(); else show();
    pointerWasOpen = false;
  };
  const pointer = (event: PointerEvent) => {
    if (!select.disabled && event.button === 0) { pointerWasOpen = isOpen(); event.preventDefault(); }
  };
  const keyboard = (event: KeyboardEvent) => {
    if (select.disabled) return;
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') { if (isOpen()) { event.preventDefault(); event.stopPropagation(); close(); } return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!isOpen()) { show(); return; }
      if (event.key === 'ArrowDown') step(1);
      else if (event.key === 'ArrowUp') step(-1);
      else if (event.key === 'Home' || event.key === 'End') {
        const candidates = buttons.map((button, index) => button.disabled ? -1 : index).filter(index => index >= 0);
        highlight(event.key === 'Home' ? candidates[0] : candidates.at(-1)!);
      } else choose(active);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); if (!isOpen()) show();
      const now = performance.now(); search = now - searchAt < 700 ? search + event.key : event.key; searchAt = now;
      const match = buttons.findIndex(button => !button.disabled && button.textContent?.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()));
      if (match >= 0) highlight(match);
    }
  };
  const beforeToggle = (event: Event) => {
    if ((event as ToggleEvent).newState !== 'closed') return;
    select.setAttribute('aria-expanded', 'false'); select.removeAttribute('aria-activedescendant');
    arrow.expanded(false);
    panel.removeAttribute('aria-label');
    // Keep optical layers alive through the exit transition, including native light dismissal.
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => { if (!isOpen()) release(); }, 240);
  };
  const outside = (event: PointerEvent) => { if (event.target !== select && !arrow.button.contains(event.target as Node) && !panel.contains(event.target as Node)) close(); };
  const focusOut = () => close();
  const scrolled = (event: Event) => { if (isOpen() && !panel.contains(event.target as Node)) position(); };
  const observer = new MutationObserver(() => { if (select.disabled || isOpen()) close(); });
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  const visibility = new MutationObserver(() => {
    if (select.closest('[hidden], [inert]') || !select.checkVisibility()) close();
  });
  for (let ancestor = select.parentElement; ancestor; ancestor = ancestor.parentElement) visibility.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert', 'open'] });
  select.addEventListener('pointerdown', pointer); select.addEventListener('click', click); select.addEventListener('keydown', keyboard); select.addEventListener('blur', focusOut);
  panel.addEventListener('beforetoggle', beforeToggle); document.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('blur', close); window.addEventListener('scroll', scrolled, true);
  return { update(next: GlassSettings) {
    settings = next; indicator?.update(next);
    arrow.position();
    glass?.update({ ...glassOptics(next, .7), chroma: 0 });
    if (select.disabled) close();
  }, destroy() {
    close(); release(); arrow.destroy(); observer.disconnect(); visibility.disconnect(); panel.remove(); select.classList.remove('rn-liquid-select');
    for (const [name, value] of previous) { if (value === null) select.removeAttribute(name); else select.setAttribute(name, value); }
    select.removeEventListener('pointerdown', pointer); select.removeEventListener('click', click); select.removeEventListener('keydown', keyboard); select.removeEventListener('blur', focusOut);
    panel.removeEventListener('beforetoggle', beforeToggle); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('blur', close); window.removeEventListener('scroll', scrolled, true);
  } };
}
