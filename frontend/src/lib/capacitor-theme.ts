import { watchSystemTheme } from '#lib/components/system-theme.ts';
import { isCapacitorNative, type CapacitorWindowRuntime } from '#lib/capacitor-env.ts';

export interface ThemeSyncOptions {
  windowRef?: Window & { Capacitor?: CapacitorWindowRuntime; __runnoteThemeBridgeActive?: boolean };
  subscribeTheme?: (update: (dark: boolean) => void) => () => void;
}

/**
 * Syncs native system bars (status bar and gesture/navigation bar) with RunNote's active
 * light/dark appearance, including manual overrides that differ from the OS theme.
 * No-ops outside native Capacitor runtimes so standard Web/SSR behavior is untouched.
 */
export function installCapacitorThemeSync(options: ThemeSyncOptions = {}): () => void {
  const win =
    options.windowRef ??
    (typeof window !== 'undefined'
      ? (window as Window & { Capacitor?: CapacitorWindowRuntime; __runnoteThemeBridgeActive?: boolean })
      : undefined);
  if (!win || !isCapacitorNative(win)) return () => {};

  const plugins = win.Capacitor?.Plugins;
  const setAppearance = plugins?.SystemAppearance?.setTheme;
  const setSystemBarsStyle = plugins?.SystemBars?.setStyle;
  if (typeof setAppearance !== 'function' && typeof setSystemBarsStyle !== 'function') {
    return () => {};
  }

  win.__runnoteThemeBridgeActive = true;
  const subscribe = options.subscribeTheme ?? watchSystemTheme;
  const stop = subscribe((dark) => {
    try {
      if (typeof setAppearance === 'function') {
        void Promise.resolve(setAppearance.call(plugins?.SystemAppearance, { theme: dark ? 'dark' : 'light' })).catch(
          () => {},
        );
      } else if (typeof setSystemBarsStyle === 'function') {
        void Promise.resolve(setSystemBarsStyle.call(plugins?.SystemBars, { style: dark ? 'DARK' : 'LIGHT' })).catch(
          () => {},
        );
      }
    } catch {
      /* Keep Web theme switching usable even if native bar sync fails. */
    }
  });

  return () => {
    win.__runnoteThemeBridgeActive = false;
    stop();
  };
}
