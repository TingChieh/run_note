import { expect, test, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

interface MockRecorderConfig {
  locationPermission?: 'granted' | 'approximate' | 'denied';
  notificationPermission?: 'granted' | 'denied' | 'not_required';
  locationServicesEnabled?: boolean;
  onRequestLocationPermission?: 'granted' | 'approximate' | 'denied';
  initialInterrupted?: boolean;
}

async function installMockLocationRecorder(page: Page, config: MockRecorderConfig = {}) {
  await page.addInitScript((cfg) => {
    let locationPerm = cfg.locationPermission ?? 'granted';
    let notificationPerm = cfg.notificationPermission ?? 'granted';
    let locEnabled = cfg.locationServicesEnabled ?? true;
    let serviceRunning = false;
    let gpsStatus = 'inactive';
    let session: Record<string, unknown> | null = cfg.initialInterrupted
      ? {
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
        }
      : null;

    let points: Array<Record<string, unknown>> = cfg.initialInterrupted
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
      canRecord: (locationPerm === 'granted' || locationPerm === 'approximate') && locEnabled,
    });
    const buildState = () => ({
      serviceRunning,
      status: session ? session.status : 'idle',
      gpsStatus,
      permissions: buildPerms(),
      session: session ? { ...session } : null,
    });
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
          discardSession: async () => {
            serviceRunning = false;
            gpsStatus = 'inactive';
            session = null;
            points = [];
            emit();
            return { discarded: true };
          },
          getSessionState: async () => buildState(),
          getSessionPoints: async () => ({ points: [...points], totalReturned: points.length }),
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

test('handles permission denied, approximate location, notification denied, and location services off', async ({
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
  await expect(page.getByTestId('recording-notification-warning')).toBeVisible();

  await installMockLocationRecorder(page, {
    locationPermission: 'granted',
    locationServicesEnabled: false,
  });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-location-disabled')).toBeVisible();
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

  // Pause & resume onto segment 2
  await page.getByTestId('recording-pause-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
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

  // Stop & Save while offline -> queued locally, 0 POSTs
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
