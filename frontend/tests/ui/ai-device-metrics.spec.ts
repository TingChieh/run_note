import { test, expect } from '@playwright/test';
import { loginRunner } from '../fixtures/activities';
import { installAI, report } from '../fixtures/p2';
const metrics = { heart_rate_record_count: 2, heart_rate_weighted_count: 1, heart_rate_weighted_duration_seconds: '1200', avg_heart_rate_bpm: '145.25', calories_record_count: 1, calories_kcal: 0, steps_record_count: 0, steps: null };
test('v2 known, missing and zero metrics, weekly coverage, consent and keyboard on mobile', async ({ page }) => {
  const state = await installAI(page);
  const snapshot = { ...report.stats_snapshot, schema_version: 'running-summary-v2', device_metrics: metrics, weeks: report.stats_snapshot.weeks.map(w => ({ ...w, device_metrics: metrics })) };
  await page.route('**/api/v1/ai-reports/context*', route => route.fulfill({ json: { data: { configured: true, model: 'mock', daily_limit: 3, attempts_today: 0, remaining_today: 3, date_from: snapshot.date_from, date_to: snapshot.date_to, stats_snapshot: snapshot } } }));
  await loginRunner(page); await page.goto('/ai');
  const devices = page.getByRole('definition').filter({ hasText: '145.3 bpm' });
  await expect(devices).toBeVisible();
  await expect(page.getByText('0 kcal', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无数据', { exact: true })).toBeVisible();
  await expect(page.getByText('心率覆盖 2 / 8 条；参与加权 1 条')).toBeVisible();
  const consent = page.getByRole('checkbox');
  await expect(consent).not.toBeChecked();
  await expect(page.getByText(/汇总心率、热量、步数、各指标覆盖率/)).toBeVisible();
  await expect(page.getByText(/原始GPX \/ TCX文件、GPS坐标/)).toBeVisible();
  expect(state.calls).toHaveLength(0);
  const details = page.getByText('每周明细与统计口径', { exact: true });
  await details.focus(); await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: '每周设备指标（覆盖数 / 当周活动数）' });
  await expect(table).toContainText('心率 2 / 8 条；加权 1 条');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390 || width === 1440) await page.getByRole('region', { name: '后端统计依据' }).screenshot({ path: `.cache/ai-device-metrics/metrics-${width}.png` });
  }
  await page.getByRole('region', { name: '每周设备指标，可横向滚动' }).focus();
  await expect(page.getByRole('region', { name: '每周设备指标，可横向滚动' })).toBeFocused();
  await page.reload(); expect(state.calls).toHaveLength(0); await expect(consent).not.toBeChecked();
});
test('historical v1 report omits device cards and never regenerates automatically', async ({ page }) => {
  const state = await installAI(page); state.reports = [report];
  await loginRunner(page); await page.goto('/ai');
  await page.getByRole('button', { name: '查看报告' }).click();
  await expect(page.getByRole('region', { name: '当前报告' })).toBeVisible();
  await expect(page.getByText(/此旧版快照未含设备指标/)).toBeVisible();
  await expect(page.getByText('平均心率（用时加权估计）', { exact: true })).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});
