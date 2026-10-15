const hosts = new WeakMap<HTMLElement, { count: number; position: string }>();

/** Place an arrow over the existing select without wrapping or moving Svelte-owned DOM. */
export function createSelectToggle(select: HTMLSelectElement, panelId: string, onclick: (wasOpen: boolean) => void) {
  const host = select.parentElement!;
  const shared = hosts.get(host) ?? { count: 0, position: host.style.position };
  if (!shared.count && getComputedStyle(host).position === 'static') host.style.position = 'relative';
  shared.count++; hosts.set(host, shared);
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'rn-select-toggle'; button.tabIndex = -1;
  button.setAttribute('aria-label', '展开选项'); button.setAttribute('aria-controls', panelId);
  button.setAttribute('aria-expanded', 'false');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm7 10 5 5 5-5'); svg.append(path); button.append(svg); host.append(button);
  const position = () => {
    button.style.left = `${select.offsetLeft + select.offsetWidth - 36}px`;
    button.style.top = `${select.offsetTop + (select.offsetHeight - 32) / 2}px`;
    button.hidden = !select.checkVisibility(); button.disabled = select.disabled;
  };
  let pointerWasOpen = false;
  const pointer = (event: PointerEvent) => { pointerWasOpen = button.getAttribute('aria-expanded') === 'true'; event.preventDefault(); };
  const click = (event: MouseEvent) => {
    event.preventDefault(); event.stopPropagation(); onclick(event.detail > 0 && pointerWasOpen); pointerWasOpen = false;
  };
  button.addEventListener('pointerdown', pointer); button.addEventListener('click', click);
  const resize = new ResizeObserver(position); resize.observe(select); resize.observe(host); position();
  return { button, position,
    expanded(open: boolean) {
      button.setAttribute('aria-expanded', String(open)); button.setAttribute('aria-label', open ? '收起选项' : '展开选项');
    },
    destroy() {
      resize.disconnect(); button.removeEventListener('pointerdown', pointer); button.removeEventListener('click', click); button.remove();
      if (!--shared.count) { host.style.position = shared.position; hosts.delete(host); }
    }
  };
}
