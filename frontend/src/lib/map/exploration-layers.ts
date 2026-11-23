import type { DataDrivenPropertyValueSpecification, GeoJSONSourceSpecification } from 'maplibre-gl';
import type { ExplorationCells, ExplorationMarker, Layer } from '#lib/api/exploration.ts';

export type GeoCollection = Exclude<GeoJSONSourceSpecification['data'], string>;
export type BoundsBox = [number, number, number, number];
export type ZoomTier = 'country' | 'region' | 'city';

export const CHINA_OVERVIEW_BOUNDS: BoundsBox = [73.5, 18.0, 135.0, 53.5];
export const COUNTRY_MAX_ZOOM = 6.5;
export const REGION_MAX_ZOOM = 10.5;
const WORLD_HALF = Math.PI * 6378137;

export const emptyCollection: GeoCollection = { type: 'FeatureCollection', features: [] };

export function zoomTier(zoom: number): ZoomTier {
  if (zoom < COUNTRY_MAX_ZOOM) return 'country';
  if (zoom < REGION_MAX_ZOOM) return 'region';
  return 'city';
}

export function mercatorLon(x: number): number {
  return Math.min(180, Math.max(-180, (x * 180) / WORLD_HALF));
}

export function mercatorLat(y: number): number {
  return (Math.atan(Math.sinh((y * Math.PI) / WORLD_HALF)) * 180) / Math.PI;
}

export interface FramingSummary {
  allBounds: BoundsBox | null;
  chinaBounds: BoundsBox | null;
  hasChina: boolean;
  hasOverseas: boolean;
  initialBounds: BoundsBox | null;
}

function mergeBox(acc: BoundsBox | null, box: BoundsBox): BoundsBox {
  if (!acc) return [...box];
  return [Math.min(acc[0], box[0]), Math.min(acc[1], box[1]), Math.max(acc[2], box[2]), Math.max(acc[3], box[3])];
}

function markerBounds(marker: ExplorationMarker): BoundsBox {
  if (marker.bounds) return marker.bounds;
  return [
    Math.max(-180, marker.lon - 0.12),
    Math.max(-85, marker.lat - 0.1),
    Math.min(180, marker.lon + 0.12),
    Math.min(85, marker.lat + 0.1),
  ];
}

export function computeFraming(markers: ExplorationMarker[]): FramingSummary {
  let allBounds: BoundsBox | null = null;
  let chinaBounds: BoundsBox | null = null;
  let hasChina = false;
  let hasOverseas = false;
  for (const item of markers) {
    const box = markerBounds(item);
    allBounds = mergeBox(allBounds, box);
    if (item.country_code === 'CHN') {
      hasChina = true;
      chinaBounds = mergeBox(chinaBounds, box);
    } else {
      hasOverseas = true;
    }
  }
  const initialBounds = !hasOverseas && hasChina ? chinaBounds : allBounds;
  return { allBounds, chinaBounds, hasChina, hasOverseas, initialBounds };
}

export function markersToGeoJSON(markers: ExplorationMarker[]): GeoCollection {
  return {
    type: 'FeatureCollection',
    features: markers.map((item) => ({
      type: 'Feature',
      properties: {
        code: item.code,
        name: item.name,
        short_name: item.short_name,
        region_code: item.region_code,
        region_name: item.region_name ?? '',
        country_code: item.country_code,
        kind: item.kind,
        activity_count: item.activity_count,
        distance_m: item.distance_m ?? 0,
        first_date: item.first_date,
        last_date: item.last_date,
        is_new_in_year: item.is_new_in_year ? 1 : 0,
        is_nearby: item.kind === 'nearby' ? 1 : 0,
      },
      geometry: {
        type: 'Point',
        coordinates: [item.lon, item.lat],
      },
    })),
  };
}

export function cellsToFeatures(data: ExplorationCells | null): {
  polygons: GeoCollection;
  centroids: GeoCollection;
} {
  if (!data || !data.cells.length) return { polygons: emptyCollection, centroids: emptyCollection };
  const step = data.block_size * 100;
  const polygons: GeoCollection = {
    type: 'FeatureCollection',
    features: data.cells.map(([i, j, count]) => {
      const west = mercatorLon(i * step);
      const south = mercatorLat(j * step);
      const east = mercatorLon((i + 1) * step);
      const north = mercatorLat((j + 1) * step);
      return {
        type: 'Feature',
        properties: { count },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      };
    }),
  };
  const centroids: GeoCollection = {
    type: 'FeatureCollection',
    features: data.cells.map(([i, j, count]) => ({
      type: 'Feature',
      properties: { count },
      geometry: {
        type: 'Point',
        coordinates: [mercatorLon((i + 0.5) * step), mercatorLat((j + 0.5) * step)],
      },
    })),
  };
  return { polygons, centroids };
}

export function visitedRegionCodes(markers: ExplorationMarker[], layer: Layer): string[] {
  const codes = new Set<string>();
  for (const item of markers) {
    if (layer === 'new' && !item.is_new_in_year) continue;
    codes.add(item.region_code);
  }
  return [...codes];
}

export interface ProjectedLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  kind: 'cluster' | 'city';
  accent: boolean;
}

export interface ClusterPoint {
  id: number;
  lon: number;
  lat: number;
  count: number;
  hasNew: boolean;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function boxesOverlap(a: Box, b: Box, gap = 6): boolean {
  return !(a.right + gap < b.left || a.left - gap > b.right || a.bottom + gap < b.top || a.top - gap > b.bottom);
}

export function placeLabels(
  markers: ExplorationMarker[],
  clusters: ClusterPoint[],
  project: (lngLat: [number, number]) => { x: number; y: number },
  width: number,
  height: number,
  zoom: number,
  layer: Layer,
  selectedCode = '',
  maxLabels = 24,
): ProjectedLabel[] {
  if (width <= 0 || height <= 0 || zoom >= REGION_MAX_ZOOM) return [];
  const placed: Box[] = [];
  const labels: ProjectedLabel[] = [];

  for (const cluster of clusters) {
    const pos = project([cluster.lon, cluster.lat]);
    if (pos.x < 16 || pos.x > width - 16 || pos.y < 16 || pos.y > height - 16) continue;
    const text = `${cluster.count}城`;
    const halfW = Math.max(16, text.length * 5.5 + 8);
    const box: Box = { left: pos.x - halfW, top: pos.y - 10, right: pos.x + halfW, bottom: pos.y + 10 };
    placed.push(box);
    labels.push({
      id: `cluster-${cluster.id}`,
      text,
      x: pos.x,
      y: pos.y,
      kind: 'cluster',
      accent: layer === 'new' && cluster.hasNew,
    });
  }

  const ordered = [...markers].sort((a, b) => {
    if (a.code === selectedCode) return -1;
    if (b.code === selectedCode) return 1;
    if (layer === 'new' && a.is_new_in_year !== b.is_new_in_year) return a.is_new_in_year ? -1 : 1;
    if (b.activity_count !== a.activity_count) return b.activity_count - a.activity_count;
    return a.code.localeCompare(b.code);
  });

  for (const item of ordered) {
    if (labels.length >= maxLabels + clusters.length) break;
    const pos = project([item.lon, item.lat]);
    if (pos.x < 24 || pos.x > width - 24 || pos.y < 28 || pos.y > height - 20) continue;
    const text = item.short_name;
    const estWidth = Math.min(128, text.length * 12 + 16);
    const ly = pos.y - 18;
    const box: Box = {
      left: pos.x - estWidth / 2,
      top: ly - 10,
      right: pos.x + estWidth / 2,
      bottom: ly + 10,
    };
    if (box.left < 6 || box.right > width - 6 || box.top < 6) continue;
    if (placed.some((existing) => boxesOverlap(existing, box))) continue;
    placed.push(box);
    labels.push({
      id: `city-${item.code}`,
      text,
      x: pos.x,
      y: ly,
      kind: 'city',
      accent: layer === 'new' && item.is_new_in_year,
    });
  }

  return labels;
}

export interface ExplorationPalette {
  ocean: string;
  land: string;
  border: string;
  visitedHeat: string;
  visitedNew: string;
  stroke: string;
  clusterHeat: string;
  clusterNew: string;
  clusterMuted: string;
  markerHeat: DataDrivenPropertyValueSpecification<string>;
  markerNew: DataDrivenPropertyValueSpecification<string>;
  gridHeat: DataDrivenPropertyValueSpecification<string>;
  gridNewFill: string;
  gridNewOutline: string;
  newHalo: string;
  selectedStroke: string;
}

export function explorationPalette(dark: boolean): ExplorationPalette {
  if (dark) {
    return {
      ocean: '#252321',
      land: '#3b3835',
      border: '#4d4945',
      visitedHeat: '#2c3a32',
      visitedNew: '#3a3020',
      stroke: '#292725',
      clusterHeat: '#77d4ac',
      clusterNew: '#f5b942',
      clusterMuted: '#4f9a69',
      markerHeat: ['step', ['get', 'activity_count'], '#347247', 3, '#60aa72', 10, '#90cc96', 25, '#c7edb5'],
      markerNew: ['case', ['==', ['get', 'is_new_in_year'], 1], '#f5b942', '#4f9a69'],
      gridHeat: ['step', ['get', 'count'], '#347247', 2, '#60aa72', 5, '#90cc96', 10, '#c7edb5'],
      gridNewFill: '#f5b942',
      gridNewOutline: '#806b41',
      newHalo: 'rgba(245, 185, 66, 0.28)',
      selectedStroke: '#ffffff',
    };
  }
  return {
    ocean: '#e8f0f4',
    land: '#fcfdfb',
    border: '#d5ded8',
    visitedHeat: '#e3f4e8',
    visitedNew: '#fdf0d5',
    stroke: '#ffffff',
    clusterHeat: '#17745c',
    clusterNew: '#d98218',
    clusterMuted: '#4ca76a',
    markerHeat: ['step', ['get', 'activity_count'], '#8dcc9c', 3, '#4ca76a', 10, '#227b49', 25, '#105332'],
    markerNew: ['case', ['==', ['get', 'is_new_in_year'], 1], '#d98218', '#72b78a'],
    gridHeat: ['step', ['get', 'count'], '#8dcc9c', 2, '#4ca76a', 5, '#227b49', 10, '#105332'],
    gridNewFill: '#d98218',
    gridNewOutline: '#805412',
    newHalo: 'rgba(217, 130, 24, 0.24)',
    selectedStroke: '#1e302b',
  };
}
