import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

test('public /privacy route renders without login, includes required disclosures, and is reachable from footer', async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const ssr = await request.get('/privacy', { maxRedirects: 0 });
  expect(ssr.status()).toBe(200);
  const ssrHtml = await ssr.text();
  expect(ssrHtml).toContain('tingchieh77@outlook.com');
  expect(ssrHtml).toContain('RunNote 账号删除请求');
  expect(ssrHtml).toContain('id="data-deletion"');

  // Reachable from public footer without login.
  await page.goto('/');
  const footerPrivacyLink = page.locator('.app-footer').getByRole('link', { name: '隐私政策', exact: true });
  await expect(footerPrivacyLink).toHaveAttribute('href', '/privacy');
  await footerPrivacyLink.click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: '隐私政策', exact: true })).toBeVisible();

  const main = page.locator('#main');
  await expect(main).toContainText('RunNote（个人项目）');
  await expect(main).toContainText('tingchieh77@outlook.com');
  await expect(main).toContainText('Health Connect');
  for (const metric of ['步数', '距离', '活动热量', '心率', '静息心率', '睡眠时长']) {
    await expect(main).toContainText(metric);
  }
  await expect(main).toContainText('仅本机读取、不上传服务器');
  await expect(main).toContainText('不出售你的个人数据');
  await expect(main).toContainText('未成年人');

  const deletionSection = page.getByTestId('data-deletion-section');
  await expect(deletionSection).toHaveAttribute('id', 'data-deletion');
  await expect(deletionSection).toContainText('RunNote 账号删除请求');
  await expect(deletionSection).toContainText('tingchieh77@outlook.com');
  await expect(deletionSection).toContainText('身份核验');
  await expect(deletionSection).toContainText('备份自然过期');
  await expect(deletionSection).toContainText('安全与法律保留例外');
  await expect(page.getByTestId('deletion-email-link')).toHaveAttribute(
    'href',
    /^mailto:tingchieh77@outlook\.com\?subject=/,
  );
  await expect(page.getByTestId('deletion-mailto-cta')).toHaveAttribute(
    'href',
    /^mailto:tingchieh77@outlook\.com\?subject=/,
  );
  // Request-based deletion only: no public web form asking for personal data.
  await expect(deletionSection.locator('form')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('in-app settings privacy area and health panel link to /privacy#data-deletion', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await loginRunner(page);
  await page.goto('/settings/preferences');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  const settingsLink = page.getByTestId('settings-data-deletion-link');
  await expect(settingsLink).toBeVisible();
  await expect(settingsLink).toHaveAttribute('href', '/privacy#data-deletion');

  const healthLink = page.getByTestId('health-data-deletion-link');
  await expect(healthLink).toBeVisible();
  await expect(healthLink).toHaveAttribute('href', '/privacy#data-deletion');

  await settingsLink.click();
  await expect(page).toHaveURL(/\/privacy#data-deletion$/);
  await expect(page.getByRole('heading', { level: 2, name: '账号与数据删除申请', exact: true })).toBeVisible();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('/privacy is responsive at 390x844 and 1440x900 in light and dark themes with zero console errors', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/privacy#data-deletion');
      await page.evaluate((value) => {
        localStorage.setItem('runnote-theme', value);
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByTestId('data-deletion-section')).toBeVisible();

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(metrics.scrollWidth, `overflow at ${viewport.width}x${viewport.height} ${theme}`).toBeLessThanOrEqual(
        metrics.innerWidth,
      );
    }
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
