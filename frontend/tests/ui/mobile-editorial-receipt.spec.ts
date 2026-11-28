import { expect, test, type Page } from '@playwright/test';
import { incompleteActivity, installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

const SHOT_DIR = process.env.MOBILE_EDITORIAL_SHOTS ?? '';

async function maybeShot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  await page.waitForTimeout(220);
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    localStorage.setItem('runnote-theme', value);
    document.documentElement.dataset.theme = value;
    window.dispatchEvent(new Event('runnote-theme-change'));
  }, theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function expectNoOverflow(page: Page, label: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
      message: `${label}: no horizontal overflow`,
    })
    .toBe(true);
}

function buildCalendarDays(year: number, overrides: Record<string, number> = {}) {
  const days: {
    date: string;
    activity_count: number;
    distance_m: number;
    duration_sum_seconds: number | null;
    known_duration_count: number;
    missing_duration_count: number;
  }[] = [];
  for (let d = new Date(`${year}-01-01T00:00:00Z`); d.getUTCFullYear() === year; d = new Date(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, iso);
    const dist = hasOverride ? overrides[iso] : 0;
    days.push({
      date: iso,
      activity_count: hasOverride ? 1 : 0,
      distance_m: dist,
      duration_sum_seconds: hasOverride ? 1200 : null,
      known_duration_count: hasOverride ? 1 : 0,
      missing_duration_count: 0,
    });
  }
  return days;
}

interface MockNativePoint {
  lat: number;
  lon: number;
  recordedAtMs: number;
  segmentIndex: number;
  accuracyM?: number;
}

async function installMockNativeRecorder(page: Page, options?: { failGetPoints?: boolean }) {
  await page.addInitScript((opts) => {
    const state = {
      status: 'idle' as 'idle' | 'recording' | 'paused' | 'stopped',
      gpsStatus: 'good',
      sessionId: '',
      accountId: '',
      idempotencyKey: '',
      title: '',
      startedAtMs: 0,
      endedAtMs: null as number | null,
      activeDurationMs: 0,
      segmentIndex: 0,
      previewDistanceM: 0,
      lastAccuracyM: 6 as number | null,
      points: [] as MockNativePoint[],
      getPointsCalls: 0,
      failGetPoints: opts.failGetPoints === true,
      listeners: new Set<(payload: unknown) => void>(),
    };

    const buildEvent = () => ({
      serviceRunning: state.status === 'recording' || state.status === 'paused',
      status: state.status,
      gpsStatus: state.gpsStatus,
      permissions: {
        location: 'granted',
        notification: 'granted',
        locationServicesEnabled: true,
        preciseLocation: true,
        canRecord: true,
      },
      session:
        state.status === 'idle'
          ? null
          : {
              sessionId: state.sessionId,
              accountId: state.accountId,
              idempotencyKey: state.idempotencyKey,
              title: state.title,
              status: state.status,
              startedAtMs: state.startedAtMs,
              endedAtMs: state.endedAtMs,
              activeDurationMs: state.activeDurationMs,
              segmentIndex: state.segmentIndex,
              pointCount: state.points.length,
              previewDistanceM: state.previewDistanceM,
              lastPointTimeMs: state.points.at(-1)?.recordedAtMs ?? null,
              lastAccuracyM: state.lastAccuracyM,
              interruptedReason: null,
            },
    });

    const emit = () => {
      const payload = buildEvent();
      for (const listener of state.listeners) listener(payload);
    };

    const plugin = {
      async getCapabilities() {
        return {
          platform: 'android',
          backgroundSupported: true,
          requiresNotificationPermission: false,
          locationServicesEnabled: true,
        };
      },
      async checkPermissions() {
        return buildEvent().permissions;
      },
      async requestPermissions() {
        return buildEvent().permissions;
      },
      async getSessionState() {
        return buildEvent();
      },
      async getSessionPoints(args: { afterIndex?: number }) {
        state.getPointsCalls += 1;
        if (state.failGetPoints) {
          throw new Error('simulated bridge read failure');
        }
        const after = Number(args?.afterIndex ?? 0);
        return { points: state.points.slice(after) };
      },
      async startSession(args: { sessionId: string; accountId: string; idempotencyKey: string; title?: string }) {
        state.status = 'recording';
        state.sessionId = args.sessionId;
        state.accountId = args.accountId;
        state.idempotencyKey = args.idempotencyKey;
        state.title = args.title ?? '';
        state.startedAtMs = Date.now() - 1_000;
        state.endedAtMs = null;
        state.activeDurationMs = 0;
        state.segmentIndex = 0;
        state.previewDistanceM = 0;
        state.points = [];
        state.gpsStatus = 'good';
        emit();
      },
      async pauseSession() {
        state.status = 'paused';
        emit();
      },
      async resumeSession() {
        state.status = 'recording';
        state.segmentIndex += 1;
        emit();
      },
      async stopSession() {
        state.status = 'stopped';
        state.endedAtMs = Date.now();
        const ev = buildEvent();
        return { ...ev, points: [...state.points] };
      },
      async discardSession() {
        state.status = 'idle';
        state.points = [];
        state.previewDistanceM = 0;
        emit();
      },
      async acknowledgeHandoff() {
        state.status = 'idle';
        state.points = [];
        emit();
        return { acknowledged: true };
      },
      async syncAccountClaim() {
        return { synced: true };
      },
      async clearAccountSessions() {
        return { cleared: true };
      },
      async addListener(_name: string, fn: (payload: unknown) => void) {
        state.listeners.add(fn);
        return {
          remove() {
            state.listeners.delete(fn);
          },
        };
      },
    };

    const w = window as unknown as Record<string, unknown>;
    w.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { LocationRecorder: plugin },
    };
    w.__mobileRecMock = {
      setPointsAndEmit(next: {
        points: MockNativePoint[];
        previewDistanceM: number;
        activeDurationMs: number;
        lastAccuracyM?: number | null;
        gpsStatus?: string;
      }) {
        state.points = next.points;
        state.previewDistanceM = next.previewDistanceM;
        state.activeDurationMs = next.activeDurationMs;
        if (next.lastAccuracyM !== undefined) state.lastAccuracyM = next.lastAccuracyM;
        if (next.gpsStatus !== undefined) state.gpsStatus = next.gpsStatus;
        emit();
      },
      emitAgain() {
        emit();
      },
      setFailGetPoints(flag: boolean) {
        state.failGetPoints = flag;
      },
      getPointsCallCount() {
        return state.getPointsCalls;
      },
      resetCallCount() {
        state.getPointsCalls = 0;
      },
    };
  }, options ?? {});
}

test('home: week-punch stays independent of browsed year, handles cross-year/missing/zero distance with active dot, and orders week first on <800px', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await installActivities(page);
  await page.clock.setFixedTime(new Date('2026-11-26T08:00:00Z'));

  const cal2026 = buildCalendarDays(2026, { '2026-11-23': 3900, '2026-11-25': 2800 });
  const cal2025 = buildCalendarDays(2025, { '2025-10-10': 5000 });

  await page.route('**/api/v1/showcase/statistics/streaks', (route) =>
    route.fulfill({
      json: {
        data: {
          today: '2026-11-26',
          current_days: 2,
          longest_days: 6,
          current_weeks: 3,
          longest_weeks: 8,
          week: [
            { date: '2026-11-23', active: true },
            { date: '2026-11-24', active: false },
            { date: '2026-11-25', active: true },
            { date: '2026-11-26', active: false },
            { date: '2026-11-27', active: false },
            { date: '2026-11-28', active: false },
            { date: '2026-11-29', active: false },
          ],
        },
        error: null,
      },
    }),
  );
  await page.route('**/api/v1/showcase/statistics/calendar**', (route) => {
    const url = new URL(route.request().url());
    const year = Number(url.searchParams.get('year'));
    const metric = url.searchParams.get('metric') ?? 'distance';
    const days = year === 2025 ? cal2025 : cal2026;
    return route.fulfill({
      json: {
        data: { year, metric, days, activity_count: 2, distance_m: 6700, date_assignment: 'activity_local_date' },
        error: null,
      },
    });
  });

  await loginRunner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('week-punch')).toBeVisible();

  // Week & streak appear above month & year on <800px.
  const weekBox = (await page.locator('.goal-card[data-period="week"]').boundingBox())!;
  const streakBox = (await page.locator('.goal-card[data-period="streak"]').boundingBox())!;
  const yearBox = (await page.locator('.goal-card[data-period="year"]').boundingBox())!;
  expect(weekBox.y).toBeLessThan(streakBox.y);
  expect(streakBox.y).toBeLessThan(yearBox.y);

  // Proportional blocks on Mon (3.9km -> 5) & Wed (2.8km -> 4).
  const mon = page.locator('[data-testid="week-punch-day"][data-punch-date="2026-11-23"]');
  const wed = page.locator('[data-testid="week-punch-day"][data-punch-date="2026-11-25"]');
  await expect(mon).toHaveAttribute('data-blocks', '5');
  await expect(wed).toHaveAttribute('data-blocks', '4');

  await setTheme(page, 'light');
  await expectNoOverflow(page, 'home-390-light');
  await maybeShot(page, 'home-390-light');
  await setTheme(page, 'dark');
  await expectNoOverflow(page, 'home-390-dark');
  await maybeShot(page, 'home-390-dark');

  // Switch browsed year to 2025 -> current-week punch blocks stay intact (independent of browsed year!).
  await page.getByRole('button', { name: '上一年', exact: true }).click();
  await expect(page.locator('#calendar-year')).toHaveValue('2025');
  await expect(mon).toHaveAttribute('data-blocks', '5');
  await expect(wed).toHaveAttribute('data-blocks', '4');

  // 320x640, 768x1024, 1440x900 regression checks.
  for (const [w, h, tag] of [
    [320, 640, 'home-320'],
    [768, 1024, 'home-768'],
    [1440, 900, 'home-1440'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expectNoOverflow(page, `${tag}-${theme}`);
      if (w === 320 || theme === 'light') await maybeShot(page, `${tag}-${theme}`);
    }
  }

  // Cross-year week + missing 2025 calendar + 0m distance on today -> active dot, 0 blocks!
  await page.unroute('**/api/v1/showcase/statistics/streaks');
  await page.unroute('**/api/v1/showcase/statistics/calendar**');
  await page.route('**/api/v1/showcase/statistics/streaks', (route) =>
    route.fulfill({
      json: {
        data: {
          today: '2026-01-01',
          current_days: 2,
          longest_days: 4,
          current_weeks: 1,
          longest_weeks: 2,
          week: [
            { date: '2025-12-29', active: true },
            { date: '2025-12-30', active: false },
            { date: '2025-12-31', active: true },
            { date: '2026-01-01', active: true },
            { date: '2026-01-02', active: false },
            { date: '2026-01-03', active: false },
            { date: '2026-01-04', active: false },
          ],
        },
        error: null,
      },
    }),
  );
  await page.route('**/api/v1/showcase/statistics/calendar**', (route) => {
    const url = new URL(route.request().url());
    const year = Number(url.searchParams.get('year'));
    if (year === 2025) {
      return route.fulfill({ status: 503, json: { error: { message: '2025 日历暂不可用' } } });
    }
    const days = buildCalendarDays(2026, { '2026-01-01': 0 });
    return route.fulfill({
      json: {
        data: {
          year: 2026,
          metric: 'distance',
          days,
          activity_count: 1,
          distance_m: 0,
          date_assignment: 'activity_local_date',
        },
        error: null,
      },
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('week-punch')).toBeVisible();
  for (const date of ['2025-12-29', '2025-12-31', '2026-01-01']) {
    const day = page.locator(`[data-testid="week-punch-day"][data-punch-date="${date}"]`);
    await expect(day).toHaveAttribute('data-blocks', '0');
    await expect(day).toHaveAttribute('data-active-dot', 'true');
    await expect(day.getByTestId('week-punch-active-dot')).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test('recording flow: pre-run, native 7-decimal splits, bounded retries, 320x640 paused + centered finish dialog + done receipt scroll-to-top', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await installActivities(page);
  await installMockNativeRecorder(page);
  await loginRunner(page);

  // 1. Pre-run screen across 390 & 320 light/dark
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/activities/record');
  await expect(page.getByTestId('recording-start-btn')).toBeVisible();
  await expect(page.getByTestId('prerun-gps-readout')).toContainText('已就绪');
  await setTheme(page, 'light');
  await expectNoOverflow(page, 'prerun-390-light');
  await maybeShot(page, 'prerun-390-light');
  await setTheme(page, 'dark');
  await expectNoOverflow(page, 'prerun-390-dark');
  await maybeShot(page, 'prerun-390-dark');

  await page.setViewportSize({ width: 320, height: 640 });
  await setTheme(page, 'light');
  await expectNoOverflow(page, 'prerun-320-light');
  await maybeShot(page, 'prerun-320-light');
  await setTheme(page, 'dark');
  await expectNoOverflow(page, 'prerun-320-dark');
  await maybeShot(page, 'prerun-320-dark');

  // 2. Start native recording at 390x844, test offline status row + exact typography + 7-decimal split补齐
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'light');
  await page.getByLabel('跑步标题（可选）').fill('移动端票据测试跑');
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');
  await expect(page.getByTestId('recording-stop-btn')).toHaveCount(0); // mobile hides direct stop during recording!

  // Switch offline -> verify `● 记录中 · GPS ±6 m · 离线` status row visible!
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  // Batch 1: 7-decimal rounded points sum to ~999.64m while previewDistanceM reports 1000.01m.
  // Live split must NOT mark km 1 complete yet!
  await page.evaluate(() => {
    const mock = (window as unknown as Record<string, { setPointsAndEmit: (arg: unknown) => void }>).__mobileRecMock;
    const t0 = Date.now() - 700_000;
    (window as unknown as Record<string, number>).__testRunT0 = t0;
    const pts: MockNativePoint[] = [];
    // ~999.64m along meridian (0.00899 deg lat ≈ 999.64m), 10 points -> 315s
    for (let i = 0; i <= 9; i += 1) {
      pts.push({
        lat: Number((31.23 + (0.00899 * i) / 9).toFixed(7)),
        lon: 121.47,
        recordedAtMs: t0 + i * 35_000,
        segmentIndex: 0,
        accuracyM: 6,
      });
    }
    (window as unknown as Record<string, MockNativePoint[]>).__testBatch1Pts = pts;
    mock.setPointsAndEmit({ points: pts, previewDistanceM: 1000.01, activeDurationMs: 315_000, lastAccuracyM: 6 });
  });

  await expect(page.getByTestId('recording-status-row')).toContainText('记录中');
  await expect(page.getByTestId('recording-status-row')).toContainText('GPS ±6 m');
  await expect(page.getByTestId('recording-top-offline')).toHaveText('离线');
  await expect(page.getByTestId('recording-live-split')).not.toContainText('上一公里');

  // Verify hero distance min(8.5rem, 31vw) and dual metrics 3.25rem (52px) at 390px!
  const recTypography = await page.evaluate(() => {
    const dist = document.querySelector('[data-testid="recording-distance"]')!;
    const dur = document.querySelector('[data-testid="recording-duration"]')!;
    const pace = document.querySelector('[data-testid="recording-pace"]')!;
    return {
      distPx: parseFloat(getComputedStyle(dist).fontSize),
      durPx: parseFloat(getComputedStyle(dur).fontSize),
      pacePx: parseFloat(getComputedStyle(pace).fontSize),
    };
  });
  expect(recTypography.distPx).toBeCloseTo(390 * 0.31, 0);
  expect(recTypography.durPx).toBeCloseTo(52, 0);
  expect(recTypography.pacePx).toBeCloseTo(52, 0);

  // Batch 2: append monotonically continuing points after Batch 1 up to 2.2 km:
  // km 1 finishes at ~315s (5:15/km), km 2 takes 290s (4:50/km -> fastest full km),
  // and 200m sprint tail takes 48s (4:00/km -> must NOT win fastest full km!).
  await page.evaluate(() => {
    const win = window as unknown as Record<string, unknown>;
    const mock = win.__mobileRecMock as { setPointsAndEmit: (arg: unknown) => void };
    const t0 = win.__testRunT0 as number;
    const basePts = [...(win.__testBatch1Pts as MockNativePoint[])];
    const degPerM = 1 / 111_195;
    // Append 10 points for km 2 (crossing 1000m then 10x100m -> 2000m, 290s total)
    for (let i = 1; i <= 10; i += 1) {
      basePts.push({
        lat: Number((31.23 + (1000 + i * 100) * degPerM).toFixed(7)),
        lon: 121.47,
        recordedAtMs: t0 + 315_000 + i * 29_000,
        segmentIndex: 0,
        accuracyM: 6,
      });
    }
    // Append 200m sprint tail (48s -> 4:00/km faster than full km 2)
    basePts.push({
      lat: Number((31.23 + 2200 * degPerM).toFixed(7)),
      lon: 121.47,
      recordedAtMs: t0 + 605_000 + 48_000,
      segmentIndex: 0,
      accuracyM: 6,
    });
    win.__testBatch2Pts = basePts;
    mock.setPointsAndEmit({ points: basePts, previewDistanceM: 2200, activeDurationMs: 653_000, lastAccuracyM: 6 });
  });

  await expect(page.getByTestId('recording-live-split')).toContainText('第 3 公里');
  await expect(page.getByTestId('recording-live-split')).toContainText('上一公里');

  await expectNoOverflow(page, 'recording-390-light');
  await maybeShot(page, 'recording-390-light');
  await setTheme(page, 'dark');
  await expectNoOverflow(page, 'recording-390-dark');
  await maybeShot(page, 'recording-390-dark');

  // Lock screen disables pause button; unlock restores it.
  await page.getByTestId('recording-lock-btn').click();
  await expect(page.getByTestId('recording-pause-btn')).toBeDisabled();
  await page.getByTestId('recording-lock-btn').click();
  await expect(page.getByTestId('recording-pause-btn')).toBeEnabled();

  // 320x640 narrow screen + explicit 123.45 km long distance check -> 0 overflow!
  await page.setViewportSize({ width: 320, height: 640 });
  await setTheme(page, 'light');
  await page.evaluate(() => {
    const win = window as unknown as Record<string, unknown>;
    const mock = win.__mobileRecMock as { setPointsAndEmit: (arg: unknown) => void };
    mock.setPointsAndEmit({
      points: win.__testBatch2Pts as MockNativePoint[],
      previewDistanceM: 123_450,
      activeDurationMs: 36_600_000,
      lastAccuracyM: 6,
    });
  });
  await expect(page.getByTestId('recording-distance')).toContainText('123.45');
  await expectNoOverflow(page, 'recording-320-long-distance');
  // Restore realistic 2.20 km metrics for narrow recording/paused/done screenshots
  await page.evaluate(() => {
    const win = window as unknown as Record<string, unknown>;
    const mock = win.__mobileRecMock as { setPointsAndEmit: (arg: unknown) => void };
    mock.setPointsAndEmit({
      points: win.__testBatch2Pts as MockNativePoint[],
      previewDistanceM: 2200,
      activeDurationMs: 653_000,
      lastAccuracyM: 6,
    });
  });
  await expectNoOverflow(page, 'recording-320-light');
  await maybeShot(page, 'recording-320-light');
  await setTheme(page, 'dark');
  await expectNoOverflow(page, 'recording-320-dark');
  await maybeShot(page, 'recording-320-dark');

  // 3. Pause on 320x640 -> both "继续跑步" & "长按 1.5 秒结束并保存" MUST be visible in first screen!
  await setTheme(page, 'light');
  await page.getByTestId('recording-pause-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('已暂停');
  await expect(page.getByTestId('recording-paused-back')).toBeVisible();
  const stopBtn = page.getByTestId('recording-stop-btn');
  await expect(stopBtn).toContainText('长按 1.5 秒结束并保存');
  const stopBox = (await stopBtn.boundingBox())!;
  expect(stopBox.y).toBeGreaterThanOrEqual(0);
  expect(stopBox.y + stopBox.height).toBeLessThanOrEqual(640);
  await expectNoOverflow(page, 'paused-320-light');
  await maybeShot(page, 'paused-320-light');
  await setTheme(page, 'dark');
  await maybeShot(page, 'paused-320-dark');

  // Also capture 390x844 paused light/dark
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'light');
  await maybeShot(page, 'paused-390-light');
  await setTheme(page, 'dark');
  await maybeShot(page, 'paused-390-dark');

  // 4. Tap finish button on 320x640 -> opens centered finish confirmation dialog within viewport!
  await page.setViewportSize({ width: 320, height: 640 });
  await setTheme(page, 'light');
  await stopBtn.click();
  const finishDialog = page.getByTestId('recording-finish-dialog');
  await expect(finishDialog).toBeVisible();
  const dialogBox = (await finishDialog.boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(8);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(312);
  expect(dialogBox.y).toBeGreaterThanOrEqual(8);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(632);
  // Centered horizontally & vertically
  expect(Math.abs(dialogBox.x + dialogBox.width / 2 - 160)).toBeLessThan(8);
  expect(Math.abs(dialogBox.y + dialogBox.height / 2 - 320)).toBeLessThan(24);

  // 5. Confirm finish -> done receipt appears, scrolls back to top (scrollY === 0), fastest km is full km 2 (NOT 0.2 tail!)
  await page.getByTestId('recording-finish-confirm-btn').click();
  await expect(page.getByTestId('recording-done-receipt')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId('recording-done-sync-status')).toContainText('已保存在本机');
  await expect(page.getByTestId('recording-done-fastest')).toContainText('第 2 km');
  await expect(page.getByTestId('recording-done-fastest')).not.toContainText('0.2');
  await expectNoOverflow(page, 'done-320-light');
  await maybeShot(page, 'done-320-light');
  await setTheme(page, 'dark');
  await maybeShot(page, 'done-320-dark');

  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'light');
  await expectNoOverflow(page, 'done-390-light');
  await maybeShot(page, 'done-390-light');
  await setTheme(page, 'dark');
  await maybeShot(page, 'done-390-dark');

  // 6. Bounded retry test: bridge failures cap at 2 attempts (1 -> 2 -> 2), never spin!
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByTestId('recording-new-run-btn').click();
  await page.evaluate(() => {
    const mock = (
      window as unknown as Record<string, { setFailGetPoints: (v: boolean) => void; resetCallCount: () => void }>
    ).__mobileRecMock;
    mock.resetCallCount();
    mock.setFailGetPoints(true);
  });
  await page.getByTestId('recording-start-btn').click();
  await expect(page.getByTestId('recording-status-badge')).toHaveText('记录中');

  // Emit 1st failure batch
  await page.evaluate(() => {
    const mock = (window as unknown as Record<string, { setPointsAndEmit: (arg: unknown) => void }>).__mobileRecMock;
    const pts: MockNativePoint[] = Array.from({ length: 12 }, (_, i) => ({
      lat: 31.23 + i * 0.001,
      lon: 121.47,
      recordedAtMs: Date.now() - (12 - i) * 10_000,
      segmentIndex: 0,
      accuracyM: 6,
    }));
    mock.setPointsAndEmit({ points: pts, previewDistanceM: 1200, activeDurationMs: 360_000, lastAccuracyM: 6 });
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as Record<string, { getPointsCallCount: () => number }>
        ).__mobileRecMock.getPointsCallCount(),
      ),
    )
    .toBe(1);

  // Emit 2nd update -> retry #2 (hits max 2)
  await page.evaluate(() =>
    (window as unknown as Record<string, { emitAgain: () => void }>).__mobileRecMock.emitAgain(),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as Record<string, { getPointsCallCount: () => number }>
        ).__mobileRecMock.getPointsCallCount(),
      ),
    )
    .toBe(2);

  // Emit 3rd, 4th, 5th updates -> stays capped at 2 (zero spin!)
  await page.evaluate(() => {
    const mock = (window as unknown as Record<string, { emitAgain: () => void }>).__mobileRecMock;
    mock.emitAgain();
    mock.emitAgain();
    mock.emitAgain();
  });
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() =>
      (window as unknown as Record<string, { getPointsCallCount: () => number }>).__mobileRecMock.getPointsCallCount(),
    ),
  ).toBe(2);

  // Clean up active session before ending
  await page.getByTestId('recording-pause-btn').click();
  await page.getByTestId('recording-discard-btn').click();
  await page.getByTestId('recording-discard-confirm-btn').click();

  expect(errors).toEqual([]);
});

test('detail: <800px puts map first, toolbar second, stub third in both visual and keyboard Tab order, with 3-col trio on <640px', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const state = await installActivities(page);
  Object.assign(state.records[0], { timer_seconds: '1740', avg_heart_rate_bpm: 162, calories_kcal: 310, steps: 5400 });
  await loginRunner(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20_000 });

  const mapBox = (await page.locator('.route-panel').boundingBox())!;
  const toolbarBox = (await page.getByTestId('detail-toolbar').boundingBox())!;
  const stubBox = (await page.getByRole('region', { name: '运动指标' }).boundingBox())!;
  expect(mapBox.y).toBeLessThan(toolbarBox.y);
  expect(toolbarBox.y).toBeLessThan(stubBox.y);

  // First 3 metrics share the same horizontal row on <640px while all 8 leader rows remain in DOM.
  const leaders = page.locator('.stub-leaders .leader-row');
  await expect(leaders).toHaveCount(8);
  const top3Y = await leaders.evaluateAll((rows) =>
    rows.slice(0, 3).map((r) => Math.round(r.getBoundingClientRect().top)),
  );
  expect(Math.max(...top3Y) - Math.min(...top3Y)).toBeLessThanOrEqual(2);

  // Verify keyboard Tab order follows visual order: Map -> Toolbar (返回) -> Stub (添加备注).
  const domOrder = await page.evaluate(() => {
    const map = document.querySelector('.route-panel')!;
    const toolbar = document.querySelector('[data-testid="detail-toolbar"]')!;
    const stub = document.querySelector('.stub')!;
    return {
      mapBeforeToolbar: Boolean(map.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING),
      toolbarBeforeStub: Boolean(toolbar.compareDocumentPosition(stub) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(domOrder).toEqual({ mapBeforeToolbar: true, toolbarBeforeStub: true });

  // Toolbar popovers (更多 -> 删除记录) work cleanly and restore focus on Escape.
  const moreBtn = page.getByRole('button', { name: '更多', exact: true });
  await moreBtn.click();
  await expect(page.getByRole('button', { name: '删除记录', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(moreBtn).toBeFocused();

  await setTheme(page, 'light');
  await expectNoOverflow(page, 'detail-390-light');
  await maybeShot(page, 'detail-390-light');
  await setTheme(page, 'dark');
  await expectNoOverflow(page, 'detail-390-dark');
  await maybeShot(page, 'detail-390-dark');

  for (const [w, h, tag] of [
    [320, 640, 'detail-320'],
    [768, 1024, 'detail-768'],
    [1440, 900, 'detail-1440'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expectNoOverflow(page, `${tag}-${theme}`);
      if (w === 320 || theme === 'light') await maybeShot(page, `${tag}-${theme}`);
    }
  }

  // Empty route state on 320x640 has 0 overflow.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/activities/${incompleteActivity.id}`);
  await expect(page.getByRole('status').filter({ hasText: '此活动没有路线。' })).toBeVisible();
  await expectNoOverflow(page, 'detail-empty-320');

  expect(errors).toEqual([]);
});

test('share: StoryShareDialog keeps #168 styles, readable contrast without white-on-white glass bug, and Save PNG visible on 320x640', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await loginRunner(page);

  for (const [w, h, tag] of [
    [320, 640, 'share-320'],
    [390, 844, 'share-390'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/workspace/records/story?year=2025');
    await expect(page.getByTestId('story-poster-dock')).toHaveClass(/section-rule/);

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      const trigger = page.getByRole('button', { name: '生成海报' });
      await trigger.click();

      const dialog = page.getByTestId('story-poster-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('data-glass-overlay', '');
      await expect(page.getByTestId('story-poster-image')).toBeVisible();
      await expect(page.getByTestId('story-poster-privacy-note')).toHaveClass(/status-strip/);

      // Save PNG MUST be visible in the first screen even at 320x640 without scrolling!
      const saveBtn = dialog.getByRole('button', { name: '保存 PNG', exact: true });
      await expect(saveBtn).toBeEnabled();
      const saveBox = (await saveBtn.boundingBox())!;
      expect(saveBox.y, `${tag}-${theme}: Save PNG top >= 0`).toBeGreaterThanOrEqual(0);
      expect(saveBox.y + saveBox.height, `${tag}-${theme}: Save PNG visible in first screen`).toBeLessThanOrEqual(h);

      // Poster preview stays strictly inside .dialog-stage and never overlaps .dialog-theme-tabs!
      const imgBox = (await page.getByTestId('story-poster-image').boundingBox())!;
      const stageBox = (await dialog.locator('.dialog-stage').boundingBox())!;
      const tabsBox = (await dialog.locator('.dialog-theme-tabs').boundingBox())!;
      expect(imgBox.y + imgBox.height, `${tag}-${theme}: poster stays inside stage`).toBeLessThanOrEqual(
        stageBox.y + stageBox.height + 1,
      );
      expect(stageBox.y + stageBox.height, `${tag}-${theme}: stage sits above theme tabs`).toBeLessThanOrEqual(
        tabsBox.y + 1,
      );

      // Contrast & no white-on-white check on underline theme tabs + primary save button!
      const contrastCheck = await dialog.evaluate((dlg) => {
        const parseRgb = (css: string): [number, number, number, number] => {
          const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
          if (!m) return [255, 255, 255, 1];
          return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
        };
        const lum = ([r, g, b]: [number, number, number]) => {
          const c = [r, g, b].map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const ratio = (a: [number, number, number], b: [number, number, number]) => {
          const l1 = lum(a);
          const l2 = lum(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const dlgBg = parseRgb(getComputedStyle(dlg).backgroundColor);
        const tab = dlg.querySelector<HTMLButtonElement>('.dialog-theme-tabs button[aria-pressed="true"]')!;
        const tabStyle = getComputedStyle(tab);
        const tabFg = parseRgb(tabStyle.color);
        return {
          tabHasGlassClass: tab.classList.contains('rn-glass-control'),
          tabShadow: tabStyle.boxShadow,
          tabContrast: ratio([tabFg[0], tabFg[1], tabFg[2]], [dlgBg[0], dlgBg[1], dlgBg[2]]),
        };
      });
      expect(contrastCheck.tabHasGlassClass, `${tag}-${theme}: underline tab excluded from glass`).toBe(false);
      expect(contrastCheck.tabShadow, `${tag}-${theme}: underline tab has no glass shadow`).toBe('none');
      expect(contrastCheck.tabContrast, `${tag}-${theme}: underline tab contrast >= 7:1`).toBeGreaterThanOrEqual(7);

      await expectNoOverflow(page, `${tag}-${theme}`);
      await maybeShot(page, `${tag}-${theme}`);

      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
  }

  expect(errors).toEqual([]);
});
