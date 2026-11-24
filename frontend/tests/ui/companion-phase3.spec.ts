import { expect, test, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

interface MockRecorderConfig {
  locationPermission?: 'granted' | 'approximate' | 'denied';
  notificationPermission?: 'granted' | 'denied' | 'not_required';
  locationServicesEnabled?: boolean;
  onRequestLocationPermission?: 'granted' | 'approximate' | 'denied';
  initialInterrupted?: boolean;
  initialStopped?: boolean;
  stoppedSessionId?: string;
  stoppedIdempotencyKey?: string;
  persistAcrossReloads?: boolean;
}

async function installMockLocationRecorder(page: Page, config: MockRecorderConfig = {}) {
  await page.addInitScript((cfg) => {
    let locationPerm = cfg.locationPermission ?? 'granted';
    let notificationPerm = cfg.notificationPermission ?? 'granted';
    let locEnabled = cfg.locationServicesEnabled ?? true;
    let serviceRunning = false;
    let gpsStatus = 'inactive';
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
      if (cfg.initialInterrupted) {
        return {
          sessionId: 'interrupted-sess-1',
          accountId: '00000000-0000-4000-8000-000000000001',
          idempotencyKey: '99999999-9999-4999-8999-999999999999',
          title: '中断待恢复晨跑',
          status: 'interrupted',
          startedAtMs: Date.now() - 420_000,
          endedAtMs: null,
          activeDurationMs: 360_000,
          segmentIndex: 0,
          pointCount: 3,
          previewDistanceM: 1250,
          lastPointTimeMs: Date.now() - 60_000,
          lastAccuracyM: 8,
          interruptedReason: 'process_terminated',
        };
      }
      return null;
    };

    let session: Record<string, unknown> | null = seedSession();
    let points: Array<Record<string, unknown>> =
      cfg.initialInterrupted || cfg.initialStopped
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

    if (cfg.persistAcrossReloads) {
      try {
        const raw = window.sessionStorage.getItem(PERSIST_KEY);
        if (raw) {
          const restored = JSON.parse(raw) as {
            session?: Record<string, unknown> | null;
            points?: Array<Record<string, unknown>>;
            clearedAccounts?: Array<string | null>;
            acknowledgedSessionIds?: string[];
          };
          session = restored.session ?? null;
          points = Array.isArray(restored.points) ? restored.points : [];
          clearedAccounts = Array.isArray(restored.clearedAccounts) ? restored.clearedAccounts : [];
          acknowledgedSessionIds = Array.isArray(restored.acknowledgedSessionIds)
            ? restored.acknowledgedSessionIds
            : [];
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
          JSON.stringify({ session, points, clearedAccounts, acknowledgedSessionIds }),
        );
      } catch {
        // Ignore storage write errors
      }
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
            if (locationPerm !== 'granted') {
              throw new Error('需要精确位置权限才能记录可靠的跑步轨迹');
            }
            if (session && session.status === 'stopped' && Number(session.pointCount ?? 0) > 0) {
              throw new Error('存在尚未入队的已结束记录，请先保存或显式丢弃');
            }
            if (opts.resumeInterrupted && session) {
              session.status = 'recording';
              session.segmentIndex = Number(session.segmentIndex ?? 0) + 1;
              session.interruptedReason = null;
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
          stopSession: async () => {
            serviceRunning = false;
            gpsStatus = 'inactive';
            if (session) {
              session.status = 'stopped';
              session.endedAtMs = Date.now();
            }
            const out = { ...buildState(), points: [...points] };
            persistState();
            emit();
            return out;
          },
          acknowledgeHandoff: async (opts?: { sessionId?: string }) => {
            const targetId = opts?.sessionId ?? '';
            if (session && session.status === 'stopped' && (!targetId || session.sessionId === targetId)) {
              acknowledgedSessionIds.push(String(session.sessionId));
              session = null;
              points = [];
              persistState();
              emit();
              return { acknowledged: true };
            }
            return { acknowledged: false };
          },
          discardSession: async () => {
            serviceRunning = false;
            gpsStatus = 'inactive';
            session = null;
            points = [];
            persistState();
            emit();
            return { discarded: true };
          },
          getSessionState: async (opts?: { accountId?: string }) => buildState(opts?.accountId),
          getSessionPoints: async (opts?: { accountId?: string }) => {
            const matches = !opts?.accountId || !session || session.accountId === opts.accountId;
            const visible = matches ? [...points] : [];
            return { points: visible, totalReturned: visible.length };
          },
          clearAccountSessions: async (opts?: { keepAccountId?: string | null }) => {
            clearedAccounts.push(opts?.keepAccountId ?? null);
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
