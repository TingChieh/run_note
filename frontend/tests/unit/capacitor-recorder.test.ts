import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgeNativeHandoff,
  checkRecorderPermissions,
  getNativeRecorderPoints,
  getNativeRecorderState,
  getRecorderCapabilities,
  isNativeLocationRecorderAvailable,
  parsePermissionsPayload,
  parsePointsPayload,
  parseStateEventPayload,
  stopNativeRecording,
  subscribeNativeRecorderUpdates,
} from '../../src/lib/capacitor-recorder.ts';

describe('capacitor-recorder bridge', () => {
  it('is strictly no-op safe in SSR and standard web environments', async () => {
    expect(isNativeLocationRecorderAvailable(undefined)).toBe(false);
    const caps = await getRecorderCapabilities(undefined);
    expect(caps.native).toBe(false);
    expect(caps.platform).toBe('web');
    expect(caps.backgroundSupported).toBe(false);
    expect(await getNativeRecorderState('user-1', undefined)).toBeNull();
    expect(await acknowledgeNativeHandoff('sess-1', undefined)).toBe(false);
  });

  it('delegates to platform-neutral LocationRecorder plugin, forwards accountId, and validates payloads', async () => {
    const callbacks: Array<(event: unknown) => void> = [];
    const remove = vi.fn();
    const getSessionState = vi.fn(async () => ({
      serviceRunning: false,
      status: 'stopped',
      gpsStatus: 'inactive',
      permissions: {
        location: 'granted',
        notification: 'granted',
        locationServicesEnabled: true,
        preciseLocation: true,
        canRecord: true,
      },
      session: null,
    }));
    const getSessionPoints = vi.fn(async () => ({
      points: [{ lat: 31.23, lon: 121.47, recordedAtMs: 1_700_000_000_000, segmentIndex: 0 }],
      totalReturned: 1,
    }));
    const acknowledgeHandoff = vi.fn(async () => ({ acknowledged: true }));

    const fakeWindow = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          LocationRecorder: {
            getCapabilities: async () => ({
              platform: 'android',
              native: true,
              backgroundSupported: true,
              requiresNotificationPermission: true,
              locationServicesEnabled: true,
            }),
            checkPermissions: async () => ({
              location: 'granted',
              notification: 'granted',
              locationServicesEnabled: true,
              preciseLocation: true,
              canRecord: true,
            }),
            getSessionState,
            getSessionPoints,
            acknowledgeHandoff,
            stopSession: async () => ({
              serviceRunning: false,
              status: 'stopped',
              gpsStatus: 'inactive',
              permissions: {
                location: 'granted',
                notification: 'granted',
                locationServicesEnabled: true,
                preciseLocation: true,
                canRecord: true,
              },
              session: {
                sessionId: 'sess-1',
                accountId: 'user-1',
                idempotencyKey: '11111111-1111-4111-8111-111111111111',
                title: '夜跑',
                status: 'stopped',
                startedAtMs: 1_700_000_000_000,
                endedAtMs: 1_700_000_100_000,
                activeDurationMs: 100_000,
                segmentIndex: 0,
                pointCount: 1,
                previewDistanceM: 320.5,
                lastPointTimeMs: 1_700_000_100_000,
                lastAccuracyM: 6,
                interruptedReason: null,
              },
              points: [
                { lat: 31.23, lon: 121.47, recordedAtMs: 1_700_000_000_000, segmentIndex: 0 },
                { lat: 999, lon: 121.47, recordedAtMs: 1_700_000_010_000, segmentIndex: 0 }, // invalid lat filtered
              ],
            }),
            addListener: (_name: 'sessionUpdate', cb: (event: unknown) => void) => {
              callbacks.push(cb);
              return { remove };
            },
          },
        },
      },
    } as unknown as Window;

    expect(isNativeLocationRecorderAvailable(fakeWindow)).toBe(true);
    const caps = await getRecorderCapabilities(fakeWindow);
    expect(caps.native).toBe(true);
    expect(caps.backgroundSupported).toBe(true);

    const perms = await checkRecorderPermissions(fakeWindow);
    expect(perms.location).toBe('granted');
    expect(perms.canRecord).toBe(true);

    await getNativeRecorderState('user-1', fakeWindow);
    expect(getSessionState).toHaveBeenCalledWith({ accountId: 'user-1' });

    const pts = await getNativeRecorderPoints(0, 'user-1', fakeWindow);
    expect(getSessionPoints).toHaveBeenCalledWith({ afterIndex: 0, accountId: 'user-1' });
    expect(pts).toHaveLength(1);

    expect(await acknowledgeNativeHandoff('sess-1', fakeWindow)).toBe(true);
    expect(acknowledgeHandoff).toHaveBeenCalledWith({ sessionId: 'sess-1' });

    const stopped = await stopNativeRecording(fakeWindow);
    expect(stopped?.points).toHaveLength(1);
    expect(stopped?.session?.previewDistanceM).toBe(320.5);

    const seen: string[] = [];
    const unsubscribe = subscribeNativeRecorderUpdates((ev) => seen.push(ev.gpsStatus), fakeWindow);
    await Promise.resolve();
    for (const cb of callbacks) {
      cb({ serviceRunning: true, status: 'recording', gpsStatus: 'lost', permissions: null, session: null });
    }
    expect(seen).toEqual(['lost']);
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('requires exact location (never allows approximate location to report canRecord=true) and sanitizes malformed payloads', () => {
    const approx = parsePermissionsPayload({
      location: 'approximate',
      notification: 'granted',
      locationServicesEnabled: true,
      preciseLocation: false,
      canRecord: true, // even if stale native payload tries to claim true, parser enforces exact location
    });
    expect(approx.location).toBe('approximate');
    expect(approx.preciseLocation).toBe(false);
    expect(approx.canRecord).toBe(false);

    expect(parsePointsPayload([{ lat: 'bad', lon: 120, recordedAtMs: 10 }, null])).toEqual([]);
    const state = parseStateEventPayload({ status: 'bogus', gpsStatus: 'bogus' });
    expect(state.status).toBe('idle');
    expect(state.gpsStatus).toBe('inactive');
  });
});
