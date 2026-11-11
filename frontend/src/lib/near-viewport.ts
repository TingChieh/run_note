/**
 * Runs `start` once, when `node` comes within `margin` of the viewport. A map or chart further down
 * the page then costs nothing until the reader scrolls towards it. Without IntersectionObserver it
 * starts at once. Returns a function that cancels the wait.
 */
export function whenNearViewport(node: Element, start: () => void, margin = '200px 0px'): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    start();
    return () => {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    },
    { rootMargin: margin },
  );
  observer.observe(node);
  return () => observer.disconnect();
}
