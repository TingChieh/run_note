import type { DataDrivenPropertyValueSpecification } from 'maplibre-gl';
import type { FootprintCollection } from '#lib/api/footprints.ts';
import { geometryBounds } from '#lib/api/footprints.ts';
import { heatFillColor } from '#lib/map/footprint-colors.ts';
import {
  COUNTRY_MAX_ZOOM,
  REGION_MAX_ZOOM,
  explorationPalette,
  placeLabels,
  zoomTier,
  type ClusterPoint,
  type GeoCollection,
  type ProjectedLabel,
  type ZoomTier,
} from '#lib/map/exploration-layers.ts';

type Point = [number, number];
type Bounds = [Point, Point];
type Polygon = Point[][];
type Geometry = FootprintCollection['features'][number]['geometry'];
export type FootprintMode = FootprintCollection['mode'];

export interface CityRegion {
  code: string;
  name: string;
  bounds: Bounds;
  polygons: Polygon[];
}
export interface FootprintCity {
  code: string;
  name: string;
  bounds: Bounds;
}
export interface CityLocations {
  cities: FootprintCity[];
  unlocatedBounds: Bounds | null;
}

export interface FootprintCityFeatureInput {
  geometry: Geometry;
  activityId?: string;
  count?: number;
}
export interface FootprintCitySummary extends FootprintCity {
  shortName: string;
  lon: number;
  lat: number;
  /** Distinct activities in tracks mode, or max cell distinct-activity count in heatmap mode. */
  count: number;
  /** Number of 100 m heatmap cells intersecting this city (0 in tracks mode). */
  cellCount: number;
}
export interface FootprintCitySummaryLocations {
  cities: FootprintCitySummary[];
  /** Coarse (~0.5 deg) display-only fallback markers for footprints outside the China city atlas. */
  unlocatedMarkers: FootprintCitySummary[];
  unlocatedBounds: Bounds | null;
}

const FALLBACK_BUCKET_DEG = 0.5;

export { COUNTRY_MAX_ZOOM, REGION_MAX_ZOOM, zoomTier, type ClusterPoint, type ProjectedLabel, type ZoomTier };

const ETHNIC_GROUP =
  '(?:蒙古|藏|回|维吾尔|苗|彝|壮|布依|朝鲜|满|侗|瑶|白|土家|哈尼|哈萨克|傣|黎|傈僳|佤|畲|高山|拉祜|水|东乡|纳西|景颇|柯尔克孜|土|达斡尔|仫佬|羌|布朗|撒拉|毛南|仡佬|锡伯|阿昌|普米|塔吉克|怒|乌孜别克|俄罗斯|鄂温克|德昂|保安|裕固|京|塔塔尔|独龙|鄂伦春|赫哲|门巴|珞巴|基诺)族?';
const AUTONOMOUS_SUFFIX = new RegExp(`(?:${ETHNIC_GROUP})+自治[州县旗]$`);
const ADMIN_SUFFIX = /(?:特别行政区|地区|林区|盟|市|县)$/;

/** Short readable label for Chinese prefecture-level city names in the bundled atlas. */
export function shortCityName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const withoutAutonomous = trimmed.replace(AUTONOMOUS_SUFFIX, '');
  if (withoutAutonomous !== trimmed && withoutAutonomous.length >= 2) return withoutAutonomous;
  const withoutSuffix = trimmed.replace(ADMIN_SUFFIX, '');
  if (withoutSuffix !== trimmed && withoutSuffix.length >= 2) return withoutSuffix;
  return trimmed;
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a[0][0] <= b[1][0] && a[1][0] >= b[0][0] && a[0][1] <= b[1][1] && a[1][1] >= b[0][1];
}
function merge(a: Bounds | null, b: Bounds): Bounds {
  return a
    ? [
        [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
        [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
      ]
    : b;
}
function cross(a: Point, b: Point, p: Point): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.abs(cross(a, b, p)) < 1e-10 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-10 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-10 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-10 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-10
  );
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    !overlaps(
      [
        [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
        [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
      ],
      [
        [Math.min(c[0], d[0]), Math.min(c[1], d[1])],
        [Math.max(c[0], d[0]), Math.max(c[1], d[1])],
      ],
    )
  )
    return false;
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
function inRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (onSegment(a, b, point)) return true;
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}
function inPolygon(point: Point, polygon: Polygon): boolean {
  return inRing(point, polygon[0]) && !polygon.slice(1).some((ring) => inRing(point, ring));
}
const polygonBounds = new WeakMap<Polygon, Bounds>();
function boundsOf(polygon: Polygon): Bounds {
  let cached = polygonBounds.get(polygon);
  if (!cached) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of polygon[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    cached = [
      [minX, minY],
      [maxX, maxY],
    ];
    polygonBounds.set(polygon, cached);
  }
  return cached;
}
function lineBounds(line: Point[]): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of line) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}
// Exact, only cheaper: polygons whose outline box misses the line's box cannot touch it, and only ring edges
// inside the line's box can cross it, so the n x m edge comparison shrinks to n x (nearby edges).
function touchesLine(line: Point[], region: CityRegion): boolean {
  const box = lineBounds(line);
  for (const polygon of region.polygons) {
    if (!overlaps(box, boundsOf(polygon))) continue;
    const outline = boundsOf(polygon);
    for (const point of line) {
      if (
        point[0] < outline[0][0] ||
        point[0] > outline[1][0] ||
        point[1] < outline[0][1] ||
        point[1] > outline[1][1]
      )
        continue;
      if (inPolygon(point, polygon)) return true;
    }
  }
  for (const polygon of region.polygons) {
    if (!overlaps(box, boundsOf(polygon))) continue;
    for (const ring of polygon) {
      const edges: [Point, Point][] = [];
      for (let j = 1; j < ring.length; j++) {
        const c = ring[j - 1],
          d = ring[j];
        if (
          Math.max(c[0], d[0]) >= box[0][0] &&
          Math.min(c[0], d[0]) <= box[1][0] &&
          Math.max(c[1], d[1]) >= box[0][1] &&
          Math.min(c[1], d[1]) <= box[1][1]
        )
          edges.push([c, d]);
      }
      if (!edges.length) continue;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i];
        // Crossing the dateline must never invent a segment through mainland China.
        if (Math.abs(a[0] - b[0]) > 180) continue;
        for (const [c, d] of edges) if (intersects(a, b, c, d)) return true;
      }
    }
  }
  return false;
}
function touchesPolygon(polygon: Polygon, region: CityRegion): boolean {
  return (
    polygon.some((ring) => touchesLine(ring, region)) || region.polygons.some((city) => inPolygon(city[0][0], polygon))
  );
}
function touches(geometry: Geometry, region: CityRegion): boolean {
  switch (geometry.type) {
    case 'Point':
      return region.polygons.some((polygon) => inPolygon(geometry.coordinates as Point, polygon));
    case 'MultiPoint':
      return (geometry.coordinates as Point[]).some((point) =>
        region.polygons.some((polygon) => inPolygon(point, polygon)),
      );
    case 'LineString':
      return touchesLine(geometry.coordinates as Point[], region);
    case 'MultiLineString':
      return (geometry.coordinates as Point[][]).some((line) => touchesLine(line, region));
    case 'Polygon':
      return touchesPolygon(geometry.coordinates as Polygon, region);
    case 'MultiPolygon':
      return (geometry.coordinates as Polygon[]).some((polygon) => touchesPolygon(polygon, region));
    case 'GeometryCollection':
      return geometry.geometries.some((child: Geometry) => touches(child, region));
  }
  return false;
}

/** Display estimates only. Coordinates and authoritative activity/heat counts remain untouched. */
export function locateFootprintCities(geometries: Geometry[], regions: CityRegion[]): CityLocations {
  const { cities, unlocatedBounds } = locateFootprintCitySummaries(
    geometries.map((geometry) => ({ geometry })),
    regions,
    'tracks',
  );
  return {
    cities: cities.map(({ code, name, bounds }) => ({ code, name, bounds })),
    unlocatedBounds,
  };
}

/**
 * Coarse (~0.5 deg) spatial bucketing for footprints outside the China city atlas or when atlas
 * lookup fails, so low-zoom heatmap/track views never turn blank while 100 m polygons stay hidden.
 */
export function bucketUnlocatedFootprints(
  features: FootprintCityFeatureInput[],
  mode: FootprintMode,
): FootprintCitySummary[] {
  const buckets = new Map<
    string,
    { bounds: Bounds; activityIds: Set<string>; maxCount: number; cellCount: number }
  >();
  for (let index = 0; index < features.length; index++) {
    const feature = features[index];
    const bounds = geometryBounds([feature.geometry]);
    if (!bounds) continue;
    const midLon = (bounds[0][0] + bounds[1][0]) / 2;
    const midLat = (bounds[0][1] + bounds[1][1]) / 2;
    const bx = Math.floor(midLon / FALLBACK_BUCKET_DEG);
    const by = Math.floor(midLat / FALLBACK_BUCKET_DEG);
    const key = `unlocated:${bx}:${by}`;
    const hitCount =
      typeof feature.count === 'number' && Number.isFinite(feature.count) && feature.count > 0 ? feature.count : 1;
    const activityKey = feature.activityId || `#${index}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.bounds = merge(existing.bounds, bounds);
      if (mode === 'heatmap') {
        existing.cellCount += 1;
        existing.maxCount = Math.max(existing.maxCount, hitCount);
      } else {
        existing.activityIds.add(activityKey);
      }
    } else {
      const activityIds = new Set<string>();
      if (mode !== 'heatmap') activityIds.add(activityKey);
      buckets.set(key, {
        bounds,
        activityIds,
        maxCount: mode === 'heatmap' ? hitCount : 0,
        cellCount: mode === 'heatmap' ? 1 : 0,
      });
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, entry]) => ({
      code,
      name: '未识别区域',
      shortName: '',
      bounds: entry.bounds,
      lon: (entry.bounds[0][0] + entry.bounds[1][0]) / 2,
      lat: (entry.bounds[0][1] + entry.bounds[1][1]) / 2,
      count: mode === 'heatmap' ? Math.max(1, entry.maxCount) : Math.max(1, entry.activityIds.size),
      cellCount: entry.cellCount,
    }));
}

/**
 * Display-only city summaries shared by both tracks and heatmap modes at low zoom.
 * Tracks count distinct activity IDs intersecting each city; heatmap records cell count and peak cell hit count.
 */
export function locateFootprintCitySummaries(
  features: FootprintCityFeatureInput[],
  regions: CityRegion[],
  mode: FootprintMode,
): FootprintCitySummaryLocations {
  const found = new Map<
    string,
    { code: string; name: string; bounds: Bounds; activityIds: Set<string>; maxCount: number; cellCount: number }
  >();
  const unlocatedFeatures: FootprintCityFeatureInput[] = [];
  let unlocatedBounds: Bounds | null = null;
  for (let index = 0; index < features.length; index++) {
    const feature = features[index];
    const bounds = geometryBounds([feature.geometry]);
    if (!bounds) continue;
    let located = false;
    const hitCount = typeof feature.count === 'number' && Number.isFinite(feature.count) && feature.count > 0 ? feature.count : 1;
    const activityKey = feature.activityId || `#${index}`;
    for (const region of regions) {
      if (!overlaps(bounds, region.bounds) || !touches(feature.geometry, region)) continue;
      located = true;
      // Fit the part of this record within the city's extent, rather than an arbitrary city centre.
      const visible: Bounds = [
        [Math.max(bounds[0][0], region.bounds[0][0]), Math.max(bounds[0][1], region.bounds[0][1])],
        [Math.min(bounds[1][0], region.bounds[1][0]), Math.min(bounds[1][1], region.bounds[1][1])],
      ];
      const existing = found.get(region.code);
      if (existing) {
        existing.bounds = merge(existing.bounds, visible);
        if (mode === 'heatmap') {
          existing.cellCount += 1;
          existing.maxCount = Math.max(existing.maxCount, hitCount);
        } else {
          existing.activityIds.add(activityKey);
        }
      } else {
        const activityIds = new Set<string>();
        if (mode !== 'heatmap') activityIds.add(activityKey);
        found.set(region.code, {
          code: region.code,
          name: region.name,
          bounds: visible,
          activityIds,
          maxCount: mode === 'heatmap' ? hitCount : 0,
          cellCount: mode === 'heatmap' ? 1 : 0,
        });
      }
    }
    if (!located) {
      unlocatedBounds = merge(unlocatedBounds, bounds);
      unlocatedFeatures.push(feature);
    }
  }
  const cities: FootprintCitySummary[] = [...found.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((entry) => ({
      code: entry.code,
      name: entry.name,
      shortName: shortCityName(entry.name),
      bounds: entry.bounds,
      lon: (entry.bounds[0][0] + entry.bounds[1][0]) / 2,
      lat: (entry.bounds[0][1] + entry.bounds[1][1]) / 2,
      count: mode === 'heatmap' ? Math.max(1, entry.maxCount) : Math.max(1, entry.activityIds.size),
      cellCount: entry.cellCount,
    }));
  const unlocatedMarkers = unlocatedFeatures.length ? bucketUnlocatedFootprints(unlocatedFeatures, mode) : [];
  return { cities, unlocatedMarkers, unlocatedBounds };
}

/** Map Chinese 6-digit GB city codes to `world-base.json` province codes (e.g. `320500` -> `CN-320000`). */
export function visitedProvinceCodes(cities: Pick<FootprintCity, 'code'>[]): string[] {
  const codes = new Set<string>();
  for (const city of cities) {
    if (/^\d{6}$/.test(city.code)) codes.add(`CN-${city.code.slice(0, 2)}0000`);
  }
  return [...codes].sort();
}

export function footprintCitiesToGeoJSON(cities: FootprintCitySummary[], mode: FootprintMode): GeoCollection {
  return {
    type: 'FeatureCollection',
    features: cities.map((city) => ({
      type: 'Feature',
      properties: {
        code: city.code,
        name: city.name,
        short_name: city.shortName,
        count: city.count,
        cell_count: city.cellCount,
        mode,
      },
      geometry: {
        type: 'Point',
        coordinates: [city.lon, city.lat],
      },
    })),
  };
}

export function footprintCitySummaryText(city: FootprintCitySummary, mode: FootprintMode): string {
  return mode === 'heatmap' ? `${city.cellCount} 格 · 最高 ${city.count} 次` : `${city.count} 条记录`;
}

/** Reuses ExplorationMap's collision-free label placement so tracks and heatmap share one rule set. */
export function placeFootprintLabels(
  cities: FootprintCitySummary[],
  clusters: ClusterPoint[],
  project: (lngLat: [number, number]) => { x: number; y: number },
  width: number,
  height: number,
  zoom: number,
  selectedCode = '',
  maxLabels = 24,
): ProjectedLabel[] {
  const markers = cities
    .filter((city) => city.shortName.length > 0)
    .map((city) => ({
    code: city.code,
    name: city.name,
    short_name: city.shortName,
    region_code: /^\d{6}$/.test(city.code) ? `CN-${city.code.slice(0, 2)}0000` : '',
    region_name: null,
    country_code: 'CHN',
    kind: 'boundary' as const,
    lon: city.lon,
    lat: city.lat,
    bounds: [city.bounds[0][0], city.bounds[0][1], city.bounds[1][0], city.bounds[1][1]] as [
      number,
      number,
      number,
      number,
    ],
    activity_count: city.count,
    distance_m: null,
    first_date: '',
    last_date: '',
    is_new_in_year: false,
  }));
  return placeLabels(markers, clusters, project, width, height, zoom, 'heatmap', selectedCode, maxLabels);
}

export interface FootprintCityPalette {
  ocean: string;
  land: string;
  border: string;
  visitedFill: string;
  stroke: string;
  selectedStroke: string;
  clusterFill: string;
  clusterHalo: string;
  clusterInk: string;
  bubbleFill: DataDrivenPropertyValueSpecification<string>;
}

/**
 * Low-zoom palette aligned with ExplorationMap (`explorationPalette`) while preserving visual distinction
 * between tracks (brand green calendar ramp) and heatmap (HEAT_LEVELS + warm terracotta cluster accent).
 */
export function footprintCityPalette(dark: boolean, mode: FootprintMode): FootprintCityPalette {
  const base = explorationPalette(dark);
  if (mode === 'heatmap') {
    return {
      ocean: base.ocean,
      land: base.land,
      border: base.border,
      visitedFill: dark ? '#3a3228' : '#f8eedf',
      stroke: base.stroke,
      selectedStroke: base.selectedStroke,
      clusterFill: dark ? '#f0a44b' : '#b45318',
      clusterHalo: dark ? 'rgba(240, 164, 75, 0.24)' : 'rgba(180, 83, 24, 0.18)',
      clusterInk: dark ? '#1f1912' : '#ffffff',
      bubbleFill: heatFillColor,
    };
  }
  return {
    ocean: base.ocean,
    land: base.land,
    border: base.border,
    visitedFill: base.visitedHeat,
    stroke: base.stroke,
    selectedStroke: base.selectedStroke,
    clusterFill: base.clusterHeat,
    clusterHalo: dark ? 'rgba(119, 212, 172, 0.2)' : 'rgba(23, 116, 92, 0.16)',
    clusterInk: dark ? '#10251b' : '#ffffff',
    bubbleFill: dark
      ? ['step', ['get', 'count'], '#347247', 3, '#60aa72', 10, '#90cc96', 25, '#c7edb5']
      : ['step', ['get', 'count'], '#8dcc9c', 3, '#4ca76a', 10, '#227b49', 25, '#105332'],
  };
}
