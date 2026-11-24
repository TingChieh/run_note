import { expect, test, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

interface MockRecorderConfig {
  locationPermission?: 'granted' | 'approximate' | 'denied';
  notificationPermission?: 'granted' | 'denied' | 'not_required';
  locationServicesEnabled?: boolean;
  onRequestLocationPermission?: 'granted' | 'approximate' | 'denied';
  initialInterrupted?: boolean;
  initialStopped?: boolean;
}

async function installMockLocationRecorder(page: Page, config: MockRecorderConfig = {}) {
  await page.addInitScript((cfg) => {
    let locationPerm = cfg.locationPermission ?? 'granted';
    let notificationPerm = cfg.notificationPermission ?? 'granted';
    let locEnabled = cfg.locationServicesEnabled ?? true;
    let serviceRunning = false;
    let gpsStatus = 'inactive';

    const seedSession = (): Record<string, unknown> | null => {
      if (cfg.initialStopped) {
        return {
          sessionId: 'stopped-handoff-sess-1',
          accountId: '00000000-0000-4000-8000-000000000001',
          idempotencyKey: '88888888-8888-4888-8888-888888888888',
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
      clearedAccounts: [] as Array<string | null>,
      acknowledgedSessionIds: [] as string[],
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
            emit();
            return { started: true };
          },
          pauseSession: async () => {
            if (session) session.status = 'paused';
            gpsStatus = 'inactive';
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
            emit();
            return out;
          },
          acknowledgeHandoff: async (opts?: { sessionId?: string }) => {
            const targetId = opts?.sessionId ?? '';
            if (session && session.status === 'stopped' && (!targetId || session.sessionId === targetId)) {
              (win.__mockRecorder as { acknowledgedSessionIds: string[] }).acknowledgedSessionIds.push(
                String(session.sessionId),
              );
              session = null;
              points = [];
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
            (win.__mockRecorder as { clearedAccounts: Array<string | null> }).clearedAccounts.push(
              opts?.keepAccountId ?? null,
            );
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
