import { describe, expect, it, vi } from 'vitest';
import {
  clearHealthGrantHistory,
  createHealthClient,
  formatSleepMinutes,
  HEALTH_METRICS,
  normalizeMetrics,
  sanitizeHealthLog,
  type GrantHistoryStore,
  type HealthMetricId,
} from '../../src/lib/capacitor-health.ts';
import type { CapacitorHealthDataPlugin, CapacitorWindowRuntime } from '../../src/lib/capacitor-env.ts';

function memoryGrantStore(): GrantHistoryStore {
  const map = new Map<string, { requested: boolean; previouslyGranted: HealthMetricId[] }>();
  return {
    read: (key) => map.get(key) ?? { requested: false, previouslyGranted: [] },
    write: (key, state) => {
      map.set(key, state);
    },
    clear: (key) => {
      if (key) map.delete(key);
      else map.clear();
    },
  };
}

function makeNativeWindow(
  plugin: CapacitorHealthDataPlugin,
  platform: 'android' | 'ios' = 'android',
): Window & { Capacitor?: CapacitorWindowRuntime } {
  return {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => platform,
      Plugins: { HealthData: plugin },
    },
  } as unknown as Window & { Capacitor?: CapacitorWindowRuntime };
}

describe('capacitor-health unified read-only interface', () => {
  it('degrades cleanly to web_unavailable outside native Capacitor', async () => {
    const client = createHealthClient({ windowRef: {} as Window, grantStore: memoryGrantStore() });
    expect(client.platform).toBe('web');
    const availability = await client.getAvailability();
    expect(availability.available).toBe(false);
    expect(availability.status).toBe('web_unavailable');
    expect(availability.readOnly).toBe(true);
    const summary = await client.readSummary();
    expect(summary.status).toBe('unsupported');
  });

  it('handles provider_update_required and unsupported device states on Android', async () => {
    const updateClient = createHealthClient({
      windowRef: makeNativeWindow({
        getAvailability: async () => ({
          available: false,
          status: 'provider_update_required',
          platform: 'android',
          reason: '需要安装 Health Connect',
        }),
        openSettings: async () => ({ opened: true }),
      }),
      grantStore: memoryGrantStore(),
    });
    const avail = await updateClient.getAvailability();
    expect(avail.available).toBe(false);
    expect(avail.status).toBe('provider_update_required');
    expect(avail.reason).toContain('Health Connect');
    expect(await updateClient.openSettings()).toBe(true);

    const unsupportedClient = createHealthClient({
      windowRef: makeNativeWindow({
        getAvailability: async () => ({
          available: false,
          status: 'unsupported',
          platform: 'android',
          reason: '系统版本不支持',
        }),
      }),
      grantStore: memoryGrantStore(),
    });
    expect((await unsupportedClient.getAvailability()).status).toBe('unsupported');
  });

  it('tracks not_requested, granted, partial, denied, and revoked permission states', async () => {
    const grantStore = memoryGrantStore();
    let currentGranted: HealthMetricId[] = [];
    const plugin: CapacitorHealthDataPlugin = {
      getAvailability: async () => ({ available: true, status: 'available', platform: 'android' }),
      checkPermissions: async ({ metrics } = {}) => ({
        status: currentGranted.length ? 'granted' : 'denied',
        granted: currentGranted,
        denied: (metrics ?? HEALTH_METRICS).filter((m) => !currentGranted.includes(m as HealthMetricId)),
      }),
      requestPermissions: async () => ({
        status: currentGranted.length ? 'granted' : 'denied',
        granted: currentGranted,
        denied: HEALTH_METRICS.filter((m) => !currentGranted.includes(m)),
      }),
      readSummary: async () => ({
        status: currentGranted.length ? 'ok' : 'denied',
        grantedMetrics: currentGranted,
        windowStart: '2026-11-16T00:00:00Z',
        windowEnd: '2026-11-23T00:00:00Z',
        metrics: {
          steps: 18420,
          distanceMeters: 14250.5,
          activeCaloriesKcal: 860,
          heartRate: { avgBpm: 148, minBpm: 112, maxBpm: 174, sampleCount: 42 },
          restingHeartRateBpm: 54,
          sleepMinutes: 455,
        },
      }),
    };

    const client = createHealthClient({
      accountKey: 'user-a',
      windowRef: makeNativeWindow(plugin, 'android'),
      grantStore,
    });

    // Initial state before any request is not_requested (not denied).
    expect((await client.checkPermissions()).status).toBe('not_requested');

    // User denies the permission prompt.
    const denied = await client.requestPermissions();
    expect(denied.status).toBe('denied');
    expect(denied.granted).toEqual([]);

    // User grants partial metrics.
    currentGranted = ['steps', 'heart_rate'];
    const partial = await client.requestPermissions();
    expect(partial.status).toBe('partial');
    expect(partial.granted).toEqual(['steps', 'heart_rate']);

    // User grants all metrics and reads summary.
    currentGranted = [...HEALTH_METRICS];
    const granted = await client.requestPermissions();
    expect(granted.status).toBe('granted');
    const summary = await client.readSummary();
    expect(summary.status).toBe('ok');
    expect(summary.metrics.steps).toBe(18420);
    expect(summary.metrics.heartRate?.avgBpm).toBe(148);
    expect(summary.metrics.sleepMinutes).toBe(455);

    // User revokes permissions in system settings -> surfaces explicit `revoked` state!
    currentGranted = [];
    const revoked = await client.checkPermissions();
    expect(revoked.status).toBe('revoked');
    expect(revoked.revoked).toEqual([...HEALTH_METRICS]);
    const readAfterRevoke = await client.readSummary();
    expect(readAfterRevoke.status).toBe('revoked');

    // Clearing grant history on logout resets state for next account.
    clearHealthGrantHistory('user-a', grantStore);
    expect((await client.checkPermissions()).status).toBe('not_requested');
  });

  it('distinguishes empty health data from denied or error and supports future iOS platform', async () => {
    const plugin: CapacitorHealthDataPlugin = {
      getAvailability: async () => ({ available: true, status: 'available', platform: 'ios' }),
      checkPermissions: async () => ({ status: 'granted', granted: [...HEALTH_METRICS], denied: [] }),
      readSummary: async () => ({
        status: 'empty',
        grantedMetrics: [...HEALTH_METRICS],
        metrics: {},
      }),
    };
    const iosClient = createHealthClient({
      windowRef: makeNativeWindow(plugin, 'ios'),
      grantStore: memoryGrantStore(),
    });
    expect(iosClient.platform).toBe('ios');
    const avail = await iosClient.getAvailability();
    expect(avail.platform).toBe('ios');
    const result = await iosClient.readSummary();
    expect(result.status).toBe('empty');
    expect(result.readOnly).toBe(true);
  });

  it('normalizes metrics, formats sleep, and sanitizes diagnostic logs without raw values', () => {
    expect(normalizeMetrics(['steps', 'unknown', 'steps', 'sleep'])).toEqual(['steps', 'sleep']);
    expect(formatSleepMinutes(455)).toBe('7.6 小时');
    expect(formatSleepMinutes(420)).toBe('7 小时');
    expect(formatSleepMinutes(45)).toBe('45 分钟');
    expect(formatSleepMinutes(null)).toBe('—');
    const line = sanitizeHealthLog({
      action: 'readSummary',
      platform: 'android',
      status: 'ok',
      grantedCount: 6,
      deniedCount: 0,
    });
    expect(line).toBe('health:android:readSummary:ok(g=6,d=0)');
    expect(vi).toBeDefined();
  });
});
