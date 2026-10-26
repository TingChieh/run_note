import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

const csrf = { Origin: 'http://127.0.0.1:5191', 'X-CSRF-Token': 'ui-csrf' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.afterEach(async ({ page }) => {
  await page.request.patch('/api/v1/site', { headers: csrf, data: { title: 'RunNote', subtitle: '跑步与足迹', footer_tagline: '记录每一步，看见你的进步。', default_theme: 'system' } });
  await page.request.delete('/api/v1/site/images/logo', { headers: csrf });
  await page.request.delete('/api/v1/site/images/favicon', { headers: csrf });
  await page.request.delete('/api/v1/me/avatar', { headers: csrf });
});

test('site title, subtitle, footer, tab title and logo follow settings', async ({ page }) => {
  await loginRunner(page);
  expect((await page.request.patch('/api/v1/site', { headers: csrf, data: { title: '晨跑站', subtitle: '每日训练', footer_tagline: '坚持就是胜利' } })).status()).toBe(200);
  await page.goto('/dashboard');
  const sidebar = page.locator('.app-sidebar');
  await expect(sidebar.locator('.desktop-brand')).toContainText('晨跑站');
  await expect(sidebar.locator('.brand-mark')).toHaveText('晨');
  await expect(sidebar.locator('.nav-caption')).toHaveText('每日训练');
  await expect(page.locator('.app-footer')).toContainText('坚持就是胜利');
  const projectLink = page.locator('.app-footer').getByRole('link', { name: /GitHub/ });
  await expect(projectLink).toHaveAttribute('href', 'https://github.com/TingChieh/run_note');
  await expect(projectLink).toHaveAttribute('target', '_blank');
  await expect(projectLink).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(projectLink).toHaveText('GitHub');
  await expect(projectLink.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(page).toHaveTitle('数据汇总 · 晨跑站');
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  expect((await page.request.put('/api/v1/site/images/logo', { headers: csrf, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  expect((await page.request.put('/api/v1/site/images/favicon', { headers: csrf, multipart: { file: { name: 'f.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  await page.reload();
  await expect(sidebar.locator('.desktop-brand img')).toHaveAttribute('src', /^\/api\/v1\/site\/images\/logo\?v=[0-9a-f]{16}$/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^\/api\/v1\/site\/images\/favicon\?v=/);
});

test('site default theme applies before local choice and local choice wins', async ({ page }) => {
  await loginRunner(page);
  await page.request.patch('/api/v1/site', { headers: csrf, data: { default_theme: 'dark' } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.setItem('runnote-theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => localStorage.removeItem('runnote-theme'));
});

test('sidebar shows the subject avatar and falls back to the initial', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/dashboard');
  await expect(page.locator('.runner-avatar')).toHaveText('晨');
  expect((await page.request.put('/api/v1/me/avatar', { headers: csrf, multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  await page.reload();
  await expect(page.locator('.runner-avatar img')).toHaveAttribute('alt', '晨跑者的头像');
  await page.request.delete('/api/v1/me/avatar', { headers: csrf });
});

test('route poster draws the site logo in the brand corner', async ({ page }) => {
  await loginRunner(page);
  expect((await page.request.put('/api/v1/site/images/logo', { headers: csrf, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  await page.goto('/activities/wall');
  await page.waitForLoadState('networkidle');
  const logoRequest = page.waitForRequest(request => /\/api\/v1\/site\/images\/logo\?v=/.test(request.url()));
  await page.getByRole('button', { name: '生成分享图', exact: true }).click();
  await logoRequest;
  const preview = page.getByRole('dialog', { name: '生成分享图' }).getByRole('img').first();
  await expect(preview).toBeVisible();
  // The synthetic logo is a translucent blue square; the default brand mark is the green route colour with an initial.
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1080, 1920);
    const [r, g, b] = context.getImageData(78, 66, 1, 1).data; return b > 200 && b - r > 80 && b - g > 80;
  })).toBe(true);
});

test('a broken brand logo falls back to the title initial', async ({ page }) => {
  await loginRunner(page);
  expect((await page.request.patch('/api/v1/site', { headers: csrf, data: { title: '晨跑站' } })).status()).toBe(200);
  expect((await page.request.put('/api/v1/site/images/logo', { headers: csrf, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(200);
  await page.route('**/api/v1/site/images/logo*', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/dashboard');
  const brand = page.locator('.app-sidebar .desktop-brand');
  await expect(brand.locator('.brand-mark')).toHaveText('晨');
  await expect(brand.locator('img')).toHaveCount(0);
});

test('owner edits site settings from the site settings page', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/settings');
  const tabs = page.getByRole('navigation', { name: '设置分区' });
  await expect(tabs.getByRole('link', { name: '账户设置', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: '站点设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/site$/);
  await expect(page.getByRole('heading', { level: 1, name: '站点设置' })).toBeVisible();
  await page.getByLabel('站点标题', { exact: true }).fill('晨跑站');
  await page.getByLabel('侧栏副标题', { exact: true }).fill('');
  await page.getByRole('radio', { name: '深色', exact: true }).check();
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByText('站点设置已保存。', { exact: true })).toBeVisible();
  await expect(page.locator('.app-sidebar .desktop-brand')).toContainText('晨跑站');
  await expect(page.locator('.app-sidebar .nav-caption')).toHaveCount(0);
  await page.getByLabel('上传站内标志').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.app-sidebar .desktop-brand img')).toBeVisible();
  await page.getByRole('button', { name: '恢复默认站内标志', exact: true }).click();
  await expect(page.locator('.app-sidebar .desktop-brand img')).toHaveCount(0);
  await page.getByLabel('站点标题', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByLabel('站点标题', { exact: true })).toHaveJSProperty('validity.valueMissing', true);
});

test('saving the default theme applies it to the current page without a reload', async ({ page }) => {
  await loginRunner(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings/site');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: '深色', exact: true }).check();
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByText('站点设置已保存。', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: '跟随系统', exact: true }).check();
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => localStorage.removeItem('runnote-theme'));
});

test('account settings upload and remove the avatar', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/settings');
  await expect(page.getByLabel('上传头像')).toBeEnabled();
  await page.getByLabel('上传头像').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.runner-avatar img')).toBeVisible();
  await page.getByRole('button', { name: '移除头像', exact: true }).click();
  await expect(page.locator('.runner-avatar img')).toHaveCount(0);
});

test('ordinary users have no site settings entry and get 403', async ({ page, browser }) => {
  await loginRunner(page);
  const username = `ui_site_${Date.now().toString(36)}`;
  await page.request.post('/api/v1/admin/users', { headers: csrf, data: { email: `${username}@example.com`, username, display_name: '普通站点用户', timezone: 'Asia/Shanghai', password: 'Synthetic-only-password', is_active: true, showcase_enabled: false } });
  const context = await browser.newContext(); const own = await context.newPage();
  try {
    await own.goto('/admin?next=%2Fworkspace%2Fsettings');
    await expect(own.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
    await own.getByLabel('邮箱', { exact: true }).fill(`${username}@example.com`);
    await own.getByLabel('密码', { exact: true }).fill('Synthetic-only-password');
    await own.getByRole('button', { name: '登录', exact: true }).click();
    await expect(own).toHaveURL(/\/workspace\/settings$/);
    await expect(own.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '站点设置' })).toHaveCount(0);
    await expect(own.getByLabel('上传头像')).toBeEnabled();
    expect((await own.goto('/settings/site'))?.status()).toBe(403);
  } finally { await context.close(); }
});
