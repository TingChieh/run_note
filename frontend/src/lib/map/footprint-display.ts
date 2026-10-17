import type { FootprintCollection, FootprintsAll } from '#lib/api/footprints.ts';

type Geometry = FootprintCollection['features'][number]['geometry'];
type Point = [number, number];
type Line = Point[];

export const MAX_FOOTPRINT_DISPLAY_POINTS = 50_000;

function linePaths(geometry: Geometry, paths: Line[]): void {
  if (geometry.type === 'LineString') paths.push(geometry.coordinates as Point[]);
  else if (geometry.type === 'MultiLineString') paths.push(...(geometry.coordinates as Point[][]));
  else if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) linePaths(child, paths);
  }
}

function sampleLine(line: Line, limit: number): Line {
  if (line.length <= limit) return line;
  if (limit <= 2) return [line[0], line[line.length - 1]];
  if (limit < 6) return Array.from({ length: limit }, (_, i) => line[Math.round(i * (line.length - 1) / (limit - 1))]);

  const buckets = Math.floor((limit - 2) / 4);
  const bucketSize = Math.ceil((line.length - 2) / buckets);
  const kept = new Set([0, line.length - 1]);
  for (let start = 1; start < line.length - 1; start += bucketSize) {
    const end = Math.min(line.length - 1, start + bucketSize);
    let minX = start, maxX = start, minY = start, maxY = start;
    for (let i = start + 1; i < end; i++) {
      if (line[i][0] < line[minX][0]) minX = i;
      if (line[i][0] > line[maxX][0]) maxX = i;
      if (line[i][1] < line[minY][1]) minY = i;
      if (line[i][1] > line[maxY][1]) maxY = i;
    }
    kept.add(minX); kept.add(maxX); kept.add(minY); kept.add(maxY);
  }
  return [...kept].sort((a, b) => a - b).map((index) => line[index]);
}

function replaceLines(geometry: Geometry, sampled: Map<Line, Line>): Geometry {
  if (geometry.type === 'LineString') {
    const coordinates = sampled.get(geometry.coordinates as Point[]);
    return coordinates ? { ...geometry, coordinates } as Geometry : geometry;
  }
  if (geometry.type === 'MultiLineString') {
    const coordinates = (geometry.coordinates as Point[][]).map((line) => sampled.get(line) ?? line);
    return coordinates.some((line, index) => line !== geometry.coordinates[index])
      ? { ...geometry, coordinates } as Geometry
      : geometry;
  }
  if (geometry.type === 'GeometryCollection') {
    const children = geometry.geometries as Geometry[];
    const geometries = children.map((child: Geometry) => replaceLines(child, sampled));
    return geometries.some((child: Geometry, index: number) => child !== children[index])
      ? { ...geometry, geometries }
      : geometry;
  }
  return geometry;
}

/** Bound map-only route detail while preserving endpoints and local spatial extremes. */
export function footprintDisplayData<T extends FootprintsAll>(data: T, limit = MAX_FOOTPRINT_DISPLAY_POINTS): T {
  const paths: Line[] = [];
  for (const feature of data.features) linePaths(feature.geometry, paths);
  const totalPoints = paths.reduce((total, line) => total + line.length, 0);
  if (totalPoints <= limit || paths.length * 2 > limit) return data;

  const extraBudget = limit - paths.length * 2;
  const availablePoints = totalPoints - paths.length * 2;
  let assigned = paths.length * 2;
  const sampled = new Map<Line, Line>();
  for (const line of paths) {
    const extra = availablePoints === 0 ? 0 : Math.min(line.length - 2, Math.floor(extraBudget * (line.length - 2) / availablePoints));
    const reduced = sampleLine(line, 2 + extra);
    assigned += reduced.length - 2;
    sampled.set(line, reduced);
  }
  if (assigned < limit) {
    for (const line of paths) {
      const reduced = sampled.get(line)!;
      const extra = Math.min(line.length - reduced.length, limit - assigned);
      if (extra > 0) {
        const expanded = sampleLine(line, reduced.length + extra);
        sampled.set(line, expanded);
        assigned += expanded.length - reduced.length;
      }
      if (assigned >= limit) break;
    }
  }

  const features = data.features.map((feature) => {
    const geometry = replaceLines(feature.geometry, sampled);
    return geometry === feature.geometry ? feature : { ...feature, geometry };
  });
  return { ...data, features };
}
