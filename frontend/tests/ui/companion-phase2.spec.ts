import { expect, test, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';
import { openAccountMenu } from '../fixtures/top-navigation.ts';

const SYNTH_ACTIVITY_1 = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '合成河畔晨跑 5K',
  notes: '',
  category: '路跑',
  tags: ['轻松跑'],
  activity_date: '2026-11-22',
  timezone: 'Asia/Shanghai',
  started_at: '2026-11-21T23:00:00Z',
  ended_at: '2026-11-21T23:28:00Z',
  distance_m: '5120.000',
  elapsed_seconds: '1680.000',
  timer_seconds: null,
  calories_kcal: 330,
  steps: 4950,
  avg_heart_rate_bpm: 146,
  max_heart_rate_bpm: 165,
  min_heart_rate_bpm: 118,
  avg_pace_seconds_per_km: '328.000',
  temporal_quality: 'complete',
  visibility: 'public',
  allow_shared_route: false,
  quality_summary: {},
  metrics_version: 'gpx-v1',
  has_route: true,
  created_at: '2026-11-22T00:00:00Z',
  updated_at: '2026-11-22T00:05:00Z',
};

const SYNTH_ACTIVITY_2 = {
  ...SYNTH_ACTIVITY_1,
  id: '22222222-2222-4222-8222-222222222222',
  title: '合成操场间歇跑 8K',
  activity_date: '2026-11-23',
  distance_m: '8040.000',
  elapsed_seconds: '2480.000',
  avg_pace_seconds_per_km: '308.000',
  has_route: false,
  created_at: '2026-11-23T00:00:00Z',
  updated_at: '2026-11-23T00:05:00Z',
};

async function installMockHealthBridge(
  page: Page,
  config: {
    platform?: 'android' | 'ios';
    availabilityStatus: 'available' | 'provider_update_required' | 'unsupported';
    initialGranted?: string[];
    onRequestGranted?: string[];
    summaryStatus?: 'ok' | 'empty' | 'denied';
    withAppPlugin?: boolean;
  },
) {
  await page.addInitScript((cfg) => {
    let granted = [...(cfg.initialGranted ?? [])];
    let summaryStatus = cfg.summaryStatus ?? 'ok';
    let stepsValue = 42180;
    let deferCheckPermissions = false;
    let pendingCheckResolvers: Array<() => void> = [];
    const stats = {
      getAvailability: 0,
      checkPermissions: 0,
      readSummary: 0,
      appAddListener: 0,
      appRemoveListener: 0,
    };
    const appListeners = new Set<(state: { isActive: boolean }) => void>();
    const allMetrics = ['steps', 'distance', 'active_calories', 'heart_rate', 'resting_heart_rate', 'sleep'];
    const win = window as unknown as Record<string, unknown>;
    win.__healthBridgeStats = stats;
    win.__setMockHealthState = (next: {
      granted?: string[];
      summaryStatus?: 'ok' | 'empty' | 'denied';
      steps?: number;
      deferCheckPermissions?: boolean;
    }) => {
      if (next.granted) granted = [...next.granted];
      if (next.summaryStatus) summaryStatus = next.summaryStatus;
      if (typeof next.steps === 'number') stepsValue = next.steps;
      if (typeof next.deferCheckPermissions === 'boolean') deferCheckPermissions = next.deferCheckPermissions;
    };
    win.__resolvePendingCheckPermissions = () => {
      const resolvers = pendingCheckResolvers;
      pendingCheckResolvers = [];
      for (const resolve of resolvers) resolve();
    };
    win.__emitAppStateChange = (isActive: boolean) => {
      for (const listener of Array.from(appListeners)) {
        listener({ isActive });
      }
    };
    win.__activeAppListenerCount = () => appListeners.size;
    const plugins: Record<string, unknown> = {
      HealthData: {
        getAvailability: async () => {
          stats.getAvailability += 1;
          return {
            available: cfg.availabilityStatus === 'available',
            status: cfg.availabilityStatus,
            platform: cfg.platform ?? 'android',
            readOnly: true,
            supportedMetrics: allMetrics,
            reason:
              cfg.availabilityStatus === 'provider_update_required'
                ? 'Health Connect 需要安装或更新后才能读取健康数据'
                : cfg.availabilityStatus === 'unsupported'
                  ? '当前设备不支持 Health Connect'
                  : null,
          };
        },
        checkPermissions: async () => {
          stats.checkPermissions += 1;
          if (deferCheckPermissions) {
            await new Promise<void>((resolve) => {
              pendingCheckResolvers.push(resolve);
            });
          }
          return {
            status: granted.length === allMetrics.length ? 'granted' : granted.length > 0 ? 'partial' : 'denied',
            granted: [...granted],
            denied: allMetrics.filter((m) => !granted.includes(m)),
            readOnly: true,
          };
        },
        requestPermissions: async () => {
          granted = [...(cfg.onRequestGranted ?? allMetrics)];
          return {
            status: granted.length === allMetrics.length ? 'granted' : granted.length > 0 ? 'partial' : 'denied',
            granted: [...granted],
            denied: allMetrics.filter((m) => !granted.includes(m)),
            readOnly: true,
          };
        },
        readSummary: async () => {
          stats.readSummary += 1;
          if (granted.length === 0 || summaryStatus === 'denied') {
            return { status: 'denied', grantedMetrics: [], readOnly: true };
          }
          if (summaryStatus === 'empty') {
            return { status: 'empty', grantedMetrics: [...granted], metrics: {}, readOnly: true };
          }
          return {
            status: 'ok',
            windowStart: '2026-11-16T00:00:00Z',
            windowEnd: '2026-11-23T00:00:00Z',
            grantedMetrics: [...granted],
            readOnly: true,
            metrics: {
              steps: granted.includes('steps') ? stepsValue : null,
              distanceMeters: granted.includes('distance') ? 31420.5 : null,
              activeCaloriesKcal: granted.includes('active_calories') ? 2140 : null,
              heartRate: granted.includes('heart_rate')
                ? { avgBpm: 149, minBpm: 112, maxBpm: 176, sampleCount: 96 }
                : null,
              restingHeartRateBpm: granted.includes('resting_heart_rate') ? 53 : null,
              sleepMinutes: granted.includes('sleep') ? 460 : null,
            },
          };
        },
        openSettings: async () => ({ opened: true }),
      },
    };
    if (cfg.withAppPlugin) {
      plugins.App = {
        addListener: async (eventName: string, cb: (state: { isActive: boolean }) => void) => {
          if (eventName !== 'appStateChange') {
            return { remove: async () => {} };
          }
          stats.appAddListener += 1;
          appListeners.add(cb);
          return {
            remove: async () => {
              stats.appRemoveListener += 1;
              appListeners.delete(cb);
            },
          };
        },
      };
    }
    win.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => cfg.platform ?? 'android',
      Plugins: plugins,
    };
  }, config);
}

test('health panel shows web_unavailable in standard web browser without crashing', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/settings/preferences');
  await expect(page.getByTestId('companion-health-panel')).toBeVisible();
  await expect(page.getByTestId('health-status-badge')).toHaveText('仅移动端可用');
  await expect(page.getByTestId('health-web-unavailable')).toBeVisible();
});

test('health panel handles Android Health Connect authorize, empty, denied, revoked, and unsupported states', async ({
  page,
}) => {
  await loginRunner(page);

  // 1. Unsupported device
  await installMockHealthBridge(page, { availabilityStatus: 'unsupported' });
  await page.goto('/settings/preferences');
  await expect(page.getByTestId('health-status-badge')).toHaveText('设备不支持');
  await expect(page.getByTestId('health-unsupported')).toBeVisible();

  // 2. Provider update required
  await installMockHealthBridge(page, { availabilityStatus: 'provider_update_required' });
  await page.goto('/settings/preferences');
  await expect(page.getByTestId('health-status-badge')).toHaveText('需更新 Health Connect');
  await expect(page.getByTestId('health-provider-update')).toBeVisible();

  // 3. Available -> denied -> authorized with synthetic metrics -> empty -> revoked
  await installMockHealthBridge(page, {
    availabilityStatus: 'available',
    initialGranted: [],
    onRequestGranted: [],
  });
  await page.goto('/settings/preferences');
  await expect(page.getByTestId('health-not-requested')).toBeVisible();
  await page.getByRole('button', { name: '授权只读健康数据' }).click();
  await expect(page.getByTestId('health-denied')).toBeVisible();

  // Now allow granting all 6 read-only metrics
  await installMockHealthBridge(page, {
    availabilityStatus: 'available',
    initialGranted: [],
    onRequestGranted: ['steps', 'distance', 'active_calories', 'heart_rate', 'resting_heart_rate', 'sleep'],
    summaryStatus: 'ok',
  });
  await page.goto('/settings/preferences');
  await page.getByRole('button', { name: '重新申请授权' }).click();
  await expect(page.getByTestId('health-status-badge')).toHaveText('已授权');
  await expect(page.getByTestId('health-steps')).toContainText('42,180');
  await expect(page.getByTestId('health-heart-rate')).toContainText('149 bpm');
  await expect(page.getByTestId('health-sleep')).toContainText('7.7 小时');

  // Empty data state after refresh
  await page.evaluate(() => {
    (window as unknown as { __setMockHealthState: (s: unknown) => void }).__setMockHealthState({
      summaryStatus: 'empty',
    });
  });
  await page.getByRole('button', { name: '刷新健康数据' }).click();
  await expect(page.getByTestId('health-empty')).toBeVisible();

  // Revoked permission state after system revocation
  await page.evaluate(() => {
    (window as unknown as { __setMockHealthState: (s: unknown) => void }).__setMockHealthState({
      granted: [],
      summaryStatus: 'denied',
    });
  });
  await page.getByRole('button', { name: '刷新健康数据' }).click();
  await expect(page.getByTestId('health-revoked')).toBeVisible();
  await expect(page.getByTestId('health-status-badge')).toHaveText('权限已撤销');
});

test('health panel refreshes on visibilitychange and Capacitor appStateChange, hides stale data while refreshing, deduplicates events, and cleans up listeners', async ({
  page,
}) => {
  await loginRunner(page);
  await installMockHealthBridge(page, {
    availabilityStatus: 'available',
    initialGranted: ['steps', 'distance', 'active_calories', 'heart_rate', 'resting_heart_rate', 'sleep'],
    summaryStatus: 'ok',
    withAppPlugin: true,
  });

  await page.goto('/settings/preferences');
  await expect(page.getByTestId('health-status-badge')).toHaveText('已授权');
  await expect(page.getByTestId('health-steps')).toContainText('42,180');
  await expect(page.getByTestId('health-heart-rate')).toContainText('149 bpm');

  const initialStats = await page.evaluate(
    () => (window as unknown as { __healthBridgeStats: Record<string, number> }).__healthBridgeStats,
  );
  expect(initialStats.checkPermissions).toBe(1);
  expect(initialStats.readSummary).toBe(1);
  expect(initialStats.appAddListener).toBe(1);

  // 1. Both visibilitychange and appStateChange fire together on resume -> single refresh updates values.
  await page.evaluate(() => {
    const win = window as unknown as {
      __setMockHealthState: (s: unknown) => void;
      __emitAppStateChange: (isActive: boolean) => void;
    };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    win.__emitAppStateChange(false);
    win.__setMockHealthState({ steps: 55120 });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    win.__emitAppStateChange(true);
  });
  await expect(page.getByTestId('health-steps')).toContainText('55,120');

  const afterResumeStats = await page.evaluate(
    () => (window as unknown as { __healthBridgeStats: Record<string, number> }).__healthBridgeStats,
  );
  expect(afterResumeStats.checkPermissions).toBe(2);
  expect(afterResumeStats.readSummary).toBe(2);

  // 2. Partial revocation via Capacitor appStateChange removes revoked metrics and shows partial banner.
  await page.evaluate(() => {
    const win = window as unknown as {
      __setMockHealthState: (s: unknown) => void;
      __emitAppStateChange: (isActive: boolean) => void;
    };
    win.__emitAppStateChange(false);
    win.__setMockHealthState({ granted: ['steps'], steps: 61000 });
    win.__emitAppStateChange(true);
  });
  await expect(page.getByTestId('health-status-badge')).toHaveText('部分授权');
  await expect(page.getByTestId('health-partial-note')).toBeVisible();
  await expect(page.getByTestId('health-steps')).toContainText('61,000');
  await expect(page.getByTestId('health-heart-rate')).toHaveCount(0);

  // 3. Full revocation on visibilitychange clears stale summary immediately while checkPermissions is in flight.
  await page.evaluate(() => {
    const win = window as unknown as { __setMockHealthState: (s: unknown) => void };
    win.__setMockHealthState({ granted: [], summaryStatus: 'denied', deferCheckPermissions: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('health-status-badge')).toHaveText('检测中…');
  await expect(page.getByTestId('health-summary-metrics')).toHaveCount(0);
  await expect(page.getByTestId('health-steps')).toHaveCount(0);

  await page.evaluate(() => {
    (window as unknown as { __resolvePendingCheckPermissions: () => void }).__resolvePendingCheckPermissions();
  });
  await expect(page.getByTestId('health-revoked')).toBeVisible();
  await expect(page.getByTestId('health-status-badge')).toHaveText('权限已撤销');
  await expect(page.getByTestId('health-summary-metrics')).toHaveCount(0);

  const beforeUnmountStats = await page.evaluate(() => {
    const stats = (
      window as unknown as {
        __healthBridgeStats: {
          getAvailability: number;
          checkPermissions: number;
          readSummary: number;
          appAddListener: number;
          appRemoveListener: number;
        };
      }
    ).__healthBridgeStats;
    const activeListeners = (
      window as unknown as { __activeAppListenerCount: () => number }
    ).__activeAppListenerCount();
    return {
      checkPermissions: stats.checkPermissions,
      readSummary: stats.readSummary,
      activeListeners,
    };
  });
  expect(beforeUnmountStats.checkPermissions).toBe(4);
  expect(beforeUnmountStats.readSummary).toBe(3);
  expect(beforeUnmountStats.activeListeners).toBe(1);

  // 4. Navigating away cleans up both visibilitychange and Capacitor appStateChange listeners.
  await page.getByRole('link', { name: '账户总览' }).click();
  await page.waitForURL('**/settings');
  await expect(page.getByTestId('companion-health-panel')).toHaveCount(0);

  const afterUnmount = await page.evaluate(() => {
    const win = window as unknown as {
      __healthBridgeStats: {
        getAvailability: number;
        checkPermissions: number;
        readSummary: number;
        appAddListener: number;
        appRemoveListener: number;
      };
      __emitAppStateChange: (isActive: boolean) => void;
      __activeAppListenerCount: () => number;
    };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    win.__emitAppStateChange(true);
    return {
      appRemoveListener: win.__healthBridgeStats.appRemoveListener,
      checkPermissions: win.__healthBridgeStats.checkPermissions,
      readSummary: win.__healthBridgeStats.readSummary,
      activeListeners: win.__activeAppListenerCount(),
    };
  });
  expect(afterUnmount.appRemoveListener).toBe(1);
  expect(afterUnmount.activeListeners).toBe(0);
  expect(afterUnmount.checkPermissions).toBe(4);
  expect(afterUnmount.readSummary).toBe(3);
});

test('incremental sync populates offline cache, supports offline viewing, and clears private cache on logout', async ({
  page,
}) => {
  await loginRunner(page);

  let syncCalls = 0;
  await page.route('**/api/v1/activities/sync**', async (route) => {
    syncCalls += 1;
    const url = new URL(route.request().url());
    const sinceVersion = url.searchParams.get('since_version');
    if (sinceVersion === '4') {
      await route.fulfill({
        status: 200,
        json: {
          data: {
            data_version: 4,
            unchanged: true,
            server_time: '2026-11-23T09:05:00Z',
            total_count: 2,
            items: [],
            next_cursor: null,
            has_more: false,
            active_ids: null,
            full_resync_required: false,
          },
          error: null,
          meta: { request_id: 'sync-unchanged' },
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        data: {
          data_version: 4,
          unchanged: false,
          server_time: '2026-11-23T09:00:00Z',
          total_count: 2,
          items: [SYNTH_ACTIVITY_1, SYNTH_ACTIVITY_2],
          next_cursor: null,
          has_more: false,
          active_ids: null,
          full_resync_required: false,
        },
        error: null,
        meta: { request_id: 'sync-initial' },
      },
    });
  });

  // Trigger sync on preferences page & verify cache panel updates cleanly.
  await page.goto('/settings/preferences');
  await expect(page.getByTestId('companion-cache-panel')).toBeVisible();
  await page.getByTestId('cache-sync-button').click();
  await expect(page.getByTestId('cache-data-version')).toHaveText('v4');
  await expect(page.getByTestId('cache-sections')).toContainText('跑步记录（2 条）');

  // Second manual sync should hit unchanged short-circuit (no duplicate records).
  await page.getByTestId('cache-sync-button').click();
  await expect(page.getByTestId('cache-status-message')).toContainText('已是最新');
  expect(syncCalls).toBe(2);

  // Visit footprints online so lightweight metadata is cached.
  await page.route('**/api/v1/showcase/footprints/all**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        data: {
          status: 'ready',
          generated_at: '2026-11-23T08:00:00Z',
          refreshing: false,
          refresh_failed: false,
          result: {
            scope: 'all',
            type: 'FeatureCollection',
            features: [],
            mode: 'tracks',
            activity_count: 2,
            visible_activity_count: 1,
            unsupported_segment_count: 0,
            grid_size_m: 100,
            grid_crs: 'EPSG:3857',
            count_basis: 'distinct_activity_per_cell',
            max_count: 1,
          },
        },
        error: null,
      },
    });
  });
  await page.goto('/footprints');
  await expect(page.getByTestId('footprint-summary')).toContainText('全部 2 条运动记录');

  // Now simulate offline / network failure on activities & footprints reads.
  await page.unroute('**/api/v1/showcase/footprints/all**');
  await page.route('**/api/v1/showcase/activities**', (route) => route.abort('internetdisconnected'));
  await page.route('**/api/v1/showcase/footprints/all**', (route) => route.abort('internetdisconnected'));

  await page.goto('/activities');
  await expect(page.getByTestId('activities-offline-cache-notice')).toBeVisible();
  await expect(page.getByRole('heading', { name: '合成操场间歇跑 8K' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '合成河畔晨跑 5K' })).toBeVisible();

  await page.goto('/footprints');
  await expect(page.getByTestId('footprint-offline-meta')).toBeVisible();
  await expect(page.getByTestId('footprint-offline-meta')).toContainText('全部 2 条记录');

  // Restore routes, verify IndexedDB has entries, then logout and confirm private cache is purged.
  await page.unroute('**/api/v1/showcase/activities**');
  await page.unroute('**/api/v1/showcase/footprints/all**');
  const countBeforeLogout = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('runnote-companion-cache', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('entries', 'readonly');
          const keysReq = tx.objectStore('entries').getAllKeys();
          keysReq.onsuccess = () => resolve((keysReq.result as string[]).filter((k) => k.startsWith('user:')).length);
        };
      }),
  );
  expect(countBeforeLogout).toBeGreaterThan(0);

  // Open account menu and sign out.
  await page.goto('/settings/preferences');
  await (await openAccountMenu(page)).getByRole('button', { name: '退出登录', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/admin' || url.pathname === '/');

  const countAfterLogout = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('runnote-companion-cache', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('entries', 'readonly');
          const keysReq = tx.objectStore('entries').getAllKeys();
          keysReq.onsuccess = () => resolve((keysReq.result as string[]).filter((k) => k.startsWith('user:')).length);
        };
      }),
  );
  expect(countAfterLogout).toBe(0);
});

test('visual QA: preferences health & offline panels have no overflow at 1440x900, 768x1024, 390x844 in light and dark themes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await loginRunner(page);
  await installMockHealthBridge(page, {
    availabilityStatus: 'available',
    initialGranted: ['steps', 'distance', 'active_calories', 'heart_rate', 'resting_heart_rate', 'sleep'],
    summaryStatus: 'ok',
  });
  await page.route('**/api/v1/activities/sync**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        data: {
          data_version: 4,
          unchanged: false,
          server_time: '2026-11-23T09:00:00Z',
          total_count: 2,
          items: [SYNTH_ACTIVITY_1, SYNTH_ACTIVITY_2],
          next_cursor: null,
          has_more: false,
          active_ids: null,
          full_resync_required: false,
        },
        error: null,
        meta: { request_id: 'visual-sync' },
      },
    });
  });

  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const;

  for (const theme of ['light', 'dark'] as const) {
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/settings/preferences');
      await page.evaluate((t) => {
        localStorage.setItem('runnote-theme', t);
        document.documentElement.dataset.theme = t;
      }, theme);
      await expect(page.getByTestId('health-steps')).toBeVisible();
      await expect(page.getByTestId('cache-data-version')).toHaveText('v4');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `No horizontal overflow on ${vp.name} ${theme}`).toBeLessThanOrEqual(1);

      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        const panel = document.querySelector('[data-testid="companion-health-panel"]');
        if (panel instanceof HTMLElement) {
          // Floating top navigation occupies --top-navigation-offset (14px) + --top-navigation-height (64px) = 78px.
          const topNavClearance = 96;
          const targetTop = Math.max(0, panel.getBoundingClientRect().top - topNavClearance);
          window.scrollTo({ top: targetTop, behavior: 'instant' });
        }
      });
      await page.screenshot({
        path: testInfo.outputPath(`phase2-${vp.name}-${theme}.png`),
        fullPage: false,
      });
    }
  }
  expect(errors).toEqual([]);
});
