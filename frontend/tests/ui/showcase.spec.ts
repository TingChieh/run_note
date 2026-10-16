import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities.ts';
import { installAI, report } from '../fixtures/p2.ts';

for (const width of [390, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`anonymous pages expose read-only owner content at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(theme => localStorage.setItem('runnote-theme', theme), theme);
      await installActivities(page);
      const ai = await installAI(page); ai.reports = [report];
      const writes: string[] = [];
      page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/') && r.method() !== 'GET') writes.push(r.url()); });
      for (const [path, heading] of [['/dashboard', '数据汇总'], ['/activities', '跑步记录'], ['/activities/wall', '足迹墙'], ['/footprints', '个人足迹'], ['/ai', 'AI 跑步分析']]) {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(path.replaceAll('/', '\\/') + '(?:\\?.*)?$'));
        await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: /^(登录|注册|设置)$/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^(编辑|设置|调整|编辑记录|删除记录|导入 GPX|生成近期总结与下周建议)/ })).toHaveCount(0);
        await expect(page.locator('[data-testid="current-user"]')).toContainText('个人跑步展示');
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.getByRole('button', { name: '查看报告', exact: true }).click();
      await expect(page.getByText('近期保持稳定运动节奏。', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '删除报告', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: '分析设置' })).toHaveCount(0);
      expect(ai.calls).toHaveLength(0);
      await page.goto(`/activities/${sampleActivity.id}`);
      await expect(page.getByRole('heading', { name: sampleActivity.title, level: 1 })).toBeVisible();
      await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole('region', { name: '管理跑步记录' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: '公开与分享' })).toHaveCount(0);
      await page.screenshot({ path: `test-results/showcase-${width}-${theme}.png`, fullPage: true });
      expect(writes).toEqual([]);
    });
  }
}

test('admin entry authenticates, enables mutations, and logout returns to public viewing', async ({ page }) => {
  const state = await installActivities(page);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/admin\?next=%2Fsettings/);
  await expect(page.getByRole('link', { name: /注册/ })).toHaveCount(0);
  await loginRunner(page);
  await page.goto('/activities');
  await expect(page.getByRole('button', { name: '导入 GPX', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: `编辑 ${sampleActivity.title}` }).click();
  await expect(page.getByRole('dialog', { name: '编辑跑步记录' })).toBeVisible();
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByTestId('current-user')).toContainText('个人跑步展示');
  await page.goto('/activities');
  await expect(page.getByRole('heading', { name: sampleActivity.title })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('old login and register pages are unavailable and registration API is closed', async ({ page, request }) => {
  for (const path of ['/login', '/register']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.locator('input[type=password]')).toHaveCount(0);
  }
  const registration = await request.post('/api/v1/auth/register', { data: {} });
  expect(registration.status()).toBe(403);
});
