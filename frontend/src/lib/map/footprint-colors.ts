import type { ExpressionSpecification } from 'maplibre-gl';

type ActivityFeature = { properties: { activity_id?: string | null } };

export function colorFootprintFeatures<T extends ActivityFeature>(features: T[], palette: readonly string[]) {
  const colors = new Map<string | null | undefined, string>();
  let nextColor = 0;
  return features.map((feature) => {
    const id = feature.properties.activity_id;
    let color = colors.get(id);
    if (color === undefined) {
      color = palette[nextColor++ % palette.length];
      colors.set(id, color);
    }
    return { ...feature, properties: { ...feature.properties, color } };
  });
}

/** Heat cells by distinct-activity count; `min` is the lowest count each colour covers (map and legend). */
export const HEAT_LEVELS = [
  { min: 1, color: '#c0dfac', label: '1 次' },
  { min: 2, color: '#72b78a', label: '2–3 次' },
  { min: 4, color: '#2d9474', label: '4–7 次' },
  { min: 8, color: '#e69338', label: '8–15 次' },
  { min: 16, color: '#bd432c', label: '16 次及以上' },
] as const;

export const heatFillColor: ExpressionSpecification = ['step', ['get', 'count'], HEAT_LEVELS[0].color, ...HEAT_LEVELS.slice(1).flatMap(level => [level.min, level.color])];
