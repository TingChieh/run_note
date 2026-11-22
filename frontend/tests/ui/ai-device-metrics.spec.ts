import { test, expect } from '@playwright/test';
import { loginRunner } from '../fixtures/activities';
import { installAI, report } from '../fixtures/p2';

const metrics = {
  heart_rate_record_count: 2,
  heart_rate_weighted_count: 1,
  heart_rate_weighted_duration_seconds: '1200',
  avg_heart_rate_bpm: '145.25',
  calories_record_count: 1,
  calories_kcal: 0,
  steps_record_count: 0,
  steps: null,
};

test('archived v2 report shows known, missing and zero metrics, weekly coverage and keyboard scroll on mobile', async ({
  page,
}) => {
  const state = await installAI(page);
  const snapshot = {
    ...report.stats_snapshot,
    schema_version: 'running-summary-v2' as const,
    device_metrics: metrics,
    weeks: report.stats_snapshot.weeks.map((w) => ({ ...w, device_metrics: metrics })),
  };
  state.reports = [{ ...report, stats_snapshot: snapshot }];
  await loginRunner(page);
  await page.goto('/ai');
  await page.getByRole('button', { name: /历史分析归档/ }).click();
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  const devices = page.getByRole('definition').filter({ hasText: '145.3 bpm' });
  await expect(devices).toBeVisible();
  await expect(page.getByText('0 kcal', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无数据', { exact: true })).toBeVisible();
  await expect(page.getByText('心率覆盖 2 / 8 条；参与加权 1 条')).toBeVisible();
  expect(state.calls).toHaveLength(0);
  const details = page.getByText('每周明细与统计口径', { exact: true });
  await details.focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: '每周设备指标（覆盖数 / 当周活动数）' });
  await expect(table).toContainText('心率 2 / 8 条；加权 1 条');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('region', { name: '每周设备指标，可横向滚动' }).focus();
  await expect(page.getByRole('region', { name: '每周设备指标，可横向滚动' })).toBeFocused();
});

test('historical v1 report omits device cards and never regenerates automatically', async ({ page }) => {
  const state = await installAI(page);
  state.reports = [report];
  await loginRunner(page);
  await page.goto('/ai');
  await page.getByRole('button', { name: /历史分析归档/ }).click();
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前报告' })).toBeVisible();
  await expect(page.getByText(/此旧版快照未含设备指标/)).toBeVisible();
  await expect(page.getByText('平均心率（用时加权估计）', { exact: true })).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});
