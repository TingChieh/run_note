import type { Map as MapLibreMap, RasterSourceSpecification, StyleSpecification } from 'maplibre-gl';

export const BASEMAP_SOURCE = 'osm-basemap';
export const BASEMAP_LAYER = 'osm-basemap-tiles';
export const BASEMAP_TIMEOUT_MS = 8000;

// Start locally: external tile availability must never gate the route's load event.
export function createRouteMapStyle(dark = false): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#19271f' : '#edf3ef' } }] };
}

// Change paint only: retain the camera, loaded GeoJSON, selection and tile source.
export function applyMapTheme(map: MapLibreMap, dark: boolean): void {
  if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', dark ? '#19271f' : '#edf3ef');
  if (map.getLayer(BASEMAP_LAYER)) {
    map.setPaintProperty(BASEMAP_LAYER, 'raster-brightness-max', dark ? .45 : 1);
    map.setPaintProperty(BASEMAP_LAYER, 'raster-saturation', dark ? -.4 : 0);
  }
  if (map.getLayer('route-lines')) map.setPaintProperty('route-lines', 'line-color', dark ? '#77d4ac' : '#14785b');
  if (map.getLayer('route-points')) map.setPaintProperty('route-points', 'circle-color', dark ? '#77d4ac' : '#14785b');
  // Keep each route's identity, making all six hues readable on the dark map.
  const colors = dark ? ['match', ['get', 'color'], '#14785b', '#77d4ac', '#315caf', '#94baff', '#b4552c', '#f2b087', '#854caa', '#d3a2ed', '#397d87', '#8bd0d9', '#ba3970', '#f29bbb', ['get', 'color']] : ['get', 'color'];
  if (map.getLayer('footprint-lines')) map.setPaintProperty('footprint-lines', 'line-color', colors);
  if (map.getLayer('footprint-points')) map.setPaintProperty('footprint-points', 'circle-color', colors);
}

export function createBasemapSource(): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 19,
    attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>'
  };
}

export function isBasemapError(event: unknown): boolean {
  return typeof event === 'object' && event !== null && 'sourceId' in event && event.sourceId === BASEMAP_SOURCE;
}
