import { popoverSupported } from '#lib/styles/browser-support.ts';

export interface CapacitorBackButtonEvent {
  canGoBack: boolean;
}

export interface CapacitorListenerHandle {
  remove: () => Promise<void> | void;
}

export interface CapacitorAppPlugin {
  addListener: (
    eventName: 'backButton',
    listenerFunc: (event: CapacitorBackButtonEvent) => void,
  ) => Promise<CapacitorListenerHandle> | CapacitorListenerHandle;
  exitApp: () => Promise<void> | void;
}

export interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  Plugins?: {
    App?: CapacitorAppPlugin;
  };
}

export interface BackHandlerOptions {
  isNavigating?: () => boolean;
  windowRef?: Window & { Capacitor?: CapacitorRuntime; __runnoteBackBridgeActive?: boolean };
  documentRef?: Document;
  debounceMs?: number;
}

function queryOpenPopovers(doc: Document): HTMLElement[] {
  if (!popoverSupported()) return [];
  try {
    return Array.from(doc.querySelectorAll<HTMLElement>('[popover]:popover-open'));
  } catch {
    return [];
  }
}

/**
 * Dismisses the topmost open modal dialog, popover menu, or mobile navigation drawer.
 * Returns true if an overlay consumed the back press.
 */
export function dismissActiveOverlay(doc: Document = document, win: Window = window): boolean {
  const dialogs = Array.from(doc.querySelectorAll<HTMLDialogElement>('dialog[open]'));
  const topDialog = dialogs.at(-1);
  if (topDialog) {
    const cancelEvent = new Event('cancel', { cancelable: true });
    topDialog.dispatchEvent(cancelEvent);
    if (!cancelEvent.defaultPrevented && typeof topDialog.close === 'function') {
      topDialog.close();
    }
    return true;
  }

  const topPopover = queryOpenPopovers(doc).at(-1);
  if (topPopover && typeof topPopover.hidePopover === 'function') {
    topPopover.hidePopover();
    return true;
  }

  if (doc.querySelector('#app-navigation.nav-open, #public-mobile-menu')) {
    const KeyEvent = (win as Window & { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent;
    const escapeEvent =
      typeof KeyEvent === 'function'
        ? new KeyEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        : Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Escape' });
    win.dispatchEvent(escapeEvent);
    return true;
  }

  return false;
}

/**
 * Integrates Capacitor's Android hardware backButton event with RunNote's overlays and browser history.
 * No-ops outside native Capacitor runtimes so standard Web/SSR behavior is completely unchanged.
 */
export function installCapacitorBackHandler(options: BackHandlerOptions = {}): () => void {
  const win =
    options.windowRef ??
    (typeof window !== 'undefined'
      ? (window as Window & { Capacitor?: CapacitorRuntime; __runnoteBackBridgeActive?: boolean })
      : undefined);
  const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
  if (!win || !doc) return () => {};

  const cap = win.Capacitor;
  const app = cap?.Plugins?.App;
  if (!cap?.isNativePlatform?.() || typeof app?.addListener !== 'function') {
    return () => {};
  }

  const debounceMs = options.debounceMs ?? 350;
  let disposed = false;
  let backPending = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let handle: CapacitorListenerHandle | undefined;

  const clearPending = () => {
    backPending = false;
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
  };

  win.addEventListener('popstate', clearPending);

  const onBackButton = (event: CapacitorBackButtonEvent) => {
    if (disposed) return;
    if (dismissActiveOverlay(doc, win)) return;
    if (backPending || options.isNavigating?.()) return;

    if (event.canGoBack) {
      backPending = true;
      pendingTimer = setTimeout(clearPending, debounceMs);
      win.history.back();
      return;
    }

    if (typeof app.exitApp === 'function') {
      void app.exitApp();
    }
  };

  void Promise.resolve(app.addListener('backButton', onBackButton))
    .then((registered) => {
      if (disposed) {
        void registered?.remove?.();
      } else {
        handle = registered;
        win.__runnoteBackBridgeActive = true;
      }
    })
    .catch(() => {
      win.__runnoteBackBridgeActive = false;
      /* Keep Web UI usable even if the native bridge listener fails to register. */
    });

  return () => {
    disposed = true;
    win.__runnoteBackBridgeActive = false;
    clearPending();
    win.removeEventListener('popstate', clearPending);
    void handle?.remove?.();
  };
}
