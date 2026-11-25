import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgeNativeHandoff,
  checkRecorderPermissions,
  clearNativeAccountSessions,
  getNativeRecorderPoints,
  getNativeRecorderState,
  getRecorderCapabilities,
  isNativeLocationRecorderAvailable,
  nativeIdentityCleanupScope,
  parsePermissionsPayload,
  parsePointsPayload,
  parseStateEventPayload,
  revokeNativeAccountClaim,
  stopNativeRecording,
  subscribeNativeRecorderUpdates,
  syncNativeAccountClaim,
} from '../../src/lib/capacitor-recorder.ts';

describe('capacitor-recorder bridge', () => {
  it('is strictly no-op safe in SSR and standard web environments', async () => {
    expect(isNativeLocationRecorderAvailable(undefined)).toBe(false);
    const caps = await getRecorderCapabilities(undefined);
    expect(caps.native).toBe(false);
    expect(caps.platform).toBe('web');
    expect(caps.backgroundSupported).toBe(false);
    expect(await getNativeRecorderState('user-1', undefined)).toBeNull();
    expect(
      await acknowledgeNativeHandoff({ sessionId: 'sess-1', accountId: 'user-1', claimRevision: 1 }, undefined),
    ).toBe(false);
    expect(await syncNativeAccountClaim('user-1', 1, 'tok-1', undefined)).toBe(false);
    expect(await revokeNativeAccountClaim('user-1', 1, undefined)).toBe(false);
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
    const stopSession = vi.fn(async () => ({
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
    }));
    const syncAccountClaim = vi.fn(async () => ({ synced: true }));
    const revokeAccountClaim = vi.fn(async () => ({ revoked: true }));

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
            syncAccountClaim,
            revokeAccountClaim,
            stopSession,
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

    expect(
      await acknowledgeNativeHandoff(
        { sessionId: 'sess-1', accountId: 'user-1', claimRevision: 2, claimToken: 'tok-2' },
        fakeWindow,
      ),
    ).toBe(true);
    expect(acknowledgeHandoff).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      accountId: 'user-1',
      claimRevision: 2,
      claimToken: 'tok-2',
    });

    const stopped = await stopNativeRecording(
      { accountId: 'user-1', sessionId: 'sess-1', claimRevision: 2, claimToken: 'tok-2' },
      fakeWindow,
    );
    expect(stopSession).toHaveBeenCalledWith({
      accountId: 'user-1',
      sessionId: 'sess-1',
      claimRevision: 2,
      claimToken: 'tok-2',
    });
    expect(stopped?.points).toHaveLength(1);
    expect(stopped?.session?.previewDistanceM).toBe(320.5);

    expect(await syncNativeAccountClaim('user-1', 2, 'tok-2', fakeWindow)).toBe(true);
    expect(syncAccountClaim).toHaveBeenCalledWith({ accountId: 'user-1', claimRevision: 2, claimToken: 'tok-2' });
    expect(await revokeNativeAccountClaim('user-1', 2, fakeWindow)).toBe(true);
    expect(revokeAccountClaim).toHaveBeenCalledWith({ accountId: 'user-1', claimRevision: 2 });

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

  it('returns null on empty/malformed native getSessionState payload and propagates rejections', async () => {
    const nullPluginWindow = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          LocationRecorder: {
            getSessionState: vi.fn(async () => null),
          },
        },
      },
    } as unknown as Window;
    expect(await getNativeRecorderState('user-1', nullPluginWindow)).toBeNull();

    const failingPluginWindow = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          LocationRecorder: {
            getSessionState: vi.fn(async () => {
              throw new Error('bridge unavailable');
            }),
          },
        },
      },
    } as unknown as Window;
    await expect(getNativeRecorderState('user-1', failingPluginWindow)).rejects.toThrow('bridge unavailable');
  });

  it('rejects unguarded ack/stop calls and blocks mismatched foreign session payloads from stopSession', async () => {
    const discardSession = vi.fn(async () => ({ discarded: true }));
    const stopSession = vi.fn(async () => ({
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
        sessionId: 'sess-b',
        accountId: 'user-b',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        title: '账号B私密跑步',
        status: 'stopped',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_100_000,
        activeDurationMs: 100_000,
        segmentIndex: 0,
        pointCount: 5,
        previewDistanceM: 1200,
        lastPointTimeMs: 1_700_000_100_000,
        lastAccuracyM: 6,
        interruptedReason: null,
      },
      points: [{ lat: 31.23, lon: 121.47, recordedAtMs: 1_700_000_000_000, segmentIndex: 0 }],
    }));

    const foreignWindow = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          LocationRecorder: {
            discardSession,
            stopSession,
          },
        },
      },
    } as unknown as Window;

    // Without acknowledgeHandoff, must NOT fall back to unguarded discardSession.
    expect(
      await acknowledgeNativeHandoff({ sessionId: 'sess-1', accountId: 'user-1', claimRevision: 1 }, foreignWindow),
    ).toBe(false);
    expect(discardSession).not.toHaveBeenCalled();

    // Missing/invalid credentials rejected before calling native.
    expect(
      await acknowledgeNativeHandoff({ sessionId: 'sess-1', accountId: '', claimRevision: 1 }, foreignWindow),
    ).toBe(false);
    expect(
      await acknowledgeNativeHandoff({ sessionId: 'sess-1', accountId: 'user-1', claimRevision: 0 }, foreignWindow),
    ).toBe(false);
    await expect(
      stopNativeRecording({ accountId: '', sessionId: 'sess-a', claimRevision: 1 }, foreignWindow),
    ).rejects.toThrow();
    expect(stopSession).not.toHaveBeenCalled();

    // If native bridge returns a different account's session, stopNativeRecording rejects instead of leaking stats.
    await expect(
      stopNativeRecording({ accountId: 'user-a', sessionId: 'sess-a', claimRevision: 1 }, foreignWindow),
    ).rejects.toThrow('归属不匹配');
  });

  it('scopes native account cleanup and never forwards a claim owned by another account', async () => {
    const clearAccountSessions = vi.fn(async () => ({ cleared: false }));
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: { LocationRecorder: { clearAccountSessions } },
      },
    } as unknown as Window;
    const claimA = { activeAccountId: 'user-a', claimRevision: 3, claimToken: ' tok-a-3 ' };
    const claimB = { activeAccountId: 'user-b', claimRevision: 4, claimToken: 'tok-b-4' };

    await clearNativeAccountSessions({ keepAccountId: 'user-a', claim: claimA }, win);
    await clearNativeAccountSessions({ keepAccountId: null, departingAccountId: 'user-a', claim: claimA }, win);
    // A snapshot that already belongs to another account carries no authority for this cleanup.
    await clearNativeAccountSessions({ keepAccountId: 'user-a', claim: claimB }, win);
    await clearNativeAccountSessions({ keepAccountId: null, departingAccountId: 'user-a', claim: claimB }, win);
    // Without an account the revision is never sent, and departing is ignored when keeping an account.
    await clearNativeAccountSessions({ keepAccountId: null, claim: claimA }, win);
    await clearNativeAccountSessions({ keepAccountId: 'user-a', departingAccountId: 'user-b', claim: null }, win);
    await clearNativeAccountSessions(
      { keepAccountId: 'user-a', claim: { activeAccountId: 'user-a', claimRevision: 0, claimToken: 'tok' } },
      win,
    );

    expect(clearAccountSessions.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      { keepAccountId: 'user-a', claimRevision: 3, claimToken: 'tok-a-3' },
      { keepAccountId: null, departingAccountId: 'user-a', claimRevision: 3, claimToken: 'tok-a-3' },
      { keepAccountId: 'user-a' },
      { keepAccountId: null, departingAccountId: 'user-a' },
      { keepAccountId: null },
      { keepAccountId: 'user-a' },
      { keepAccountId: 'user-a' },
    ]);

    clearAccountSessions.mockRejectedValueOnce(new Error('bridge gone'));
    await expect(clearNativeAccountSessions({ keepAccountId: 'user-a', claim: claimA }, win)).resolves.toBeUndefined();
    await expect(clearNativeAccountSessions({ keepAccountId: 'user-a', claim: claimA }, undefined)).resolves.toBe(
      undefined,
    );
  });

  it('keeps the confirmed account only when the observed claim is its own after an identity change', () => {
    const claimB = { activeAccountId: 'user-b', claimRevision: 4, claimToken: 'tok-b-4' };
    const claimA = { activeAccountId: 'user-a', claimRevision: 3, claimToken: 'tok-a-3' };
    expect(nativeIdentityCleanupScope('user-b', 'user-a', claimB)).toEqual({ keepAccountId: 'user-b', claim: claimB });
    expect(nativeIdentityCleanupScope('user-b', 'user-a', claimA)).toEqual({
      keepAccountId: null,
      departingAccountId: 'user-a',
      claim: claimA,
    });
    expect(nativeIdentityCleanupScope(null, 'user-a', claimA)).toEqual({
      keepAccountId: null,
      departingAccountId: 'user-a',
      claim: claimA,
    });
    expect(nativeIdentityCleanupScope('user-b', null, null)).toEqual({
      keepAccountId: null,
      departingAccountId: null,
      claim: null,
    });
  });
});
