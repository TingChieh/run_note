/** Layout viewport plus the visual viewport, which diverges on iOS zoom and the keyboard. */
export function visualViewportBox(view: Pick<Window, 'innerWidth' | 'innerHeight' | 'visualViewport'> = window) {
  const viewport = view.visualViewport;
  if (!viewport) return { left: 0, top: 0, width: view.innerWidth, height: view.innerHeight };
  return { left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height };
}

/** iOS URL-bar and keyboard changes resize the window without changing its width. */
export function followViewportWidth(onMove: () => void, onWidthChange: () => void, view: Window = window) {
  let width = view.innerWidth;
  const onResize = () => {
    const next = view.innerWidth;
    if (next !== width) { width = next; onWidthChange(); return; }
    onMove();
  };
  view.addEventListener('resize', onResize);
  const viewport = view.visualViewport;
  viewport?.addEventListener('resize', onMove);
  viewport?.addEventListener('scroll', onMove);
  return () => {
    view.removeEventListener('resize', onResize);
    viewport?.removeEventListener('resize', onMove);
    viewport?.removeEventListener('scroll', onMove);
  };
}

export function bindVisualViewport(listener: () => void, view: Window = window) {
  const viewport = view.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener('resize', listener);
  viewport.addEventListener('scroll', listener);
  return () => {
    viewport.removeEventListener('resize', listener);
    viewport.removeEventListener('scroll', listener);
  };
}

export function popoverSupported() {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
}

/** `checkVisibility` is Safari 17.4+. Older engines still need a visibility answer. */
export function isElementShown(element: HTMLElement) {
  if (typeof element.checkVisibility === 'function') return element.checkVisibility();
  return element.getClientRects().length > 0;
}

/** Phones open the platform picker; a second custom menu would stack on top of it. */
export function prefersNativeSelect(view: Window = window) {
  return view.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
