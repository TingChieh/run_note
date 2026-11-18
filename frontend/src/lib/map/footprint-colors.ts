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

/**
 * Dashboard global footprint map (WebGL, so plain hex). The base stays quiet so green only ever means
 * "ran here": far out, land is a halftone of `dot`s; closer in, a paper cut-out (`land` over its
 * `landShadow`) with hairline borders. Far out, visited places light up in the halftone (`dotRegion`, and
 * city dots by tier); closer in they are flat pale fills. City colours step through the calendar ramp's
 * greens (`--calendar-*` in app.css).
 * `limb` is the colour the globe's rim fades toward.
 */
export const GLOBAL_MAP_PALETTE = {
  light: {
    space: '#f2f6f9',
    ocean: '#e3edf2',
    dot: '#b4c6d0',
    land: '#ffffff',
    landShadow: '#c7d8e1',
    border: '#e4eaee',
    halo: '#d6e8f2',
    limb: '#b5d3e5',
    limbStrength: 0.35,
    region: '#c4ead0',
    regionSelected: '#9fdcb3',
    cityRamp: ['#5dbd7f', '#2f9a5f', '#1d7a4b'],
    dotRegion: '#5cbf80',
    dotRegionSelected: '#2e9f5b',
  },
  dark: {
    space: '#292725',
    ocean: '#252321',
    dot: '#4d4945',
    land: '#3b3835',
    landShadow: '#1a1918',
    border: '#33302d',
    halo: '#3a4540',
    limb: '#000000',
    limbStrength: 0.14,
    region: '#3a5143',
    regionSelected: '#4b6d58',
    cityRamp: ['#60aa72', '#90cc96', '#c7edb5'],
    dotRegion: '#4f9a69',
    dotRegionSelected: '#76c992',
  },
} as const satisfies Record<
  'light' | 'dark',
  Record<string, string | number | readonly [string, string, string]>
>;

export const heatFillColor: ExpressionSpecification = ['step', ['get', 'count'], HEAT_LEVELS[0].color, ...HEAT_LEVELS.slice(1).flatMap(level => [level.min, level.color])];
