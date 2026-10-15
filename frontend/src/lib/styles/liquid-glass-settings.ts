export type GlassSettings = {
  transparency: number; refraction: number; bezel: number; curvature: number; ior: number;
  chroma: number; blur: number; highlight: number; specularWidth: number; lightAngle: number;
};
export const DEFAULT_GLASS_SETTINGS: Readonly<GlassSettings> = Object.freeze({
  transparency: 86, refraction: 14, bezel: .8, curvature: 3, ior: 1.5, chroma: .12,
  blur: 0, highlight: .6, specularWidth: 1.5, lightAngle: -120
});
export const GLASS_RANGES = {
  transparency: { min: 45, max: 95, step: 1 },
  refraction: { min: 0, max: 60, step: 1 },
  bezel: { min: .1, max: 1, step: .05 },
  curvature: { min: 2, max: 6, step: .1 },
  ior: { min: 1.3, max: 2, step: .01 },
  chroma: { min: 0, max: .3, step: .01 },
  blur: { min: 0, max: 8, step: .1 },
  highlight: { min: 0, max: 1, step: .05 },
  specularWidth: { min: 1, max: 4, step: .1 },
  lightAngle: { min: -180, max: 180, step: 1 }
} as const;
const STORAGE_KEY = 'runnote:dev-liquid-glass:v1';
const CHANGE_EVENT = 'runnote:dev-liquid-glass-changed';

/** The same optics reach each lens; small controls keep gentler displacement. */
export function glassOptics(settings: GlassSettings, scale = 1) {
  return { refraction: settings.refraction * scale, bezel: settings.bezel,
    curvature: settings.curvature, ior: settings.ior, chroma: settings.chroma,
    blur: settings.blur, specular: settings.highlight, specularWidth: settings.specularWidth,
    lightAngle: settings.lightAngle };
}

export function normalizeGlassSettings(value: unknown): GlassSettings {
  const result = { ...DEFAULT_GLASS_SETTINGS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of Object.keys(GLASS_RANGES) as (keyof GlassSettings)[]) {
    const candidate = (value as Record<string, unknown>)[key];
    const range = GLASS_RANGES[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) result[key] = Math.min(range.max, Math.max(range.min, candidate));
  }
  return result;
}

export function readGlassSettings(): GlassSettings {
  if (import.meta.env.DEV) {
    try { return normalizeGlassSettings(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')); }
    catch { /* Storage may be unavailable or contain an older invalid value. */ }
  }
  return { ...DEFAULT_GLASS_SETTINGS };
}

export function writeGlassSettings(settings: GlassSettings, reset = false): GlassSettings {
  const safe = normalizeGlassSettings(settings);
  if (import.meta.env.DEV) {
    try {
      if (reset) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch { /* Live preview still works when storage is blocked. */ }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: safe }));
  }
  return safe;
}

export function watchGlassSettings(update: (settings: GlassSettings) => void): () => void {
  if (!import.meta.env.DEV) return () => {};
  const changed = (event: Event) => update(normalizeGlassSettings((event as CustomEvent<unknown>).detail));
  window.addEventListener(CHANGE_EVENT, changed);
  return () => window.removeEventListener(CHANGE_EVENT, changed);
}
