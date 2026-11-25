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

/**
 * Listens for page visibility and native Capacitor app foreground/background transitions.
 * Coalesces duplicate foreground signals (e.g. `visibilitychange` + `appStateChange` firing
 * together on Android resume) and removes all listeners on cleanup.
 */
export function installForegroundRefresh(options: ForegroundRefreshOptions): () => void {
  const win =
    options.windowRef ?? (typeof window !== 'undefined' ? (window as Window & CapacitorLifecycleWindow) : undefined);
  const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) return () => {};

  const now = options.now ?? (() => Date.now());
  const dedupeWindowMs = options.dedupeWindowMs ?? 300;

  let disposed = false;
  let runSeq = 0;
  let activeRunId = 0;
  let lastForegroundAt = 0;
  let appStateHandle: CapacitorListenerHandle | undefined;

  const handleBackground = () => {
    if (disposed) return;
    activeRunId = 0;
    lastForegroundAt = 0;
    options.onBackground?.();
  };

  const triggerForeground = () => {
    if (disposed) return;
    if (activeRunId !== 0 || options.isBusy?.()) return;

    const currentTime = now();
    if (lastForegroundAt > 0 && currentTime - lastForegroundAt < dedupeWindowMs) {
      return;
    }

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
          if (activeRunId === id) activeRunId = 0;
        });
    } catch {
      if (activeRunId === id) activeRunId = 0;
    }
  };

  const handleVisibilityChange = () => {
    if (doc.visibilityState === 'visible') {
      triggerForeground();
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
        triggerForeground();
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

  return () => {
    disposed = true;
    activeRunId = 0;
    doc.removeEventListener('visibilitychange', handleVisibilityChange);
    const handle = appStateHandle;
    appStateHandle = undefined;
    if (handle && typeof handle.remove === 'function') {
      void Promise.resolve(handle.remove()).catch(() => {});
    }
  };
}
