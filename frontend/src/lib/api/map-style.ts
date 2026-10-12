import type { RasterSourceSpecification, StyleSpecification } from 'maplibre-gl';

export const BASEMAP_SOURCE = 'osm-basemap';
export const BASEMAP_LAYER = 'osm-basemap-tiles';
export const BASEMAP_TIMEOUT_MS = 8000;

// Start locally: external tile availability must never gate the route's load event.
export function createRouteMapStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf3ef' } }] };
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
