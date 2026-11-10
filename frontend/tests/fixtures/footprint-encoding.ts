// Test-side copy of backend footprints/encoding.py: plain GeoJSON → `?encoding=delta` response shape.
type Position = number[];
type Geometry = { type: string; coordinates?: unknown; geometries?: Geometry[] };

const SCALE = 1e9;

function run(positions: Position[]): number[] {
  const flat: number[] = [];
  let lastX = 0,
    lastY = 0;
  for (const [x, y] of positions) {
    const ux = Math.round(x * SCALE),
      uy = Math.round(y * SCALE);
    flat.push(ux - lastX, uy - lastY);
    lastX = ux;
    lastY = uy;
  }
  return flat;
}

function geometry(g: Geometry): unknown {
  if (g.type === 'GeometryCollection') return { type: g.type, geometries: g.geometries!.map(geometry) };
  if (g.type === 'Point') return { type: g.type, delta: run([g.coordinates as Position]) };
  if (g.type === 'MultiPoint' || g.type === 'LineString')
    return { type: g.type, delta: run(g.coordinates as Position[]) };
  return { type: g.type, delta: (g.coordinates as Position[][]).map(run) };
}

export function encodeFootprints<T extends { features: { geometry: unknown }[] }>(collection: T) {
  return {
    ...collection,
    coordinate_encoding: 'delta-1e9',
    features: collection.features.map((feature) => ({ ...feature, geometry: geometry(feature.geometry as Geometry) })),
  };
}
