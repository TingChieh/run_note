import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';

export type BasemapStyle = 'positron' | 'dark' | 'liberty';
export type BasemapPreference = BasemapStyle | 'auto';
export type BasemapStatus = 'loading' | 'ready' | 'failed' | 'off';
export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/';
export const BASEMAP_STORAGE_KEY = 'runnote-basemap';
const preferenceEvent = 'runnote-basemap-change';

export function parseBasemapPreference(value: unknown): BasemapPreference {
  return value === 'positron' || value === 'dark' || value === 'liberty' ? value : 'auto';
}
export function resolveBasemap(preference: BasemapPreference, dark: boolean): BasemapStyle {
  return preference === 'auto' ? dark ? 'dark' : 'positron' : preference;
}

// Browser-only callers invoke these from onMount or event handlers.
export function savedBasemapPreference(): BasemapPreference {
  try { return parseBasemapPreference(localStorage.getItem(BASEMAP_STORAGE_KEY)); } catch { return 'auto'; }
}
export function setBasemapPreference(value: BasemapPreference): void {
  try {
    if (value === 'auto') localStorage.removeItem(BASEMAP_STORAGE_KEY);
    else localStorage.setItem(BASEMAP_STORAGE_KEY, value);
  } catch { /* The current page still works with storage disabled. */ }
  window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: value }));
}
export function watchBasemapPreference(update: (value: BasemapPreference) => void): () => void {
  const changed = (event: Event) => update((event as CustomEvent<BasemapPreference>).detail);
  const stored = (event: StorageEvent) => { if (event.key === BASEMAP_STORAGE_KEY || event.key === null) update(savedBasemapPreference()); };
  window.addEventListener(preferenceEvent, changed);
  window.addEventListener('storage', stored);
  update(savedBasemapPreference());
  return () => { window.removeEventListener(preferenceEvent, changed); window.removeEventListener('storage', stored); };
}

const numericCompare = new Set(['==', '!=', '>', '>=', '<', '<=']);
function isBareGet(value: unknown): value is ['get', string] {
  return Array.isArray(value) && value.length === 2 && value[0] === 'get' && typeof value[1] === 'string';
}
// OpenFreeMap rank filters compare ['get','rank'] with a number. Features that omit the
// property evaluate to null and MapLibre logs a type warning. Skip the comparison unless
// the property is actually a number, which keeps the previous "no match" result.
function guardNullNumbers(value: unknown): unknown {
  if (Array.isArray(value)) {
    const [op, ...rest] = value;
    if (typeof op === 'string' && numericCompare.has(op) && rest.length === 2) {
      const left = guardNullNumbers(rest[0]);
      const right = guardNullNumbers(rest[1]);
      const property = isBareGet(left) ? left : isBareGet(right) ? right : null;
      const other = property === left ? right : left;
      if (property && typeof other === 'number') return ['case', ['==', ['typeof', property], 'number'], [op, left, right], false];
      return [op, left, right];
    }
    return [op, ...rest.map(guardNullNumbers)];
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, guardNullNumbers(item)]));
  return value;
}
function guardLayer<T extends { filter?: unknown; paint?: unknown; layout?: unknown }>(layer: T): T {
  return { ...layer,
    ...(layer.filter === undefined ? {} : { filter: guardNullNumbers(layer.filter) }),
    ...(layer.paint === undefined ? {} : { paint: guardNullNumbers(layer.paint) }),
    ...(layer.layout === undefined ? {} : { layout: guardNullNumbers(layer.layout) })
  };
}

// Validate the external structure before touching MapLibre; preserve source-layer names.
export function prepareBasemapStyle(value: unknown, prefix: string): StyleSpecification {
  if (!value || typeof value !== 'object') throw new Error('Invalid basemap style');
  const style = value as StyleSpecification;
  if (style.version !== 8 || !style.sources || typeof style.sources !== 'object' || Array.isArray(style.sources) || !Array.isArray(style.layers)) throw new Error('Invalid basemap style');
  const ids = new Set<string>();
  for (const layer of style.layers) {
    if (!layer || typeof layer.id !== 'string' || ids.has(layer.id) || typeof layer.type !== 'string') throw new Error('Invalid basemap layer');
    ids.add(layer.id);
    if ('source' in layer && (typeof layer.source !== 'string' || !Object.hasOwn(style.sources, layer.source))) throw new Error('Invalid basemap source');
  }
  for (const source of Object.values(style.sources)) {
    // Only provider tile sources belong here; local GeoJSON never leaves the map.
    if (!source || !['vector', 'raster', 'raster-dem'].includes(source.type)) throw new Error('Invalid basemap source');
  }
  return { ...style,
    sources: Object.fromEntries(Object.entries(style.sources).map(([id, source]) => [prefix + id, source])),
    layers: style.layers.map(layer => guardLayer({ ...layer, id: prefix + layer.id, ...('source' in layer ? { source: prefix + layer.source } : {}) }))
  };
}
export const BASEMAP_TIMEOUT_MS = 8000;

// One local background for both the initial style and later theme switches.
const routeMapBackground = (dark: boolean) => (dark ? '#302e2c' : '#edf3ef');

// Start locally: external tile availability must never gate the route's load event.
export function createRouteMapStyle(dark = false): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': routeMapBackground(dark) } }] };
}

// Change paint only: retain the camera, loaded GeoJSON, selection and tile source.
export function applyMapTheme(map: MapLibreMap, dark: boolean): void {
  if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', routeMapBackground(dark));
  if (map.getLayer('route-lines')) map.setPaintProperty('route-lines', 'line-color', dark ? '#77d4ac' : '#14785b');
  if (map.getLayer('route-points')) map.setPaintProperty('route-points', 'circle-color', dark ? '#77d4ac' : '#14785b');
  // Keep each route's identity, making all six hues readable on the dark map.
  const colors = dark ? ['match', ['get', 'color'], '#14785b', '#77d4ac', '#315caf', '#94baff', '#b4552c', '#f2b087', '#854caa', '#d3a2ed', '#397d87', '#8bd0d9', '#ba3970', '#f29bbb', ['get', 'color']] : ['get', 'color'];
  if (map.getLayer('footprint-lines')) map.setPaintProperty('footprint-lines', 'line-color', colors);
  if (map.getLayer('footprint-points')) map.setPaintProperty('footprint-points', 'circle-color', colors);
}
