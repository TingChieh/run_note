import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities.ts';

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.evaluate((next) => {
    localStorage.setItem('runnote-theme', next);
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event('runnote-theme-change'));
  }, theme);
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function installMockNativeRecorder(page: Page) {
  await page.addInitScript(() => {
    type Point = {
      lat: number;
      lon: number;
      elevationM: number | null;
      accuracyM: number | null;
      recordedAtMs: number;
      segmentIndex: number;
    };
    let session: Record<string, unknown> | null = null;
    let points: Point[] = [];
    let gpsStatus = 'good';
    let serviceRunning = false;
    const listeners: Array<(payload: unknown) => void> = [];
    const perms = {
      location: 'granted',
      notification: 'granted',
      locationServicesEnabled: true,
      preciseLocation: true,
      canRecord: true,
    };
    const buildState = () => ({
      serviceRunning,
      status: session ? session.status : 'idle',
      gpsStatus,
      permissions: perms,
      session: session ? { ...session } : null,
    });
    const emit = () => {
      const payload = buildState();
      for (const fn of listeners) fn(payload);
    };
    (window as unknown as Record<string, unknown>).__editorialMockRecorder = {
      pushPoints(pts: Point[], totalDistanceM: number, totalDurationMs: number) {
        if (!session) return;
        points = [...points, ...pts];
        session.pointCount = points.length;
        session.previewDistanceM = totalDistanceM;
        session.activeDurationMs = totalDurationMs;
        session.lastAccuracyM = 6;
        gpsStatus = 'good';
        emit();
      },
    };
    (window as unknown as Record<string, unknown>).Capacitor = {
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
          checkPermissions: async () => perms,
          requestPermissions: async () => perms,
          openAppSettings: async () => ({ opened: true }),
          openLocationSettings: async () => ({ opened: true }),
          startSession: async (opts: Record<string, unknown>) => {
            points = [];
            session = {
              sessionId: opts.sessionId,
              accountId: opts.accountId,
              idempotencyKey: opts.idempotencyKey,
              title: opts.title ?? '',
              status: 'recording',
              startedAtMs: Date.now() - 18 * 60_000,
              endedAtMs: null,
              activeDurationMs: 0,
              segmentIndex: 0,
              pointCount: 0,
              previewDistanceM: 0,
              lastPointTimeMs: Date.now(),
              lastAccuracyM: 6,
              interruptedReason: null,
            };
            serviceRunning = true;
            gpsStatus = 'good';
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
            gpsStatus = 'good';
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
          acknowledgeHandoff: async () => {
            session = null;
            points = [];
            emit();
            return { acknowledged: true };
          },
          syncAccountClaim: async () => ({ synced: true }),
          revokeAccountClaim: async () => ({ revoked: true }),
          discardSession: async () => {
            session = null;
            points = [];
            emit();
            return { discarded: true };
          },
          getSessionState: async () => buildState(),
          getSessionPoints: async () => ({ points: [...points], totalReturned: points.length }),
          clearAccountSessions: async () => ({ cleared: false }),
          addListener: (_name: string, fn: (payload: unknown) => void) => {
            listeners.push(fn);
            return { remove: () => {} };
          },
        },
      },
    };
  });
}

test('mobile home puts week goal and 7-day punch card first while desktop keeps 4-column order', async ({ page }) => {
  await loginRunner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'light');
  await page.goto('/');
  await expect(page.getByTestId('annual-distance')).toBeVisible();
  const weekCard = page.locator('.goal-card[data-period="week"]');
  const yearCard = page.locator('.goal-card[data-period="year"]');
  await expect(weekCard).toBeVisible();
  await expect(yearCard).toBeVisible();
  await expectNoOverflow(page);

  const weekBox = await weekCard.boundingBox();
  const yearBox = await yearCard.boundingBox();
  expect(weekBox!.y).toBeLessThan(yearBox!.y);
  await expect(page.locator('.week-punch').first()).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  await setTheme(page, 'dark');
  await expectNoOverflow(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'light');
  await expectNoOverflow(page);
  const desktopYearBox = await yearCard.boundingBox();
  const desktopWeekBox = await weekCard.boundingBox();
  expect(desktopYearBox!.x).toBeLessThan(desktopWeekBox!.x);
});

test('mobile recording flow: pre-run -> single Pause + screen lock -> paused confirm dialog -> serrated done receipt', async ({
  page,
  context,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await loginRunner(page);
  await installMockNativeRecorder(page);

  for (const vp of [
    { width: 390, height: 844, theme: 'light' as const },
    { width: 320, height: 640, theme: 'dark' as const },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setTheme(page, vp.theme);
    await page.goto('/activities/record');

    // Screen 2: Pre-run
    const startBtn = page.getByTestId('recording-start-btn');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();
    await expectNoOverflow(page);
    const startBox = await startBtn.boundingBox();
    expect(startBox!.height).toBeGreaterThanOrEqual(48);
    const titleFontPx = await page
      .getByLabel('跑步标题（可选）')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(titleFontPx).toBeGreaterThanOrEqual(16);

    // Screen 3: Active Recording
    await page.getByLabel('跑步标题（可选）').fill('移动端验收跑');
    await startBtn.click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
    await expect(page.locator('[data-recording-immersive]')).toBeVisible();
    await expect(page.getByTestId('recording-stop-btn')).toHaveCount(0);
    await expect(page.getByLabel('跑步标题（可选）')).toHaveCount(0);

    await page.evaluate(() => {
      const rec = (window as unknown as Record<string, { pushPoints: (pts: unknown[], d: number, ms: number) => void }>)
        .__editorialMockRecorder;
      const base = Date.now() - 18 * 60_000;
      const pts = Array.from({ length: 25 }, (_, i) => ({
        lat: 31.23 + i * 0.001,
        lon: 121.47,
        elevationM: 12,
        accuracyM: 6,
        recordedAtMs: base + i * 36_000,
        segmentIndex: 0,
      }));
      rec.pushPoints(pts, 2670, 900_000);
    });
    await expect(page.getByTestId('recording-distance')).toContainText('2.67 km');
    await expectNoOverflow(page);

    const pauseBtn = page.getByTestId('recording-pause-btn');
    const pauseBox = await pauseBtn.boundingBox();
    expect(pauseBox!.height).toBeGreaterThanOrEqual(64);

    // Screen lock disables Pause until unlocked
    const lockBtn = page.getByTestId('recording-lock-btn');
    const lockBox = await lockBtn.boundingBox();
    expect(lockBox!.width).toBeGreaterThanOrEqual(44);
    expect(lockBox!.height).toBeGreaterThanOrEqual(44);
    await lockBtn.click();
    await expect(lockBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(pauseBtn).toBeDisabled();
    await lockBtn.click();
    await expect(lockBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(pauseBtn).toBeEnabled();

    // Paused state -> single tap opens WCAG 2.5.1 confirmation dialog
    await pauseBtn.click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
    await expect(page.getByTestId('recording-resume-btn')).toBeVisible();
    await expect(page.getByTestId('recording-discard-btn')).toBeVisible();
    await expectNoOverflow(page);

    // Go offline before finishing so Done receipt shows honest pending queue state first
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await page.getByTestId('recording-stop-btn').click();
    const finishDialog = page.getByTestId('recording-finish-dialog');
    await expect(finishDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(finishDialog).not.toBeVisible();

    await page.getByTestId('recording-stop-btn').click();
    await expect(finishDialog).toBeVisible();
    await page.getByTestId('recording-finish-confirm-btn').click();

    // Screen 4: Done serrated receipt (offline pending -> reconnect -> uploaded authoritative)
    const doneSheet = page.getByTestId('recording-done-sheet');
    await expect(doneSheet).toBeVisible();
    await expect(doneSheet).toContainText('本地预览');
    await expect(doneSheet).toContainText('本机上传队列');
    await expect(page.getByTestId('upload-queue-item').first()).toHaveAttribute('data-status', 'pending');
    await expectNoOverflow(page);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(doneSheet).toContainText('服务端权威指标', { timeout: 10_000 });
    await expect(page.getByRole('link', { name: '查看跑步详情' })).toBeVisible();
    await expectNoOverflow(page);

    // Clean up queue item before next viewport iteration
    await page.getByRole('button', { name: '再跑一次' }).click();
    await expect(page.getByTestId('recording-start-btn')).toBeVisible();
  }

  expect(pageErrors).toEqual([]);
});

test('mobile activity detail and story share dialog stay flat Editorial Receipt with zero overflow at 390 and 320', async ({
  page,
}) => {
  await installActivities(page);
  await loginRunner(page);

  for (const vp of [
    { width: 390, height: 844, theme: 'light' as const },
    { width: 320, height: 640, theme: 'dark' as const },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setTheme(page, vp.theme);

    // Screen 5: Activity Detail (map first, then receipt stub)
    await page.goto(`/activities/${sampleActivity.id}`);
    await expect(page.getByTestId('route-map-ready')).toBeVisible();
    await expectNoOverflow(page);
    const mapBox = await page.locator('.route-map').boundingBox();
    const stubBox = await page.getByRole('region', { name: '运动指标' }).boundingBox();
    expect(mapBox!.y).toBeLessThan(stubBox!.y);

    // Screen 6: Story Share Dialog (flat Editorial Receipt controls, readable active segment, focus restore)
    await page.goto('/workspace/records/story?year=2025');
    const trigger = page.getByRole('button', { name: '生成海报' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const dialog = page.getByTestId('story-poster-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/editorial-page/);
    await expect(page.getByTestId('story-poster-image')).toBeVisible({ timeout: 15_000 });
    await expectNoOverflow(page);

    const lightBtn = dialog.getByRole('button', { name: '浅色纸面' });
    const darkBtn = dialog.getByRole('button', { name: '深色暖炭' });
    await lightBtn.click();
    await expect(lightBtn).toHaveAttribute('aria-pressed', 'true');
    const activeColors = await lightBtn.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color };
    });
    expect(activeColors.bg).not.toBe(activeColors.fg);
    await darkBtn.click();
    await expect(darkBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: '保存 PNG' })).toBeEnabled();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});
