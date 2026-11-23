import { describe, expect, it, vi } from 'vitest';
import {
  dismissActiveOverlay,
  installCapacitorBackHandler,
  type CapacitorBackButtonEvent,
  type CapacitorRuntime,
} from '../../src/lib/capacitor-back.ts';

function createMockEnv(
  options: {
    dialogs?: Array<{ preventCancel?: boolean; close: ReturnType<typeof vi.fn> }>;
    popovers?: Array<{ hidePopover: ReturnType<typeof vi.fn> }>;
    mobileMenuOpen?: boolean;
    native?: boolean;
  } = {},
) {
  const listeners = new Map<string, Set<EventListener>>();
  const historyBack = vi.fn();
  const exitApp = vi.fn();
  const remove = vi.fn();
  let backCallback: ((event: CapacitorBackButtonEvent) => void) | undefined;

  const dialogs = (options.dialogs ?? []).map((item) => ({
    dispatchEvent(event: Event) {
      if (item.preventCancel) event.preventDefault();
      return !event.defaultPrevented;
    },
    close: item.close,
  }));

  const popovers = options.popovers ?? [];

  const doc = {
    querySelectorAll(selector: string) {
      if (selector === 'dialog[open]') return dialogs;
      if (selector === '[popover]:popover-open') return popovers;
      return [];
    },
    querySelector(selector: string) {
      if (selector === '#app-navigation.nav-open, #public-mobile-menu') {
        return options.mobileMenuOpen ? {} : null;
      }
      return null;
    },
  } as unknown as Document;

  const cap: CapacitorRuntime | undefined =
    options.native === false
      ? undefined
      : {
          isNativePlatform: () => true,
          Plugins: {
            App: {
              addListener: (_name, cb) => {
                backCallback = cb;
                return Promise.resolve({ remove });
              },
              exitApp,
            },
          },
        };

  const dispatchedEvents: Event[] = [];
  const win = {
    Capacitor: cap,
    history: { back: historyBack },
    addEventListener(type: string, cb: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: EventListener) {
      listeners.get(type)?.delete(cb);
    },
    dispatchEvent(event: Event) {
      dispatchedEvents.push(event);
      listeners.get(event.type)?.forEach((cb) => cb(event));
      return true;
    },
  } as unknown as Window & { Capacitor?: CapacitorRuntime };

  return {
    doc,
    win,
    historyBack,
    exitApp,
    remove,
    dispatchedEvents,
    fireBack: (canGoBack: boolean) => backCallback?.({ canGoBack }),
    firePopstate: () => win.dispatchEvent(new Event('popstate')),
  };
}

describe('capacitor back button integration', () => {
  it('is a no-op outside native Capacitor runtimes', () => {
    const env = createMockEnv({ native: false });
    const cleanup = installCapacitorBackHandler({ windowRef: env.win, documentRef: env.doc });
    expect(() => cleanup()).not.toThrow();
    expect(env.historyBack).not.toHaveBeenCalled();
    expect(env.exitApp).not.toHaveBeenCalled();
  });

  it('closes the topmost open dialog before navigating back', () => {
    const firstClose = vi.fn();
    const topClose = vi.fn();
    const env = createMockEnv({
      dialogs: [{ close: firstClose }, { close: topClose }],
    });
    const cleanup = installCapacitorBackHandler({ windowRef: env.win, documentRef: env.doc });

    env.fireBack(true);

    expect(topClose).toHaveBeenCalledTimes(1);
    expect(firstClose).not.toHaveBeenCalled();
    expect(env.historyBack).not.toHaveBeenCalled();
    expect(env.exitApp).not.toHaveBeenCalled();
    cleanup();
  });

  it('respects cancelable dialog prevention without navigating away', () => {
    const close = vi.fn();
    const env = createMockEnv({
      dialogs: [{ preventCancel: true, close }],
    });

    expect(dismissActiveOverlay(env.doc, env.win)).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes open mobile menu via Escape key before navigating back', () => {
    const env = createMockEnv({ mobileMenuOpen: true });
    const cleanup = installCapacitorBackHandler({ windowRef: env.win, documentRef: env.doc });

    env.fireBack(true);

    expect(env.dispatchedEvents).toHaveLength(1);
    expect((env.dispatchedEvents[0] as Event & { key?: string }).key).toBe('Escape');
    expect(env.historyBack).not.toHaveBeenCalled();
    cleanup();
  });

  it('closes open popover menu when popover API is available', () => {
    const hidePopover = vi.fn();
    const prevHtmlElement = globalThis.HTMLElement;
    Object.defineProperty(globalThis, 'HTMLElement', {
      value: { prototype: { showPopover: () => {} } },
      configurable: true,
    });
    try {
      const env = createMockEnv({ popovers: [{ hidePopover }] });
      const cleanup = installCapacitorBackHandler({ windowRef: env.win, documentRef: env.doc });
      env.fireBack(true);
      expect(hidePopover).toHaveBeenCalledTimes(1);
      expect(env.historyBack).not.toHaveBeenCalled();
      cleanup();
    } finally {
      Object.defineProperty(globalThis, 'HTMLElement', {
        value: prevHtmlElement,
        configurable: true,
      });
    }
  });

  it('navigates back once when history exists and prevents double navigation until popstate', () => {
    const env = createMockEnv();
    let navigating = false;
    const cleanup = installCapacitorBackHandler({
      windowRef: env.win,
      documentRef: env.doc,
      isNavigating: () => navigating,
      debounceMs: 5000,
    });

    env.fireBack(true);
    env.fireBack(true);
    expect(env.historyBack).toHaveBeenCalledTimes(1);

    env.firePopstate();
    navigating = true;
    env.fireBack(true);
    expect(env.historyBack).toHaveBeenCalledTimes(1);

    navigating = false;
    env.fireBack(true);
    expect(env.historyBack).toHaveBeenCalledTimes(2);
    expect(env.exitApp).not.toHaveBeenCalled();
    cleanup();
  });

  it('exits app only when canGoBack is false and no overlay is open', async () => {
    const env = createMockEnv();
    const cleanup = installCapacitorBackHandler({ windowRef: env.win, documentRef: env.doc });
    const winFlag = env.win as Window & { __runnoteBackBridgeActive?: boolean };
    expect(winFlag.__runnoteBackBridgeActive).toBeUndefined();

    await Promise.resolve();
    expect(winFlag.__runnoteBackBridgeActive).toBe(true);

    env.fireBack(false);
    expect(env.exitApp).toHaveBeenCalledTimes(1);
    expect(env.historyBack).not.toHaveBeenCalled();

    cleanup();
    expect(winFlag.__runnoteBackBridgeActive).toBe(false);
    expect(env.remove).toHaveBeenCalledTimes(1);
  });
});
