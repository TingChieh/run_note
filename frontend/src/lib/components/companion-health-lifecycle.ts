export interface CapacitorAppState {
  isActive: boolean;
}

export interface CapacitorListenerHandle {
  remove: () => Promise<void> | void;
}

export interface CapacitorAppLifecyclePlugin {
  addListener?: (
    eventName: 'appStateChange',
    listenerFunc: (state: CapacitorAppState) => void,
  ) => Promise<CapacitorListenerHandle> | CapacitorListenerHandle;
}

export interface CapacitorLifecycleWindow {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      App?: CapacitorAppLifecyclePlugin;
    };
  };
}

export interface ForegroundRefreshOptions {
  onForeground: () => Promise<unknown> | void;
  onBackground?: () => void;
  isBusy?: () => boolean;
  dedupeWindowMs?: number;
  windowRef?: Window & CapacitorLifecycleWindow;
  documentRef?: Document;
  now?: () => number;
}

export interface ForegroundRefreshController {
  /** Returns true when a foreground event arrived while busy and is queued to run once idle. */
  hasPending(): boolean;
  /** Flushes a queued foreground refresh if the app/page is still in the foreground and no longer busy. */
  notifyIdle(): void;
  /** Removes all event listeners and prevents further callbacks. */
  destroy(): void;
}

/**
 * Listens for page visibility and native Capacitor app foreground/background transitions.
 * Coalesces duplicate foreground signals (e.g. `visibilitychange` + `appStateChange` firing
 * together on Android resume), queues foreground events received while busy so they flush
 * once the in-flight operation settles, and removes all listeners on cleanup.
 */
export function installForegroundRefresh(options: ForegroundRefreshOptions): ForegroundRefreshController {
  const win =
    options.windowRef ?? (typeof window !== 'undefined' ? (window as Window & CapacitorLifecycleWindow) : undefined);
  const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) {
    return {
      hasPending: () => false,
      notifyIdle: () => {},
      destroy: () => {},
    };
  }

  const now = options.now ?? (() => Date.now());
  const dedupeWindowMs = options.dedupeWindowMs ?? 300;

  let disposed = false;
  let runSeq = 0;
  let activeRunId = 0;
  let lastForegroundAt = 0;
  let pendingForeground = false;
  let inForeground = doc.visibilityState !== 'hidden';
  let appStateHandle: CapacitorListenerHandle | undefined;

  const handleBackground = () => {
    if (disposed) return;
    inForeground = false;
    pendingForeground = false;
    activeRunId = 0;
    lastForegroundAt = 0;
    options.onBackground?.();
  };

  const runForeground = (respectDedupe: boolean) => {
    if (disposed || !inForeground) return;
    if (activeRunId !== 0) return;
    if (options.isBusy?.()) {
      pendingForeground = true;
      return;
    }

    const currentTime = now();
    if (respectDedupe && lastForegroundAt > 0 && currentTime - lastForegroundAt < dedupeWindowMs) {
      return;
    }

    pendingForeground = false;
    lastForegroundAt = currentTime;
    const id = ++runSeq;
    activeRunId = id;

    try {
      const result = options.onForeground();
      void Promise.resolve(result)
        .catch(() => {
          /* Refresh errors are handled by the caller. */
        })
        .finally(() => {
          if (activeRunId === id) {
            activeRunId = 0;
            if (pendingForeground && inForeground && !disposed) {
              runForeground(false);
            }
          }
        });
    } catch {
      if (activeRunId === id) activeRunId = 0;
    }
  };

  const handleForeground = () => {
    if (disposed) return;
    inForeground = true;
    runForeground(true);
  };

  const handleVisibilityChange = () => {
    if (doc.visibilityState === 'visible') {
      handleForeground();
    } else if (doc.visibilityState === 'hidden') {
      handleBackground();
    }
  };

  doc.addEventListener('visibilitychange', handleVisibilityChange);

  const cap = win?.Capacitor;
  const app = cap?.Plugins?.App;
  if (cap?.isNativePlatform?.() === true && typeof app?.addListener === 'function') {
    const handleAppStateChange = (state: CapacitorAppState) => {
      if (state?.isActive === true) {
        handleForeground();
      } else if (state?.isActive === false) {
        handleBackground();
      }
    };

    try {
      void Promise.resolve(app.addListener('appStateChange', handleAppStateChange))
        .then((registered) => {
          if (disposed) {
            void Promise.resolve(registered?.remove?.()).catch(() => {});
          } else {
            appStateHandle = registered;
          }
        })
        .catch(() => {
          /* Keep visibilitychange active even if native App listener registration fails. */
        });
    } catch {
      /* Keep visibilitychange active even if native bridge throws synchronously. */
    }
  }

  return {
    hasPending: () => !disposed && pendingForeground,
    notifyIdle: () => {
      if (disposed || !pendingForeground || !inForeground) return;
      runForeground(false);
    },
    destroy: () => {
      disposed = true;
      pendingForeground = false;
      activeRunId = 0;
      doc.removeEventListener('visibilitychange', handleVisibilityChange);
      const handle = appStateHandle;
      appStateHandle = undefined;
      if (handle && typeof handle.remove === 'function') {
        void Promise.resolve(handle.remove()).catch(() => {});
      }
    },
  };
}
