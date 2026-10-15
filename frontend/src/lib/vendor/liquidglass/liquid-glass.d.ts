export type GlassOptions = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  clip?: boolean;
  fit?: boolean;
  mode?: 'content' | 'backdrop';
  radius?: number;
  refraction?: number;
  bezel?: number;
  curvature?: number;
  ior?: number;
  lightAngle?: number;
  hidden?: boolean;
  chroma?: number;
  blur?: number;
  specular?: number;
  specularWidth?: number;
  mapScale?: number;
  fallback?: string;
};
export const engine: 'blink' | 'webkit' | 'gecko' | 'unknown';
export function createGlass(target: HTMLElement, options?: GlassOptions): {
  update(options: GlassOptions): void;
  destroy(): void;
};
export function createSpring(initial: number, onUpdate: (value: number, velocity: number) => void,
  options?: { stiffness?: number; damping?: number; mass?: number }): {
  set(value: number, options?: { immediate?: boolean }): void;
  stop(): void;
  readonly value: number;
  readonly target: number;
};
