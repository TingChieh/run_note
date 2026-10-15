import { test, expect } from '@playwright/test';
import { loginRunner } from '../fixtures/activities';
import { installAI } from '../fixtures/p2';

test('AI ranges use the shared calendar with keyboard, responsive placement and read-only previews', async ({ page }) => {
  const state = await installAI(page);
  await loginRunner(page);
  await page.goto('/ai');
  await expect(page.getByLabel('开始日期（周一）', { exact: true })).toHaveValue('2026-09-14');
  const start = page.getByRole('button', { name: '选择开始日期（周一）', exact: true });
  await start.click();
  let calendar = page.getByRole('dialog', { name: '选择开始日期（周一）', exact: true });
  await expect(calendar).toBeVisible();
  await calendar.getByRole('button', { name: '2026年9月7日', exact: true }).click();
  await expect(page.getByLabel('开始日期（周一）', { exact: true })).toHaveValue('2026-09-07');
  const end = page.getByRole('button', { name: '选择结束日期（周一，不含）', exact: true });
  await end.focus(); await page.keyboard.press('Enter');
  calendar = page.getByRole('dialog', { name: '选择结束日期（周一，不含）', exact: true });
  await expect(calendar.getByRole('button', { name: '2026年10月12日', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await expect(page.getByLabel('结束日期（周一，不含）', { exact: true })).toHaveValue('2026-10-05');
  const request = page.waitForRequest(req => req.url().includes('/ai-reports/context?'));
  await page.getByRole('button', { name: '读取统计依据', exact: true }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get('date_from')).toBe('2026-09-07');
  expect(url.searchParams.get('date_to')).toBe('2026-10-05');
  expect(state.calls).toHaveLength(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await start.click();
    const popup = page.getByRole('dialog', { name: '选择开始日期（周一）', exact: true });
    await expect(popup).toHaveCSS('opacity', '1');
    await expect(popup).toHaveCSS('scale', '1');
    const box = await popup.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/ai-datepicker-${width}.png` });
    await page.keyboard.press('Escape'); await expect(start).toBeFocused();
  }
});

test('AI generation locks both date inputs and shared calendar triggers', async ({ page }) => {
  const state = await installAI(page);
  await loginRunner(page); await page.goto('/ai');
  await expect(page.getByLabel('开始日期（周一）', { exact: true })).toHaveValue('2026-09-14');
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/ai-reports', async route => {
    if (route.request().method() === 'POST') await hold;
    await route.fallback();
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成近期总结与下周建议', exact: true }).click();
  await expect(page.getByLabel('开始日期（周一）', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('结束日期（周一，不含）', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '选择开始日期（周一）', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '选择结束日期（周一，不含）', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toBeHidden();
  release();
  await expect(page.getByRole('region', { name: '当前报告' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择开始日期（周一）', exact: true })).toBeEnabled();
  expect(state.calls).toHaveLength(1);
});
