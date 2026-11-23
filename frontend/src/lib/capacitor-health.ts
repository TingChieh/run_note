import { isCapacitorNative, type CapacitorHealthDataPlugin, type CapacitorWindowRuntime } from '#lib/capacitor-env.ts';

/**
 * Unified, strictly read-only health metric set aligned with RunNote's existing running and
 * recovery data fields. Both Android Health Connect and future iOS HealthKit map onto these IDs.
 */
export const HEALTH_METRICS = [
  'steps',
  'distance',
  'active_calories',
  'heart_rate',
  'resting_heart_rate',
  'sleep',
] as const;

export type HealthMetricId = (typeof HEALTH_METRICS)[number];

export const HEALTH_METRIC_LABELS: Record<HealthMetricId, string> = {
  steps: '步数',
  distance: '距离',
  active_calories: '活动热量',
  heart_rate: '心率',
  resting_heart_rate: '静息心率',
  sleep: '睡眠时长',
};

export type HealthPlatform = 'android' | 'ios' | 'web';

export type HealthAvailabilityStatus = 'available' | 'provider_update_required' | 'unsupported' | 'web_unavailable';

export interface HealthAvailability {
  available: boolean;
  status: HealthAvailabilityStatus;
  platform: HealthPlatform;
  readOnly: true;
  supportedMetrics: HealthMetricId[];
  reason: string | null;
}

export type HealthPermissionState = 'not_requested' | 'granted' | 'partial' | 'denied' | 'revoked' | 'unsupported';

export interface HealthPermissionSnapshot {
  status: HealthPermissionState;
  granted: HealthMetricId[];
  denied: HealthMetricId[];
  revoked: HealthMetricId[];
  readOnly: true;
}

export interface HealthHeartRateSummary {
  avgBpm: number | null;
  minBpm: number | null;
  maxBpm: number | null;
  sampleCount: number;
}

export interface HealthSummaryMetrics {
  steps: number | null;
  distanceMeters: number | null;
  activeCaloriesKcal: number | null;
  heartRate: HealthHeartRateSummary | null;
  restingHeartRateBpm: number | null;
  sleepMinutes: number | null;
}

export type HealthSummaryStatus = 'ok' | 'empty' | 'denied' | 'revoked' | 'unsupported' | 'error';

export interface HealthSummaryResult {
  status: HealthSummaryStatus;
  windowStart: string | null;
  windowEnd: string | null;
  grantedMetrics: HealthMetricId[];
  metrics: HealthSummaryMetrics;
  readOnly: true;
  message: string | null;
}

/**
 * Cross-platform adapter contract.
 * - Android uses the in-repo HealthData Capacitor plugin backed by Jetpack Health Connect.
 * - Future iOS HealthKit implements the exact same contract without modifying Svelte UI code.
 */
export interface HealthProviderAdapter {
  readonly platform: HealthPlatform;
  getAvailability(): Promise<HealthAvailability>;
  checkPermissions(metrics?: HealthMetricId[]): Promise<HealthPermissionSnapshot>;
  requestPermissions(metrics?: HealthMetricId[]): Promise<HealthPermissionSnapshot>;
  readSummary(options?: {
    startDate?: string;
    endDate?: string;
    metrics?: HealthMetricId[];
  }): Promise<HealthSummaryResult>;
  openSettings(): Promise<boolean>;
}

const VALID_METRICS = new Set<string>(HEALTH_METRICS);
const GRANT_MARKER_PREFIX = 'runnote-health-grants:v1:';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeMetrics(input?: readonly string[]): HealthMetricId[] {
  if (!input || input.length === 0) return [...HEALTH_METRICS];
  const seen = new Set<HealthMetricId>();
  for (const item of input) {
    if (VALID_METRICS.has(item)) seen.add(item as HealthMetricId);
  }
  return Array.from(seen);
}

function parseMetricArray(value: unknown): HealthMetricId[] {
  if (!Array.isArray(value)) return [];
  const out: HealthMetricId[] = [];
  for (const item of value) {
    if (typeof item === 'string' && VALID_METRICS.has(item) && !out.includes(item as HealthMetricId)) {
      out.push(item as HealthMetricId);
    }
  }
  return out;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function emptyHealthMetrics(): HealthSummaryMetrics {
  return {
    steps: null,
    distanceMeters: null,
    activeCaloriesKcal: null,
    heartRate: null,
    restingHeartRateBpm: null,
    sleepMinutes: null,
  };
}

function parseHeartRate(value: unknown): HealthHeartRateSummary | null {
  if (!isObject(value)) return null;
  const avg = finiteNonNegative(value.avgBpm);
  const min = finiteNonNegative(value.minBpm);
  const max = finiteNonNegative(value.maxBpm);
  const count = finiteNonNegative(value.sampleCount);
  if (avg === null && min === null && max === null) return null;
  return {
    avgBpm: avg !== null ? Math.round(avg) : null,
    minBpm: min !== null ? Math.round(min) : null,
    maxBpm: max !== null ? Math.round(max) : null,
    sampleCount: count !== null ? Math.round(count) : 0,
  };
}

function parseMetrics(value: unknown): HealthSummaryMetrics {
  if (!isObject(value)) return emptyHealthMetrics();
  return {
    steps: finiteNonNegative(value.steps) !== null ? Math.round(value.steps as number) : null,
    distanceMeters: finiteNonNegative(value.distanceMeters),
    activeCaloriesKcal:
      finiteNonNegative(value.activeCaloriesKcal) !== null ? Math.round(value.activeCaloriesKcal as number) : null,
    heartRate: parseHeartRate(value.heartRate),
    restingHeartRateBpm:
      finiteNonNegative(value.restingHeartRateBpm) !== null ? Math.round(value.restingHeartRateBpm as number) : null,
    sleepMinutes: finiteNonNegative(value.sleepMinutes) !== null ? Math.round(value.sleepMinutes as number) : null,
  };
}

/**
 * Strips any health metric numbers or tokens before writing diagnostic telemetry.
 */
export function sanitizeHealthLog(event: {
  action: string;
  platform: HealthPlatform;
  status: string;
  grantedCount?: number;
  deniedCount?: number;
}): string {
  return `health:${event.platform}:${event.action}:${event.status}(g=${event.grantedCount ?? 0},d=${event.deniedCount ?? 0})`;
}

export interface GrantHistoryStore {
  read(accountKey: string): { requested: boolean; previouslyGranted: HealthMetricId[] };
  write(accountKey: string, state: { requested: boolean; previouslyGranted: HealthMetricId[] }): void;
  clear(accountKey?: string): void;
}

export function createBrowserGrantHistoryStore(storage?: Storage | null): GrantHistoryStore {
  const resolveStorage = (): Storage | null => {
    if (storage !== undefined) return storage;
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    read(accountKey) {
      const store = resolveStorage();
      if (!store) return { requested: false, previouslyGranted: [] };
      try {
        const raw = store.getItem(`${GRANT_MARKER_PREFIX}${accountKey}`);
        if (!raw) return { requested: false, previouslyGranted: [] };
        const parsed: unknown = JSON.parse(raw);
        if (!isObject(parsed)) return { requested: false, previouslyGranted: [] };
        return {
          requested: parsed.requested === true,
          previouslyGranted: parseMetricArray(parsed.previouslyGranted),
        };
      } catch {
        return { requested: false, previouslyGranted: [] };
      }
    },
    write(accountKey, state) {
      const store = resolveStorage();
      if (!store) return;
      try {
        store.setItem(
          `${GRANT_MARKER_PREFIX}${accountKey}`,
          JSON.stringify({
            requested: state.requested,
            previouslyGranted: parseMetricArray(state.previouslyGranted),
          }),
        );
      } catch {
        /* Storage quota or privacy mode must never break health permission flow. */
      }
    },
    clear(accountKey) {
      const store = resolveStorage();
      if (!store) return;
      try {
        if (accountKey) {
          store.removeItem(`${GRANT_MARKER_PREFIX}${accountKey}`);
          return;
        }
        const toDelete: string[] = [];
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (key && key.startsWith(GRANT_MARKER_PREFIX)) toDelete.push(key);
        }
        for (const key of toDelete) store.removeItem(key);
      } catch {
        /* Ignore storage errors on cleanup. */
      }
    },
  };
}

export interface HealthClientOptions {
  accountKey?: string;
  windowRef?: Window & { Capacitor?: CapacitorWindowRuntime };
  grantStore?: GrantHistoryStore;
}

function detectPlatform(win: (Window & { Capacitor?: CapacitorWindowRuntime }) | undefined): HealthPlatform {
  if (!win || !isCapacitorNative(win)) return 'web';
  const raw = win.Capacitor?.getPlatform?.();
  if (raw === 'ios') return 'ios';
  return 'android';
}

function resolvePermissionSnapshot(
  raw: unknown,
  requested: HealthMetricId[],
  history: { requested: boolean; previouslyGranted: HealthMetricId[] },
  wasInteractiveRequest: boolean,
): HealthPermissionSnapshot {
  if (!isObject(raw)) {
    return { status: 'unsupported', granted: [], denied: requested, revoked: [], readOnly: true };
  }
  if (raw.status === 'unsupported') {
    return { status: 'unsupported', granted: [], denied: requested, revoked: [], readOnly: true };
  }
  const granted = parseMetricArray(raw.granted).filter((m) => requested.includes(m));
  const denied = requested.filter((m) => !granted.includes(m));
  const revoked = history.previouslyGranted.filter((m) => requested.includes(m) && !granted.includes(m));

  let status: HealthPermissionState;
  if (granted.length === requested.length && requested.length > 0) {
    status = 'granted';
  } else if (revoked.length > 0 && granted.length === 0) {
    status = 'revoked';
  } else if (granted.length > 0) {
    status = 'partial';
  } else if (wasInteractiveRequest || history.requested) {
    status = 'denied';
  } else {
    status = 'not_requested';
  }

  return { status, granted, denied, revoked, readOnly: true };
}

/**
 * Creates a platform-neutral read-only health data client.
 * Safely degrades to `web_unavailable` during SSR and in standard desktop/mobile browsers.
 */
export function createHealthClient(options: HealthClientOptions = {}): HealthProviderAdapter {
  const win =
    options.windowRef ??
    (typeof window !== 'undefined' ? (window as Window & { Capacitor?: CapacitorWindowRuntime }) : undefined);
  const platform = detectPlatform(win);
  const plugin: CapacitorHealthDataPlugin | undefined =
    win && isCapacitorNative(win) ? win.Capacitor?.Plugins?.HealthData : undefined;
  const accountKey = options.accountKey ?? 'default';
  const grantStore = options.grantStore ?? createBrowserGrantHistoryStore();

  const unavailableAvailability = (): HealthAvailability => ({
    available: false,
    status: platform === 'web' ? 'web_unavailable' : 'unsupported',
    platform,
    readOnly: true,
    supportedMetrics: [],
    reason:
      platform === 'web'
        ? '设备健康数据读取仅在 RunNote 移动端 App（Android Health Connect / 未来 iOS HealthKit）中可用。'
        : '当前设备暂不支持只读健康数据桥接。',
  });

  return {
    platform,

    async getAvailability(): Promise<HealthAvailability> {
      if (!plugin || typeof plugin.getAvailability !== 'function') {
        return unavailableAvailability();
      }
      try {
        const raw = await plugin.getAvailability();
        if (!isObject(raw)) return unavailableAvailability();
        const status =
          raw.status === 'available' || raw.status === 'provider_update_required' || raw.status === 'unsupported'
            ? raw.status
            : 'unsupported';
        const supportedMetrics = parseMetricArray(raw.supportedMetrics);
        const reportedPlatform = raw.platform === 'ios' ? 'ios' : raw.platform === 'android' ? 'android' : platform;
        return {
          available: raw.available === true && status === 'available',
          status,
          platform: reportedPlatform,
          readOnly: true,
          supportedMetrics: supportedMetrics.length ? supportedMetrics : [...HEALTH_METRICS],
          reason: typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason : null,
        };
      } catch {
        return {
          available: false,
          status: 'unsupported',
          platform,
          readOnly: true,
          supportedMetrics: [],
          reason: '无法检测 Health Connect 服务状态，请稍后重试。',
        };
      }
    },

    async checkPermissions(metrics?: HealthMetricId[]): Promise<HealthPermissionSnapshot> {
      const requested = normalizeMetrics(metrics);
      if (!plugin || typeof plugin.checkPermissions !== 'function') {
        return { status: 'unsupported', granted: [], denied: requested, revoked: [], readOnly: true };
      }
      try {
        const raw = await plugin.checkPermissions({ metrics: requested });
        const history = grantStore.read(accountKey);
        const snapshot = resolvePermissionSnapshot(raw, requested, history, false);
        if (snapshot.granted.length > 0) {
          grantStore.write(accountKey, {
            requested: true,
            previouslyGranted: Array.from(new Set([...history.previouslyGranted, ...snapshot.granted])),
          });
        }
        return snapshot;
      } catch {
        return { status: 'unsupported', granted: [], denied: requested, revoked: [], readOnly: true };
      }
    },

    async requestPermissions(metrics?: HealthMetricId[]): Promise<HealthPermissionSnapshot> {
      const requested = normalizeMetrics(metrics);
      if (!plugin || typeof plugin.requestPermissions !== 'function') {
        return { status: 'unsupported', granted: [], denied: requested, revoked: [], readOnly: true };
      }
      const history = grantStore.read(accountKey);
      const raw = await plugin.requestPermissions({ metrics: requested });
      const snapshot = resolvePermissionSnapshot(raw, requested, history, true);
      grantStore.write(accountKey, {
        requested: true,
        previouslyGranted: snapshot.granted.length > 0 ? snapshot.granted : history.previouslyGranted,
      });
      return snapshot;
    },

    async readSummary(readOptions = {}): Promise<HealthSummaryResult> {
      const requested = normalizeMetrics(readOptions.metrics);
      if (!plugin || typeof plugin.readSummary !== 'function') {
        return {
          status: 'unsupported',
          windowStart: null,
          windowEnd: null,
          grantedMetrics: [],
          metrics: emptyHealthMetrics(),
          readOnly: true,
          message: unavailableAvailability().reason,
        };
      }
      try {
        const raw = await plugin.readSummary({
          startDate: readOptions.startDate,
          endDate: readOptions.endDate,
          metrics: requested,
        });
        if (!isObject(raw)) {
          return {
            status: 'error',
            windowStart: null,
            windowEnd: null,
            grantedMetrics: [],
            metrics: emptyHealthMetrics(),
            readOnly: true,
            message: '设备健康数据返回格式无效',
          };
        }
        const history = grantStore.read(accountKey);
        const grantedMetrics = parseMetricArray(raw.grantedMetrics);
        const rawStatus = raw.status;
        if (rawStatus === 'unsupported') {
          return {
            status: 'unsupported',
            windowStart: null,
            windowEnd: null,
            grantedMetrics: [],
            metrics: emptyHealthMetrics(),
            readOnly: true,
            message: '当前设备不支持 Health Connect。',
          };
        }
        if (rawStatus === 'denied') {
          const wasGranted = history.previouslyGranted.some((m) => requested.includes(m));
          return {
            status: wasGranted ? 'revoked' : 'denied',
            windowStart: typeof raw.windowStart === 'string' ? raw.windowStart : null,
            windowEnd: typeof raw.windowEnd === 'string' ? raw.windowEnd : null,
            grantedMetrics: [],
            metrics: emptyHealthMetrics(),
            readOnly: true,
            message: wasGranted
              ? '健康数据权限已被撤销，请重新授权或在系统设置中开启只读权限。'
              : '尚未获得只读健康数据权限。',
          };
        }
        const metrics = parseMetrics(raw.metrics);
        const hasAny =
          metrics.steps !== null ||
          metrics.distanceMeters !== null ||
          metrics.activeCaloriesKcal !== null ||
          metrics.heartRate !== null ||
          metrics.restingHeartRateBpm !== null ||
          metrics.sleepMinutes !== null;
        return {
          status: rawStatus === 'empty' || !hasAny ? 'empty' : 'ok',
          windowStart: typeof raw.windowStart === 'string' ? raw.windowStart : null,
          windowEnd: typeof raw.windowEnd === 'string' ? raw.windowEnd : null,
          grantedMetrics,
          metrics,
          readOnly: true,
          message: null,
        };
      } catch {
        return {
          status: 'error',
          windowStart: null,
          windowEnd: null,
          grantedMetrics: [],
          metrics: emptyHealthMetrics(),
          readOnly: true,
          message: '读取设备健康数据失败，请稍后重试。',
        };
      }
    },

    async openSettings(): Promise<boolean> {
      if (!plugin || typeof plugin.openSettings !== 'function') return false;
      try {
        const raw = await plugin.openSettings();
        return isObject(raw) ? raw.opened !== false : true;
      } catch {
        return false;
      }
    },
  };
}

export function clearHealthGrantHistory(accountKey?: string, store?: GrantHistoryStore): void {
  (store ?? createBrowserGrantHistoryStore()).clear(accountKey);
}

export function formatSleepMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
}
