import { expect, test, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';
import { loginRunner } from '../fixtures/activities.ts';

const csrf = { Origin: 'http://127.0.0.1:5191', 'X-CSRF-Token': 'ui-csrf' };

async function createAndSignInMember(page: Page, browser: Browser) {
  await loginRunner(page);
  const username = `ui_hub_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const password = 'Synthetic-member-password-2026';
  const created = await page.request.post('/api/v1/admin/users', {
    headers: csrf,
    data: {
      email,
      username,
      display_name: '普通设置用户',
      timezone: 'Asia/Shanghai',
      password,
      is_active: true,
      showcase_enabled: false,
    },
  });
  expect(created.status()).toBe(201);
  const context = await browser.newContext();
  const member = await context.newPage();
  await member.goto('/admin?next=%2Fworkspace%2Fsettings');
  await member.getByLabel('邮箱', { exact: true }).fill(email);
  await member.getByLabel('密码', { exact: true }).fill(password);
  await member.getByRole('button', { name: '登录', exact: true }).click();
  await expect(member).toHaveURL(/\/workspace\/settings$/);
  await expect(member.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  return { context, member };
}

test('settings hub shows 5 tabs for owner with pseudo-element divider and keeps liquid-glass lens aligned', async ({
  page,
}) => {
  await loginRunner(page);
  await page.goto('/settings');
  const tabs = page.getByRole('navigation', { name: '设置分区' });
  await expect(tabs.locator(':scope > a')).toHaveCount(5);
  // Divider is a CSS pseudo-element on .settings-tab-admin-start, never an extra indexed child.
  expect(
    await tabs.evaluate((el) =>
      [...el.children]
        .filter((c) => !c.classList.contains('rn-moving-copy') && !c.classList.contains('rn-moving-outline'))
        .every((c) => c.tagName === 'A'),
    ),
  ).toBe(true);
  await expect(tabs.locator('a.settings-tab-admin-start')).toHaveText('站点设置');
  await expect(tabs.getByRole('link', { name: '账户总览', exact: true })).toHaveAttribute('aria-current', 'page');

  // Hub summary strip loads shoes & goals and links cleanly to sub-tabs.
  const hub = page.getByTestId('settings-hub-strip');
  await expect(hub.getByTestId('hub-shoes')).toContainText('2 双使用中');
  await expect(hub.getByTestId('hub-shoes')).toContainText('1 双接近阈值');
  await expect(tabs.locator(':scope > a .settings-tab-badge')).toHaveText('1');

  await hub.getByTestId('hub-shoes').click();
  await expect(page).toHaveURL(/\/settings\/shoes$/);
  await expect(page.getByRole('heading', { level: 1, name: '跑鞋', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /添加跑鞋/ })).toBeVisible();

  await tabs.getByRole('link', { name: '目标与隐私', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(page.getByRole('heading', { level: 1, name: '目标与隐私', exact: true })).toBeVisible();
});

test('independent summary read failures never block profile editing on /settings or switches on /settings/preferences', async ({
  page,
}) => {
  await loginRunner(page);
  await page.route('**/api/v1/me/shoes?*', (route) =>
    route.fulfill({ status: 503, json: { data: null, error: { code: 'UNAVAILABLE', message: '跑鞋服务暂不可用' } } }),
  );
  await page.route('**/api/v1/me/running-goals', (route) =>
    route.fulfill({ status: 503, json: { data: null, error: { code: 'UNAVAILABLE', message: '目标服务暂不可用' } } }),
  );

  await page.goto('/settings');
  await expect(page.getByTestId('hub-shoes')).toContainText('跑鞋摘要暂时无法读取');
  await expect(page.getByTestId('hub-goals')).toContainText('跑量目标暂时无法读取');

  // Profile & timezone editing still works cleanly.
  await page.getByLabel('昵称', { exact: true }).fill('独立降级测试');
  await page.getByLabel('时区', { exact: true }).selectOption('Asia/Tokyo');
  await page.getByRole('button', { name: '保存个人资料', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '资料已保存。' })).toBeVisible();
  await expect(page.locator('.identity-chips')).toContainText('Asia/Tokyo');

  // On /settings/preferences, a goals read failure never blocks privacy switches.
  await page.goto('/settings/preferences');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await expect(page.getByRole('alert')).toContainText('目标服务暂不可用');
  const toggle = page.getByRole('switch', { name: '公开个人主页' });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await page.getByRole('button', { name: '保存隐私与功能设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '主页已开启' })).toBeVisible();
});

test('unified running goals editing validates input, persists via PUT, and syncs to hub strip', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/settings/preferences');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  await page.getByLabel('每周目标').fill('-10');
  await page.getByRole('button', { name: '保存跑量目标', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('大于 0');
  await expect(page.getByLabel('每周目标')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('每周目标').fill('40');
  await page.getByLabel('每月目标').fill('160.5');
  await page.getByLabel('年度目标').fill('1800');
  await page.getByRole('button', { name: '保存跑量目标', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '跑量目标已保存并同步。' })).toBeVisible();

  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '账户总览', exact: true }).click();
  await expect(page.getByTestId('hub-goals')).toContainText('周 40 km');
  await expect(page.getByTestId('hub-goals')).toContainText('月 160.5 km');
  await expect(page.getByTestId('hub-goals')).toContainText('年 1,800 km');
});

test('non-admin member gets 3 personal tabs, redirects off root /settings* (blank-page regression) and legacy /activities/shoes', async ({
  page,
  browser,
}) => {
  const { context, member } = await createAndSignInMember(page, browser);
  try {
    const tabs = member.getByRole('navigation', { name: '设置分区' });
    await expect(tabs.locator(':scope > a')).toHaveCount(3);
    await expect(tabs.getByRole('link', { name: '站点设置' })).toHaveCount(0);
    await expect(tabs.getByRole('link', { name: '用户管理' })).toHaveCount(0);

    // Non-admin blank-page regression: visiting root /settings* redirects 303 to /workspace/settings*.
    for (const [rootPath, workspacePath] of [
      ['/settings', '/workspace/settings'],
      ['/settings/shoes?status=retired', '/workspace/settings/shoes?status=retired'],
      ['/settings/preferences', '/workspace/settings/preferences'],
      ['/activities/shoes?add=1', '/workspace/settings/shoes?add=1'],
      ['/workspace/activities/shoes?status=retired', '/workspace/settings/shoes?status=retired'],
    ]) {
      const response = await member.request.get(rootPath, { maxRedirects: 0 });
      expect(response.status(), `303 for ${rootPath}`).toBe(303);
      expect(response.headers().location).toBe(workspacePath);
    }

    await member.goto('/settings');
    await expect(member).toHaveURL(/\/workspace\/settings$/);
    await expect(member.getByLabel('昵称', { exact: true })).toBeVisible();

    // Clicking the /together empty-state link lands on /workspace/settings/preferences with visible switches.
    await member.goto('/together');
    const joinLink = member.locator('.together-stack').getByRole('link', { name: '去设置里加入' });
    await expect(joinLink).toHaveAttribute('href', '/workspace/settings/preferences');
    await joinLink.click();
    await expect(member).toHaveURL(/\/workspace\/settings\/preferences$/);
    await expect(member.getByRole('switch', { name: '加入一起跑步' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('visual QA screenshots across viewports, themes and interaction states with zero console errors', async ({
  page,
}) => {
  const outDir = process.env.RUNNOTE_SETTINGS_SCREENSHOTS;
  test.skip(!outDir, 'Set RUNNOTE_SETTINGS_SCREENSHOTS to capture visual QA screenshots');

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await loginRunner(page);
  // Seed goals so the hub strip shows rich realistic values.
  await page.goto('/settings/preferences');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await page.getByLabel('每周目标').fill('40');
  await page.getByLabel('每月目标').fill('160');
  await page.getByLabel('年度目标').fill('1800');
  await page.getByRole('button', { name: '保存跑量目标', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '跑量目标已保存并同步。' })).toBeVisible();

  const shot = async (name: string) => {
    await page.screenshot({ path: join(outDir!, `${name}.png`), animations: 'disabled' });
  };

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.evaluate((value) => localStorage.setItem('runnote-theme', value), theme);
      for (const [slug, route] of [
        ['hub', '/settings'],
        ['shoes', '/settings/shoes'],
        ['preferences', '/settings/preferences'],
      ] as const) {
        await page.goto(route);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.settings-tabs')).toBeVisible();
        if (slug === 'hub') {
          await expect(page.getByTestId('hub-shoes')).toContainText('双使用中');
          await expect(page.getByTestId('hub-goals')).toContainText('周 40 km');
        } else if (slug === 'shoes') {
          await expect(page.getByRole('link', { name: /长距离训练鞋/ })).toBeVisible();
        } else if (slug === 'preferences') {
          await expect(page.getByLabel('每周目标')).toHaveValue('40');
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        await shot(`prod-${slug}-${viewport.width}-${theme}`);
      }
    }
  }

  // Interaction states at 1440x900
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => localStorage.setItem('runnote-theme', 'light'));

  // 1. Validation error dialog
  await page.goto('/settings/shoes');
  await page.getByRole('button', { name: /添加跑鞋/ }).click();
  const editor = page.getByRole('dialog', { name: '添加跑鞋' });
  await editor.getByLabel('鞋名').fill('校验测试鞋');
  await editor.getByLabel('替换阈值（km）').fill('0');
  await editor.getByRole('button', { name: '保存跑鞋', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await shot('prod-state-validation-error-light');
  await page.keyboard.press('Escape');

  // 2. Retire confirmation dialog (dark)
  await page.evaluate(() => localStorage.setItem('runnote-theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '退役跑鞋', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '退役跑鞋？' })).toBeVisible();
  await shot('prod-state-retire-confirm-dark');
  await page.keyboard.press('Escape');

  // 3. Delete 409 SHOE_IN_USE dialog (light)
  await page.evaluate(() => localStorage.setItem('runnote-theme', 'light'));
  await page.reload();
  await page.getByRole('button', { name: '删除跑鞋', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: '删除跑鞋？' });
  await deleteDialog.getByRole('button', { name: '确认删除' }).click();
  await expect(deleteDialog.getByRole('alert')).toContainText('关联活动');
  await shot('prod-state-delete-409-light');
  await page.keyboard.press('Escape');

  // 4. Empty shoes state
  await page.route('**/api/v1/me/shoes?*', (route) =>
    route.fulfill({ json: { data: { items: [], total: 0, limit: 20, offset: 0 }, error: null } }),
  );
  await page.goto('/settings/shoes');
  await expect(page.getByText('没有使用中的跑鞋')).toBeVisible();
  await shot('prod-state-empty-shoes-light');
  await page.unroute('**/api/v1/me/shoes?*');

  // 5. Error shoes state
  await page.route('**/api/v1/me/shoes?*', (route) =>
    route.fulfill({ status: 503, json: { data: null, error: { code: 'UNAVAILABLE', message: '无法读取跑鞋列表' } } }),
  );
  await page.goto('/settings/shoes');
  await expect(page.getByRole('alert')).toContainText('无法读取跑鞋列表');
  await shot('prod-state-error-shoes-light');
  await page.unroute('**/api/v1/me/shoes?*');

  // 6. Loading shoes state
  const hold = Promise.withResolvers<void>();
  await page.route('**/api/v1/me/shoes?*', async (route) => {
    await hold.promise;
    await route.abort();
  });
  await page.goto('/settings/shoes');
  await expect(page.getByText('正在读取跑鞋…')).toBeVisible();
  await shot('prod-state-loading-shoes-light');
  hold.resolve();
  await page.unroute('**/api/v1/me/shoes?*');

  // Ignore expected abort/503 network errors from simulated error/loading tests above; assert zero JS/page errors.
  expect(pageErrors).toEqual([]);
});
