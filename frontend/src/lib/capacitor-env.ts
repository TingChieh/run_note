export interface CapacitorSystemBarsPlugin {
  setStyle?: (options: { style: 'LIGHT' | 'DARK' | 'DEFAULT'; bar?: string }) => Promise<void> | void;
}

export interface CapacitorSystemAppearancePlugin {
  setTheme?: (options: { theme: 'light' | 'dark' | 'system' }) => Promise<void> | void;
}

export interface CapacitorWindowRuntime {
  isNativePlatform?: () => boolean;
  Plugins?: {
    SystemBars?: CapacitorSystemBarsPlugin;
    SystemAppearance?: CapacitorSystemAppearancePlugin;
  };
}

/**
 * Returns true only inside a native Capacitor WebView shell (Android or future iOS).
 * Always returns false during SSR and in standard desktop/mobile web browsers.
 */
export function isCapacitorNative(
  win: (Window & { Capacitor?: CapacitorWindowRuntime }) | undefined = typeof window !== 'undefined'
    ? (window as Window & { Capacitor?: CapacitorWindowRuntime })
    : undefined,
): boolean {
  return win?.Capacitor?.isNativePlatform?.() === true;
}
