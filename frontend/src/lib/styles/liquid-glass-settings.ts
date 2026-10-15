export type GlassSettings = { transparency: number; refraction: number; blur: number; highlight: number };
export const DEFAULT_GLASS_SETTINGS: Readonly<GlassSettings> = Object.freeze({
  transparency: 86, refraction: 14, blur: 0, highlight: .6
});
export const GLASS_RANGES = {
  transparency: { min: 45, max: 95, step: 1 },
  refraction: { min: 0, max: 32, step: 1 },
  blur: { min: 0, max: 8, step: .1 },
  highlight: { min: 0, max: 1, step: .05 }
} as const;
const STORAGE_KEY = 'runnote:dev-liquid-glass:v1';
const CHANGE_EVENT = 'runnote:dev-liquid-glass-changed';

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
