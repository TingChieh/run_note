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
  },
) {
  await page.addInitScript((cfg) => {
    let granted = [...(cfg.initialGranted ?? [])];
    let summaryStatus = cfg.summaryStatus ?? 'ok';
    const allMetrics = ['steps', 'distance', 'active_calories', 'heart_rate', 'resting_heart_rate', 'sleep'];
    (window as unknown as Record<string, unknown>).__setMockHealthState = (next: {
      granted?: string[];
      summaryStatus?: 'ok' | 'empty' | 'denied';
    }) => {
      if (next.granted) granted = [...next.granted];
      if (next.summaryStatus) summaryStatus = next.summaryStatus;
    };
    (window as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => cfg.platform ?? 'android',
      Plugins: {
        HealthData: {
          getAvailability: async () => ({
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
          }),
          checkPermissions: async () => ({
            status: granted.length === allMetrics.length ? 'granted' : granted.length > 0 ? 'partial' : 'denied',
            granted: [...granted],
            denied: allMetrics.filter((m) => !granted.includes(m)),
            readOnly: true,
          }),
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
                steps: 42180,
                distanceMeters: 31420.5,
                activeCaloriesKcal: 2140,
                heartRate: { avgBpm: 149, minBpm: 112, maxBpm: 176, sampleCount: 96 },
                restingHeartRateBpm: 53,
                sleepMinutes: 460,
              },
            };
          },
          openSettings: async () => ({ opened: true }),
        },
      },
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
  await expect(page.getByTestId('cache-data-version')).toHaveText('v4');
  await expect(page.getByTestId('cache-sections')).toContainText('跑步记录（2 条）');

  // Second manual sync should hit unchanged short-circuit (no duplicate records).
  await page.getByTestId('cache-sync-button').click();
  await expect(page.getByTestId('cache-status-message')).toContainText('已是最新');
  expect(syncCalls).toBeGreaterThanOrEqual(2);

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

      await page.getByTestId('companion-health-panel').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`phase2-${vp.name}-${theme}.png`),
        fullPage: false,
      });
    }
  }
  expect(errors).toEqual([]);
});
