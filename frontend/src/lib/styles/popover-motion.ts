/** Measure the real panel before animating, including its first open and rapid reopen. */
export function preparePopoverMotion(panel: HTMLElement) {
  panel.style.transition = 'none';
  panel.removeAttribute('data-popover-positioned');
}

/** Use layout dimensions, never the panel's animated getBoundingClientRect(). */
export function positionPopoverMotion(
  panel: HTMLElement,
  anchor: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  placement: { left: number; top: number }
) {
  const width = Math.max(1, panel.offsetWidth), height = Math.max(1, panel.offsetHeight);
  panel.style.setProperty('--popover-from-x', `${anchor.left + anchor.width / 2 - placement.left - width / 2}px`);
  panel.style.setProperty('--popover-from-y', `${anchor.top + anchor.height / 2 - placement.top - height / 2}px`);
  panel.style.setProperty('--popover-from-scale-x', String(anchor.width / width));
  panel.style.setProperty('--popover-from-scale-y', String(anchor.height / height));
  if (!panel.hasAttribute('data-popover-positioned')) {
    // Commit the measured, collapsed state before transitioning to the open state.
    void panel.offsetWidth;
    panel.style.removeProperty('transition');
    panel.setAttribute('data-popover-positioned', '');
  }
}
