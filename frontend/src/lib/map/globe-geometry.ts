import earcut from 'earcut';
import type { GeoJSONSourceSpecification } from 'maplibre-gl';

export type GeoCollection = Exclude<GeoJSONSourceSpecification['data'], string>;
export type GeoFeature = GeoCollection extends { features: Array<infer F> } ? F : never;

type LonLat = [number, number];
type Ring = LonLat[];
export type GeoBounds = [number, number, number, number];
export type RgbTuple = [number, number, number];

export interface ChinaCitiesData {
  scale: number;
  regions: Array<{
    code: string | number;
    name: string;
    polygons: number[][][];
    bounds: [[number, number], [number, number]];
  }>;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const MAX_MERCATOR_LAT = 84.5;
const MERCATOR_SCALE = 0.56;
export const MERCATOR_WORLD_WIDTH = 2 * Math.PI * MERCATOR_SCALE;
export const MERCATOR_MAX_Y = Math.log(Math.tan(Math.PI / 4 + (MAX_MERCATOR_LAT * DEG_TO_RAD) / 2)) * MERCATOR_SCALE;

/** Convert `[lon, lat]` in degrees into Three.js sphere coordinates at `radius`. */
export function lonLatToSphere(lon: number, lat: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * DEG_TO_RAD;
  const theta = (lon + 180) * DEG_TO_RAD;
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)];
}

/** Inverse transform from a sphere coordinate back to `[lon, lat]` in degrees. */
export function spherePointToLonLat(x: number, y: number, z: number): LonLat {
  const len = Math.hypot(x, y, z) || 1;
  const ny = Math.max(-1, Math.min(1, y / len));
  const lat = 90 - Math.acos(ny) * RAD_TO_DEG;
  const lon = ((Math.atan2(z, -x) * RAD_TO_DEG + 720) % 360) - 180;
  return [lon, lat];
}

/** Project `[lon, lat]` in degrees into full-bleed conformal 2D Web Mercator space. */
export function lonLatToMercator2D(lon: number, lat: number, zLayer: number): [number, number, number] {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const phi = clampedLat * DEG_TO_RAD;
  const x = lon * DEG_TO_RAD * MERCATOR_SCALE;
  const y = Math.log(Math.tan(Math.PI / 4 + phi / 2)) * MERCATOR_SCALE;
  return [x, y, zLayer];
}

/** Inverse transform from 2D Web Mercator `(x, y)` back to `[lon, lat]` in degrees. */
export function mercator2DToLonLat(x: number, y: number): LonLat {
  const lon = (x / MERCATOR_SCALE) * RAD_TO_DEG;
  const lat = (2 * Math.atan(Math.exp(y / MERCATOR_SCALE)) - Math.PI / 2) * RAD_TO_DEG;
  return [lon, lat];
}

/** Convert a hex color like `#17745c` into normalized linear/sRGB tuple `[0..1, 0..1, 0..1]`. */
export function hexToRgb(hex: string): RgbTuple {
  const clean = hex.replace('#', '');
  const n = Number.parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Test whether `[lon, lat]` falls inside a GeoJSON Polygon/MultiPolygon feature. */
export function pointInGeoFeature(lon: number, lat: number, feature: GeoFeature): boolean {
  const geom = feature.geometry;
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates as Ring[]] : (geom.coordinates as Ring[][]);
  for (const poly of polys) {
    if (!poly.length || !pointInRing(lon, lat, poly[0])) continue;
    const inHole = poly.slice(1).some((hole) => pointInRing(lon, lat, hole));
    if (!inHole) return true;
  }
  return false;
}

/** Extract municipal `[minLon, minLat, maxLon, maxLat]` lookup table from `china-cities.json`. */
export function decodeChinaCitiesBounds(raw: ChinaCitiesData): Map<string, GeoBounds> {
  const map = new Map<string, GeoBounds>();
  for (const region of raw.regions) {
    const b = region.bounds;
    if (b?.length === 2) {
      map.set(String(region.code), [b[0][0], b[0][1], b[1][0], b[1][1]]);
    }
  }
  return map;
}

/** Decode delta-encoded Chinese municipal boundaries for matching lit city codes. */
export function decodeChinaCitiesFeatures(raw: ChinaCitiesData, litCodes: Set<string>): GeoFeature[] {
  const features: GeoFeature[] = [];
  const scale = raw.scale || 1;
  for (const region of raw.regions) {
    const code = String(region.code);
    if (!litCodes.has(code)) continue;
    const polys: Ring[][] = [];
    for (const poly of region.polygons) {
      const rings: Ring[] = [];
      for (const flat of poly) {
        const ring: Ring = [];
        let x = 0;
        let y = 0;
        for (let i = 0; i < flat.length; i += 2) {
          x += flat[i];
          y += flat[i + 1];
          ring.push([x / scale, y / scale]);
        }
        if (ring.length >= 4) {
          ring[ring.length - 1] = [ring[0][0], ring[0][1]];
          rings.push(ring);
        }
      }
      if (rings.length) polys.push(rings);
    }
    if (!polys.length) continue;
    const geometry =
      polys.length === 1
        ? { type: 'Polygon' as const, coordinates: polys[0] }
        : { type: 'MultiPolygon' as const, coordinates: polys };
    features.push({
      type: 'Feature',
      properties: { code, name: region.name },
      geometry,
    } as GeoFeature);
  }
  return features;
}

/** Compute tight merged bounding box across multiple `[minLon, minLat, maxLon, maxLat]` entries. */
export function mergeGeoBounds(list: readonly (GeoBounds | null | undefined)[]): GeoBounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const b of list) {
    if (!b) continue;
    minLon = Math.min(minLon, b[0]);
    minLat = Math.min(minLat, b[1]);
    maxLon = Math.max(maxLon, b[2]);
    maxLat = Math.max(maxLat, b[3]);
  }
  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}

/** Compute camera `(panX, panY, dist)` in Mercator 2D space so `bounds` fits cleanly inside viewport. */
/**
 * Distance limits below are tuned for a 32° field of view; this scales them so they cover the same visible
 * area at any field of view (a narrower lens has to stand further back to see as much).
 */
export function fovReach(halfTan: number): number {
  return Math.tan(16 * DEG_TO_RAD) / halfTan;
}

export function fitBoundsMercator2D(
  bounds: GeoBounds,
  aspect: number,
  fovDeg: number,
  minSpanDeg = 1.6,
): { panX: number; panY: number; dist: number } {
  let [minLon, minLat, maxLon, maxLat] = bounds;
  if (maxLon - minLon < minSpanDeg) {
    const mid = (minLon + maxLon) * 0.5;
    minLon = mid - minSpanDeg * 0.5;
    maxLon = mid + minSpanDeg * 0.5;
  }
  if (maxLat - minLat < minSpanDeg * 0.78) {
    const mid = (minLat + maxLat) * 0.5;
    const half = minSpanDeg * 0.39;
    minLat = mid - half;
    maxLat = mid + half;
  }
  const [x0, y0] = lonLatToMercator2D(minLon, minLat, 0);
  const [x1, y1] = lonLatToMercator2D(maxLon, maxLat, 0);
  const panX = (x0 + x1) * 0.5;
  const panY = (y0 + y1) * 0.5;
  const bw = Math.max(0.012, Math.abs(x1 - x0));
  const bh = Math.max(0.012, Math.abs(y1 - y0));
  const halfTan = Math.tan(fovDeg * DEG_TO_RAD * 0.5);
  const distForH = bh / 0.62 / (2 * halfTan);
  const distForW = bw / 0.72 / (2 * halfTan * Math.max(0.5, aspect));
  const reach = fovReach(halfTan);
  const dist = Math.max(0.024 * reach, Math.min(4.6 * reach, Math.max(distForH, distForW)));
  return { panX, panY, dist };
}

/** Compute camera `(lon, lat, dist)` on unit sphere (`r = 1`) so `bounds` fills ~60% of 3D viewport. */
export function fitBoundsGlobe3D(
  bounds: GeoBounds,
  aspect: number,
  fovDeg: number,
  minSpanDeg = 1.6,
): { lon: number; lat: number; dist: number } {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const lon = (minLon + maxLon) * 0.5;
  const lat = (minLat + maxLat) * 0.5;
  const spanLatDeg = Math.max(minSpanDeg * 0.85, maxLat - minLat);
  const cosLat = Math.max(0.25, Math.cos(lat * DEG_TO_RAD));
  const spanLonDeg = Math.max(minSpanDeg, (maxLon - minLon) * cosLat);
  const arcH = spanLatDeg * DEG_TO_RAD;
  const arcW = spanLonDeg * DEG_TO_RAD;
  const halfTan = Math.tan(fovDeg * DEG_TO_RAD * 0.5);
  const dSurfH = arcH / 0.58 / (2 * halfTan);
  const dSurfW = arcW / 0.68 / (2 * halfTan * Math.max(0.5, aspect));
  const reach = fovReach(halfTan);
  const dSurf = Math.max(0.045 * reach, Math.min(2.6 * reach, Math.max(dSurfH, dSurfW)));
  return { lon, lat, dist: 1.0 + dSurf };
}

export interface DualPositionArrays {
  sphere: Float32Array;
  flat: Float32Array;
  colors?: Float32Array;
}

/**
 * Triangulate GeoJSON features via earcut and subdivide large spherical triangles (`<= maxDeg`)
 * so continent interiors hug the 3D sphere without chord holes, while mapping seamlessly to flat 2D Mercator.
 */
export function buildSubdividedPolygons(
  features: readonly GeoFeature[],
  rSphere: number,
  zFlat: number,
  maxDeg = 4.5,
  maxDepth = 4,
  colorForFeature?: (feature: GeoFeature) => RgbTuple,
): DualPositionArrays {
  const spherePos: number[] = [];
  const flatPos: number[] = [];
  const colors: number[] | null = colorForFeature ? [] : null;

  function emitTri(
    lon0: number,
    lat0: number,
    lon1: number,
    lat1: number,
    lon2: number,
    lat2: number,
    depth: number,
    rgb: RgbTuple | null,
  ): void {
    const span = Math.max(
      Math.abs(lon1 - lon0),
      Math.abs(lat1 - lat0),
      Math.abs(lon2 - lon1),
      Math.abs(lat2 - lat1),
      Math.abs(lon0 - lon2),
      Math.abs(lat0 - lat2),
    );
    if (span > maxDeg && depth < maxDepth) {
      const m01x = (lon0 + lon1) * 0.5;
      const m01y = (lat0 + lat1) * 0.5;
      const m12x = (lon1 + lon2) * 0.5;
      const m12y = (lat1 + lat2) * 0.5;
      const m20x = (lon2 + lon0) * 0.5;
      const m20y = (lat2 + lat0) * 0.5;
      emitTri(lon0, lat0, m01x, m01y, m20x, m20y, depth + 1, rgb);
      emitTri(m01x, m01y, lon1, lat1, m12x, m12y, depth + 1, rgb);
      emitTri(m20x, m20y, m12x, m12y, lon2, lat2, depth + 1, rgb);
      emitTri(m01x, m01y, m12x, m12y, m20x, m20y, depth + 1, rgb);
      return;
    }
    const a = lonLatToSphere(lon0, lat0, rSphere);
    let b = lonLatToSphere(lon1, lat1, rSphere);
    let c = lonLatToSphere(lon2, lat2, rSphere);
    const fa = lonLatToMercator2D(lon0, lat0, zFlat);
    let fb = lonLatToMercator2D(lon1, lat1, zFlat);
    let fc = lonLatToMercator2D(lon2, lat2, zFlat);

    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const dot = nx * (a[0] + b[0] + c[0]) + ny * (a[1] + b[1] + c[1]) + nz * (a[2] + b[2] + c[2]);
    if (dot < 0) {
      [b, c] = [c, b];
      [fb, fc] = [fc, fb];
    }
    spherePos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    flatPos.push(fa[0], fa[1], fa[2], fb[0], fb[1], fb[2], fc[0], fc[1], fc[2]);
    if (colors && rgb) {
      colors.push(rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2]);
    }
  }

  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    const rgb = colorForFeature ? colorForFeature(feature) : null;
    const polys = geom.type === 'Polygon' ? [geom.coordinates as Ring[]] : (geom.coordinates as Ring[][]);
    for (const poly of polys) {
      if (!poly.length || poly[0].length < 4) continue;
      const flatCoords: number[] = [];
      const holeIndices: number[] = [];
      let vertCount = 0;
      for (let r = 0; r < poly.length; r++) {
        if (r > 0) holeIndices.push(vertCount);
        const ring = poly[r];
        for (let i = 0; i < ring.length - 1; i++) {
          flatCoords.push(ring[i][0], ring[i][1]);
          vertCount++;
        }
      }
      const triangles = earcut(flatCoords, holeIndices, 2);
      for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i] * 2;
        const i1 = triangles[i + 1] * 2;
        const i2 = triangles[i + 2] * 2;
        emitTri(
          flatCoords[i0],
          flatCoords[i0 + 1],
          flatCoords[i1],
          flatCoords[i1 + 1],
          flatCoords[i2],
          flatCoords[i2 + 1],
          0,
          rgb,
        );
      }
    }
  }

  return {
    sphere: new Float32Array(spherePos),
    flat: new Float32Array(flatPos),
    ...(colors ? { colors: new Float32Array(colors) } : {}),
  };
}

/** Build subdivided border `LineSegments` attributes for GeoJSON features. */
export function buildSubdividedLines(
  features: readonly GeoFeature[],
  rSphere: number,
  zFlat: number,
  stepDeg = 4.5,
): DualPositionArrays {
  const spherePos: number[] = [];
  const flatPos: number[] = [];
  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates as Ring[]] : (geom.coordinates as Ring[][]);
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [ax, ay] = ring[i];
          const [bx, by] = ring[i + 1];
          const span = Math.hypot(bx - ax, by - ay);
          const steps = span > stepDeg ? Math.ceil(span / stepDeg) : 1;
          for (let s = 0; s < steps; s++) {
            const t0 = s / steps;
            const t1 = (s + 1) / steps;
            const x0 = ax + (bx - ax) * t0;
            const y0 = ay + (by - ay) * t0;
            const x1 = ax + (bx - ax) * t1;
            const y1 = ay + (by - ay) * t1;
            const s0 = lonLatToSphere(x0, y0, rSphere);
            const s1 = lonLatToSphere(x1, y1, rSphere);
            const f0 = lonLatToMercator2D(x0, y0, zFlat);
            const f1 = lonLatToMercator2D(x1, y1, zFlat);
            spherePos.push(s0[0], s0[1], s0[2], s1[0], s1[1], s1[2]);
            flatPos.push(f0[0], f0[1], f0[2], f1[0], f1[1], f1[2]);
          }
        }
      }
    }
  }
  return { sphere: new Float32Array(spherePos), flat: new Float32Array(flatPos) };
}

/** Build morphable ocean grid covering `[-180..180] x [-84.5..84.5]` (full-bleed in 2D, sphere in 3D). */
export function buildOceanGrid(rSphere: number, zFlat: number): DualPositionArrays {
  const lonSteps = 72;
  const latSteps = 34;
  const sPos: number[] = [];
  const fPos: number[] = [];
  for (let i = 0; i < lonSteps; i++) {
    const l0 = -180 + (360 * i) / lonSteps;
    const l1 = -180 + (360 * (i + 1)) / lonSteps;
    for (let j = 0; j < latSteps; j++) {
      const a0 = -MAX_MERCATOR_LAT + (2 * MAX_MERCATOR_LAT * j) / latSteps;
      const a1 = -MAX_MERCATOR_LAT + (2 * MAX_MERCATOR_LAT * (j + 1)) / latSteps;
      const quad: LonLat[] = [
        [l0, a0],
        [l1, a0],
        [l1, a1],
        [l0, a1],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const s = lonLatToSphere(quad[k][0], quad[k][1], rSphere);
        const f = lonLatToMercator2D(quad[k][0], quad[k][1], zFlat);
        sPos.push(s[0], s[1], s[2]);
        fPos.push(f[0], f[1], f[2]);
      }
    }
    // Polar caps close the globe past the Mercator limit; flattened they clamp onto the edge with no area.
    for (const pole of [MAX_MERCATOR_LAT, -MAX_MERCATOR_LAT]) {
      const tip = pole > 0 ? 90 : -90;
      for (const [lon, lat] of [
        [l0, pole],
        [l1, pole],
        [(l0 + l1) / 2, tip],
      ] as const) {
        const s = lonLatToSphere(lon, lat, rSphere);
        const f = lonLatToMercator2D(lon, lat, zFlat);
        sPos.push(s[0], s[1], s[2]);
        fPos.push(f[0], f[1], f[2]);
      }
    }
  }
  return { sphere: new Float32Array(sPos), flat: new Float32Array(fPos) };
}

/**
 * Evenly spaced dots on land for the halftone globe. Rows run every `spacingDeg` of latitude; each row's
 * longitude step widens by 1/cos(lat) so dots stay evenly spaced on the sphere, and alternate rows shift
 * half a step. Land is found by an even-odd scanline per row, which holds because country polygons do
 * not overlap.
 */
export function buildLandDots(
  features: readonly GeoFeature[],
  spacingDeg: number,
  rSphere: number,
  zFlat: number,
): DualPositionArrays {
  const rings: Ring[] = [];
  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates as Ring[]] : (geom.coordinates as Ring[][]);
    for (const poly of polys) rings.push(...poly);
  }
  const lat0 = -MAX_MERCATOR_LAT + spacingDeg / 2;
  const rows = Math.ceil((MAX_MERCATOR_LAT - lat0) / spacingDeg);
  const rowLat = (row: number) => lat0 + row * spacingDeg;
  // Most edges are shorter than a row, so bucket each edge into only the rows it crosses.
  const crossingsByRow: number[][] = Array.from({ length: rows }, () => []);
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const first = Math.max(0, Math.ceil((Math.min(yi, yj) - lat0) / spacingDeg) - 1);
      const last = Math.min(rows - 1, Math.floor((Math.max(yi, yj) - lat0) / spacingDeg) + 1);
      for (let row = first; row <= last; row++) {
        const lat = rowLat(row);
        if (yi > lat !== yj > lat) crossingsByRow[row].push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
      }
    }
  }
  const sPos: number[] = [];
  const fPos: number[] = [];
  for (let row = 0; row < rows; row++) {
    const lat = rowLat(row);
    const crossings = crossingsByRow[row];
    if (!crossings.length) continue;
    crossings.sort((a, b) => a - b);
    const count = Math.max(1, Math.round((360 * Math.max(Math.cos(lat * DEG_TO_RAD), 0.15)) / spacingDeg));
    const step = 360 / count;
    const offset = row % 2 ? step / 2 : 0;
    let passed = 0;
    for (let k = 0; k < count; k++) {
      const lon = -180 + offset + k * step;
      while (passed < crossings.length && crossings[passed] < lon) passed++;
      if (passed % 2 === 0) continue;
      const s = lonLatToSphere(lon, lat, rSphere);
      const f = lonLatToMercator2D(lon, lat, zFlat);
      sPos.push(s[0], s[1], s[2]);
      fPos.push(f[0], f[1], f[2]);
    }
  }
  return { sphere: new Float32Array(sPos), flat: new Float32Array(fPos) };
}

/** Build subtle 30-degree meridian and parallel graticule line segments. */
export function buildGraticuleLines(rSphere: number, zFlat: number): DualPositionArrays {
  const sPos: number[] = [];
  const fPos: number[] = [];
  for (let lon = -150; lon <= 180; lon += 30) {
    for (let lat = -84; lat < 84; lat += 6) {
      const s0 = lonLatToSphere(lon, lat, rSphere);
      const s1 = lonLatToSphere(lon, lat + 6, rSphere);
      const f0 = lonLatToMercator2D(lon, lat, zFlat);
      const f1 = lonLatToMercator2D(lon, lat + 6, zFlat);
      sPos.push(s0[0], s0[1], s0[2], s1[0], s1[1], s1[2]);
      fPos.push(f0[0], f0[1], f0[2], f1[0], f1[1], f1[2]);
    }
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 6) {
      const s0 = lonLatToSphere(lon, lat, rSphere);
      const s1 = lonLatToSphere(lon + 6, lat, rSphere);
      const f0 = lonLatToMercator2D(lon, lat, zFlat);
      const f1 = lonLatToMercator2D(lon + 6, lat, zFlat);
      sPos.push(s0[0], s0[1], s0[2], s1[0], s1[1], s1[2]);
      fPos.push(f0[0], f0[1], f0[2], f1[0], f1[1], f1[2]);
    }
  }
  return { sphere: new Float32Array(sPos), flat: new Float32Array(fPos) };
}
