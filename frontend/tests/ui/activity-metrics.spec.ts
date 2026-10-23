import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

function metric(page: Page, label: string) {
  return page.getByRole('region', { name: '运动指标', exact: true }).locator('.metrics > div')
    .filter({ has: page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }) });
}

test('device metrics use readable icon cards while keeping timer and elapsed durations distinct', async ({ page }) => {
  const state = await installActivities(page);
  state.records = [{ ...sampleActivity, started_at: '2026-10-04T08:15:20Z', elapsed_seconds: '1322', timer_seconds: '1166', avg_heart_rate_bpm: 156, calories_kcal: 144, steps: 3262, metrics_version: 'tcx-v1' }];
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  const panel = page.getByRole('region', { name: '运动指标', exact: true });
  await expect(panel.locator('.metrics > div')).toHaveCount(7);
  for (const [label, value] of [['距离', '5.1 km'], ['设备用时', '19:26'], ['平均配速', '5:51 /km'], ['经过时间', '22:02'], ['平均心率', '156 bpm'], ['热量', '144 kcal'], ['步数', '3262 步']]) {
    const card = metric(page, label);
    await expect(card.locator('dd')).toHaveText(value);
    await expect(card.locator('[aria-hidden="true"] svg')).toBeVisible();
    const style = await card.locator('dd').evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), weight: Number(getComputedStyle(el).fontWeight) }));
    // The detail page deliberately uses compact 1.25rem figures next to the icons.
    expect(style.size).toBeGreaterThanOrEqual(20);
    expect(style.weight).toBeGreaterThanOrEqual(700);
  }
  await expect(panel.getByText('16:15:20 · Asia/Shanghai', { exact: true })).toBeVisible();
  await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
  const overview = await panel.boundingBox(), route = await page.getByRole('region', { name: '路线', exact: true }).boundingBox();
  expect(route!.x).toBeGreaterThan(overview!.x + overview!.width);
  expect(Math.abs(route!.height - overview!.height)).toBeLessThan(150);
  await page.locator('.detail-workspace').screenshot({ path: '.cache/activity-library/activity-metrics-desktop.png', animations: 'disabled' });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(metric(page, '步数').locator('dd')).toBeVisible();
    // Below 1200px the detail content height is clamp(17.5rem, 38svh, 22rem); 17.5rem = 280px is its floor.
    expect((await page.locator('.route-map').boundingBox())!.height).toBeGreaterThanOrEqual(280);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const appearance = await metric(page, '平均心率').locator('dd').evaluate(el => {
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => {
        const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const text = luminance(getComputedStyle(el).color), surface = luminance(getComputedStyle(document.querySelector('.detail-workspace')!).backgroundColor);
    return { surface, contrast: (Math.max(text, surface) + .05) / (Math.min(text, surface) + .05) };
  });
  expect(appearance.surface).toBeLessThan(.1);
  expect(appearance.contrast).toBeGreaterThanOrEqual(4.5);
  await page.locator('.detail-workspace').screenshot({ path: '.cache/activity-library/activity-metrics-mobile-dark.png', animations: 'disabled' });
});

test('missing metrics remain explicit and zero device values stay visible without a duplicate elapsed card', async ({ page }) => {
  const state = await installActivities(page);
  state.records = [{ ...sampleActivity, started_at: null, distance_m: null, elapsed_seconds: null, avg_pace_seconds_per_km: null, avg_heart_rate_bpm: null, calories_kcal: 0, steps: 0, temporal_quality: 'incomplete', has_route: false }];
  await loginRunner(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/activities/${sampleActivity.id}`);
  const panel = page.getByRole('region', { name: '运动指标', exact: true });
  await expect(panel.locator('.metrics > div')).toHaveCount(6);
  for (const label of ['距离', '经过时间', '平均配速', '平均心率']) {
    await expect(metric(page, label).locator('dd')).toContainText('—');
    await expect(metric(page, label).locator('dd .sr-only')).toHaveText('（缺失或无法可靠计算）');
  }
  await expect(metric(page, '热量').locator('dd')).toHaveText('0 kcal');
  await expect(metric(page, '步数').locator('dd')).toHaveText('0 步');
  await expect(panel.getByText('— · Asia/Shanghai', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '此活动没有路线。' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a real zero timer remains a device duration and does not replace elapsed time', async ({ page }) => {
  const state = await installActivities(page);
  state.records = [{ ...sampleActivity, timer_seconds: 0 }];
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(metric(page, '设备用时').locator('dd')).toHaveText('0:00');
  await expect(metric(page, '经过时间').locator('dd')).toHaveText('30:00');
});
