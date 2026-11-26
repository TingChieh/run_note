export interface CapacitorSystemBarsPlugin {
  setStyle?: (options: { style: 'LIGHT' | 'DARK' | 'DEFAULT'; bar?: string }) => Promise<void> | void;
}

export interface CapacitorSystemAppearancePlugin {
  setTheme?: (options: { theme: 'light' | 'dark' | 'system' }) => Promise<void> | void;
}

export interface CapacitorHealthDataPlugin {
  getAvailability?: () => Promise<unknown>;
  checkPermissions?: (options?: { metrics?: string[] }) => Promise<unknown>;
  requestPermissions?: (options?: { metrics?: string[] }) => Promise<unknown>;
  readSummary?: (options?: { startDate?: string; endDate?: string; metrics?: string[] }) => Promise<unknown>;
  openSettings?: () => Promise<unknown>;
}

export interface CapacitorLocationRecorderPlugin {
  getCapabilities?: () => Promise<unknown>;
  checkPermissions?: () => Promise<unknown>;
  requestPermissions?: () => Promise<unknown>;
  openAppSettings?: () => Promise<unknown>;
  openLocationSettings?: () => Promise<unknown>;
  startSession?: (options: {
    sessionId: string;
    accountId: string;
    idempotencyKey: string;
    title?: string;
    resumeInterrupted?: boolean;
    claimRevision?: number;
    claimToken?: string;
  }) => Promise<unknown>;
  pauseSession?: () => Promise<unknown>;
  resumeSession?: () => Promise<unknown>;
  stopSession?: (options: {
    accountId: string;
    sessionId: string;
    claimRevision: number;
    claimToken?: string;
  }) => Promise<unknown>;
  acknowledgeHandoff?: (options: {
    sessionId: string;
    accountId: string;
    claimRevision: number;
    claimToken?: string;
  }) => Promise<unknown>;
  syncAccountClaim?: (options: {
    accountId: string | null;
    claimRevision: number;
    claimToken?: string;
  }) => Promise<unknown>;
  revokeAccountClaim?: (options: { accountId?: string | null; claimRevision?: number }) => Promise<unknown>;
  discardSession?: () => Promise<unknown>;
  getSessionState?: (options?: { accountId?: string }) => Promise<unknown>;
  getSessionPoints?: (options?: { accountId?: string; afterIndex?: number }) => Promise<unknown>;
  clearAccountSessions?: (options?: {
    keepAccountId?: string | null;
    departingAccountId?: string;
    claimRevision?: number;
    claimToken?: string;
  }) => Promise<unknown>;
  addListener?: (
    eventName: 'sessionUpdate',
    listenerFunc: (event: unknown) => void,
  ) => Promise<{ remove: () => Promise<void> | void }> | { remove: () => Promise<void> | void };
}

export type MobileSessionLifecycleState = 'active' | 'reauth_required' | 'signed_out';

export interface CapacitorRunNoteTransportPlugin {
  getSessionState?: () => Promise<{
    state: MobileSessionLifecycleState;
    serverUrl: string | null;
    serverOriginHash?: string | null;
    accountId: string | null;
    user?: unknown;
  }>;
  getServerConfig?: () => Promise<{
    serverUrl: string | null;
    defaultServerUrl: string | null;
    valid: boolean;
    reason?: string | null;
  }>;
  checkCapabilities?: () => Promise<{
    ok: boolean;
    status: number;
    capabilities?: unknown;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
  login?: (options: {
    email: string;
    password: string;
    deviceLabel?: string;
    clientVersion?: string;
  }) => Promise<{
    ok: boolean;
    status: number;
    user?: unknown;
    errorCode?: string | null;
    errorMessage?: string | null;
    retryAfterSeconds?: number | null;
  }>;
  logout?: (options?: { revokeAllDevices?: boolean }) => Promise<{
    ok: boolean;
    status: number;
  }>;
  request?: (options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string | null;
    timeoutMs?: number;
  }) => Promise<{
    status: number;
    ok: boolean;
    headers?: Record<string, string>;
    body?: string;
    sessionState?: MobileSessionLifecycleState;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
}

export interface CapacitorWindowRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    SystemBars?: CapacitorSystemBarsPlugin;
    SystemAppearance?: CapacitorSystemAppearancePlugin;
    HealthData?: CapacitorHealthDataPlugin;
    LocationRecorder?: CapacitorLocationRecorderPlugin;
    RunNoteTransport?: CapacitorRunNoteTransportPlugin;
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
