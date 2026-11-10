import atlasUrl from '#lib/data/china-cities.json?url';
import type { CityRegion } from './footprint-cities.ts';

type Point = [number, number];
/** Rings are flat integer deltas [dx0, dy0, dx1, dy1, …] in units of 1/scale degree. */
export interface EncodedAtlas {
  scale: number;
  regions: { code: string; name: string; bounds: [Point, Point]; polygons: number[][][] }[];
}

export function decodeCityAtlas(atlas: EncodedAtlas): CityRegion[] {
  return atlas.regions.map(({ code, name, bounds, polygons }) => ({
    code, name, bounds,
    polygons: polygons.map(polygon => polygon.map(ring => {
      const points: Point[] = [];
      let x = 0, y = 0;
      for (let i = 0; i < ring.length; i += 2) { x += ring[i]; y += ring[i + 1]; points.push([x / atlas.scale, y / atlas.scale]); }
      return points;
    })),
  }));
}

// One hashed static file shared by both workers, so the browser downloads and caches it once.
let atlas: Promise<CityRegion[]> | undefined;
function loadCityAtlas(): Promise<CityRegion[]> {
  atlas ??= fetch(atlasUrl).then(response => {
    if (!response.ok) throw new Error(`City atlas unavailable: ${response.status}`);
    return response.json() as Promise<EncodedAtlas>;
  }).then(decodeCityAtlas);
  atlas.catch(() => { atlas = undefined; });
  return atlas;
}

/** Runs `use` with the atlas; a failed download or lookup surfaces as the Worker's `error` event. */
export function withCityAtlas(use: (regions: CityRegion[]) => void): void {
  loadCityAtlas().then(use).catch((cause: unknown) => { setTimeout(() => { throw cause; }); });
}
