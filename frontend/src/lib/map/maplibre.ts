/** Load MapLibre GL JS with its stylesheet and self-hosted module worker URL (required by MapLibre v6 in bundlers). */
export async function loadMapLibre() {
  const [lib, , worker] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
  ]);
  lib.setWorkerUrl(worker.default);
  return lib;
}

/**
 * MapLibre expands the compact attribution the first time it receives content (when the basemap
 * arrives). Collapse that one automatic expansion so the map starts with just the ⓘ button; the
 * attribution stays one click away and toggles normally afterwards.
 */
export function startAttributionCollapsed(container: HTMLElement): () => void {
  const element = container.querySelector('.maplibregl-ctrl-attrib');
  if (!element) return () => {};
  const observer = new MutationObserver(() => {
    if (!element.classList.contains('maplibregl-compact-show')) return;
    element.classList.remove('maplibregl-compact-show');
    observer.disconnect();
  });
  observer.observe(element, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
