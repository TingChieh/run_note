/** Keep the page from scrolling behind an open dialog, including iOS touch scroll. */
export function installDialogScrollLock(doc: Document = document, view: Window = window) {
  const coarse = () => view.matchMedia('(hover: none) and (pointer: coarse)').matches;
  let lockedScroll = 0;
  let fixed = false;
  const apply = () => {
    const open = doc.querySelector('dialog[open]');
    const root = doc.documentElement;
    if (open) {
      root.classList.add('rn-dialog-open');
      if (coarse() && !fixed) {
        lockedScroll = view.scrollY;
        root.classList.add('rn-dialog-lock');
        doc.body.style.top = `-${lockedScroll}px`;
        fixed = true;
      }
      return;
    }
    root.classList.remove('rn-dialog-open');
    if (!fixed) return;
    root.classList.remove('rn-dialog-lock');
    doc.body.style.top = '';
    fixed = false;
    view.scrollTo(0, lockedScroll);
  };
  const observer = new MutationObserver(apply);
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  apply();
  return () => {
    observer.disconnect();
    doc.documentElement.classList.remove('rn-dialog-open', 'rn-dialog-lock');
    if (fixed) { doc.body.style.top = ''; fixed = false; }
  };
}
