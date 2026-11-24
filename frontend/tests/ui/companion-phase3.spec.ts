import { expect, test, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

interface MockRecorderConfig {
  locationPermission?: 'granted' | 'approximate' | 'denied';
  notificationPermission?: 'granted' | 'denied' | 'not_required';
  locationServicesEnabled?: boolean;
  onRequestLocationPermission?: 'granted' | 'approximate' | 'denied';
  initialRecording?: boolean;
  initialPaused?: boolean;
  initialInterrupted?: boolean;
  initialStopped?: boolean;
  stoppedSessionId?: string;
  stoppedIdempotencyKey?: string;
  persistAcrossReloads?: boolean;
  getSessionStateDelayMs?: number;
  getSessionStateBehavior?: 'resolve' | 'reject' | 'null' | 'hang';
}

async function installMockLocationRecorder(page: Page, config: MockRecorderConfig = {}) {
  await page.addInitScript((cfg) => {
    let locationPerm = cfg.locationPermission ?? 'granted';
    let notificationPerm = cfg.notificationPermission ?? 'granted';
    let locEnabled = cfg.locationServicesEnabled ?? true;
    let serviceRunning = Boolean(cfg.initialRecording);
    let gpsStatus = cfg.initialRecording ? 'good' : 'inactive';
    let stateBehavior = cfg.getSessionStateBehavior ?? 'resolve';
    let stateDelayMs = cfg.getSessionStateDelayMs ?? 0;
    const PERSIST_KEY = '__mock_native_recorder_state';

    const seedSession = (): Record<string, unknown> | null => {
      if (cfg.initialStopped) {
        return {
          sessionId: cfg.stoppedSessionId ?? 'stopped-handoff-sess-1',
          accountId: '00000000-0000-4000-8000-000000000001',
          idempotencyKey: cfg.stoppedIdempotencyKey ?? '88888888-8888-4888-8888-888888888888',
          title: '待交接已结束晨跑',
          status: 'stopped',
          startedAtMs: Date.now() - 300_000,
          endedAtMs: Date.now() - 10_000,
          activeDurationMs: 290_000,
          segmentIndex: 0,
          pointCount: 3,
          previewDistanceM: 980,
          lastPointTimeMs: Date.now() - 10_000,
          lastAccuracyM: 7,
          interruptedReason: null,
        };
      }
      if (cfg.initialRecording || cfg.initialPaused || cfg.initialInterrupted) {
        const seedStatus = cfg.initialRecording ? 'recording' : cfg.initialPaused ? 'paused' : 'interrupted';
        const seedSessionId = cfg.initialRecording
          ? 'recording-sess-1'
          : cfg.initialPaused
            ? 'paused-sess-1'
            : 'interrupted-sess-1';
        const seedTitle = cfg.initialRecording
          ? '正在进行的原生跑步'
          : cfg.initialPaused
            ? '已暂停待处理晨跑'
            : '中断待恢复晨跑';
        return {
          sessionId: seedSessionId,
          accountId: '00000000-0000-4000-8000-000000000001',
          idempotencyKey: '99999999-9999-4999-8999-999999999999',
          title: seedTitle,
          status: seedStatus,
          startedAtMs: Date.now() - 420_000,
          endedAtMs: null,
          activeDurationMs: 360_000,
          segmentIndex: 0,
          pointCount: 3,
          previewDistanceM: 1250,
          lastPointTimeMs: Date.now() - 60_000,
          lastAccuracyM: 8,
          interruptedReason: seedStatus === 'interrupted' ? 'process_terminated' : null,
        };
      }
      return null;
    };

    let session: Record<string, unknown> | null = seedSession();
    let points: Array<Record<string, unknown>> =
      cfg.initialRecording || cfg.initialPaused || cfg.initialInterrupted || cfg.initialStopped
        ? [
            {
              lat: 31.23,
              lon: 121.47,
              elevationM: 12,
              accuracyM: 8,
              recordedAtMs: Date.now() - 420_000,
              segmentIndex: 0,
            },
            {
              lat: 31.235,
              lon: 121.47,
              elevationM: 13,
              accuracyM: 7,
              recordedAtMs: Date.now() - 240_000,
              segmentIndex: 0,
            },
            {
              lat: 31.241,
              lon: 121.47,
              elevationM: 14,
              accuracyM: 8,
              recordedAtMs: Date.now() - 60_000,
              segmentIndex: 0,
            },
          ]
        : [];

    const listeners: Array<(event: unknown) => void> = [];
    let clearedAccounts: Array<string | null> = [];
    let acknowledgedSessionIds: string[] = [];
    let startSessionCalls = 0;
    let startSessionRejectedCount = 0;
    let stopSessionCalls = 0;
    let stopSessionRejectedCount = 0;
    let ackRejectedCount = 0;
    let claimFence: {
      authorizedAccountId: string | null;
      authorizedClaimRevision: number | null;
      authorizedClaimToken: string | null;
      claimEpoch: number;
    } | null = null;

    if (cfg.persistAcrossReloads) {
      try {
        const raw = window.sessionStorage.getItem(PERSIST_KEY);
        if (raw) {
          const restored = JSON.parse(raw) as {
            session?: Record<string, unknown> | null;
            points?: Array<Record<string, unknown>>;
            clearedAccounts?: Array<string | null>;
            acknowledgedSessionIds?: string[];
            claimFence?: {
              authorizedAccountId: string | null;
              authorizedClaimRevision: number | null;
              authorizedClaimToken: string | null;
              claimEpoch: number;
            } | null;
          };
          session = restored.session ?? null;
          points = Array.isArray(restored.points) ? restored.points : [];
          clearedAccounts = Array.isArray(restored.clearedAccounts) ? restored.clearedAccounts : [];
          acknowledgedSessionIds = Array.isArray(restored.acknowledgedSessionIds)
            ? restored.acknowledgedSessionIds
            : [];
          claimFence = restored.claimFence ?? null;
        }
      } catch {
        // Ignore storage read errors in init script
      }
    }

    const persistState = () => {
      if (!cfg.persistAcrossReloads) return;
      try {
        window.sessionStorage.setItem(
          PERSIST_KEY,
          JSON.stringify({ session, points, clearedAccounts, acknowledgedSessionIds, claimFence }),
        );
      } catch {
        // Ignore storage write errors
      }
    };

    const syncFence = (accountId: string | null, claimRevision: number, claimToken?: string | null) => {
      const normalizedAccount = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
      const rev = Number.isInteger(claimRevision) && claimRevision > 0 ? claimRevision : 0;
      const tok = typeof claimToken === 'string' && claimToken.trim() ? claimToken.trim() : null;
      if (normalizedAccount && rev > 0) {
        if (claimFence) {
          if (rev < claimFence.claimEpoch) return false;
          if (rev === claimFence.claimEpoch && claimFence.authorizedAccountId === null) return false;
        }
        claimFence = {
          authorizedAccountId: normalizedAccount,
          authorizedClaimRevision: rev,
          authorizedClaimToken: tok,
          claimEpoch: Math.max(claimFence?.claimEpoch ?? 0, rev),
        };
        persistState();
        return true;
      }
      return revokeFence(null, rev);
    };

    const revokeFence = (accountId: string | null, revokedClaimRevision = 0) => {
      const normalizedAccount = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
      const rev = Number.isInteger(revokedClaimRevision) && revokedClaimRevision > 0 ? revokedClaimRevision : 0;
      if (claimFence && rev > 0 && rev < claimFence.claimEpoch) return false;
      if (
        normalizedAccount &&
        claimFence?.authorizedAccountId &&
        claimFence.authorizedAccountId !== normalizedAccount
      ) {
        return false;
      }
      claimFence = {
        authorizedAccountId: null,
        authorizedClaimRevision: null,
        authorizedClaimToken: null,
        claimEpoch: Math.max(claimFence?.claimEpoch ?? 0, rev),
      };
      persistState();
      return true;
    };

    const isClaimAuthorized = (
      accountId: string,
      claimRevision: number,
      claimToken?: string,
      sessionClaimRevision?: number | null,
    ) => {
      if (!accountId.trim() || !Number.isInteger(claimRevision) || claimRevision <= 0) return false;
      if (typeof sessionClaimRevision === 'number' && claimRevision < sessionClaimRevision) return false;
      if (!claimFence) return true;
      if (
        claimFence.authorizedAccountId === null ||
        claimFence.authorizedAccountId !== accountId ||
        claimFence.authorizedClaimRevision !== claimRevision ||
        claimRevision < claimFence.claimEpoch
      ) {
        return false;
      }
      if (claimFence.authorizedClaimToken && claimFence.authorizedClaimToken !== (claimToken?.trim() || '')) {
        return false;
      }
      return true;
    };

    const buildPerms = () => ({
      location: locationPerm,
      notification: notificationPerm,
      locationServicesEnabled: locEnabled,
      preciseLocation: locationPerm === 'granted',
      canRecord: locationPerm === 'granted' && locEnabled,
    });
    const buildState = (accountId?: string | null) => {
      const visibleSession = session && (!accountId || session.accountId === accountId) ? { ...session } : null;
      return {
        serviceRunning,
        status: visibleSession ? visibleSession.status : 'idle',
        gpsStatus,
        permissions: buildPerms(),
        session: visibleSession,
      };
    };
    const emit = () => {
      const payload = buildState();
      for (const fn of listeners) fn(payload);
    };

    const win = window as unknown as Record<string, unknown>;
    win.__mockRecorder = {
      pushPoint(pt: { lat: number; lon: number; accuracyM?: number; deltaM?: number }) {
        if (!session || session.status !== 'recording') return;
        const now = Date.now();
        points.push({
          lat: pt.lat,
          lon: pt.lon,
          elevationM: 12.5,
          accuracyM: pt.accuracyM ?? 6,
          recordedAtMs: now,
          segmentIndex: Number(session.segmentIndex ?? 0),
        });
        session.pointCount = points.length;
        session.previewDistanceM = Number(session.previewDistanceM ?? 0) + (pt.deltaM ?? 450);
        session.activeDurationMs = Number(session.activeDurationMs ?? 0) + 120_000;
        session.lastPointTimeMs = now;
        session.lastAccuracyM = pt.accuracyM ?? 6;
        gpsStatus = (pt.accuracyM ?? 6) <= 15 ? 'good' : 'weak';
        emit();
      },
      setGpsStatus(next: string) {
        gpsStatus = next;
        emit();
      },
      setGetSessionStateBehavior(nextBehavior: 'resolve' | 'reject' | 'null' | 'hang', delayMs = 0) {
        stateBehavior = nextBehavior;
        stateDelayMs = delayMs;
      },
      getStartSessionCalls: () => startSessionCalls,
      getStartSessionRejectedCount: () => startSessionRejectedCount,
      getStopSessionCalls: () => stopSessionCalls,
      getStopSessionRejectedCount: () => stopSessionRejectedCount,
      getAckRejectedCount: () => ackRejectedCount,
      getClaimFence: () => (claimFence ? { ...claimFence } : null),
      syncAccountClaim: (accountId: string | null, claimRevision: number, claimToken?: string | null) =>
        syncFence(accountId, claimRevision, claimToken),
      revokeAccountClaim: (accountId: string | null, claimRevision = 0) => revokeFence(accountId, claimRevision),
      replaceActiveSession: (
        nextSession: Record<string, unknown> | null,
        nextPoints: Array<Record<string, unknown>> = [],
      ) => {
        session = nextSession ? { ...nextSession } : null;
        points = nextPoints.map((pt) => ({ ...pt }));
        serviceRunning = nextSession?.status === 'recording';
        gpsStatus = serviceRunning ? 'good' : 'inactive';
        persistState();
      },
      getSession: () => (session ? { ...session } : null),
      getPointCount: () => points.length,
      clearedAccounts,
      acknowledgedSessionIds,
    };

    win.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        LocationRecorder: {
          getCapabilities: async () => ({
            platform: 'android',
            native: true,
            backgroundSupported: true,
            requiresNotificationPermission: true,
            locationServicesEnabled: locEnabled,
          }),
          checkPermissions: async () => buildPerms(),
          requestPermissions: async () => {
            if (cfg.onRequestLocationPermission) locationPerm = cfg.onRequestLocationPermission;
            emit();
            return buildPerms();
          },
          openAppSettings: async () => ({ opened: true }),
          openLocationSettings: async () => ({ opened: true }),
          startSession: async (opts: Record<string, unknown>) => {
            startSessionCalls += 1;
            if (locationPerm !== 'granted') {
              startSessionRejectedCount += 1;
              throw new Error('需要精确位置权限才能记录可靠的跑步轨迹');
            }
            if (!opts.resumeInterrupted && session) {
              startSessionRejectedCount += 1;
              if (session.status === 'stopped' && Number(session.pointCount ?? 0) > 0) {
                throw new Error('存在尚未入队的已结束记录，请先保存或显式丢弃');
              }
              throw new Error('存在尚未保存或丢弃的记录会话，请先恢复、保存或安全丢弃后再开始新记录');
            }
            const startClaimRev = typeof opts.claimRevision === 'number' ? opts.claimRevision : 0;
            const startClaimToken = typeof opts.claimToken === 'string' ? opts.claimToken : undefined;
            if (startClaimRev > 0) {
              if (
                claimFence &&
                (startClaimRev < claimFence.claimEpoch ||
                  (startClaimRev === claimFence.claimEpoch && claimFence.authorizedAccountId === null) ||
                  (claimFence.authorizedAccountId !== null &&
                    claimFence.authorizedAccountId !== opts.accountId &&
                    startClaimRev <= claimFence.claimEpoch))
              ) {
                startSessionRejectedCount += 1;
                throw new Error('当前登录状态已变更或会话已失效，请刷新页面后再开始记录');
              }
              syncFence(String(opts.accountId ?? ''), startClaimRev, startClaimToken);
            }
            if (opts.resumeInterrupted && session) {
              session.status = 'recording';
              session.segmentIndex = Number(session.segmentIndex ?? 0) + 1;
              session.interruptedReason = null;
              if (startClaimRev > 0) session.claimRevision = startClaimRev;
            } else {
              points = [];
              session = {
                sessionId: opts.sessionId,
                accountId: opts.accountId,
                idempotencyKey: opts.idempotencyKey,
                title: opts.title ?? '',
                status: 'recording',
                startedAtMs: Date.now(),
                endedAtMs: null,
                activeDurationMs: 0,
                segmentIndex: 0,
                pointCount: 0,
                previewDistanceM: 0,
                lastPointTimeMs: null,
                lastAccuracyM: null,
                interruptedReason: null,
                ...(startClaimRev > 0 ? { claimRevision: startClaimRev } : {}),
              };
            }
            serviceRunning = true;
            gpsStatus = 'acquiring';
            persistState();
            emit();
            return { started: true };
          },
          pauseSession: async () => {
            if (session) session.status = 'paused';
            gpsStatus = 'inactive';
            persistState();
            emit();
            return { paused: true };
          },
          resumeSession: async () => {
            if (locationPerm !== 'granted') {
              throw new Error('需要精确位置权限才能继续记录跑步轨迹');
            }
            if (session) {
              session.status = 'recording';
              session.segmentIndex = Number(session.segmentIndex ?? 0) + 1;
            }
            gpsStatus = 'acquiring';
            persistState();
            emit();
            return { resumed: true };
          },
          stopSession: async (opts?: {
            accountId?: string;
            sessionId?: string;
            claimRevision?: number;
            claimToken?: string;
          }) => {
            stopSessionCalls += 1;
            const targetAccount = typeof opts?.accountId === 'string' ? opts.accountId.trim() : '';
            const targetSession = typeof opts?.sessionId === 'string' ? opts.sessionId.trim() : '';
            const targetRev = typeof opts?.claimRevision === 'number' ? opts.claimRevision : 0;
            const targetToken = typeof opts?.claimToken === 'string' ? opts.claimToken.trim() : undefined;
            if (!targetAccount || !targetSession || !Number.isInteger(targetRev) || targetRev <= 0) {
              stopSessionRejectedCount += 1;
              throw new Error('缺少有效的账号或会话归属凭据，已阻止停止原生记录');
            }
            if (!session) {
              stopSessionRejectedCount += 1;
              throw new Error('当前没有可停止的原生记录会话');
            }
            if (session.accountId !== targetAccount) {
              stopSessionRejectedCount += 1;
              throw new Error('当前原生记录属于其他账号，已阻止停止或读取其他账号数据');
            }
            if (session.sessionId !== targetSession) {
              stopSessionRejectedCount += 1;
              throw new Error('当前原生记录会话已变更，已阻止停止其他会话');
            }
            const sessionRev = typeof session.claimRevision === 'number' ? session.claimRevision : null;
            if (!isClaimAuthorized(targetAccount, targetRev, targetToken, sessionRev)) {
              stopSessionRejectedCount += 1;
              throw new Error('当前登录状态已变更或本地记录数据已清理，已阻止停止原生记录');
            }
            serviceRunning = false;
            gpsStatus = 'inactive';
            session.status = 'stopped';
            session.endedAtMs = Date.now();
            const out = { ...buildState(targetAccount), points: [...points] };
            persistState();
            emit();
            return out;
          },
          acknowledgeHandoff: async (opts?: {
            sessionId?: string;
            accountId?: string;
            claimRevision?: number;
            claimToken?: string;
          }) => {
            const targetId = typeof opts?.sessionId === 'string' ? opts.sessionId.trim() : '';
            const targetAccount = typeof opts?.accountId === 'string' ? opts.accountId.trim() : '';
            const targetRev = typeof opts?.claimRevision === 'number' ? opts.claimRevision : 0;
            const targetToken = typeof opts?.claimToken === 'string' ? opts.claimToken.trim() : undefined;
            const sessionRev = session && typeof session.claimRevision === 'number' ? session.claimRevision : null;
            if (
              session &&
              session.status === 'stopped' &&
              targetId &&
              session.sessionId === targetId &&
              targetAccount &&
              session.accountId === targetAccount &&
              isClaimAuthorized(targetAccount, targetRev, targetToken, sessionRev)
            ) {
              acknowledgedSessionIds.push(String(session.sessionId));
              session = null;
              points = [];
              persistState();
              emit();
              return { acknowledged: true };
            }
            ackRejectedCount += 1;
            return { acknowledged: false };
          },
          syncAccountClaim: async (opts?: {
            accountId?: string | null;
            claimRevision?: number;
            claimToken?: string;
          }) => ({
            synced: syncFence(opts?.accountId ?? null, Number(opts?.claimRevision ?? 0), opts?.claimToken),
          }),
          revokeAccountClaim: async (opts?: { accountId?: string | null; claimRevision?: number }) => ({
            revoked: revokeFence(opts?.accountId ?? null, Number(opts?.claimRevision ?? 0)),
          }),
          discardSession: async () => {
            serviceRunning = false;
            gpsStatus = 'inactive';
            session = null;
            points = [];
            persistState();
            emit();
            return { discarded: true };
          },
          getSessionState: async (opts?: { accountId?: string }) => {
            if (stateDelayMs > 0) {
              await new Promise((r) => setTimeout(r, stateDelayMs));
            }
            if (stateBehavior === 'hang') {
              return await new Promise<never>(() => {});
            }
            if (stateBehavior === 'reject') {
              throw new Error('原生定位服务状态读取失败');
            }
            if (stateBehavior === 'null') {
              return null;
            }
            return buildState(opts?.accountId);
          },
          getSessionPoints: async (opts?: { accountId?: string }) => {
            const matches = !opts?.accountId || !session || session.accountId === opts.accountId;
            const visible = matches ? [...points] : [];
            return { points: visible, totalReturned: visible.length };
          },
          clearAccountSessions: async (opts?: {
            keepAccountId?: string | null;
            claimRevision?: number;
            claimToken?: string;
          }) => {
            clearedAccounts.push(opts?.keepAccountId ?? null);
            const keep =
              typeof opts?.keepAccountId === 'string' && opts.keepAccountId.trim() ? opts.keepAccountId.trim() : null;
            if (!keep) {
              revokeFence(null, Number(opts?.claimRevision ?? 0));
            } else if (typeof opts?.claimRevision === 'number' && opts.claimRevision > 0) {
              syncFence(keep, opts.claimRevision, opts.claimToken);
            }
            persistState();
            return { cleared: true };
          },
          addListener: (_name: string, fn: (event: unknown) => void) => {
            listeners.push(fn);
            return {
              remove: () => {
                const idx = listeners.indexOf(fn);
                if (idx >= 0) listeners.splice(idx, 1);
              },
            };
          },
        },
      },
    };
  }, config);
}

test('standard web browser renders /activities/record cleanly and protects unauthenticated access', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Unauthenticated redirect
  await page.goto('/activities/record');
  await expect(page).toHaveURL(/\/admin\?next=%2Factivities%2Frecord/);

  // Authenticated web view shows foreground notice and entry link from /activities
  await loginRunner(page);
  await page.goto('/activities');
  await expect(page.getByTestId('activities-record-link')).toBeVisible();
  await page.getByTestId('activities-record-link').click();
  await expect(page).toHaveURL('/activities/record');
  await expect(page.getByTestId('recording-web-notice')).toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('handles permission denied, approximate location blocking, notification denied, and location services off', async ({
  page,
}) => {
  await loginRunner(page);

  await installMockLocationRecorder(page, {
    locationPermission: 'denied',
    onRequestLocationPermission: 'denied',
  });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-permission-denied')).toBeVisible();
  await page.getByTestId('recording-request-permission-btn').click();
  await expect(page.getByTestId('recording-error')).toBeVisible();

  await installMockLocationRecorder(page, {
    locationPermission: 'approximate',
    notificationPermission: 'denied',
    locationServicesEnabled: true,
  });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-approximate-warning')).toBeVisible();
  await expect(page.getByTestId('recording-request-precise-btn')).toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  await expect(page.getByTestId('recording-notification-warning')).toBeVisible();

  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    locationServicesEnabled: false,
  });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-location-disabled')).toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
});

test('records offline, handles GPS lost/pause/resume, and idempotently uploads exactly once on reconnect', async ({
  page,
  context,
}) => {
  let gpxPostCount = 0;
  const seenKeys: string[] = [];
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    const key = route.request().headers()['idempotency-key'];
    if (key) seenKeys.push(key);
    await route.continue();
  });

  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  // Start recording
  await page.getByLabel('跑步标题（可选）').fill('离线飞行模式测试跑');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect(page.getByTestId('recording-gps-badge')).toContainText('搜星中');

  // Receive points and test GPS lost indicator
  await page.evaluate(() => {
    const rec = (
      window as unknown as Record<string, { pushPoint: (p: unknown) => void; setGpsStatus: (s: string) => void }>
    ).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.234, lon: 121.47, accuracyM: 7, deltaM: 445 });
  });
  await expect(page.getByTestId('recording-gps-badge')).toContainText('GPS 良好');
  await expect(page.getByTestId('recording-distance')).toContainText('0.45 km');

  await page.evaluate(() => {
    (window as unknown as Record<string, { setGpsStatus: (s: string) => void }>).__mockRecorder.setGpsStatus('lost');
  });
  await expect(page.getByTestId('recording-gps-lost')).toBeVisible();

  // Back / navigation guard prompts confirmation dialog while recording
  await page.getByRole('link', { name: '跑步记录' }).first().click();
  await expect(page.getByTestId('recording-leave-dialog')).toBeVisible();
  await page.getByRole('button', { name: '留在记录页' }).click();
  await expect(page.getByTestId('recording-leave-dialog')).not.toBeVisible();

  // Pause & resume onto segment 2 (verify pause elapsed-time disclosure)
  await page.getByTestId('recording-pause-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
  await expect(page.getByTestId('recording-pause-note')).toContainText('首尾轨迹点');
  await page.getByTestId('recording-resume-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.236, lon: 121.472, accuracyM: 5, deltaM: 0 });
    rec.pushPoint({ lat: 31.24, lon: 121.472, accuracyM: 5, deltaM: 445 });
  });
  await expect(page.getByTestId('recording-points-count')).toContainText('4 点 · 2 段');

  // Switch to offline (airplane mode) before stopping
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByTestId('recording-offline-note')).toBeVisible();

  // Stop & Save while offline -> queued locally, 0 POSTs, native handoff acknowledged after IndexedDB commit
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'pending');
  expect(gpxPostCount).toBe(0);

  // Reconnect -> auto-flushes exactly once with UUID Idempotency-Key
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded');
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('服务端权威指标');
  expect(gpxPostCount).toBe(1);
  expect(seenKeys).toHaveLength(1);
  expect(seenKeys[0]).toMatch(/^[0-9a-f-]{36}$/i);
});

test('automatically recovers and enqueues a stopped native session after pre-enqueue crash within 5 seconds', async ({
  page,
}) => {
  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await route.continue();
  });

  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialStopped: true });
  await page.goto('/activities/record');

  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('待交接已结束晨跑');
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 5_000,
  });
  expect(gpxPostCount).toBe(1);

  const ackIds = await page.evaluate(
    () =>
      (window as unknown as Record<string, { acknowledgedSessionIds: string[] }>).__mockRecorder.acknowledgedSessionIds,
  );
  expect(ackIds).toEqual(['stopped-handoff-sess-1']);
});

test('automatically retries after 503 backoff expires while staying on the recording page', async ({ page }) => {
  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    if (gpxPostCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          data: null,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂时不可用' },
        }),
      });
      return;
    }
    await route.continue();
  });

  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.233, lon: 121.47, accuracyM: 6, deltaM: 333 });
  });
  await page.getByTestId('recording-stop-btn').click();

  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('等待自动重试');
  expect(gpxPostCount).toBe(1);

  // Stay on the page without clicking Retry: scheduled 5s backoff timer must auto-upload
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 10_000,
  });
  expect(gpxPostCount).toBe(2);
});

test('aborts upload and clears queue without leaking account A track when session switches to account B', async ({
  page,
  context,
}) => {
  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await route.continue();
  });

  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  // Record and stop offline as Account A
  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.232, lon: 121.47, accuracyM: 6, deltaM: 222 });
  });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);

  // Simulate cross-tab login as Account B before reconnecting
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user: {
            id: '00000000-0000-4000-8000-000000000099',
            email: 'other@example.com',
            username: 'other_runner',
            display_name: 'Other Runner',
            timezone: 'Asia/Shanghai',
            created_at: '2026-01-01T00:00:00Z',
            bio: '',
            is_admin: false,
            showcase_enabled: false,
            profile_is_public: false,
            wellbeing_allowed: false,
            wellbeing_enabled: false,
            together_allowed: false,
            together_enabled: false,
          },
        },
        error: null,
      }),
    });
  });

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Either layout identity verification reloads the page or uploader emits account_mismatch;
  // in both cases Account A's queue must be wiped and ZERO POSTs sent under Account B's cookie.
  await expect(page.getByTestId('upload-queue-empty')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
  expect(gpxPostCount).toBe(0);

  // Also verify server-side 409 ACCOUNT_MISMATCH (race between pre-flight check and POST) shows error and wipes queue
  await page.unroute('**/api/v1/auth/session');
  await page.unroute('**/api/v1/gpx-imports');
  await page.route('**/api/v1/gpx-imports', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'ACCOUNT_MISMATCH', message: '当前登录账号与待上传记录所属账号不一致' },
      }),
    });
  });

  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.232, lon: 121.47, accuracyM: 6, deltaM: 222 });
  });
  await page.getByTestId('recording-stop-btn').click();

  await expect(page.getByTestId('recording-error')).toContainText('账号已变更');
  await expect(page.getByTestId('upload-queue-empty')).toBeVisible();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
});

test('recovers interrupted session after process death and requires confirmation before discard', async ({ page }) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialInterrupted: true });
  await page.goto('/activities/record');

  await expect(page.getByTestId('recording-recovery-panel')).toBeVisible();
  await expect(page.getByTestId('recording-recovery-panel')).toContainText('3 个轨迹点');
  await expect(page.getByTestId('recording-recovery-panel')).toContainText('1.25 km');

  // Explicit confirmation dialog protects against accidental silent discard
  await page.getByTestId('recovery-discard-btn').click();
  await expect(page.getByTestId('recording-discard-dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByTestId('recording-recovery-panel')).toBeVisible();

  // Confirm discard clears session cleanly
  await page.getByTestId('recovery-discard-btn').click();
  await page.getByTestId('recording-discard-confirm-btn').click();
  await expect(page.getByTestId('recording-recovery-panel')).not.toBeVisible();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
});

test('visual QA across 390x844, 768x1024, and 1440x900 in light and dark themes with zero overflow', async ({
  page,
}) => {
  const captureScreenshots = process.env.PHASE3_CAPTURE_SCREENSHOTS === '1';
  const viewports = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const;

  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted' });

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript((t) => {
        window.localStorage.setItem('runnote-theme', t);
      }, theme);
      await page.goto('/activities/record');
      await expect(page.getByTestId('recording-panel')).toBeVisible();

      if (vp.name === 'mobile' && theme === 'dark') {
        // Show active recording state on mobile dark screenshot too
        await page.getByTestId('recording-start-btn').click();
        await page.evaluate(() => {
          const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
          rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
          rec.pushPoint({ lat: 31.238, lon: 121.47, accuracyM: 6, deltaM: 2150 });
        });
        await expect(page.getByTestId('recording-distance')).toContainText('2.15 km');
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${vp.name}-${theme} horizontal overflow`).toBeLessThanOrEqual(1);

      if (captureScreenshots) {
        await page.screenshot({
          path: `../docs/assets/phase3-${vp.name}-${theme}.png`,
          fullPage: false,
        });
      }

      if (vp.name === 'mobile' && theme === 'dark') {
        await page.getByTestId('recording-pause-btn').click();
        await page.getByTestId('recording-discard-btn').click();
        await page.getByTestId('recording-discard-confirm-btn').click();
      }
    }
  }
});

test('P1: never acknowledges/deletes native handoff when IndexedDB transaction aborts during put, and recovers on restart', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted', persistAcrossReloads: true });
  await page.goto('/activities/record');

  await page.getByLabel('跑步标题（可选）').fill('事务中止保留原生轨迹跑');
  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.234, lon: 121.47, accuracyM: 6, deltaM: 445 });
  });

  // Go offline and abort the upload-store transaction inside the put request's `success` event.
  await context.setOffline(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    const origPut = IDBObjectStore.prototype.put;
    let abortedOnce = false;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const req = origPut.call(this, value, key);
      const recordKey = (value as { key?: unknown } | null)?.key;
      if (!abortedOnce && typeof recordKey === 'string' && recordKey.includes(':upload:')) {
        abortedOnce = true;
        const tx = req.transaction;
        req.addEventListener(
          'success',
          () => {
            try {
              tx?.abort();
            } catch {
              // Ignore if already aborted
            }
          },
          { once: true },
        );
      }
      return req;
    };
  });

  await page.getByTestId('recording-stop-btn').click();

  // Native ack must NOT fire when transaction aborts; recoverable pending handoff UI stays visible.
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('事务');
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
  const ackedBeforeRestart = await page.evaluate(
    () =>
      (window as unknown as Record<string, { acknowledgedSessionIds: string[] }>).__mockRecorder.acknowledgedSessionIds,
  );
  expect(ackedBeforeRestart).toEqual([]);

  // Simulate process restart with healthy IndexedDB while holding the network upload briefly to inspect durability.
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await uploadGate;
    await route.continue();
  });

  await context.setOffline(false);
  await page.reload();

  // After restart, auto-recovery commits to IndexedDB first, THEN acknowledges native handoff.
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.getByTestId('recording-pending-handoff-panel')).not.toBeVisible();
  const ackedAfterRecovery = await page.evaluate(
    () =>
      (window as unknown as Record<string, { acknowledgedSessionIds: string[] }>).__mockRecorder.acknowledgedSessionIds,
  );
  expect(ackedAfterRecovery).toHaveLength(1);

  releaseUpload();
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 5_000,
  });
  expect(gpxPostCount).toBe(1);
});

test('P1: preserves native handoff when IndexedDB is unavailable and recovers when storage becomes available', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'stopped-handoff-unavail-1',
    stoppedIdempotencyKey: '77777777-7777-4777-8777-777777777777',
  });
  await page.addInitScript(() => {
    const origOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (name: string, version?: number) {
      if (name === 'runnote-recording-store' && window.sessionStorage.getItem('__idb_available') !== '1') {
        const fakeReq = new EventTarget() as IDBOpenDBRequest;
        Object.defineProperty(fakeReq, 'error', {
          value: new DOMException('IndexedDB unavailable', 'UnknownError'),
        });
        setTimeout(() => {
          fakeReq.dispatchEvent(new Event('error'));
        }, 0);
        return fakeReq;
      }
      return version !== undefined ? origOpen(name, version) : origOpen(name);
    };
  });

  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await route.continue();
  });

  await page.goto('/activities/record');

  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toBeVisible();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
  const ackedWhileUnavailable = await page.evaluate(
    () =>
      (window as unknown as Record<string, { acknowledgedSessionIds: string[] }>).__mockRecorder.acknowledgedSessionIds,
  );
  expect(ackedWhileUnavailable).toEqual([]);

  // Restore persistent storage and retry handoff
  await page.evaluate(() => {
    window.sessionStorage.setItem('__idb_available', '1');
  });
  await page.getByTestId('handoff-retry-btn').click();

  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 5_000,
  });
  expect(gpxPostCount).toBe(1);
  const ackedAfterRetry = await page.evaluate(
    () =>
      (window as unknown as Record<string, { acknowledgedSessionIds: string[] }>).__mockRecorder.acknowledgedSessionIds,
  );
  expect(ackedAfterRetry).toEqual(['stopped-handoff-unavail-1']);
});

test('P2: same-account new tab BroadcastChannel check does not cancel 503 backoff retry', async ({ page, context }) => {
  let gpxPostCount = 0;
  await context.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    if (gpxPostCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          data: null,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂时不可用' },
        }),
      });
      return;
    }
    await route.continue();
  });

  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.233, lon: 121.47, accuracyM: 6, deltaM: 333 });
  });
  await page.getByTestId('recording-stop-btn').click();

  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('等待自动重试');
  expect(gpxPostCount).toBe(1);

  // Open a real second tab on the same account, triggering BroadcastChannel('runnote-auth') `check`.
  const secondTab = await context.newPage();
  await secondTab.goto('/settings');
  await expect(secondTab.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  // Tab 1 must NOT permanently cancel its backoff timer and must still auto-upload at due time.
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 10_000,
  });
  expect(gpxPostCount).toBe(2);
  await secondTab.close();
});

test('P2: suspended stale account A tab waking after account B signs in deletes only A records and preserves B queue and draft', async ({
  page,
  context,
}) => {
  await loginRunner(page);

  // Create an active second runner account B via admin API
  const accountBEmail = `phase3_b_${Date.now()}@example.com`;
  const accountBPassword = 'SecondRunner-2026!';
  const createRes = await page.request.post('/api/v1/admin/users', {
    headers: { 'x-csrf-token': 'ui-csrf' },
    data: {
      email: accountBEmail,
      username: `runner_b_${Date.now().toString().slice(-6)}`,
      display_name: 'Runner B',
      password: accountBPassword,
      timezone: 'Asia/Shanghai',
      is_active: true,
      showcase_enabled: false,
      wellbeing_allowed: false,
    },
  });
  expect(createRes.ok()).toBe(true);
  const accountBId = (await createRes.json()).data.user?.id ?? (await createRes.json()).data.id;
  expect(typeof accountBId).toBe('string');

  let gpxPostCount = 0;
  await context.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await route.continue();
  });

  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  // Account A records and stops offline
  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.232, lon: 121.47, accuracyM: 6, deltaM: 222 });
  });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);

  // While Tab 1 is suspended, another session switches cookies to Account B and writes Account B's draft & queue.
  const loginBRes = await context.request.post('/api/v1/auth/login', {
    data: { email: accountBEmail, password: accountBPassword },
  });
  expect(loginBRes.ok()).toBe(true);

  const bUploadKey = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await page.evaluate(
    async ({ bId, bKey }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('runnote-recording-store', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('records', 'readwrite');
          const store = tx.objectStore('records');
          const now = Date.now();
          store.put({
            key: 'meta:recording_active_account',
            accountId: bId,
            schemaVersion: 1,
            savedAt: now,
            payload: bId,
          });
          store.put({
            key: `user:${bId}:draft:active`,
            accountId: bId,
            schemaVersion: 1,
            savedAt: now,
            payload: {
              sessionId: 'sess-b-active',
              accountId: bId,
              idempotencyKey: 'bbbbbbbb-1111-4111-8111-111111111111',
              title: '账号 B 进行中草稿',
              status: 'paused',
              startedAtMs: now - 60_000,
              endedAtMs: null,
              activeDurationMs: 60_000,
              lastSegmentStartMs: null,
              segmentIndex: 0,
              previewDistanceM: 320,
              lastPointTimeMs: now - 5_000,
              lastAccuracyM: 6,
              interruptedReason: null,
              points: [
                { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 60_000, segmentIndex: 0 },
              ],
            },
          });
          store.put({
            key: `user:${bId}:upload:${bKey}`,
            accountId: bId,
            schemaVersion: 1,
            savedAt: now,
            payload: {
              idempotencyKey: bKey,
              accountId: bId,
              sessionId: 'sess-b-upload',
              title: '账号 B 待上传记录',
              timezone: 'Asia/Shanghai',
              startedAtMs: now - 120_000,
              endedAtMs: now - 30_000,
              pointCount: 2,
              segmentCount: 1,
              previewDistanceM: 450,
              activeDurationMs: 90_000,
              gpxXml: '<gpx version="1.1"><trk><name>B</name></trk></gpx>',
              status: 'failed',
              attemptCount: 1,
              nextRetryAt: now + 60_000,
              lastError: '等待退避',
              permanentError: false,
              uploadedActivityId: null,
              serverDistanceM: null,
              serverDurationS: null,
              serverPaceSPerKm: null,
              createdAtMs: now - 30_000,
              updatedAtMs: now - 30_000,
            },
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { bId: accountBId, bKey: bUploadKey },
  );

  // Wake Tab 1 cleanly (comes online + focus)
  await context.setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });

  // Tab 1 detects identity switch (and redirects/reloads to /workspace/activities/record as Account B).
  await expect(page).toHaveURL(/\/workspace\/activities\/record/, { timeout: 10_000 });
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('账号 B 待上传记录');

  // Verify IndexedDB directly: zero Account A keys remain, while Account B draft, queue, and marker are intact.
  const idbSnapshot = await page.evaluate(async () => {
    return await new Promise<Array<{ key: string; payload: unknown }>>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readonly');
        const allReq = tx.objectStore('records').getAll();
        allReq.onsuccess = () => {
          const rows = (allReq.result as Array<{ key: string; payload: unknown }>).map((r) => ({
            key: r.key,
            payload: r.payload,
          }));
          db.close();
          resolve(rows);
        };
        allReq.onerror = () => reject(allReq.error);
      };
    });
  });

  const accountAId = '00000000-0000-4000-8000-000000000001';
  expect(idbSnapshot.filter((r) => r.key.startsWith(`user:${accountAId}:`))).toEqual([]);
  expect(idbSnapshot.find((r) => r.key === 'meta:recording_active_account')?.payload).toBe(accountBId);
  expect(idbSnapshot.find((r) => r.key === `user:${accountBId}:draft:active`)).toBeTruthy();
  const bQueueRow = idbSnapshot.find((r) => r.key === `user:${accountBId}:upload:${bUploadKey}`);
  expect(bQueueRow).toBeTruthy();
  expect((bQueueRow?.payload as { gpxXml?: string })?.gpxXml).toContain('<gpx');
  expect(gpxPostCount).toBe(0);
});

test('P2 Round 3: interleaving A reads session then B becomes active and enqueues preserves B data and removes expired A records', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  const accountAId = '00000000-0000-4000-8000-000000000001';

  const accountBEmail = `phase3_r3_interleave_${Date.now()}@example.com`;
  const accountBPassword = 'SecondRunner-2026!';
  const createRes = await page.request.post('/api/v1/admin/users', {
    headers: { 'x-csrf-token': 'ui-csrf' },
    data: {
      email: accountBEmail,
      username: `runner_r3a_${Date.now().toString().slice(-6)}`,
      display_name: 'Runner R3 Interleave',
      password: accountBPassword,
      timezone: 'Asia/Shanghai',
      is_active: true,
      showcase_enabled: false,
      wellbeing_allowed: false,
    },
  });
  expect(createRes.ok()).toBe(true);
  const createBody = await createRes.json();
  const accountBId = createBody.data.user?.id ?? createBody.data.id;
  expect(typeof accountBId).toBe('string');

  const gpxOwnersPosted: string[] = [];
  await context.route('**/api/v1/gpx-imports', async (route) => {
    const raw = route.request().postData() ?? '';
    const match = raw.match(/name="expected_owner_id"\s+([^\r\n]+)/);
    if (match) gpxOwnersPosted.push(match[1].trim());
    // Hold B's upload in failed/retry state so B's queued item stays inspectable in IndexedDB
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用' },
      }),
    });
  });

  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  // Account A records & stops (503 keeps A's queued item in backoff state), plus leaves an active draft in IndexedDB
  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.232, lon: 121.47, accuracyM: 6, deltaM: 222 });
  });
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'failed');
  gpxOwnersPosted.length = 0;

  await page.evaluate(async (aId) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        const now = Date.now();
        tx.objectStore('records').put({
          key: `user:${aId}:draft:active`,
          accountId: aId,
          schemaVersion: 1,
          savedAt: now,
          payload: {
            sessionId: 'sess-a-expired-draft',
            accountId: aId,
            idempotencyKey: 'aaaaaaaa-9999-4999-8999-999999999999',
            title: '账号 A 过期草稿',
            status: 'paused',
            startedAtMs: now - 60_000,
            endedAtMs: null,
            activeDurationMs: 60_000,
            lastSegmentStartMs: null,
            segmentIndex: 0,
            previewDistanceM: 200,
            lastPointTimeMs: now - 5_000,
            lastAccuracyM: 6,
            interruptedReason: null,
            points: [
              { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 60_000, segmentIndex: 0 },
            ],
          },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, accountAId);

  // Intercept Tab A's NEXT /api/v1/auth/session call so Tab A reads Account A's session and pauses before cleanup.
  let sessionCallCount = 0;
  let markSessionARead!: () => void;
  const sessionAReadPromise = new Promise<void>((resolve) => {
    markSessionARead = resolve;
  });
  let releaseSessionAResponse!: () => void;
  const sessionAReleaseGate = new Promise<void>((resolve) => {
    releaseSessionAResponse = resolve;
  });

  await page.route('**/api/v1/auth/session', async (route) => {
    sessionCallCount += 1;
    if (sessionCallCount === 1) {
      const resp = await route.fetch();
      const body = await resp.text();
      markSessionARead();
      await sessionAReleaseGate;
      await route.fulfill({ status: resp.status(), headers: resp.headers(), body });
      return;
    }
    await route.continue();
  });

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sessionAReadPromise;

  // Interleaving step: while Tab A holds Account A's session response, another tab signs in as B and enqueues B's data.
  const loginBRes = await context.request.post('/api/v1/auth/login', {
    data: { email: accountBEmail, password: accountBPassword },
  });
  expect(loginBRes.ok()).toBe(true);

  const tabB = await context.newPage();
  await installMockLocationRecorder(tabB, { locationPermission: 'granted' });
  await tabB.goto('/workspace/activities/record');
  await expect(tabB.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  await tabB.getByLabel('跑步标题（可选）').fill('账号 B 并发写入跑');
  await tabB.getByTestId('recording-start-btn').click();
  await tabB.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.235, lon: 121.47, accuracyM: 6, deltaM: 510 });
  });
  await tabB.getByTestId('recording-stop-btn').click();
  await expect(tabB.getByTestId('upload-queue-item')).toHaveCount(1);

  // Also persist an active draft for B in IndexedDB before Tab A's delayed cleanup runs
  await tabB.evaluate(async (bId) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        const now = Date.now();
        tx.objectStore('records').put({
          key: `user:${bId}:draft:active`,
          accountId: bId,
          schemaVersion: 1,
          savedAt: now,
          payload: {
            sessionId: 'sess-b-active-draft',
            accountId: bId,
            idempotencyKey: 'bbbbbbbb-9999-4999-8999-999999999999',
            title: '账号 B 进行中草稿',
            status: 'paused',
            startedAtMs: now - 30_000,
            endedAtMs: null,
            activeDurationMs: 30_000,
            lastSegmentStartMs: null,
            segmentIndex: 0,
            previewDistanceM: 310,
            lastPointTimeMs: now - 3_000,
            lastAccuracyM: 6,
            interruptedReason: null,
            points: [
              { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 30_000, segmentIndex: 0 },
            ],
          },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, accountBId);

  // Now release Tab A's stale Account A session read so Tab A's cleanup/reconciliation runs AFTER B became active.
  releaseSessionAResponse();

  await expect(page).toHaveURL(/\/workspace\/activities\/record/, { timeout: 10_000 });
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('账号 B 并发写入跑');

  const idbSnapshot = await tabB.evaluate(async () => {
    return await new Promise<Array<{ key: string; payload: unknown }>>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readonly');
        const allReq = tx.objectStore('records').getAll();
        allReq.onsuccess = () => {
          const rows = (allReq.result as Array<{ key: string; payload: unknown }>).map((r) => ({
            key: r.key,
            payload: r.payload,
          }));
          db.close();
          resolve(rows);
        };
        allReq.onerror = () => reject(allReq.error);
      };
    });
  });

  expect(idbSnapshot.filter((r) => r.key.startsWith(`user:${accountAId}:`))).toEqual([]);
  expect(idbSnapshot.find((r) => r.key === 'meta:recording_active_account')?.payload).toBe(accountBId);
  expect(idbSnapshot.find((r) => r.key === `user:${accountBId}:draft:active`)).toBeTruthy();
  const bUploads = idbSnapshot.filter((r) => r.key.startsWith(`user:${accountBId}:upload:`));
  expect(bUploads).toHaveLength(1);
  expect((bUploads[0].payload as { gpxXml?: string })?.gpxXml).toContain('<gpx');
  expect(gpxOwnersPosted.filter((id) => id === accountAId)).toEqual([]);

  await tabB.close();
});

test('P2 Round 3: two-tab concurrent claim and preemption never loses or reassigns active account B records', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  const accountAId = '00000000-0000-4000-8000-000000000001';

  const accountBEmail = `phase3_r3_preempt_${Date.now()}@example.com`;
  const accountBPassword = 'SecondRunner-2026!';
  const createRes = await page.request.post('/api/v1/admin/users', {
    headers: { 'x-csrf-token': 'ui-csrf' },
    data: {
      email: accountBEmail,
      username: `runner_r3b_${Date.now().toString().slice(-6)}`,
      display_name: 'Runner R3 Preempt',
      password: accountBPassword,
      timezone: 'Asia/Shanghai',
      is_active: true,
      showcase_enabled: false,
      wellbeing_allowed: false,
    },
  });
  expect(createRes.ok()).toBe(true);
  const createBody = await createRes.json();
  const accountBId = createBody.data.user?.id ?? createBody.data.id;
  expect(typeof accountBId).toBe('string');

  const gpxOwnersPosted: string[] = [];
  await context.route('**/api/v1/gpx-imports', async (route) => {
    const raw = route.request().postData() ?? '';
    const match = raw.match(/name="expected_owner_id"\s+([^\r\n]+)/);
    if (match) gpxOwnersPosted.push(match[1].trim());
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用' },
      }),
    });
  });

  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  // Seed Account A's offline upload item, then delete active marker so both tabs race to claim
  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.232, lon: 121.47, accuracyM: 6, deltaM: 222 });
  });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').delete('meta:recording_active_account');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  const loginBRes = await context.request.post('/api/v1/auth/login', {
    data: { email: accountBEmail, password: accountBPassword },
  });
  expect(loginBRes.ok()).toBe(true);
  await context.setOffline(false);

  const tabB = await context.newPage();
  await installMockLocationRecorder(tabB, { locationPermission: 'granted' });

  // Race Tab A focus verification and Tab B opening/claiming simultaneously
  await Promise.all([
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
    tabB.goto('/workspace/activities/record'),
  ]);
  await expect(tabB.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await expect(page).toHaveURL(/\/workspace\/activities\/record/, { timeout: 10_000 });

  // Tab B records & stops a track while Tab A stays open
  await tabB.getByLabel('跑步标题（可选）').fill('账号 B 抢占保护跑');
  await tabB.getByTestId('recording-start-btn').click();
  await tabB.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.236, lon: 121.47, accuracyM: 6, deltaM: 620 });
  });
  await tabB.getByTestId('recording-stop-btn').click();
  await expect(tabB.getByTestId('upload-queue-item')).toHaveCount(1);

  const idbSnapshot = await tabB.evaluate(async () => {
    return await new Promise<Array<{ key: string; payload: unknown }>>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readonly');
        const allReq = tx.objectStore('records').getAll();
        allReq.onsuccess = () => {
          const rows = (allReq.result as Array<{ key: string; payload: unknown }>).map((r) => ({
            key: r.key,
            payload: r.payload,
          }));
          db.close();
          resolve(rows);
        };
        allReq.onerror = () => reject(allReq.error);
      };
    });
  });

  expect(idbSnapshot.filter((r) => r.key.startsWith(`user:${accountAId}:`))).toEqual([]);
  expect(idbSnapshot.find((r) => r.key === 'meta:recording_active_account')?.payload).toBe(accountBId);
  const bUploads = idbSnapshot.filter((r) => r.key.startsWith(`user:${accountBId}:upload:`));
  expect(bUploads).toHaveLength(1);
  expect((bUploads[0].payload as { gpxXml?: string })?.gpxXml).toContain('<gpx');
  expect(gpxOwnersPosted.filter((id) => id === accountAId)).toEqual([]);

  await tabB.close();
});

test('P2 Round 4: tab A stale cleanup aborts and preserves new A claim/draft/queue when tab B re-logs in as A during verification', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  const accountAId = '00000000-0000-4000-8000-000000000001';

  await context.route('**/api/v1/gpx-imports', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用' },
      }),
    });
  });

  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  // Tab A records & stops (rev 1 stale upload item stays in IndexedDB via 503)
  await page.getByLabel('跑步标题（可选）').fill('账号 A 旧会话跑');
  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.232, lon: 121.47, accuracyM: 6, deltaM: 222 });
  });
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'failed');

  // Intercept Tab A's NEXT /api/v1/auth/session call so it pauses behind a gate and returns expired (user: null);
  // subsequent calls continue to the live server.
  let sessionCallCount = 0;
  let markSessionInFlight!: () => void;
  const sessionInFlightPromise = new Promise<void>((resolve) => {
    markSessionInFlight = resolve;
  });
  let releaseStaleSessionResponse!: () => void;
  const staleSessionGate = new Promise<void>((resolve) => {
    releaseStaleSessionResponse = resolve;
  });

  await page.route('**/api/v1/auth/session', async (route) => {
    sessionCallCount += 1;
    if (sessionCallCount === 1) {
      markSessionInFlight();
      await staleSessionGate;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ data: null, error: { code: 'AUTH_REQUIRED', message: '请重新登录' } }),
      });
      return;
    }
    await route.continue();
  });

  // Start Tab A verification: snapshots A @ rev 1, then pauses on Call #1
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sessionInFlightPromise;

  // Meanwhile, Tab B logs out and re-logs in as Account A, opens /activities/record (claim rev 2),
  // enqueues a new upload item (rev 2), and stores a new active draft (rev 2).
  // Suppress Tab B's routine 'check' broadcast so Tab A's Call #1 actually enters the stale cleanup path.
  await context.request.post('/api/v1/auth/logout', { headers: { 'x-csrf-token': 'ui-csrf' } });
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').delete('meta:recording_active_account');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  const reloginRes = await context.request.post('/api/v1/auth/login', {
    data: { email: 'runner@example.com', password: 'Synthetic-ui-password-2026' },
  });
  expect(reloginRes.ok()).toBe(true);

  const tabB = await context.newPage();
  await tabB.addInitScript(() => {
    const OrigBroadcastChannel = window.BroadcastChannel;
    if (!OrigBroadcastChannel) return;
    window.BroadcastChannel = class extends OrigBroadcastChannel {
      override postMessage(message: unknown) {
        if (this.name === 'runnote-auth' && message === 'check') return;
        super.postMessage(message);
      }
    };
  });
  await installMockLocationRecorder(tabB, { locationPermission: 'granted' });
  await tabB.goto('/activities/record');
  await expect(tabB.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  await tabB.getByLabel('跑步标题（可选）').fill('账号 A 重新登录新跑');
  await tabB.getByTestId('recording-start-btn').click();
  await tabB.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.236, lon: 121.47, accuracyM: 6, deltaM: 580 });
  });
  await tabB.getByTestId('recording-stop-btn').click();
  await expect(tabB.getByTestId('upload-queue-item')).toHaveCount(2);
  await expect(tabB.getByTestId('upload-queue-item').nth(0)).toHaveAttribute('data-status', 'failed');
  await expect(tabB.getByTestId('upload-queue-item').nth(1)).toHaveAttribute('data-status', 'failed');

  // Also save a rev-2 active draft for Account A in Tab B
  await tabB.evaluate(async (aId) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        const activeReq = store.get('meta:recording_active_account');
        activeReq.onsuccess = () => {
          const rev = (activeReq.result as { claimRevision?: number } | undefined)?.claimRevision;
          const now = Date.now();
          store.put({
            key: `user:${aId}:draft:active`,
            accountId: aId,
            schemaVersion: 1,
            savedAt: now,
            claimRevision: rev,
            payload: {
              sessionId: 'sess-a-relogin-new-draft',
              accountId: aId,
              idempotencyKey: 'aaaaaaaa-8888-4888-8888-888888888888',
              title: '账号 A 新登录草稿',
              status: 'paused',
              startedAtMs: now - 30_000,
              endedAtMs: null,
              activeDurationMs: 30_000,
              lastSegmentStartMs: null,
              segmentIndex: 0,
              previewDistanceM: 320,
              lastPointTimeMs: now - 5_000,
              lastAccuracyM: 6,
              interruptedReason: null,
              points: [
                { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 30_000, segmentIndex: 0 },
              ],
            },
          });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, accountAId);

  // Release Tab A's stale expired session response -> Tab A attempts generation-guarded cleanup and MUST abort!
  releaseStaleSessionResponse();

  // Wait for Tab A's retry verification to confirm Account A is still signed in and keep Tab A on /activities/record
  await expect.poll(() => sessionCallCount, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/\/activities\/record$/);

  const idbSnapshot = await tabB.evaluate(async () => {
    return await new Promise<Array<{ key: string; claimRevision?: number; payload: unknown }>>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readonly');
        const allReq = tx.objectStore('records').getAll();
        allReq.onsuccess = () => {
          const rows = (allReq.result as Array<{ key: string; claimRevision?: number; payload: unknown }>).map((r) => ({
            key: r.key,
            claimRevision: r.claimRevision,
            payload: r.payload,
          }));
          db.close();
          resolve(rows);
        };
        allReq.onerror = () => reject(allReq.error);
      };
    });
  });

  const activeRow = idbSnapshot.find((r) => r.key === 'meta:recording_active_account');
  expect(activeRow?.payload).toBe(accountAId);
  expect(activeRow?.claimRevision).toBeGreaterThanOrEqual(2);
  const epochRow = idbSnapshot.find((r) => r.key === 'meta:recording_claim_epoch');
  expect(Number(epochRow?.payload)).toBeGreaterThanOrEqual(2);

  const draftRow = idbSnapshot.find((r) => r.key === `user:${accountAId}:draft:active`);
  expect((draftRow?.payload as { sessionId?: string })?.sessionId).toBe('sess-a-relogin-new-draft');

  const aUploads = idbSnapshot.filter((r) => r.key.startsWith(`user:${accountAId}:upload:`));
  expect(aUploads).toHaveLength(1);
  expect((aUploads[0].payload as { title?: string })?.title).toBe('账号 A 重新登录新跑');

  await tabB.close();
});

test('P2 Round 4: two-tab concurrent same-account re-login and re-claim advances monotonic epoch without losing new records', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  const accountAId = '00000000-0000-4000-8000-000000000001';

  await context.route('**/api/v1/gpx-imports', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用' },
      }),
    });
  });

  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');

  // Claim rev 1 and record an item in Tab A
  await page.getByLabel('跑步标题（可选）').fill('账号 A 初始跑');
  await page.getByTestId('recording-start-btn').click();
  await page.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.232, lon: 121.47, accuracyM: 6, deltaM: 222 });
  });
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);

  // Clear active marker (keeping meta:recording_claim_epoch) and re-login in context
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').delete('meta:recording_active_account');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  const reloginRes = await context.request.post('/api/v1/auth/login', {
    data: { email: 'runner@example.com', password: 'Synthetic-ui-password-2026' },
  });
  expect(reloginRes.ok()).toBe(true);

  const tabB = await context.newPage();
  await installMockLocationRecorder(tabB, { locationPermission: 'granted' });

  await Promise.all([page.evaluate(() => window.dispatchEvent(new Event('focus'))), tabB.goto('/activities/record')]);
  await expect(tabB.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  await tabB.getByLabel('跑步标题（可选）').fill('账号 A 并发重认领新跑');
  await tabB.getByTestId('recording-start-btn').click();
  await tabB.evaluate(() => {
    const rec = (window as unknown as Record<string, { pushPoint: (p: unknown) => void }>).__mockRecorder;
    rec.pushPoint({ lat: 31.23, lon: 121.47, accuracyM: 6, deltaM: 0 });
    rec.pushPoint({ lat: 31.235, lon: 121.47, accuracyM: 6, deltaM: 490 });
  });
  await tabB.getByTestId('recording-stop-btn').click();
  await expect(tabB.getByTestId('upload-queue-item')).toHaveCount(2);
  await expect(tabB.getByTestId('upload-queue-item').nth(0)).toHaveAttribute('data-status', 'failed');
  await expect(tabB.getByTestId('upload-queue-item').nth(1)).toHaveAttribute('data-status', 'failed');

  const idbSnapshot = await tabB.evaluate(async () => {
    return await new Promise<Array<{ key: string; claimRevision?: number; payload: unknown }>>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readonly');
        const allReq = tx.objectStore('records').getAll();
        allReq.onsuccess = () => {
          const rows = (allReq.result as Array<{ key: string; claimRevision?: number; payload: unknown }>).map((r) => ({
            key: r.key,
            claimRevision: r.claimRevision,
            payload: r.payload,
          }));
          db.close();
          resolve(rows);
        };
        allReq.onerror = () => reject(allReq.error);
      };
    });
  });

  const activeRow = idbSnapshot.find((r) => r.key === 'meta:recording_active_account');
  expect(activeRow?.payload).toBe(accountAId);
  expect(activeRow?.claimRevision).toBeGreaterThanOrEqual(2);
  const epochRow = idbSnapshot.find((r) => r.key === 'meta:recording_claim_epoch');
  expect(Number(epochRow?.payload)).toBeGreaterThanOrEqual(2);
  const titles = idbSnapshot
    .filter((r) => r.key.startsWith(`user:${accountAId}:upload:`))
    .map((r) => (r.payload as { title?: string })?.title);
  expect(titles).toContain('账号 A 并发重认领新跑');

  await tabB.close();
});

async function installMockWebGeolocation(page: Page) {
  await page.addInitScript(() => {
    let nextWatchId = 1;
    let activeWatchId: number | null = null;
    let onSuccess: PositionCallback | null = null;
    let clearWatchCount = 0;
    let fixSeq = 0;
    const baseMs = Date.now();

    const geoMock = {
      watchPosition(success: PositionCallback) {
        const id = nextWatchId++;
        activeWatchId = id;
        onSuccess = success;
        return id;
      },
      clearWatch(id: number) {
        if (activeWatchId === id) {
          activeWatchId = null;
          onSuccess = null;
        }
        clearWatchCount += 1;
      },
      getCurrentPosition(success: PositionCallback) {
        success({
          coords: {
            latitude: 31.23,
            longitude: 121.47,
            accuracy: 6,
            altitude: 12,
            altitudeAccuracy: 5,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: baseMs,
          toJSON: () => ({}),
        } as GeolocationPosition);
      },
    };

    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geoMock,
    });

    const win = window as unknown as Record<string, unknown>;
    win.__geo = {
      emit(lat: number, lon: number, accuracy = 6) {
        if (!onSuccess) return false;
        fixSeq += 1;
        onSuccess({
          coords: {
            latitude: lat,
            longitude: lon,
            accuracy,
            altitude: 12,
            altitudeAccuracy: 5,
            heading: null,
            speed: 3.1,
            toJSON: () => ({}),
          },
          timestamp: baseMs + fixSeq * 60_000,
          toJSON: () => ({}),
        } as GeolocationPosition);
        return true;
      },
      getClearWatchCount: () => clearWatchCount,
      isWatching: () => activeWatchId !== null && onSuccess !== null,
    };
  });
}

test('P2 Round 5: late GPS write and stale delete from old tab epoch 1 cannot overwrite or delete epoch 2 draft', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  const accountAId = '00000000-0000-4000-8000-000000000001';

  await installMockWebGeolocation(page);
  await page.goto('/activities/record');

  // Tab 1 starts Web recording under epoch 1 and records 2 GPS points
  await page.getByLabel('跑步标题（可选）').fill('Tab1 旧代草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching()),
    )
    .toBe(true);
  await page.evaluate(() => {
    const geo = (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo;
    geo.emit(31.23, 121.47);
    geo.emit(31.232, 121.47);
  });
  await expect(page.getByTestId('recording-points-count')).toContainText('2 点');

  const readDraftRow = async (targetPage: Page) =>
    await targetPage.evaluate(async (aId) => {
      return await new Promise<{
        activeClaimRev?: number;
        claimEpoch?: number;
        draftClaimRev?: number;
        title?: string;
        sessionId?: string;
        pointCount?: number;
      }>((resolve, reject) => {
        const req = indexedDB.open('runnote-recording-store', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('records', 'readonly');
          const store = tx.objectStore('records');
          const rActive = store.get('meta:recording_active_account');
          const rEpoch = store.get('meta:recording_claim_epoch');
          const rDraft = store.get(`user:${aId}:draft:active`);
          tx.oncomplete = () => {
            const active = rActive.result as { claimRevision?: number } | undefined;
            const epoch = rEpoch.result as { payload?: number } | undefined;
            const draft = rDraft.result as
              | { claimRevision?: number; payload?: { title?: string; sessionId?: string; points?: unknown[] } }
              | undefined;
            db.close();
            resolve({
              activeClaimRev: active?.claimRevision,
              claimEpoch: typeof epoch?.payload === 'number' ? epoch.payload : undefined,
              draftClaimRev: draft?.claimRevision,
              title: draft?.payload?.title,
              sessionId: draft?.payload?.sessionId,
              pointCount: Array.isArray(draft?.payload?.points) ? draft.payload.points.length : undefined,
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, accountAId);

  const tab1Snap = await readDraftRow(page);
  expect(tab1Snap.title).toBe('Tab1 旧代草稿');
  expect(tab1Snap.pointCount).toBe(2);
  expect(typeof tab1Snap.activeClaimRev).toBe('number');

  // Re-login as Account A and open Tab 2 -> claims epoch 2 (> epoch 1) and writes new draft
  await context.request.post('/api/v1/auth/logout', { headers: { 'x-csrf-token': 'ui-csrf' } });
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').delete('meta:recording_active_account');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  const reloginRes = await context.request.post('/api/v1/auth/login', {
    data: { email: 'runner@example.com', password: 'Synthetic-ui-password-2026' },
  });
  expect(reloginRes.ok()).toBe(true);

  const tab2 = await context.newPage();
  await installMockWebGeolocation(tab2);
  await tab2.goto('/activities/record');
  await expect(tab2.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  // Tab 2 sees Tab 1's recovered draft and explicitly discards it before starting a new epoch-2 session
  await expect(tab2.getByTestId('recording-recovery-panel')).toBeVisible();
  await tab2.getByTestId('recovery-discard-btn').click();
  await tab2.getByTestId('recording-discard-confirm-btn').click();
  await expect(tab2.getByTestId('recording-recovery-panel')).not.toBeVisible();

  await tab2.getByLabel('跑步标题（可选）').fill('Tab2 新代草稿');
  await tab2.getByTestId('recording-start-btn').click();
  await expect(tab2.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect
    .poll(() =>
      tab2.evaluate(() => (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching()),
    )
    .toBe(true);
  await tab2.evaluate(() => {
    const geo = (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo;
    geo.emit(31.24, 121.48);
    geo.emit(31.242, 121.48);
  });
  await expect(tab2.getByTestId('recording-points-count')).toContainText('2 点');

  const tab2Snap = await readDraftRow(tab2);
  expect(tab2Snap.title).toBe('Tab2 新代草稿');
  expect(tab2Snap.activeClaimRev).toBeGreaterThan(tab1Snap.activeClaimRev!);
  expect(tab2Snap.draftClaimRev).toBe(tab2Snap.activeClaimRev);

  // Fire a late GPS callback on old Tab 1 -> must reject STORAGE_CLAIM_STALE, stop watch, and NOT overwrite Tab 2's draft
  await page.evaluate(() => {
    const geo = (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo;
    geo.emit(31.235, 121.47);
  });
  await expect(page.getByTestId('recording-error')).toContainText('接管');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching()),
    )
    .toBe(false);

  const afterLateWrite = await readDraftRow(tab2);
  expect(afterLateWrite.title).toBe('Tab2 新代草稿');
  expect(afterLateWrite.sessionId).toBe(tab2Snap.sessionId);
  expect(afterLateWrite.draftClaimRev).toBe(tab2Snap.activeClaimRev);
  expect(afterLateWrite.pointCount).toBe(2);

  // Stale discard/delete from old Tab 1 must NOT delete Tab 2's new draft
  await page.getByTestId('recovery-discard-btn').click();
  await page.getByTestId('recording-discard-confirm-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  await expect(page.getByTestId('recording-error')).toContainText('接管');

  const afterStaleDelete = await readDraftRow(tab2);
  expect(afterStaleDelete.title).toBe('Tab2 新代草稿');
  expect(afterStaleDelete.sessionId).toBe(tab2Snap.sessionId);
  expect(afterStaleDelete.draftClaimRev).toBe(tab2Snap.activeClaimRev);

  // Legitimate write within current claim (Tab 2 emits a 3rd GPS fix) still succeeds cleanly
  await tab2.evaluate(() => {
    const geo = (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo;
    geo.emit(31.244, 121.48);
  });
  await expect(tab2.getByTestId('recording-points-count')).toContainText('3 点');
  const afterTab2ThirdPoint = await readDraftRow(tab2);
  expect(afterTab2ThirdPoint.title).toBe('Tab2 新代草稿');
  expect(afterTab2ThirdPoint.pointCount).toBe(3);
  expect(afterTab2ThirdPoint.draftClaimRev).toBe(tab2Snap.activeClaimRev);

  // While Tab 2 (live owner) still holds an undiscarded paused draft, Tab 1 starting a new run must neither
  // overwrite it nor take it over: it fails closed into the recovery-error state without exposing resume.
  await tab2.getByTestId('recording-pause-btn').click();
  await page.getByLabel('跑步标题（可选）').fill('Tab1 误覆盖尝试');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-error')).toContainText('草稿');
  await expect(page.getByTestId('recording-recovery-error-panel')).toContainText('其他标签页');
  await expect(page.getByTestId('recording-recovery-panel')).not.toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  const preservedWhilePaused = await readDraftRow(tab2);
  expect(preservedWhilePaused.title).toBe('Tab2 新代草稿');
  expect(preservedWhilePaused.pointCount).toBe(3);

  // Explicitly discard Tab 2's paused draft, then Tab 1 retries recovery and its start succeeds cleanly
  await tab2.getByTestId('recording-discard-btn').click();
  await tab2.getByTestId('recording-discard-confirm-btn').click();
  await expect(tab2.getByTestId('recording-status-badge')).toHaveText('就绪');
  await page.getByTestId('recording-recovery-retry-btn').click();
  await expect(page.getByTestId('recording-recovery-error-panel')).not.toBeVisible();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');

  await page.getByLabel('跑步标题（可选）').fill('Tab1 重试新草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching()),
    )
    .toBe(true);
  await page.evaluate(() => {
    const geo = (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo;
    geo.emit(31.25, 121.49);
  });
  await expect(page.getByTestId('recording-points-count')).toContainText('1 点');

  const afterRetry = await readDraftRow(page);
  expect(afterRetry.title).toBe('Tab1 重试新草稿');
  expect(afterRetry.draftClaimRev).toBe(afterRetry.activeClaimRev);
  expect(afterRetry.draftClaimRev).toBeGreaterThanOrEqual(tab2Snap.activeClaimRev!);

  await tab2.close();
});

test('P1: blocks Start until delayed native getSessionState (4s) finishes and restores existing recording session', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialRecording: true,
    getSessionStateDelayMs: 4_000,
  });

  await page.goto('/activities/record');

  // During the 4s native recovery delay, permissions are already granted, yet Start MUST stay disabled.
  await expect(page.getByTestId('recording-status-badge')).toHaveText('正在恢复…');
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  await expect(page.getByTestId('recording-start-btn')).toContainText('正在恢复会话');

  // Even a forced DOM click attempt during pending recovery must NOT invoke native startSession.
  await page.getByTestId('recording-start-btn').dispatchEvent('click');
  const callsWhilePending = await page.evaluate(() =>
    (window as unknown as Record<string, { getStartSessionCalls: () => number }>).__mockRecorder.getStartSessionCalls(),
  );
  expect(callsWhilePending).toBe(0);

  // Once the 4s delayed getSessionState resolves, existing recording session (3 points) is restored untouched.
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中', { timeout: 8_000 });
  await expect(page.getByTestId('recording-points-count')).toContainText('3 点');
  await expect(page.getByTestId('recording-start-btn')).toHaveCount(0);

  const callsAfterRestore = await page.evaluate(() => {
    const rec = (
      window as unknown as Record<
        string,
        {
          getStartSessionCalls: () => number;
          getSession: () => { sessionId: string; status: string } | null;
          getPointCount: () => number;
        }
      >
    ).__mockRecorder;
    return {
      calls: rec.getStartSessionCalls(),
      session: rec.getSession(),
      points: rec.getPointCount(),
    };
  });
  expect(callsAfterRestore.calls).toBe(0);
  expect(callsAfterRestore.session?.sessionId).toBe('recording-sess-1');
  expect(callsAfterRestore.session?.status).toBe('recording');
  expect(callsAfterRestore.points).toBe(3);
});

test('P1 (mock bridge contract): native startSession rejects while paused/interrupted session exists and concurrent calls create at most one session', async ({
  page,
}) => {
  // Note: this browser test verifies the Playwright mock LocationRecorder bridge contract & UI state;
  // real native synchronized(store.lock) coordinator enforcement is covered in JVM LocationRecordingPolicyTest.java,
  // while real Android Capacitor plugin/ForegroundService execution remains a pre-release real-device gate.
  await loginRunner(page);

  // 1. Preset paused same-account session -> direct startSession rejected, 3 points preserved
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialPaused: true });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
  await expect(page.getByTestId('recording-points-count')).toContainText('3 点');

  const pausedAttempt = await page.evaluate(async () => {
    const win = window as unknown as {
      Capacitor: { Plugins: { LocationRecorder: { startSession: (o: Record<string, unknown>) => Promise<unknown> } } };
      __mockRecorder: {
        getSession: () => { sessionId: string; status: string } | null;
        getPointCount: () => number;
        getStartSessionRejectedCount: () => number;
      };
    };
    let rejectedMsg = '';
    try {
      await win.Capacitor.Plugins.LocationRecorder.startSession({
        sessionId: 'overwrite-paused',
        accountId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: '覆盖尝试',
        resumeInterrupted: false,
      });
    } catch (err) {
      rejectedMsg = err instanceof Error ? err.message : String(err);
    }
    return {
      rejectedMsg,
      session: win.__mockRecorder.getSession(),
      points: win.__mockRecorder.getPointCount(),
      rejectedCount: win.__mockRecorder.getStartSessionRejectedCount(),
    };
  });
  expect(pausedAttempt.rejectedMsg).toContain('未保存或丢弃');
  expect(pausedAttempt.session?.sessionId).toBe('paused-sess-1');
  expect(pausedAttempt.points).toBe(3);
  expect(pausedAttempt.rejectedCount).toBe(1);

  // 2. Preset interrupted same-account session -> direct startSession rejected, 3 points preserved
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialInterrupted: true });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('待恢复');
  await expect(page.getByTestId('recording-points-count')).toContainText('3 点');

  const interruptedAttempt = await page.evaluate(async () => {
    const win = window as unknown as {
      Capacitor: { Plugins: { LocationRecorder: { startSession: (o: Record<string, unknown>) => Promise<unknown> } } };
      __mockRecorder: {
        getSession: () => { sessionId: string; status: string } | null;
        getPointCount: () => number;
      };
    };
    let rejectedMsg = '';
    try {
      await win.Capacitor.Plugins.LocationRecorder.startSession({
        sessionId: 'overwrite-interrupted',
        accountId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: '覆盖中断会话',
        resumeInterrupted: false,
      });
    } catch (err) {
      rejectedMsg = err instanceof Error ? err.message : String(err);
    }
    return {
      rejectedMsg,
      session: win.__mockRecorder.getSession(),
      points: win.__mockRecorder.getPointCount(),
    };
  });
  expect(interruptedAttempt.rejectedMsg).toContain('未保存或丢弃');
  expect(interruptedAttempt.session?.sessionId).toBe('interrupted-sess-1');
  expect(interruptedAttempt.points).toBe(3);

  // 3. Concurrent/repeated startSession calls from idle -> at most 1 session created
  await installMockLocationRecorder(page, { locationPermission: 'granted' });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();

  const concurrentOutcome = await page.evaluate(async () => {
    const win = window as unknown as {
      Capacitor: { Plugins: { LocationRecorder: { startSession: (o: Record<string, unknown>) => Promise<unknown> } } };
      __mockRecorder: {
        getSession: () => { sessionId: string; status: string } | null;
        getPointCount: () => number;
        pushPoint: (pt: { lat: number; lon: number }) => void;
      };
    };
    const api = win.Capacitor.Plugins.LocationRecorder;
    const settled = await Promise.allSettled([
      api.startSession({
        sessionId: 'race-1',
        accountId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        title: '竞态1',
        resumeInterrupted: false,
      }),
      api.startSession({
        sessionId: 'race-2',
        accountId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        title: '竞态2',
        resumeInterrupted: false,
      }),
      api.startSession({
        sessionId: 'race-3',
        accountId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
        title: '竞态3',
        resumeInterrupted: false,
      }),
    ]);
    win.__mockRecorder.pushPoint({ lat: 31.23, lon: 121.47 });
    const postPointRetry = await Promise.allSettled([
      api.startSession({
        sessionId: 'race-4',
        accountId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
        title: '重复覆盖',
        resumeInterrupted: false,
      }),
    ]);
    return {
      fulfilledCount: settled.filter((r) => r.status === 'fulfilled').length,
      rejectedCount: settled.filter((r) => r.status === 'rejected').length,
      postPointRetryRejected: postPointRetry[0].status === 'rejected',
      session: win.__mockRecorder.getSession(),
      points: win.__mockRecorder.getPointCount(),
    };
  });
  expect(concurrentOutcome.fulfilledCount).toBe(1);
  expect(concurrentOutcome.rejectedCount).toBe(2);
  expect(concurrentOutcome.postPointRetryRejected).toBe(true);
  expect(concurrentOutcome.session?.sessionId).toBe('race-1');
  expect(concurrentOutcome.points).toBe(1);
});

test('P1: recovery failure, empty payload, or no-response timeout keeps Start disabled in safe state until retry succeeds', async ({
  page,
}) => {
  await loginRunner(page);

  // 1. Recovery rejects -> safe disabled state + recovery error panel, no startSession call
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    getSessionStateBehavior: 'reject',
  });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('恢复失败');
  await expect(page.getByTestId('recording-recovery-error-panel')).toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  await expect(page.getByTestId('recording-start-btn')).toContainText('会话状态未就绪');

  // Switch mock back to healthy idle state and click retry -> recovers cleanly and Start works normally
  await page.evaluate(() => {
    (
      window as unknown as Record<string, { setGetSessionStateBehavior: (b: 'resolve') => void }>
    ).__mockRecorder.setGetSessionStateBehavior('resolve');
  });
  await page.getByTestId('recording-recovery-retry-btn').click();
  await expect(page.getByTestId('recording-recovery-error-panel')).not.toBeVisible();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');

  // 2. Empty (null) payload from getSessionState -> safe disabled state, never misclassified as idle
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    getSessionStateBehavior: 'null',
  });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('恢复失败');
  await expect(page.getByTestId('recording-recovery-error-panel')).toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();

  // 3. No-response hang -> times out deterministically to safe failed state, 0 startSession calls
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    getSessionStateBehavior: 'hang',
  });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('正在恢复…');
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('恢复失败', { timeout: 12_000 });
  await expect(page.getByTestId('recording-recovery-error-panel')).toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  const hangStartCalls = await page.evaluate(() =>
    (window as unknown as Record<string, { getStartSessionCalls: () => number }>).__mockRecorder.getStartSessionCalls(),
  );
  expect(hangStartCalls).toBe(0);
});

test('P2 Web: transient IndexedDB get failure keeps Start disabled, preserves old draft, and retry recovers cleanly', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);

  await page.addInitScript(() => {
    const origGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      if (
        typeof key === 'string' &&
        key === 'user:00000000-0000-4000-8000-000000000001:draft:active' &&
        window.sessionStorage.getItem('__web_get_fail_armed') === '1'
      ) {
        window.sessionStorage.removeItem('__web_get_fail_armed');
        const fakeReq = new EventTarget() as IDBRequest;
        Object.defineProperty(fakeReq, 'error', {
          value: new DOMException('Simulated transient IndexedDB get failure', 'UnknownError'),
        });
        Object.defineProperty(fakeReq, 'result', { value: undefined });
        setTimeout(() => {
          fakeReq.dispatchEvent(new Event('error'));
        }, 0);
        return fakeReq;
      }
      return origGet.call(this, key);
    };
  });

  const readDraftRow = async (targetPage: Page) =>
    targetPage.evaluate(async () => {
      return await new Promise<{ title?: string; sessionId?: string; pointCount?: number } | null>(
        (resolve, reject) => {
          const req = indexedDB.open('runnote-recording-store', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('records', 'readonly');
            const rowReq = tx.objectStore('records').get('user:00000000-0000-4000-8000-000000000001:draft:active');
            rowReq.onsuccess = () => {
              const payload = (
                rowReq.result as { payload?: { title?: string; sessionId?: string; points?: unknown[] } }
              )?.payload;
              db.close();
              resolve(
                payload
                  ? { title: payload.title, sessionId: payload.sessionId, pointCount: payload.points?.length ?? 0 }
                  : null,
              );
            };
            rowReq.onerror = () => reject(rowReq.error);
          };
        },
      );
    });

  // 1. Web start and save 1 synthetic GPS point
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  await page.getByLabel('跑步标题（可选）').fill('旧未保存草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching()),
    )
    .toBe(true);
  await page.evaluate(() => {
    (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo.emit(31.23, 121.47);
  });
  await expect(page.getByTestId('recording-points-count')).toContainText('1 点');
  const savedBeforeReload = await readDraftRow(page);
  expect(savedBeforeReload?.title).toBe('旧未保存草稿');
  expect(savedBeforeReload?.pointCount).toBe(1);

  // 2. Refresh while arming a transient one-shot IndexedDB get error on active draft
  await page.evaluate(() => window.sessionStorage.setItem('__web_get_fail_armed', '1'));
  await page.reload();

  // Recovery failed -> Start MUST stay disabled and old draft + point MUST remain intact in IndexedDB
  await expect(page.getByTestId('recording-status-badge')).toHaveText('恢复失败');
  await expect(page.getByTestId('recording-recovery-error-panel')).toBeVisible();
  await expect(page.getByTestId('recording-recovery-error-panel')).toContainText('本地草稿状态');
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();

  const preservedWhileFailed = await readDraftRow(page);
  expect(preservedWhileFailed?.title).toBe('旧未保存草稿');
  expect(preservedWhileFailed?.sessionId).toBe(savedBeforeReload?.sessionId);
  expect(preservedWhileFailed?.pointCount).toBe(1);

  // 3. Click retry recovery -> recovers old interrupted draft cleanly
  await page.getByTestId('recording-recovery-retry-btn').click();
  await expect(page.getByTestId('recording-recovery-error-panel')).not.toBeVisible();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('待恢复');
  await expect(page.getByTestId('recording-recovery-panel')).toBeVisible();
  await expect(page.getByTestId('recording-points-count')).toContainText('1 点');
  await expect(page.getByLabel('跑步标题（可选）')).toHaveValue('旧未保存草稿');

  // 4. Discard recovered draft -> Start becomes enabled and can start a new session cleanly
  await page.getByTestId('recovery-discard-btn').click();
  await page.getByTestId('recording-discard-confirm-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();

  await page.getByLabel('跑步标题（可选）').fill('恢复丢弃后新跑步');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
});

test('P2 Web: enqueue failure during recovery blocks Start and preserves draft; concurrent new-start interleave never overwrites', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);

  await page.addInitScript(() => {
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: { key?: string }, key?: IDBValidKey) {
      if (
        typeof value?.key === 'string' &&
        value.key.startsWith('user:00000000-0000-4000-8000-000000000001:upload:') &&
        window.sessionStorage.getItem('__web_enqueue_fail') === '1'
      ) {
        const fakeReq = new EventTarget() as IDBRequest;
        Object.defineProperty(fakeReq, 'error', {
          value: new DOMException('Simulated upload enqueue failure', 'QuotaExceededError'),
        });
        setTimeout(() => {
          fakeReq.dispatchEvent(new Event('error'));
        }, 0);
        return fakeReq;
      }
      return key !== undefined ? origPut.call(this, value, key) : origPut.call(this, value);
    };
  });

  // Subcase A: Stopped Web draft present + enqueue failure on mount -> Start disabled, draft preserved until retry succeeds
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        const now = Date.now();
        tx.objectStore('records').put({
          key: 'user:00000000-0000-4000-8000-000000000001:draft:active',
          accountId: '00000000-0000-4000-8000-000000000001',
          schemaVersion: 1,
          savedAt: now,
          claimRevision: 1,
          payload: {
            sessionId: 'sess-stopped-web-recovery',
            accountId: '00000000-0000-4000-8000-000000000001',
            idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            title: 'Web 已结束待入队草稿',
            status: 'stopped',
            startedAtMs: now - 120_000,
            endedAtMs: now - 10_000,
            activeDurationMs: 110_000,
            lastSegmentStartMs: null,
            segmentIndex: 0,
            previewDistanceM: 320,
            lastPointTimeMs: now - 10_000,
            lastAccuracyM: 6,
            interruptedReason: null,
            points: [
              { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 120_000, segmentIndex: 0 },
              { lat: 31.232, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 60_000, segmentIndex: 0 },
            ],
          },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    window.sessionStorage.setItem('__web_enqueue_fail', '1');
  });

  await page.reload();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('恢复失败');
  await expect(page.getByTestId('recording-recovery-error-panel')).toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);

  // Stopped draft stays intact in IndexedDB while enqueue failed
  const draftDuringEnqueueFail = await page.evaluate(async () => {
    return await new Promise<string | null>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const rowReq = db
          .transaction('records', 'readonly')
          .objectStore('records')
          .get('user:00000000-0000-4000-8000-000000000001:draft:active');
        rowReq.onsuccess = () => {
          const id = (rowReq.result as { payload?: { sessionId?: string } })?.payload?.sessionId ?? null;
          db.close();
          resolve(id);
        };
        rowReq.onerror = () => reject(rowReq.error);
      };
    });
  });
  expect(draftDuringEnqueueFail).toBe('sess-stopped-web-recovery');

  // Clear failure and retry recovery -> enqueues stopped draft, clears active draft, enables Start
  await page.evaluate(() => window.sessionStorage.removeItem('__web_enqueue_fail'));
  await page.getByTestId('recording-recovery-retry-btn').click();
  await expect(page.getByTestId('recording-recovery-error-panel')).not.toBeVisible();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('Web 已结束待入队草稿');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();

  // Subcase B: Concurrent new-start interleave between two tabs never overwrites an active draft
  const tab2 = await context.newPage();
  await installMockWebGeolocation(tab2);
  await tab2.goto('/activities/record');
  await expect(tab2.getByTestId('recording-status-badge')).toHaveText('就绪');

  // Tab 2 starts and records 1 GPS point while Tab 1 still sees idle
  await tab2.getByLabel('跑步标题（可选）').fill('Tab2 已写入草稿');
  await tab2.getByTestId('recording-start-btn').click();
  await expect(tab2.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect
    .poll(() =>
      tab2.evaluate(() => (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching()),
    )
    .toBe(true);
  await tab2.evaluate(() => {
    (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo.emit(31.24, 121.48);
  });
  await expect(tab2.getByTestId('recording-points-count')).toContainText('1 点');

  // Now stale Tab 1 tries to start a brand-new run -> MUST NOT overwrite or take over Tab 2's live draft
  await page.getByLabel('跑步标题（可选）').fill('Tab1 误覆盖标题');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-error')).toContainText('其他标签页');
  await expect(page.getByTestId('recording-recovery-error-panel')).toBeVisible();
  await expect(page.getByTestId('recording-recovery-panel')).not.toBeVisible();
  await expect(page.getByTestId('recording-start-btn')).toBeDisabled();
  await expect(tab2.getByTestId('recording-status-badge')).toHaveText('记录中');

  const tab2DraftAfterInterleave = await tab2.evaluate(async () => {
    return await new Promise<{ title?: string; pointCount?: number } | null>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const rowReq = db
          .transaction('records', 'readonly')
          .objectStore('records')
          .get('user:00000000-0000-4000-8000-000000000001:draft:active');
        rowReq.onsuccess = () => {
          const payload = (rowReq.result as { payload?: { title?: string; points?: unknown[] } })?.payload;
          db.close();
          resolve(payload ? { title: payload.title, pointCount: payload.points?.length ?? 0 } : null);
        };
        rowReq.onerror = () => reject(rowReq.error);
      };
    });
  });
  expect(tab2DraftAfterInterleave?.title).toBe('Tab2 已写入草稿');
  expect(tab2DraftAfterInterleave?.pointCount).toBe(1);

  // Once Tab 2 closes, its Web Lock is freed and Tab 1 can take over the exact persisted snapshot
  await tab2.close();
  await page.getByTestId('recording-recovery-retry-btn').click();
  await expect(page.getByTestId('recording-recovery-panel')).toBeVisible();
  await expect(page.getByTestId('recording-points-count')).toContainText('1 点');
});

const WEB_DRAFT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

async function readWebDraftRow(targetPage: Page) {
  return await targetPage.evaluate(async (aId) => {
    return await new Promise<{
      exists: boolean;
      sessionId?: string;
      pointCount?: number;
      ownerId?: string;
      ownerGeneration?: number;
      draftRevision?: number;
    }>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const rowReq = db.transaction('records', 'readonly').objectStore('records').get(`user:${aId}:draft:active`);
        rowReq.onsuccess = () => {
          const row = rowReq.result as
            | {
                ownerId?: string;
                ownerGeneration?: number;
                draftRevision?: number;
                payload?: { sessionId?: string; points?: unknown[] };
              }
            | undefined;
          db.close();
          resolve(
            row
              ? {
                  exists: true,
                  sessionId: row.payload?.sessionId,
                  pointCount: Array.isArray(row.payload?.points) ? row.payload.points.length : undefined,
                  ownerId: row.ownerId,
                  ownerGeneration: row.ownerGeneration,
                  draftRevision: row.draftRevision,
                }
              : { exists: false },
          );
        };
        rowReq.onerror = () => reject(rowReq.error);
      };
    });
  }, WEB_DRAFT_ACCOUNT_ID);
}

async function emitWebFix(targetPage: Page, lat: number, lon: number) {
  return await targetPage.evaluate(
    ([la, lo]) =>
      (window as unknown as Record<string, { emit: (lat: number, lon: number) => boolean }>).__geo.emit(la, lo),
    [lat, lon] as const,
  );
}

async function waitForWebWatch(targetPage: Page) {
  await expect
    .poll(() =>
      targetPage.evaluate(() =>
        (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching(),
      ),
    )
    .toBe(true);
}

test('P1 Round 9: a second tab can never take over a live Web session or truncate its persisted points', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await page.goto('/activities/record');

  // Tab A records point 1
  await page.getByLabel('跑步标题（可选）').fill('A 实时草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect(page.getByTestId('recording-points-count')).toContainText('1 点');
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);

  // Tab B opens while A is live: no recovery snapshot, no resume/save/discard, Start blocked
  const tabB = await context.newPage();
  await installMockWebGeolocation(tabB);
  await tabB.goto('/activities/record');
  await expect(tabB.getByTestId('recording-recovery-error-panel')).toContainText('其他标签页');
  await expect(tabB.getByTestId('recording-recovery-panel')).toHaveCount(0);
  await expect(tabB.getByTestId('recovery-resume-btn')).toHaveCount(0);
  await expect(tabB.getByTestId('recording-start-btn')).toBeDisabled();
  const ownedByA = await readWebDraftRow(page);
  expect(ownedByA.pointCount).toBe(1);
  expect(ownedByA.ownerId).toBeTruthy();

  // A records point 2 (IDB has 2); B retries -> still refused, persisted draft keeps 2 points
  await emitWebFix(page, 31.232, 121.47);
  await expect(page.getByTestId('recording-points-count')).toContainText('2 点');
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(2);
  await tabB.getByTestId('recording-recovery-retry-btn').click();
  await expect(tabB.getByTestId('recording-recovery-error-panel')).toContainText('其他标签页');
  await expect(tabB.getByTestId('recovery-resume-btn')).toHaveCount(0);
  const afterRefusedRetry = await readWebDraftRow(page);
  expect(afterRefusedRetry.pointCount).toBe(2);
  expect(afterRefusedRetry.ownerId).toBe(ownedByA.ownerId);
  expect(afterRefusedRetry.ownerGeneration).toBe(ownedByA.ownerGeneration);

  // A keeps recording untouched by B's attempts
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await emitWebFix(page, 31.234, 121.47);
  await expect(page.getByTestId('recording-points-count')).toContainText('3 点');
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(3);
  await expect(page.getByTestId('recording-error')).toHaveCount(0);

  // A's tab closes (Web Lock released) -> B takes over the exact latest snapshot (3 points)
  await page.close();
  await tabB.getByTestId('recording-recovery-retry-btn').click();
  await expect(tabB.getByTestId('recording-recovery-panel')).toBeVisible();
  await expect(tabB.getByTestId('recording-points-count')).toContainText('3 点');
  const ownedByB = await readWebDraftRow(tabB);
  expect(ownedByB.pointCount).toBe(3);
  expect(ownedByB.ownerId).not.toBe(ownedByA.ownerId);
  expect(ownedByB.ownerGeneration).toBe((ownedByA.ownerGeneration ?? 0) + 1);

  // B continues: the persisted draft is never reduced, and new points append
  await tabB.getByTestId('recovery-resume-btn').click();
  await expect(tabB.getByTestId('recording-status-badge')).toHaveText('记录中');
  expect((await readWebDraftRow(tabB)).pointCount).toBe(3);
  await waitForWebWatch(tabB);
  // Tab B's mock clock starts slightly later than A's, so its first fixes may predate A's last point and
  // be filtered as out-of-order; emit a few so at least one lands after the recovered track.
  for (const lat of [31.236, 31.238, 31.24, 31.242]) {
    await emitWebFix(tabB, lat, 121.47);
  }
  await expect.poll(async () => (await readWebDraftRow(tabB)).pointCount ?? 0).toBeGreaterThan(3);
  const finalRow = await readWebDraftRow(tabB);
  await expect(tabB.getByTestId('recording-points-count')).toContainText(`${finalRow.pointCount} 点`);
  expect(finalRow.ownerId).toBe(ownedByB.ownerId);
});

test('P2 Round 9: a Web draft discarded elsewhere is never recreated or enqueued by the stale tab', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await page.goto('/activities/record');

  await page.getByLabel('跑步标题（可选）').fill('被丢弃的草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);

  // Another tab discards the draft row (simulated directly against IndexedDB)
  await page.evaluate(async (aId) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').delete(`user:${aId}:draft:active`);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, WEB_DRAFT_ACCOUNT_ID);

  // Delayed GPS write from this tab is refused instead of recreating the row
  await emitWebFix(page, 31.232, 121.47);
  await expect(page.getByTestId('recording-error')).toContainText('保存或丢弃');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('待恢复');
  expect((await readWebDraftRow(page)).exists).toBe(false);

  // Resume and save are refused too; nothing is recreated or enqueued
  await page.getByTestId('recovery-resume-btn').click();
  await expect(page.getByTestId('recording-error')).toContainText('接管');
  await page.getByTestId('recovery-save-btn').click();
  await expect(page.getByTestId('recording-error')).toContainText('接管');
  expect((await readWebDraftRow(page)).exists).toBe(false);
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
});

async function readRecordingStoreSummary(targetPage: Page) {
  return await targetPage.evaluate(async (aId) => {
    return await new Promise<{
      uploadKeys: string[];
      activeMarker: { payload?: unknown; claimRevision?: number } | null;
      draft: { status?: string; pointCount?: number } | null;
    }>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const allReq = db.transaction('records', 'readonly').objectStore('records').getAll();
        allReq.onsuccess = () => {
          const rows = allReq.result as Array<{
            key: string;
            claimRevision?: number;
            payload?: { status?: string; points?: unknown[] } | string;
          }>;
          const marker = rows.find((row) => row.key === 'meta:recording_active_account') ?? null;
          const draftRow = rows.find((row) => row.key === `user:${aId}:draft:active`);
          const draftPayload = draftRow?.payload as { status?: string; points?: unknown[] } | undefined;
          db.close();
          resolve({
            uploadKeys: rows.filter((row) => row.key.includes(':upload:')).map((row) => row.key),
            activeMarker: marker ? { payload: marker.payload, claimRevision: marker.claimRevision } : null,
            draft: draftPayload ? { status: draftPayload.status, pointCount: draftPayload.points?.length ?? 0 } : null,
          });
        };
        allReq.onerror = () => reject(allReq.error);
      };
    });
  }, WEB_DRAFT_ACCOUNT_ID);
}

async function isWebWatching(targetPage: Page) {
  return await targetPage.evaluate(() =>
    (window as unknown as Record<string, { isWatching: () => boolean }>).__geo.isWatching(),
  );
}

test('P1 Round 10: a stale recovery tab never steals the Web Lock from the current recorder or stops its GPS', async ({
  page,
  context,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await page.goto('/activities/record');

  // Tab O records and commits 1 point under the account's current claim
  await page.getByLabel('跑步标题（可选）').fill('旧代草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);

  // A re-login elsewhere advances the claim generation: O is now fenced by an older claim
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        const activeReq = store.get('meta:recording_active_account');
        activeReq.onsuccess = () => {
          const active = activeReq.result as { claimRevision: number; payload: string };
          const next = active.claimRevision + 1;
          const now = Date.now();
          store.put({
            key: 'meta:recording_claim_epoch',
            accountId: null,
            schemaVersion: 1,
            savedAt: now,
            claimRevision: next,
            payload: next,
          });
          store.put({ ...active, savedAt: now, claimRevision: next });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  // Tab S opens recovery, reads the old (fenced) draft, and its first lock request is held back
  const staleTab = await context.newPage();
  await installMockWebGeolocation(staleTab);
  await staleTab.addInitScript(() => {
    const original = LockManager.prototype.request as (...args: unknown[]) => Promise<unknown>;
    let gated = false;
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const win = window as unknown as Record<string, unknown>;
    win.__lockGatePaused = false;
    win.__openLockGate = () => open();
    LockManager.prototype.request = function (this: LockManager, ...args: unknown[]) {
      if (!gated && String(args[0]).startsWith('runnote-recording-session:')) {
        gated = true;
        win.__lockGatePaused = true;
        return gate.then(() => original.apply(this, args));
      }
      return original.apply(this, args);
    } as typeof LockManager.prototype.request;
  });
  await staleTab.goto('/activities/record');
  await expect
    .poll(() => staleTab.evaluate(() => (window as unknown as Record<string, boolean>).__lockGatePaused))
    .toBe(true);

  // Tab C recovers under the new claim and keeps recording
  const currentTab = await context.newPage();
  await installMockWebGeolocation(currentTab);
  await currentTab.goto('/activities/record');
  await expect(currentTab.getByTestId('recording-recovery-panel')).toBeVisible();
  await expect(currentTab.getByTestId('recording-points-count')).toContainText('1 点');
  await currentTab.getByTestId('recovery-resume-btn').click();
  await expect(currentTab.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(currentTab);
  for (const lat of [31.232, 31.234]) {
    await emitWebFix(currentTab, lat, 121.47);
  }
  await expect.poll(async () => (await readWebDraftRow(currentTab)).pointCount ?? 0).toBeGreaterThan(1);
  const ownedByCurrent = await readWebDraftRow(currentTab);

  // The stale tab's held-back request now runs against C's live session: it must give up, not steal
  await staleTab.evaluate(() => (window as unknown as Record<string, () => void>).__openLockGate());
  await expect(staleTab.getByTestId('recording-recovery-error-panel')).toContainText('其他标签页');
  await expect(staleTab.getByTestId('recording-recovery-panel')).toHaveCount(0);
  await expect(staleTab.getByTestId('recording-start-btn')).toBeDisabled();

  // C is untouched: still recording, GPS watcher alive, next points are persisted
  await expect(currentTab.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect(currentTab.getByTestId('recording-error')).toHaveCount(0);
  expect(await isWebWatching(currentTab)).toBe(true);
  const heldLocks = await currentTab.evaluate(async () =>
    ((await navigator.locks.query()).held ?? []).map((lock) => lock.name ?? ''),
  );
  expect(heldLocks.some((name) => name.startsWith('runnote-recording-session:'))).toBe(true);
  const afterStaleAttempt = await readWebDraftRow(currentTab);
  expect(afterStaleAttempt.ownerId).toBe(ownedByCurrent.ownerId);
  expect(afterStaleAttempt.ownerGeneration).toBe(ownedByCurrent.ownerGeneration);
  for (const lat of [31.236, 31.238]) {
    await emitWebFix(currentTab, lat, 121.47);
  }
  await expect
    .poll(async () => (await readWebDraftRow(currentTab)).pointCount ?? 0)
    .toBeGreaterThan(ownedByCurrent.pointCount ?? 0);
  await expect(currentTab.getByTestId('recording-points-count')).toContainText(
    `${(await readWebDraftRow(currentTab)).pointCount} 点`,
  );

  // The fenced original tab finds out on its own (lease check) and stops without touching C's draft
  await expect(page.getByTestId('recording-status-badge')).toHaveText('待恢复', { timeout: 15_000 });
  expect(await isWebWatching(page)).toBe(false);
  expect((await readWebDraftRow(currentTab)).ownerId).toBe(ownedByCurrent.ownerId);
  await expect(currentTab.getByTestId('recording-status-badge')).toHaveText('记录中');
});

test('P2 Round 10: cleanup between Web stop and enqueue leaves no private queue row (stop and stopped-draft recovery)', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  // Real IndexedDB interleaving: right after the transaction that marks the draft "stopped", a
  // logout-style cleanup transaction (draft + active marker) is queued ahead of the next one.
  await page.addInitScript((aId) => {
    const originalPut = IDBObjectStore.prototype.put;
    const originalTransaction = IDBDatabase.prototype.transaction;
    let cleanupPending = false;
    const win = window as unknown as Record<string, number>;
    win.__cleanupRuns = 0;
    IDBObjectStore.prototype.put = function (
      value: { key?: string; payload?: { status?: string } },
      key?: IDBValidKey,
    ) {
      if (
        window.sessionStorage.getItem('__cleanup_after_stopped_put') === '1' &&
        value?.key === `user:${aId}:draft:active` &&
        value?.payload?.status === 'stopped'
      ) {
        window.sessionStorage.removeItem('__cleanup_after_stopped_put');
        cleanupPending = true;
      }
      return key !== undefined ? originalPut.call(this, value, key) : originalPut.call(this, value);
    };
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      if (cleanupPending) {
        cleanupPending = false;
        const cleanup = originalTransaction.call(this, 'records', 'readwrite');
        cleanup.objectStore('records').delete(`user:${aId}:draft:active`);
        cleanup.objectStore('records').delete('meta:recording_active_account');
        win.__cleanupRuns += 1;
      }
      return originalTransaction.apply(this, args);
    } as typeof IDBDatabase.prototype.transaction;
  }, WEB_DRAFT_ACCOUNT_ID);
  await page.goto('/activities/record');

  // Subcase A: normal "结束并保存"
  await page.getByLabel('跑步标题（可选）').fill('清理竞态草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);
  await page.evaluate(() => window.sessionStorage.setItem('__cleanup_after_stopped_put', '1'));
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('recording-status-badge')).not.toHaveText('记录中');
  await expect(page.getByTestId('recording-stop-btn')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__cleanupRuns)).toBe(1);
  const afterStop = await readRecordingStoreSummary(page);
  expect(afterStop.uploadKeys).toEqual([]);
  expect(afterStop.draft).toBeNull();
  expect(afterStop.activeMarker).toBeNull();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
  expect(await isWebWatching(page)).toBe(false);

  // Subcase B: a stopped draft found on load (recovery path) hits the same cleanup window
  await page.evaluate(async (aId) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('runnote-recording-store', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        const epochReq = store.get('meta:recording_claim_epoch');
        epochReq.onsuccess = () => {
          const epoch = (epochReq.result as { payload?: number } | undefined)?.payload ?? 1;
          const now = Date.now();
          store.put({
            key: 'meta:recording_active_account',
            accountId: aId,
            schemaVersion: 1,
            savedAt: now,
            claimRevision: epoch,
            payload: aId,
          });
          store.put({
            key: `user:${aId}:draft:active`,
            accountId: aId,
            schemaVersion: 1,
            savedAt: now,
            claimRevision: epoch,
            draftRevision: 3,
            ownerId: 'closed-tab',
            ownerGeneration: 1,
            leaseExpiresAtMs: now - 1,
            payload: {
              sessionId: 'sess-stopped-cleanup',
              accountId: aId,
              idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              title: '恢复期清理草稿',
              status: 'stopped',
              startedAtMs: now - 120_000,
              endedAtMs: now - 10_000,
              activeDurationMs: 110_000,
              lastSegmentStartMs: null,
              segmentIndex: 0,
              previewDistanceM: 320,
              lastPointTimeMs: now - 10_000,
              lastAccuracyM: 6,
              interruptedReason: null,
              points: [
                { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 120_000, segmentIndex: 0 },
                { lat: 31.232, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: now - 60_000, segmentIndex: 0 },
              ],
            },
          });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    window.sessionStorage.setItem('__cleanup_after_stopped_put', '1');
  }, WEB_DRAFT_ACCOUNT_ID);
  await page.reload();
  await expect(page.getByTestId('recording-status-badge')).not.toHaveText('正在恢复…');
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__cleanupRuns)).toBe(1);
  const afterRecovery = await readRecordingStoreSummary(page);
  expect(afterRecovery.uploadKeys).toEqual([]);
  expect(afterRecovery.draft).toBeNull();
  await expect(page.getByTestId('recording-recovery-error-panel')).toContainText('未写入上传队列');
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);

  // Retrying finds nothing left to recover and nothing is recreated
  await page.getByTestId('recording-recovery-retry-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  expect((await readRecordingStoreSummary(page)).uploadKeys).toEqual([]);
});

test('P2 Round 10: a Web enqueue transaction abort never leaves a "recording" badge with GPS stopped', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: { key?: string }, key?: IDBValidKey) {
      const request = key !== undefined ? originalPut.call(this, value, key) : originalPut.call(this, value);
      if (
        window.sessionStorage.getItem('__abort_upload_tx') === '1' &&
        typeof value?.key === 'string' &&
        value.key.includes(':upload:')
      ) {
        this.transaction.abort();
      }
      return request;
    };
  });
  await page.goto('/activities/record');

  await page.getByLabel('跑步标题（可选）').fill('入队中止草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await emitWebFix(page, 31.232, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(2);

  await page.evaluate(() => window.sessionStorage.setItem('__abort_upload_tx', '1'));
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('recording-error')).toContainText('未能将已结束记录写入本地上传队列');

  // Watcher state and UI agree: GPS is off and nothing claims to be recording
  await expect(page.getByTestId('recording-status-badge')).toHaveText('待恢复');
  await expect(page.getByTestId('recording-gps-badge')).toHaveText('GPS 未开启');
  expect(await isWebWatching(page)).toBe(false);
  await expect(page.getByTestId('recording-recovery-panel')).toContainText('未能写入本地上传队列');
  await expect(page.getByTestId('recording-pause-btn')).toHaveCount(0);
  await expect(page.getByTestId('recording-stop-btn')).toHaveCount(0);

  // The aborted transaction rolled back completely: the stopped draft is intact and recoverable
  const afterAbort = await readRecordingStoreSummary(page);
  expect(afterAbort.uploadKeys).toEqual([]);
  expect(afterAbort.draft).toEqual({ status: 'stopped', pointCount: 2 });

  // Retry from the recovery panel enqueues once and clears the draft
  await page.evaluate(() => window.sessionStorage.removeItem('__abort_upload_tx'));
  await page.getByTestId('recovery-save-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('就绪');
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toContainText('入队中止草稿');
  const afterRetry = await readRecordingStoreSummary(page);
  expect(afterRetry.uploadKeys).toHaveLength(1);
  expect(afterRetry.draft).toBeNull();
});

/**
 * Real IndexedDB interleaving for native handoff: right after the mock bridge returns the track
 * (`getSessionPoints` for auto recovery, `stopSession` for manual stop), the next transaction the page
 * opens is preceded by a committed account cleanup (active marker + all A rows) and, for 'relogin',
 * a fresh same-account claim at a newer revision, i.e. logout then sign-in as A again.
 */
async function installNativeReadInterleave(page: Page, trigger: 'getSessionPoints' | 'stopSession') {
  await page.addInitScript(
    ({ aId, hook }) => {
      const win = window as unknown as Record<string, unknown>;
      const originalTransaction = IDBDatabase.prototype.transaction;
      let pending: 'cleanup' | 'relogin' | null = null;
      win.__interleaveRuns = 0;
      IDBDatabase.prototype.transaction = function (
        this: IDBDatabase,
        ...args: Parameters<IDBDatabase['transaction']>
      ) {
        if (pending) {
          const mode = pending;
          pending = null;
          const tx = originalTransaction.call(this, 'records', 'readwrite');
          const store = tx.objectStore('records');
          store.delete('meta:recording_active_account');
          store.delete(IDBKeyRange.bound(`user:${aId}:`, `user:${aId}:￿`));
          if (mode === 'relogin') {
            const epochReq = store.get('meta:recording_claim_epoch');
            epochReq.onsuccess = () => {
              const next = Number((epochReq.result as { payload?: number } | undefined)?.payload ?? 0) + 1;
              const now = Date.now();
              store.put({
                key: 'meta:recording_claim_epoch',
                accountId: null,
                schemaVersion: 1,
                savedAt: now,
                claimRevision: next,
                payload: next,
              });
              store.put({
                key: 'meta:recording_active_account',
                accountId: aId,
                schemaVersion: 1,
                savedAt: now,
                claimRevision: next,
                payload: aId,
              });
            };
          }
          win.__interleaveRuns = Number(win.__interleaveRuns) + 1;
        }
        return originalTransaction.apply(this, args);
      } as typeof IDBDatabase.prototype.transaction;

      const plugin = (win.Capacitor as { Plugins: { LocationRecorder: Record<string, (...a: unknown[]) => unknown> } })
        .Plugins.LocationRecorder;
      const original = plugin[hook];
      plugin[hook] = async (...callArgs: unknown[]) => {
        const out = await original(...callArgs);
        const mode = window.sessionStorage.getItem('__native_read_interleave');
        if (mode === 'cleanup' || mode === 'relogin') {
          window.sessionStorage.removeItem('__native_read_interleave');
          pending = mode;
        }
        return out;
      };
    },
    { aId: WEB_DRAFT_ACCOUNT_ID, hook: trigger },
  );
}

async function readNativeMock(targetPage: Page) {
  return await targetPage.evaluate(() => {
    const mock = (
      window as unknown as Record<
        string,
        {
          acknowledgedSessionIds: string[];
          getSession: () => { status?: string; sessionId?: string; accountId?: string; title?: string } | null;
          getPointCount: () => number;
          getStopSessionCalls?: () => number;
          getStopSessionRejectedCount?: () => number;
          getAckRejectedCount?: () => number;
        }
      >
    ).__mockRecorder;
    return {
      acks: [...mock.acknowledgedSessionIds],
      session: mock.getSession(),
      pointCount: mock.getPointCount(),
      stopCalls: mock.getStopSessionCalls?.() ?? 0,
      stopRejected: mock.getStopSessionRejectedCount?.() ?? 0,
      ackRejected: mock.getAckRejectedCount?.() ?? 0,
      interleaveRuns: Number((window as unknown as Record<string, unknown>).__interleaveRuns ?? 0),
    };
  });
}

test('P1 Round 11: cleanup after the native handoff read never recreates the queue row or acknowledges (auto recovery)', async ({
  page,
}) => {
  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await route.continue();
  });
  await loginRunner(page);
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r11-cleanup-handoff',
    stoppedIdempotencyKey: 'b1111111-1111-4111-8111-111111111111',
  });
  await installNativeReadInterleave(page, 'getSessionPoints');
  await page.evaluate(() => window.sessionStorage.setItem('__native_read_interleave', 'cleanup'));
  await page.goto('/activities/record');

  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const native = await readNativeMock(page);
  expect(native.interleaveRuns).toBe(1);
  expect(native.acks).toEqual([]);
  expect(native.session?.status).toBe('stopped');
  expect(native.pointCount).toBe(3);
  const store = await readRecordingStoreSummary(page);
  expect(store.uploadKeys).toEqual([]);
  expect(store.activeMarker).toBeNull();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);

  // Native data stayed recoverable: once the account is claimed again (fresh page), it is enqueued,
  // acknowledged and uploaded exactly once.
  await page.reload();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 5_000,
  });
  const recovered = await readNativeMock(page);
  expect(recovered.acks).toEqual(['r11-cleanup-handoff']);
  expect(recovered.session).toBeNull();
  expect((await readRecordingStoreSummary(page)).uploadKeys).toHaveLength(1);
  expect(gpxPostCount).toBe(1);
});

test('P1 Round 11: cleanup after the native stop returns the track keeps the session for retry and never acknowledges (manual stop)', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialRecording: true });
  await installNativeReadInterleave(page, 'stopSession');
  await page.goto('/activities/record');

  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await page.evaluate(() => window.sessionStorage.setItem('__native_read_interleave', 'cleanup'));
  await page.getByTestId('recording-stop-btn').click();

  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const native = await readNativeMock(page);
  expect(native.interleaveRuns).toBe(1);
  expect(native.acks).toEqual([]);
  expect(native.session?.status).toBe('stopped');
  expect(native.pointCount).toBe(3);
  const store = await readRecordingStoreSummary(page);
  expect(store.uploadKeys).toEqual([]);
  expect(store.activeMarker).toBeNull();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
});

test('P1 Round 11: same-account logout and re-login after the native read is refused, then retry enqueues and acks once', async ({
  page,
}) => {
  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await route.continue();
  });
  await loginRunner(page);
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r11-relogin-handoff',
    stoppedIdempotencyKey: 'b2222222-2222-4222-8222-222222222222',
  });
  await installNativeReadInterleave(page, 'getSessionPoints');
  await page.evaluate(() => window.sessionStorage.setItem('__native_read_interleave', 'relogin'));
  await page.goto('/activities/record');

  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const refused = await readNativeMock(page);
  expect(refused.interleaveRuns).toBe(1);
  expect(refused.acks).toEqual([]);
  expect(refused.session?.status).toBe('stopped');
  const afterRelogin = await readRecordingStoreSummary(page);
  expect(afterRelogin.uploadKeys).toEqual([]);
  expect(afterRelogin.activeMarker?.payload).toBe(WEB_DRAFT_ACCOUNT_ID);

  // The retry pins the new generation of the same signed-in account and completes exactly once.
  await page.getByTestId('handoff-retry-btn').click();
  await expect(page.getByTestId('recording-pending-handoff-panel')).toHaveCount(0);
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1);
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 5_000,
  });
  const done = await readNativeMock(page);
  expect(done.acks).toEqual(['r11-relogin-handoff']);
  expect(done.session).toBeNull();
  const finalStore = await readRecordingStoreSummary(page);
  expect(finalStore.uploadKeys).toHaveLength(1);
  expect(gpxPostCount).toBe(1);
});

/**
 * Holds the next draft write behind a live readwrite transaction (kept open by chained requests)
 * until `window.__releaseHold()`: 'after-lock' arms on the Start path's Web Lock request, 'next'
 * arms immediately (resume has no await before its draft write).
 */
async function installDraftWriteHold(page: Page) {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    const originalTransaction = IDBDatabase.prototype.transaction;
    let armed = false;
    let released = false;
    win.__holdRuns = 0;
    win.__armHold = () => {
      armed = true;
      released = false;
    };
    win.__releaseHold = () => {
      released = true;
    };
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      if (armed) {
        armed = false;
        const store = originalTransaction.call(this, 'records', 'readwrite').objectStore('records');
        const spin = () => {
          if (released) return;
          store.get('meta:hold-spin').onsuccess = spin;
        };
        spin();
        win.__holdRuns = Number(win.__holdRuns) + 1;
      }
      return originalTransaction.apply(this, args);
    } as typeof IDBDatabase.prototype.transaction;
    const locks = navigator.locks;
    const originalRequest = locks.request.bind(locks) as (...a: unknown[]) => Promise<unknown>;
    (locks as unknown as { request: (...a: unknown[]) => Promise<unknown> }).request = (...callArgs: unknown[]) => {
      if (window.sessionStorage.getItem('__hold_after_lock') === '1') {
        window.sessionStorage.removeItem('__hold_after_lock');
        armed = true;
        released = false;
      }
      return originalRequest(...callArgs);
    };
  });
}

async function heldRecordingLocks(targetPage: Page) {
  return await targetPage.evaluate(async () => {
    const snapshot = await navigator.locks.query();
    return (snapshot.held ?? [])
      .map((lock) => lock.name ?? '')
      .filter((name) => name.startsWith('runnote-recording-session:'));
  });
}

async function leaveRecordingPageViaDialog(targetPage: Page) {
  await targetPage.getByRole('link', { name: '跑步记录' }).first().click();
  await expect(targetPage.getByTestId('recording-leave-dialog')).toBeVisible();
  await targetPage.getByTestId('recording-leave-confirm-btn').click();
  await expect(targetPage).not.toHaveURL(/\/activities\/record/);
  await expect(targetPage.getByTestId('recording-status-badge')).toHaveCount(0);
}

test('P2 Round 11: leaving during an in-flight Web Start never turns GPS on and keeps the draft recoverable', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await installDraftWriteHold(page);
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();

  await page.getByLabel('跑步标题（可选）').fill('离开页面草稿');
  await page.evaluate(() => window.sessionStorage.setItem('__hold_after_lock', '1'));
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__holdRuns)).toBe(1);
  expect(await isWebWatching(page)).toBe(false);

  await leaveRecordingPageViaDialog(page);
  await page.evaluate(() => (window as unknown as Record<string, () => void>).__releaseHold());

  // The held draft write commits after unmount; GPS must stay off and nothing keeps running.
  await expect.poll(async () => (await readWebDraftRow(page)).exists).toBe(true);
  const committed = await readWebDraftRow(page);
  expect(await isWebWatching(page)).toBe(false);
  expect(await heldRecordingLocks(page)).toEqual([]);
  // No orphaned lease-renew interval: the row is untouched across more than one renew period (5s).
  await page.waitForTimeout(6_000);
  expect(await isWebWatching(page)).toBe(false);
  expect(await readWebDraftRow(page)).toEqual(committed);

  // The persisted draft is recoverable when the runner comes back.
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-recovery-panel')).toBeVisible();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('待恢复');
  expect(await isWebWatching(page)).toBe(false);
  expect((await readWebDraftRow(page)).sessionId).toBe(committed.sessionId);
});

test('P2 Round 11: leaving during an in-flight Web resume never turns GPS on and keeps the draft recoverable', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await installDraftWriteHold(page);
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();

  await page.getByLabel('跑步标题（可选）').fill('继续时离开草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);
  await page.getByTestId('recording-pause-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
  expect(await isWebWatching(page)).toBe(false);

  const revisionBefore = (await readWebDraftRow(page)).draftRevision ?? 0;
  await page.evaluate(() => (window as unknown as Record<string, () => void>).__armHold());
  await page.getByTestId('recording-resume-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__holdRuns)).toBe(1);

  await leaveRecordingPageViaDialog(page);
  await page.evaluate(() => (window as unknown as Record<string, () => void>).__releaseHold());

  await expect.poll(async () => (await readWebDraftRow(page)).draftRevision ?? 0).toBeGreaterThan(revisionBefore);
  expect(await isWebWatching(page)).toBe(false);
  expect(await heldRecordingLocks(page)).toEqual([]);

  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-recovery-panel')).toBeVisible();
  await expect(page.getByTestId('recording-points-count')).toContainText('1 点');
  expect(await isWebWatching(page)).toBe(false);
});

/**
 * Deletes account A's recording data and active marker in a real committed IndexedDB transaction.
 * When `relogin` is true, also establishes a fresh same-account generation (epoch + 1) in the same
 * transaction to simulate logout + same-account re-login in another tab.
 */
async function commitAccountCleanupInIdb(
  targetPage: Page,
  accountId: string,
  options?: { relogin?: boolean; seedQueueKey?: string },
) {
  return await targetPage.evaluate(
    async ({ aId, relogin, seedQueueKey }) => {
      return await new Promise<{ nextRevision: number | null }>((resolve, reject) => {
        const req = indexedDB.open('runnote-recording-store', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('records', 'readwrite');
          const store = tx.objectStore('records');
          let nextRevision: number | null = null;
          store.delete('meta:recording_active_account');
          store.delete(IDBKeyRange.bound(`user:${aId}:`, `user:${aId}:\uffff`));
          if (relogin) {
            const epochReq = store.get('meta:recording_claim_epoch');
            epochReq.onsuccess = () => {
              const next = Number((epochReq.result as { payload?: number } | undefined)?.payload ?? 0) + 1;
              nextRevision = next;
              const now = Date.now();
              store.put({
                key: 'meta:recording_claim_epoch',
                accountId: null,
                schemaVersion: 1,
                savedAt: now,
                claimRevision: next,
                payload: next,
              });
              store.put({
                key: 'meta:recording_active_account',
                accountId: aId,
                schemaVersion: 1,
                savedAt: now,
                claimRevision: next,
                payload: aId,
              });
              if (seedQueueKey) {
                store.put({
                  key: `user:${aId}:upload:${seedQueueKey}`,
                  accountId: aId,
                  schemaVersion: 1,
                  savedAt: now,
                  claimRevision: next,
                  payload: {
                    idempotencyKey: seedQueueKey,
                    accountId: aId,
                    sessionId: 'new-gen-sess',
                    title: '新登录世代记录',
                    timezone: 'Asia/Shanghai',
                    startedAtMs: now - 60_000,
                    endedAtMs: now - 10_000,
                    pointCount: 2,
                    segmentCount: 1,
                    previewDistanceM: 400,
                    activeDurationMs: 50_000,
                    gpxXml: '<gpx version="1.1"></gpx>',
                    status: 'uploaded',
                    attemptCount: 1,
                    nextRetryAt: null,
                    lastError: null,
                    permanentError: false,
                    uploadedActivityId: '44444444-4444-4444-8444-444444444444',
                    serverDistanceM: 400,
                    serverDurationS: 50,
                    serverPaceSPerKm: 125,
                    createdAtMs: now,
                    updatedAtMs: now,
                  },
                });
              }
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve({ nextRevision });
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('cleanup tx aborted'));
        };
      });
    },
    { aId: accountId, relogin: options?.relogin === true, seedQueueKey: options?.seedQueueKey ?? null },
  );
}

/**
 * Intercepts a real IndexedDB transaction's `complete` event so that AFTER the target transaction
 * commits in IndexedDB, a real cleanup transaction commits before the target transaction's
 * continuation resumes.
 *
 * Modes (armed via `window.sessionStorage.setItem('__r12_post_commit_cleanup', mode)`):
 * - `'draft-put'`: fires after a `put` of `user:<A>:draft:active` commits.
 * - `'draft-readback'`: fires after a `readonly` tx reading `user:<A>:draft:active` commits (ownership read-back -> watch window).
 * - `'upload-put'`: fires after a `put` of `user:<A>:upload:*` commits (write -> read-back window).
 * - `'upload-readback'`: fires after the 1st `readonly` tx reading `user:<A>:upload:*` commits.
 * - `'upload-readback-final'`: skips the 1st read-back inside enqueue and fires on the 2nd (final)
 *   `readonly` tx reading `user:<A>:upload:*` right before `acknowledgeHandoff`, committing IDB
 *   cleanup AND revoking native claim fence.
 * - `'upload-readback-final-relogin'`: same as `'upload-readback-final'`, plus establishes a fresh
 *   same-account claim generation (`rev + 1`) in IDB and syncs it to native.
 */
async function installPostCommitCleanupInterleave(page: Page) {
  await page.addInitScript((aId) => {
    const win = window as unknown as Record<string, unknown>;
    const origTransaction = IDBDatabase.prototype.transaction;
    const origPut = IDBObjectStore.prototype.put;
    const origGet = IDBObjectStore.prototype.get;
    const origAddEventListener = IDBTransaction.prototype.addEventListener;
    const taggedTxs = new Map<IDBTransaction, string>();
    let uploadReadbackSeen = 0;
    win.__r12CleanupRuns = 0;
    win.__r13ResetReadbackCounter = () => {
      uploadReadbackSeen = 0;
    };

    IDBObjectStore.prototype.put = function (value: { key?: string }, key?: IDBValidKey) {
      const mode = window.sessionStorage.getItem('__r12_post_commit_cleanup');
      if (mode === 'draft-put' && value?.key === `user:${aId}:draft:active`) {
        window.sessionStorage.removeItem('__r12_post_commit_cleanup');
        taggedTxs.set(this.transaction, mode);
      } else if (
        mode === 'upload-put' &&
        typeof value?.key === 'string' &&
        value.key.startsWith(`user:${aId}:upload:`)
      ) {
        window.sessionStorage.removeItem('__r12_post_commit_cleanup');
        taggedTxs.set(this.transaction, mode);
      }
      return key !== undefined ? origPut.call(this, value, key) : origPut.call(this, value);
    };

    IDBObjectStore.prototype.get = function (query: IDBValidKey | IDBKeyRange) {
      const mode = window.sessionStorage.getItem('__r12_post_commit_cleanup');
      if (mode === 'draft-readback' && this.transaction.mode === 'readonly' && query === `user:${aId}:draft:active`) {
        window.sessionStorage.removeItem('__r12_post_commit_cleanup');
        taggedTxs.set(this.transaction, mode);
      } else if (
        mode === 'upload-readback' &&
        this.transaction.mode === 'readonly' &&
        typeof query === 'string' &&
        query.startsWith(`user:${aId}:upload:`)
      ) {
        window.sessionStorage.removeItem('__r12_post_commit_cleanup');
        taggedTxs.set(this.transaction, mode);
      } else if (
        (mode === 'upload-readback-final' || mode === 'upload-readback-final-relogin') &&
        this.transaction.mode === 'readonly' &&
        typeof query === 'string' &&
        query.startsWith(`user:${aId}:upload:`)
      ) {
        uploadReadbackSeen += 1;
        if (uploadReadbackSeen >= 2) {
          window.sessionStorage.removeItem('__r12_post_commit_cleanup');
          taggedTxs.set(this.transaction, mode);
        }
      }
      return origGet.call(this, query);
    };

    IDBTransaction.prototype.addEventListener = function (
      this: IDBTransaction,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'complete' && listener) {
        const tx = this;
        const wrapped: EventListener = function (this: IDBTransaction, ev: Event) {
          const taggedMode = taggedTxs.get(tx);
          if (!taggedMode) {
            if (typeof listener === 'function') listener.call(this, ev);
            else listener.handleEvent(ev);
            return;
          }
          taggedTxs.delete(tx);
          const cleanupTx = origTransaction.call(tx.db, 'records', 'readwrite');
          const store = cleanupTx.objectStore('records');
          const mockRecorder = win.__mockRecorder as
            | {
                revokeAccountClaim?: (accountId: string | null, rev?: number) => boolean;
                syncAccountClaim?: (accountId: string | null, rev: number, tok?: string) => boolean;
              }
            | undefined;
          let nextReloginRev = 0;
          let nextReloginToken = '';
          store.delete('meta:recording_active_account');
          store.delete(IDBKeyRange.bound(`user:${aId}:`, `user:${aId}:\uffff`));
          if (taggedMode === 'upload-readback-final-relogin') {
            const epochReq = store.get('meta:recording_claim_epoch');
            epochReq.onsuccess = () => {
              nextReloginRev = Number((epochReq.result as { payload?: number } | undefined)?.payload ?? 0) + 1;
              nextReloginToken = `r13-relogin-tok-${nextReloginRev}`;
              const now = Date.now();
              store.put({
                key: 'meta:recording_claim_epoch',
                accountId: null,
                schemaVersion: 1,
                savedAt: now,
                claimRevision: nextReloginRev,
                payload: nextReloginRev,
              });
              store.put({
                key: 'meta:recording_active_account',
                accountId: aId,
                schemaVersion: 1,
                savedAt: now,
                claimRevision: nextReloginRev,
                claimToken: nextReloginToken,
                payload: aId,
              });
            };
          }
          cleanupTx.oncomplete = () => {
            if (taggedMode === 'upload-readback-final') {
              mockRecorder?.revokeAccountClaim?.(aId, 0);
            } else if (taggedMode === 'upload-readback-final-relogin' && nextReloginRev > 0) {
              mockRecorder?.syncAccountClaim?.(aId, nextReloginRev, nextReloginToken);
            }
            win.__r12CleanupRuns = Number(win.__r12CleanupRuns) + 1;
            if (typeof listener === 'function') listener.call(tx, ev);
            else listener.handleEvent(ev);
          };
        };
        return origAddEventListener.call(this, type, wrapped, options);
      }
      return origAddEventListener.call(this, type, listener, options);
    };
  }, WEB_DRAFT_ACCOUNT_ID);
}

test('P1 Round 12: cleanup before native pin never recreates a claim, writes a queue row, or acks (auto recovery)', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r12-prepin-auto',
    stoppedIdempotencyKey: 'c1111111-1111-4111-8111-111111111111',
    getSessionStateDelayMs: 600,
  });
  await page.goto('/activities/record');
  // Wait for the layout to mount and bind the initial claim while getSessionState is still pending.
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __mockRecorder?: { getClaimFence: () => { authorizedAccountId: string | null } | null };
            }
          ).__mockRecorder?.getClaimFence()?.authorizedAccountId ?? null,
      ),
    )
    .toBe(WEB_DRAFT_ACCOUNT_ID);

  // Commit account A cleanup (data + active marker deleted) BEFORE auto-recovery pins the claim.
  await commitAccountCleanupInIdb(page, WEB_DRAFT_ACCOUNT_ID);
  expect((await readRecordingStoreSummary(page)).activeMarker).toBeNull();

  // Delayed getSessionState now resolves and triggers auto-recovery on the old page.
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');

  const store = await readRecordingStoreSummary(page);
  expect(store.activeMarker).toBeNull();
  expect(store.uploadKeys).toEqual([]);
  const native = await readNativeMock(page);
  expect(native.acks).toEqual([]);
  expect(native.session?.status).toBe('stopped');
  expect(native.pointCount).toBe(3);

  // Even clicking manual retry while the active marker is still empty must NOT recreate a claim or ack.
  await page.getByTestId('handoff-retry-btn').click();
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  const afterRetryStore = await readRecordingStoreSummary(page);
  expect(afterRetryStore.activeMarker).toBeNull();
  expect(afterRetryStore.uploadKeys).toEqual([]);
  expect((await readNativeMock(page)).acks).toEqual([]);
});

test('P1 Round 12: cleanup before native pin never recreates a claim, writes a queue row, or acks (manual stop)', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialRecording: true });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect
    .poll(async () => (await readRecordingStoreSummary(page)).activeMarker?.payload ?? null)
    .toBe(WEB_DRAFT_ACCOUNT_ID);

  // Account A data + active marker deleted and committed BEFORE user clicks Stop on the old page.
  await commitAccountCleanupInIdb(page, WEB_DRAFT_ACCOUNT_ID);
  expect((await readRecordingStoreSummary(page)).activeMarker).toBeNull();

  await page.getByTestId('recording-stop-btn').click();
  // Round 13 P2: when pinning the claim fails before stop, do NOT stop native recording or show pending handoff.
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  await expect(page.getByTestId('recording-pending-handoff-panel')).toHaveCount(0);

  const store = await readRecordingStoreSummary(page);
  expect(store.activeMarker).toBeNull();
  expect(store.uploadKeys).toEqual([]);
  const native = await readNativeMock(page);
  expect(native.acks).toEqual([]);
  expect(native.stopCalls).toBe(0);
  expect(native.session?.status).toBe('recording');
  expect(native.pointCount).toBe(3);
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(0);
});

test('P1 Round 12: cleanup before pin with same-account new generation blocks old page auto-recovery and manual stop', async ({
  page,
}) => {
  const newGenKey = 'c2222222-2222-4222-8222-222222222222';

  // Subcase A: old page auto-recovery after cleanup + same-account new generation established.
  await loginRunner(page);
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r12-newgen-auto',
    stoppedIdempotencyKey: 'c3333333-3333-4333-8333-333333333333',
    getSessionStateDelayMs: 600,
  });
  await page.goto('/activities/record');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  const initialRev = (await readRecordingStoreSummary(page)).activeMarker?.claimRevision ?? 0;
  expect(initialRev).toBeGreaterThan(0);

  const { nextRevision: autoNewGenRev } = await commitAccountCleanupInIdb(page, WEB_DRAFT_ACCOUNT_ID, {
    relogin: true,
    seedQueueKey: newGenKey,
  });
  expect(autoNewGenRev).toBeGreaterThan(initialRev);

  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const autoStore = await readRecordingStoreSummary(page);
  expect(autoStore.activeMarker?.claimRevision).toBe(autoNewGenRev);
  expect(autoStore.uploadKeys).toEqual([`user:${WEB_DRAFT_ACCOUNT_ID}:upload:${newGenKey}`]);
  const autoNative = await readNativeMock(page);
  expect(autoNative.acks).toEqual([]);
  expect(autoNative.session?.status).toBe('stopped');

  // Subcase B: old page manual stop after cleanup + same-account new generation established.
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialRecording: true });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  const stopInitialRev = (await readRecordingStoreSummary(page)).activeMarker?.claimRevision ?? 0;
  expect(stopInitialRev).toBeGreaterThan(0);

  const { nextRevision: stopNewGenRev } = await commitAccountCleanupInIdb(page, WEB_DRAFT_ACCOUNT_ID, {
    relogin: true,
    seedQueueKey: newGenKey,
  });
  expect(stopNewGenRev).toBeGreaterThan(stopInitialRev);

  await page.getByTestId('recording-stop-btn').click();
  // Round 13 P2: old page pin fails against the new generation, so it must NOT stop native recording.
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  await expect(page.getByTestId('recording-pending-handoff-panel')).toHaveCount(0);
  const stopStore = await readRecordingStoreSummary(page);
  expect(stopStore.activeMarker?.claimRevision).toBe(stopNewGenRev);
  expect(stopStore.uploadKeys).toEqual([`user:${WEB_DRAFT_ACCOUNT_ID}:upload:${newGenKey}`]);
  const stopNative = await readNativeMock(page);
  expect(stopNative.acks).toEqual([]);
  expect(stopNative.stopCalls).toBe(0);
  expect(stopNative.session?.status).toBe('recording');
});

test('P1 Round 12: cleanup interleaved in the queue write/read-back/ack window never resurrects or acks', async ({
  page,
}) => {
  await loginRunner(page);
  await installPostCommitCleanupInterleave(page);

  // Subcase A: cleanup commits right after the queue write tx commits, before read-back verification.
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r12-window-write-readback',
    stoppedIdempotencyKey: 'c4444444-4444-4444-8444-444444444444',
  });
  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'upload-put'));
  await page.goto('/activities/record');
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const storeAfterWriteWindow = await readRecordingStoreSummary(page);
  expect(storeAfterWriteWindow.activeMarker).toBeNull();
  expect(storeAfterWriteWindow.uploadKeys).toEqual([]);
  const nativeAfterWriteWindow = await readNativeMock(page);
  expect(nativeAfterWriteWindow.acks).toEqual([]);
  expect(nativeAfterWriteWindow.session?.status).toBe('stopped');

  // Subcase B: cleanup commits right after read-back verification commits, before acknowledgeHandoff.
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r12-window-readback-ack',
    stoppedIdempotencyKey: 'c5555555-5555-4555-8555-555555555555',
  });
  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'upload-readback'));
  await page.goto('/activities/record');
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const storeAfterAckWindow = await readRecordingStoreSummary(page);
  expect(storeAfterAckWindow.activeMarker).toBeNull();
  expect(storeAfterAckWindow.uploadKeys).toEqual([]);
  const nativeAfterAckWindow = await readNativeMock(page);
  expect(nativeAfterAckWindow.acks).toEqual([]);
  expect(nativeAfterAckWindow.session?.status).toBe('stopped');
});

test('P2 Round 12: cleanup completing after Web Start draft commit and before continuation never starts GPS', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await installPostCommitCleanupInterleave(page);
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();

  await page.getByLabel('跑步标题（可选）').fill('开始后清理草稿');
  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'draft-put'));
  await page.getByTestId('recording-start-btn').click();

  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-status-badge')).not.toHaveText('记录中');
  expect(await isWebWatching(page)).toBe(false);
  expect(await heldRecordingLocks(page)).toEqual([]);
  const store = await readRecordingStoreSummary(page);
  expect(store.activeMarker).toBeNull();
  expect(store.draft).toBeNull();
  expect(store.uploadKeys).toEqual([]);
});

test('P2 Round 12: cleanup completing after Web Resume draft commit and before continuation never starts GPS', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await installPostCommitCleanupInterleave(page);
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();

  await page.getByLabel('跑步标题（可选）').fill('继续后清理草稿');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);
  await page.getByTestId('recording-pause-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
  expect(await isWebWatching(page)).toBe(false);

  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'draft-put'));
  await page.getByTestId('recording-resume-btn').click();

  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-status-badge')).not.toHaveText('记录中');
  expect(await isWebWatching(page)).toBe(false);
  expect(await heldRecordingLocks(page)).toEqual([]);
  const store = await readRecordingStoreSummary(page);
  expect(store.activeMarker).toBeNull();
  expect(store.draft).toBeNull();
  expect(store.uploadKeys).toEqual([]);
});

test('P1 Round 13: cleanup after final queue read-back before ack never clears native session (auto recovery, manual stop, and same-account new gen)', async ({
  page,
}) => {
  await loginRunner(page);
  await installPostCommitCleanupInterleave(page);

  // Subcase A: auto-recovery — cleanup commits right after the 2nd (final) readonly queue read-back, before ack.
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r13-final-readback-auto',
    stoppedIdempotencyKey: 'd1111111-1111-4111-8111-111111111111',
  });
  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'upload-readback-final'));
  await page.goto('/activities/record');
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const storeAuto = await readRecordingStoreSummary(page);
  expect(storeAuto.activeMarker).toBeNull();
  expect(storeAuto.uploadKeys).toEqual([]);
  const nativeAuto = await readNativeMock(page);
  expect(nativeAuto.acks).toEqual([]);
  expect(nativeAuto.ackRejected).toBeGreaterThanOrEqual(1);
  expect(nativeAuto.session?.status).toBe('stopped');
  expect(nativeAuto.pointCount).toBe(3);

  // Subcase B: manual Stop — cleanup commits right after the final readonly queue read-back, before ack.
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialRecording: true });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await page.evaluate(() => {
    (window as unknown as Record<string, () => void>).__r13ResetReadbackCounter?.();
    window.sessionStorage.setItem('__r12_post_commit_cleanup', 'upload-readback-final');
  });
  await page.getByTestId('recording-stop-btn').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const storeStop = await readRecordingStoreSummary(page);
  expect(storeStop.activeMarker).toBeNull();
  expect(storeStop.uploadKeys).toEqual([]);
  const nativeStop = await readNativeMock(page);
  expect(nativeStop.acks).toEqual([]);
  expect(nativeStop.ackRejected).toBeGreaterThanOrEqual(1);
  expect(nativeStop.session?.status).toBe('stopped');
  expect(nativeStop.pointCount).toBe(3);

  // Subcase C: cleanup + same-account new generation established right after final read-back, before ack.
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r13-final-readback-relogin',
    stoppedIdempotencyKey: 'd2222222-2222-4222-8222-222222222222',
  });
  await page.evaluate(() =>
    window.sessionStorage.setItem('__r12_post_commit_cleanup', 'upload-readback-final-relogin'),
  );
  await page.goto('/activities/record');
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-pending-handoff-panel')).toBeVisible();
  await expect(page.getByTestId('recording-error')).toContainText('未写入上传队列');
  const storeRelogin = await readRecordingStoreSummary(page);
  expect(storeRelogin.activeMarker?.payload).toBe(WEB_DRAFT_ACCOUNT_ID);
  expect(storeRelogin.uploadKeys).toEqual([]);
  const nativeRelogin = await readNativeMock(page);
  expect(nativeRelogin.acks).toEqual([]);
  expect(nativeRelogin.ackRejected).toBeGreaterThanOrEqual(1);
  expect(nativeRelogin.session?.status).toBe('stopped');
  expect(nativeRelogin.pointCount).toBe(3);
});

test('P1 Round 13: native acknowledgeHandoff rejects stale, foreign, and revoked claims without clearing session', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    initialStopped: true,
    stoppedSessionId: 'r13-ack-reject-sess',
    stoppedIdempotencyKey: 'd3333333-3333-4333-8333-333333333333',
    getSessionStateBehavior: 'hang',
  });
  await page.goto('/activities/record');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __mockRecorder?: { getClaimFence: () => { authorizedAccountId: string | null } | null };
            }
          ).__mockRecorder?.getClaimFence()?.authorizedAccountId ?? null,
      ),
    )
    .toBe(WEB_DRAFT_ACCOUNT_ID);

  const probeResult = await page.evaluate(async (aId) => {
    const win = window as unknown as {
      Capacitor: {
        Plugins: {
          LocationRecorder: {
            acknowledgeHandoff: (opts: Record<string, unknown>) => Promise<{ acknowledged: boolean }>;
          };
        };
      };
      __mockRecorder: {
        getClaimFence: () => { authorizedClaimRevision: number | null; authorizedClaimToken: string | null } | null;
        syncAccountClaim: (accountId: string | null, rev: number, tok?: string) => boolean;
        revokeAccountClaim: (accountId: string | null, rev?: number) => boolean;
        getSession: () => { status?: string; sessionId?: string } | null;
        getPointCount: () => number;
      };
    };
    const plugin = win.Capacitor.Plugins.LocationRecorder;
    const fence = win.__mockRecorder.getClaimFence();
    const rev1 = fence?.authorizedClaimRevision ?? 1;
    const tok1 = fence?.authorizedClaimToken ?? '';

    const missingAccount = await plugin.acknowledgeHandoff({ sessionId: 'r13-ack-reject-sess', claimRevision: rev1 });
    const foreignAccount = await plugin.acknowledgeHandoff({
      sessionId: 'r13-ack-reject-sess',
      accountId: '00000000-0000-4000-8000-000000000002',
      claimRevision: rev1,
      claimToken: tok1,
    });
    const wrongToken = await plugin.acknowledgeHandoff({
      sessionId: 'r13-ack-reject-sess',
      accountId: aId,
      claimRevision: rev1,
      claimToken: 'forged-token',
    });

    // Advance to gen 2: gen 1 must be rejected.
    win.__mockRecorder.syncAccountClaim(aId, rev1 + 1, 'tok-gen-2');
    const staleGen = await plugin.acknowledgeHandoff({
      sessionId: 'r13-ack-reject-sess',
      accountId: aId,
      claimRevision: rev1,
      claimToken: tok1,
    });

    // Revoke gen 2: gen 2 must also be rejected.
    win.__mockRecorder.revokeAccountClaim(aId, rev1 + 1);
    const revokedGen = await plugin.acknowledgeHandoff({
      sessionId: 'r13-ack-reject-sess',
      accountId: aId,
      claimRevision: rev1 + 1,
      claimToken: 'tok-gen-2',
    });

    return {
      missingAccount: missingAccount.acknowledged,
      foreignAccount: foreignAccount.acknowledged,
      wrongToken: wrongToken.acknowledged,
      staleGen: staleGen.acknowledged,
      revokedGen: revokedGen.acknowledged,
      sessionAfter: win.__mockRecorder.getSession(),
      pointsAfter: win.__mockRecorder.getPointCount(),
    };
  }, WEB_DRAFT_ACCOUNT_ID);

  expect(probeResult.missingAccount).toBe(false);
  expect(probeResult.foreignAccount).toBe(false);
  expect(probeResult.wrongToken).toBe(false);
  expect(probeResult.staleGen).toBe(false);
  expect(probeResult.revokedGen).toBe(false);
  expect(probeResult.sessionAfter?.status).toBe('stopped');
  expect(probeResult.pointsAfter).toBe(3);
});

test('P2 Round 13: cleanup committing after final draft-ownership read-back leaves no GPS watcher (Start, Resume, Interrupted Recovery)', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockWebGeolocation(page);
  await installPostCommitCleanupInterleave(page);

  // Subcase A: Start
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();
  await page.getByLabel('跑步标题（可选）').fill('R13 Start 读回后清理');
  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'draft-readback'));
  await page.getByTestId('recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-status-badge')).not.toHaveText('记录中');
  expect(await isWebWatching(page)).toBe(false);
  expect(await heldRecordingLocks(page)).toEqual([]);
  const startStore = await readRecordingStoreSummary(page);
  expect(startStore.activeMarker).toBeNull();
  expect(startStore.draft).toBeNull();
  expect(startStore.uploadKeys).toEqual([]);

  // Subcase B: Resume from paused
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();
  await page.getByLabel('跑步标题（可选）').fill('R13 Resume 读回后清理');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);
  await page.getByTestId('recording-pause-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
  expect(await isWebWatching(page)).toBe(false);

  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'draft-readback'));
  await page.getByTestId('recording-resume-btn').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-status-badge')).not.toHaveText('记录中');
  expect(await isWebWatching(page)).toBe(false);
  expect(await heldRecordingLocks(page)).toEqual([]);
  const resumeStore = await readRecordingStoreSummary(page);
  expect(resumeStore.activeMarker).toBeNull();
  expect(resumeStore.draft).toBeNull();
  expect(resumeStore.uploadKeys).toEqual([]);

  // Subcase C: Interrupted recovery resume
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeEnabled();
  await page.getByLabel('跑步标题（可选）').fill('R13 中断恢复读回后清理');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await waitForWebWatch(page);
  await emitWebFix(page, 31.23, 121.47);
  await expect.poll(async () => (await readWebDraftRow(page)).pointCount).toBe(1);
  // Reload to enter interrupted recovery state.
  await page.reload();
  await expect(page.getByTestId('recording-recovery-panel')).toBeVisible();
  expect(await isWebWatching(page)).toBe(false);

  await page.evaluate(() => window.sessionStorage.setItem('__r12_post_commit_cleanup', 'draft-readback'));
  await page.getByTestId('recovery-resume-btn').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__r12CleanupRuns)).toBe(1);
  await expect(page.getByTestId('recording-status-badge')).not.toHaveText('记录中');
  expect(await isWebWatching(page)).toBe(false);
  expect(await heldRecordingLocks(page)).toEqual([]);
  const interruptedStore = await readRecordingStoreSummary(page);
  expect(interruptedStore.activeMarker).toBeNull();
  expect(interruptedStore.draft).toBeNull();
  expect(interruptedStore.uploadKeys).toEqual([]);
});

test('P2 Round 13: stale account A Stop never stops account B native session or leaks B stats, while normal same-account Stop succeeds once', async ({
  page,
}) => {
  const accountBId = '00000000-0000-4000-8000-000000000002';

  // Subcase A: Account A has an active native recording open; native switches to Account B's live session.
  // Even if A's IDB claim has NOT yet been cleared (bridge-level guard) or HAS been replaced by B (pin-level guard),
  // clicking Stop on stale page A must NOT stop B's recording and must NOT display B's stats.
  await loginRunner(page);
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialRecording: true });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect
    .poll(async () => (await readRecordingStoreSummary(page)).activeMarker?.payload ?? null)
    .toBe(WEB_DRAFT_ACCOUNT_ID);

  // Simulate Account B now owning the active native session (with distinct points/distance/title).
  await page.evaluate((bId) => {
    const mock = (
      window as unknown as Record<
        string,
        {
          replaceActiveSession: (s: Record<string, unknown>, pts: Array<Record<string, unknown>>) => void;
          syncAccountClaim: (acc: string, rev: number, tok: string) => boolean;
        }
      >
    ).__mockRecorder;
    mock.replaceActiveSession(
      {
        sessionId: 'account-b-live-sess',
        accountId: bId,
        idempotencyKey: 'bbbbbbbb-1313-4bbb-8bbb-bbbbbbbbbbbb',
        title: '账号B机密长跑',
        status: 'recording',
        startedAtMs: Date.now() - 600_000,
        endedAtMs: null,
        activeDurationMs: 600_000,
        segmentIndex: 0,
        pointCount: 7,
        previewDistanceM: 4320,
        lastPointTimeMs: Date.now() - 10_000,
        lastAccuracyM: 5,
        interruptedReason: null,
        claimRevision: 99,
      },
      Array.from({ length: 7 }, (_, i) => ({
        lat: 31.23 + i * 0.001,
        lon: 121.47,
        elevationM: 12,
        accuracyM: 5,
        recordedAtMs: Date.now() - (7 - i) * 30_000,
        segmentIndex: 0,
      })),
    );
    mock.syncAccountClaim(bId, 99, 'tok-b-99');
  }, accountBId);

  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('recording-error')).toBeVisible();
  await expect(page.getByTestId('recording-pending-handoff-panel')).toHaveCount(0);
  const bodyText = await page.locator('main').innerText();
  expect(bodyText).not.toContain('账号B机密长跑');
  expect(bodyText).not.toContain('4.32');
  expect(bodyText).not.toContain('7 个轨迹点');
  const nativeAfterForeignStop = await readNativeMock(page);
  expect(nativeAfterForeignStop.session?.accountId).toBe(accountBId);
  expect(nativeAfterForeignStop.session?.sessionId).toBe('account-b-live-sess');
  expect(nativeAfterForeignStop.session?.status).toBe('recording');
  expect(nativeAfterForeignStop.pointCount).toBe(7);
  expect(nativeAfterForeignStop.stopRejected).toBeGreaterThanOrEqual(1);

  // Subcase B: Normal same-account manual Stop still finalizes, enqueues, acks, and uploads exactly once.
  let gpxPostCount = 0;
  await page.route('**/api/v1/gpx-imports', async (route) => {
    gpxPostCount += 1;
    await route.continue();
  });
  await installMockLocationRecorder(page, { locationPermission: 'granted', initialRecording: true });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await page.getByTestId('recording-stop-btn').click();
  await expect(page.getByTestId('upload-queue-item')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'uploaded', {
    timeout: 5_000,
  });
  const nativeDone = await readNativeMock(page);
  expect(nativeDone.acks).toEqual(['recording-sess-1']);
  expect(nativeDone.session).toBeNull();
  expect(gpxPostCount).toBe(1);
});
