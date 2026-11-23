import { describe, expect, it, vi } from 'vitest';
import { isCapacitorNative, type CapacitorWindowRuntime } from '../../src/lib/capacitor-env.ts';
import { installCapacitorThemeSync } from '../../src/lib/capacitor-theme.ts';

describe('capacitor environment and theme sync', () => {
  it('returns false outside native Capacitor runtimes and no-ops theme sync', () => {
    const win = {} as Window & { Capacitor?: CapacitorWindowRuntime };
    expect(isCapacitorNative(win)).toBe(false);
    const subscribe = vi.fn(() => () => {});
    const cleanup = installCapacitorThemeSync({ windowRef: win, subscribeTheme: subscribe });
    expect(subscribe).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });

  it('prefers SystemAppearance.setTheme when available and tracks bridge active flag', () => {
    const setTheme = vi.fn();
    const setStyle = vi.fn();
    let emit: ((dark: boolean) => void) | undefined;
    const unsubscribe = vi.fn();
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          SystemAppearance: { setTheme },
          SystemBars: { setStyle },
        },
      },
    } as unknown as Window & { Capacitor?: CapacitorWindowRuntime; __runnoteThemeBridgeActive?: boolean };

    expect(isCapacitorNative(win)).toBe(true);
    const cleanup = installCapacitorThemeSync({
      windowRef: win,
      subscribeTheme: (cb) => {
        emit = cb;
        cb(false);
        return unsubscribe;
      },
    });

    expect(win.__runnoteThemeBridgeActive).toBe(true);
    expect(setTheme).toHaveBeenCalledWith({ theme: 'light' });
    expect(setStyle).not.toHaveBeenCalled();

    emit?.(true);
    expect(setTheme).toHaveBeenLastCalledWith({ theme: 'dark' });

    cleanup();
    expect(win.__runnoteThemeBridgeActive).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('falls back to standard Capacitor SystemBars.setStyle on platforms without SystemAppearance', () => {
    const setStyle = vi.fn();
    let emit: ((dark: boolean) => void) | undefined;
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          SystemBars: { setStyle },
        },
      },
    } as unknown as Window & { Capacitor?: CapacitorWindowRuntime; __runnoteThemeBridgeActive?: boolean };

    const cleanup = installCapacitorThemeSync({
      windowRef: win,
      subscribeTheme: (cb) => {
        emit = cb;
        cb(true);
        return () => {};
      },
    });

    expect(setStyle).toHaveBeenCalledWith({ style: 'DARK' });
    emit?.(false);
    expect(setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
    cleanup();
  });
});
