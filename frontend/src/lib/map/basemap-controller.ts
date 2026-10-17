import type { Map as LibreMap, MapLibreEvent, ErrorEvent } from 'maplibre-gl';
import { BASEMAP_TIMEOUT_MS, BASEMAP_URL, applyMapTheme, prepareBasemapStyle, resolveBasemap,
  savedBasemapPreference, watchBasemapPreference, type BasemapPreference, type BasemapStatus, type BasemapStyle } from '#lib/api/map-style.ts';
import { watchSystemTheme } from '#lib/components/system-theme.ts';

// Owns external layers only. Local sources, markers, selections, camera and handlers survive.
export function createBasemapController(map: LibreMap, beforeLayer: string,
  update: (state: { status: BasemapStatus; preference: BasemapPreference; style: BasemapStyle }) => void) {
  let preference = savedBasemapPreference(), dark = false, enabled = true, disposed = false;
  let retryAssets = false;
  let installing = false;
  let atlas: { url: string; ready: Promise<void> } | undefined;
  let status: BasemapStatus = 'loading', active: BasemapStyle | undefined;
  let generation = 0, prefix = '', sources: string[] = [], layers: string[] = [];
  let abort: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    applyMapTheme(map, status === 'failed' || status === 'off' ? dark : active === 'dark');
    update({ status, preference, style: resolveBasemap(preference, dark) });
  };
  function clear() {
    generation++; abort?.abort(); abort = undefined; clearTimeout(timer); timer = undefined;
    // Reverse order also handles references among provider layers.
    for (const id of layers.reverse()) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of sources) if (map.getSource(id)) map.removeSource(id);
    layers = []; sources = []; prefix = '';
  }
  function fail(token: number) {
    if (disposed || token !== generation || !enabled) return;
    retryAssets = true; clear(); status = 'failed'; publish();
  }
  async function load() {
    if (disposed || !enabled) return;
    clear(); active = resolveBasemap(preference, dark); status = 'loading'; publish();
    const token = generation, controller = new AbortController(); abort = controller;
    timer = setTimeout(() => fail(token), BASEMAP_TIMEOUT_MS);
    try {
      const response = await fetch(BASEMAP_URL + active, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Basemap unavailable');
      const json: unknown = await response.json();
      if (disposed || token !== generation) return;
      prefix = `basemap-${token}-`;
      const style = prepareBasemapStyle(json, prefix);
      // All three OFM styles use the same sprite/glyph resources. Setting them does
      // not replace the Style or block local GeoJSON behind external style loading.
      if (style.glyphs && (retryAssets || map.getGlyphs() !== style.glyphs)) map.setGlyphs(style.glyphs);
      if (typeof style.sprite === 'string') {
        if (retryAssets || atlas?.url !== style.sprite) {
          const url = style.sprite;
          // Style exposes completion; Map.setSprite does not. Await the current
          // atlas so a late completion/error from an expired load cannot mark a
          // retry ready or remove its layers. OFM's three styles share this atlas.
          atlas = { url, ready: new Promise<void>((resolve, reject) => {
            map.style.setSprite(url, {}, error => error ? reject(error) : resolve());
          }) };
        }
        await atlas!.ready;
      }
      if (token !== generation) return;
      retryAssets = false;
      installing = true;
      for (const [id, source] of Object.entries(style.sources)) {
        if (token !== generation) return;
        sources.push(id); map.addSource(id, source);
      }
      for (const layer of style.layers) {
        if (token !== generation) return;
        layers.push(layer.id); map.addLayer(layer, beforeLayer);
      }
      check();
    } catch { fail(token); }
    finally { installing = false; }
  }
  function check() {
    if (disposed || status !== 'loading' || !layers.length) return;
    if (!map.isStyleLoaded() || !sources.every(id => map.isSourceLoaded(id))) return;
    clearTimeout(timer); timer = undefined; status = 'ready'; publish();
  }
  function onError(event: ErrorEvent & { sourceId?: string }) {
    if (disposed || !enabled) return;
    // Old tile events must not fail a newer selection. Local errors stay with its component.
    if (event.sourceId) {
      if (prefix && event.sourceId.startsWith(prefix)) fail(generation);
    // Sprite completion belongs to its Promise above. Unscoped asynchronous
    // errors cannot be attributed to the current generation; glyph failures are
    // covered by source readiness and the timeout, then reset on retry.
    } else if (installing) fail(generation);
  }
  const onData = (_event: MapLibreEvent) => check();
  map.on('render', onData); map.on('error', onError);
  let initialized = false;
  const stopPreference = watchBasemapPreference(value => {
    preference = value;
    if (initialized && enabled && active !== resolveBasemap(preference, dark)) void load();
    else if (initialized) publish();
  });
  const stopTheme = watchSystemTheme(value => {
    dark = value;
    if (initialized && enabled && active !== resolveBasemap(preference, dark)) void load();
    else if (initialized) publish();
  });
  initialized = true; void load();
  return {
    retry: () => { if (enabled) void load(); },
    toggle: () => { enabled = !enabled; if (enabled) void load(); else { if (status === 'loading') retryAssets = true; clear(); status = 'off'; publish(); } },
    destroy: () => { disposed = true; stopPreference(); stopTheme(); clear(); map.off('render', onData); map.off('error', onError); }
  };
}
