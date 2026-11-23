import { test, expect } from '@playwright/test';
import { loginRunner } from '../fixtures/activities';

test('shared calendar supports keyboard, responsive placement and read-only custom ranges', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/wellbeing?tab=report');
  await expect(page.getByTestId('wellbeing-report-summary')).toBeVisible();
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByLabel('开始日期', { exact: true }).fill('2026-09-14');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-12');
  const start = page.getByRole('button', { name: '选择开始日期', exact: true });
  await start.click();
  let calendar = page.getByRole('dialog', { name: '选择开始日期', exact: true });
  await expect(calendar).toBeVisible();
  await calendar.getByRole('button', { name: '2026年9月7日', exact: true }).click();
  await expect(page.getByLabel('开始日期', { exact: true })).toHaveValue('2026-09-07');
  const end = page.getByRole('button', { name: '选择结束日期', exact: true });
  await end.focus();
  await page.keyboard.press('Enter');
  calendar = page.getByRole('dialog', { name: '选择结束日期', exact: true });
  await expect(calendar.getByRole('button', { name: '2026年10月12日', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('结束日期', { exact: true })).toHaveValue('2026-10-05');
  const request = page.waitForRequest((req) => req.url().includes('/me/wellbeing/report?from=2026-09-07'));
  await page.getByRole('button', { name: '查看', exact: true }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get('from')).toBe('2026-09-07');
  expect(url.searchParams.get('to')).toBe('2026-10-05');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await start.click();
    const popup = page.getByRole('dialog', { name: '选择开始日期', exact: true });
    await expect(popup).toHaveCSS('opacity', '1');
    await expect(popup).toHaveCSS('scale', '1');
    const box = (await popup.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(start).toBeFocused();
  }
});
