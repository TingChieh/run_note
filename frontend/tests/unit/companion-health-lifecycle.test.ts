import { describe, expect, it, vi } from 'vitest';
import {
  installForegroundRefresh,
  type CapacitorAppState,
  type CapacitorLifecycleWindow,
  type CapacitorListenerHandle,
} from '../../src/lib/components/companion-health-lifecycle.ts';

function createLifecycleEnv(
  options: {
    native?: boolean;
    deferAppListener?: boolean;
    initialVisibility?: DocumentVisibilityState;
  } = {},
) {
  let visibilityState: DocumentVisibilityState = options.initialVisibility ?? 'visible';
  const docListeners = new Map<string, Set<EventListener>>();
  const remove = vi.fn();
  const addListener = vi.fn();
  let appStateCallback: ((state: CapacitorAppState) => void) | undefined;
  let resolveAddListener: ((handle: CapacitorListenerHandle) => void) | undefined;

  const doc = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, cb: EventListener) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: EventListener) {
      docListeners.get(type)?.delete(cb);
    },
    dispatchEvent(event: Event) {
      docListeners.get(event.type)?.forEach((cb) => cb(event));
      return true;
    },
  } as unknown as Document;

  const win: Window & CapacitorLifecycleWindow = {
    Capacitor:
      options.native === false
        ? undefined
        : {
            isNativePlatform: () => true,
            Plugins: {
              App: {
                addListener: (eventName: 'appStateChange', cb: (state: CapacitorAppState) => void) => {
                  addListener(eventName, cb);
                  appStateCallback = cb;
                  if (options.deferAppListener) {
                    return new Promise<CapacitorListenerHandle>((resolve) => {
                      resolveAddListener = resolve;
                    });
                  }
                  return Promise.resolve({ remove });
                },
              },
            },
          },
  } as unknown as Window & CapacitorLifecycleWindow;

  return {
    doc,
    win,
    addListener,
    remove,
    listenerCount: () => docListeners.get('visibilitychange')?.size ?? 0,
    setVisibilityAndEmit: (next: DocumentVisibilityState) => {
      visibilityState = next;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    emitAppState: (isActive: boolean) => {
      appStateCallback?.({ isActive });
    },
    resolveNativeHandle: () => {
      resolveAddListener?.({ remove });
    },
  };
}

describe('companion health foreground refresh lifecycle', () => {
  it('triggers foreground and background callbacks via visibilitychange on web without touching Capacitor App', () => {
    const env = createLifecycleEnv({ native: false });
    const onForeground = vi.fn();
    const onBackground = vi.fn();
    let clock = 1000;

    const controller = installForegroundRefresh({
      onForeground,
      onBackground,
      windowRef: env.win,
      documentRef: env.doc,
      now: () => clock,
    });

    expect(env.listenerCount()).toBe(1);
    expect(env.addListener).not.toHaveBeenCalled();

    env.setVisibilityAndEmit('hidden');
    expect(onBackground).toHaveBeenCalledTimes(1);
    expect(onForeground).not.toHaveBeenCalled();

    clock += 50;
    env.setVisibilityAndEmit('visible');
    expect(onForeground).toHaveBeenCalledTimes(1);

    controller.destroy();
    expect(env.listenerCount()).toBe(0);

    clock += 500;
    env.setVisibilityAndEmit('visible');
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it('registers Capacitor App appStateChange when native and avoids duplicate refreshes when both events fire together', async () => {
    const env = createLifecycleEnv({ native: true });
    let resolveRefresh: (() => void) | undefined;
    const onForeground = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const onBackground = vi.fn();
    let clock = 2000;

    const controller = installForegroundRefresh({
      onForeground,
      onBackground,
      dedupeWindowMs: 300,
      windowRef: env.win,
      documentRef: env.doc,
      now: () => clock,
    });

    await Promise.resolve();
    expect(env.addListener).toHaveBeenCalledTimes(1);
    expect(env.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    // Both visibilitychange and appStateChange fire together while refresh is in flight.
    env.setVisibilityAndEmit('visible');
    env.emitAppState(true);
    expect(onForeground).toHaveBeenCalledTimes(1);

    // First refresh finishes quickly; a delayed companion event within dedupeWindowMs still does not double-fetch.
    resolveRefresh?.();
    await Promise.resolve();
    await Promise.resolve();
    clock += 80;
    env.emitAppState(true);
    expect(onForeground).toHaveBeenCalledTimes(1);

    // Going to background resets the dedupe window so returning triggers a fresh check even within 300ms.
    env.emitAppState(false);
    expect(onBackground).toHaveBeenCalledTimes(1);
    clock += 20;
    env.emitAppState(true);
    expect(onForeground).toHaveBeenCalledTimes(2);

    resolveRefresh?.();
    controller.destroy();
    expect(env.listenerCount()).toBe(0);
    expect(env.remove).toHaveBeenCalledTimes(1);
  });

  it('always runs onBackground while busy, queues pending foreground refresh, and flushes once on notifyIdle', () => {
    const env = createLifecycleEnv({ native: true });
    let busy = true;
    let clock = 4000;
    const onForeground = vi.fn();
    const onBackground = vi.fn();

    const controller = installForegroundRefresh({
      onForeground,
      onBackground,
      isBusy: () => busy,
      dedupeWindowMs: 300,
      windowRef: env.win,
      documentRef: env.doc,
      now: () => clock,
    });

    // Entering background while busy still clears via onBackground.
    env.setVisibilityAndEmit('hidden');
    env.emitAppState(false);
    expect(onBackground).toHaveBeenCalledTimes(2);
    expect(controller.hasPending()).toBe(false);

    // Returning to foreground while busy queues pending refresh instead of dropping it;
    // duplicate companion events coalesce into the same pending flag.
    clock += 20;
    env.setVisibilityAndEmit('visible');
    env.emitAppState(true);
    expect(onForeground).not.toHaveBeenCalled();
    expect(controller.hasPending()).toBe(true);

    // Idle callback while still in foreground flushes the queued refresh once.
    busy = false;
    controller.notifyIdle();
    expect(controller.hasPending()).toBe(false);
    expect(onForeground).toHaveBeenCalledTimes(1);

    // A delayed duplicate event shortly after notifyIdle is still suppressed by dedupeWindowMs.
    clock += 50;
    env.emitAppState(true);
    expect(onForeground).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it('drops pending queue if returned to background before notifyIdle and cleans up deferred native handle on destroy', async () => {
    const env = createLifecycleEnv({ native: true, deferAppListener: true });
    let busy = true;
    const onForeground = vi.fn();

    const controller = installForegroundRefresh({
      onForeground,
      isBusy: () => busy,
      windowRef: env.win,
      documentRef: env.doc,
      now: () => 5000,
    });

    env.setVisibilityAndEmit('hidden');
    env.setVisibilityAndEmit('visible');
    expect(controller.hasPending()).toBe(true);

    // Going back to background before busy settles clears the stale pending flag.
    env.emitAppState(false);
    expect(controller.hasPending()).toBe(false);
    busy = false;
    controller.notifyIdle();
    expect(onForeground).not.toHaveBeenCalled();

    // Next foreground return triggers refresh cleanly.
    env.emitAppState(true);
    expect(onForeground).toHaveBeenCalledTimes(1);

    // Destroy before App.addListener promise resolves -> handle must be removed once it settles.
    controller.destroy();
    expect(env.remove).not.toHaveBeenCalled();
    env.resolveNativeHandle();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.remove).toHaveBeenCalledTimes(1);
  });

  it('no-ops cleanly during SSR without document', () => {
    const onForeground = vi.fn();
    const controller = installForegroundRefresh({
      onForeground,
      documentRef: undefined,
      windowRef: undefined,
    });
    expect(controller.hasPending()).toBe(false);
    expect(() => controller.notifyIdle()).not.toThrow();
    expect(() => controller.destroy()).not.toThrow();
    expect(onForeground).not.toHaveBeenCalled();
  });
});
