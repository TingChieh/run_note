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

  // Unrelated admin pages keep their existing PageHeader descriptions intact.
  await tabs.getByRole('link', { name: '站点设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/site$/);
  await expect(page.locator('.page-description')).toHaveText('管理站点名称、标语、默认外观和图标。');

  await tabs.getByRole('link', { name: '用户管理', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.locator('.page-description')).toHaveText('管理账号、登录权限和独立个人展示链接。');

  // Legacy shoe redirects preserve query parameters for owner in both root and workspace contexts.
  const rootLegacy = await page.request.get('/activities/shoes?status=retired&id=test-id&add=1', { maxRedirects: 0 });
  expect(rootLegacy.status()).toBe(303);
  expect(rootLegacy.headers().location).toBe('/settings/shoes?status=retired&id=test-id&add=1');

  const workspaceLegacy = await page.request.get('/workspace/activities/shoes?status=retired&id=test-id', {
    maxRedirects: 0,
  });
  expect(workspaceLegacy.status()).toBe(303);
  expect(workspaceLegacy.headers().location).toBe('/workspace/settings/shoes?status=retired&id=test-id');
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

test('partial running-goals save failure reports exact saved and failed periods without misleading success', async ({
  page,
}) => {
  await loginRunner(page);
  await page.goto('/settings/preferences');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');

  await page.route(
    '**/api/v1/me/running-goals/month',
    (route) =>
      route.fulfill({
        status: 500,
        json: { data: null, error: { code: 'SAVE_FAILED', message: '月度目标写入失败' } },
      }),
    { times: 1 },
  );

  await page.getByLabel('每周目标').fill('45');
  await page.getByLabel('每月目标').fill('180');
  await page.getByRole('button', { name: '保存跑量目标', exact: true }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('每周目标已保存');
  await expect(alert).toContainText('每月目标保存失败');
  await expect(alert).toContainText('月度目标写入失败');
  await expect(page.getByRole('status').filter({ hasText: '跑量目标已保存并同步' })).toHaveCount(0);

  // Saved week value is reflected immediately; failed month keeps draft & invalid marker for retry.
  const weekCard = page.locator('.goal-input-card').filter({ hasText: '每周目标' });
  const monthCard = page.locator('.goal-input-card').filter({ hasText: '每月目标' });
  await expect(weekCard).toContainText('已保存：45 km');
  await expect(monthCard).toContainText('已保存：未设置');
  await expect(page.getByLabel('每月目标')).toHaveValue('180');
  await expect(page.getByLabel('每月目标')).toHaveAttribute('aria-invalid', 'true');

  // Retrying submits only the still-dirty failed period and succeeds.
  const retriedPeriods: string[] = [];
  page.on('request', (req) => {
    const match = req.url().match(/\/api\/v1\/me\/running-goals\/(week|month|year)$/);
    if (req.method() === 'PUT' && match) retriedPeriods.push(match[1]);
  });
  await page.getByRole('button', { name: '保存跑量目标', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '跑量目标已保存并同步。' })).toBeVisible();
  await expect(monthCard).toContainText('已保存：180 km');
  expect(retriedPeriods).toEqual(['month']);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`deleting a shoe focuses the enabled add-shoe header button on ${viewport.name} (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginRunner(page);
    await page.goto('/settings/shoes');
    await page.getByRole('link', { name: /间歇训练鞋/ }).click();
    await expect(page.getByRole('heading', { name: '间歇训练鞋', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '删除跑鞋', exact: true }).click();
    const deleteDialog = page.getByRole('dialog', { name: '删除跑鞋？' });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: '已删除跑鞋' })).toBeVisible();
    const addButton = page.locator('#add-shoe');
    await expect(addButton).toBeEnabled();
    await expect(addButton).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('add-shoe');
  });
}

test('shoe reminder badge refreshes after unbinding and rebinding a shoe on activity detail via SPA navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginRunner(page);
  await page.goto('/settings');
  const tabs = page.getByRole('navigation', { name: '设置分区' });
  await expect(tabs.locator(':scope > a .settings-tab-badge')).toHaveText('1');

  // Navigate via SPA links from Settings -> Shoes -> bound activity detail so root layout stays mounted.
  await tabs.getByRole('link', { name: /跑鞋/ }).click();
  await expect(page).toHaveURL(/\/settings\/shoes$/);
  await page.getByRole('link', { name: /以往训练记录/ }).click();
  await expect(page).toHaveURL(/\/activities\/34567890-1234-4567-8899-012345678903$/);

  const binding = page.getByRole('region', { name: '活动的跑鞋' });
  await expect(binding.getByRole('combobox')).toHaveValue('45d68910-3d3d-4c10-8e13-ea016883ff41');
  await binding.getByRole('combobox').selectOption('');
  await binding.getByRole('button', { name: '保存跑鞋', exact: true }).click();
  await expect(binding.getByRole('status')).toHaveText('已解绑跑鞋');

  // Return to /settings via SPA link (without ShoesPage mounted); badge must drop from 1 to hidden (0).
  await page.getByRole('button', { name: /账户菜单/ }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(tabs.locator(':scope > a .settings-tab-badge')).toHaveCount(0);
  await expect(page.getByTestId('hub-shoes')).not.toContainText('接近阈值');

  // Navigate back to the same activity via browser history (SPA) and bind the second shoe past its 650km threshold.
  await page.goBack();
  await expect(page).toHaveURL(/\/activities\/34567890-1234-4567-8899-012345678903$/);
  await binding.getByRole('combobox').selectOption('45d68910-3d3d-4c10-8e13-ea016883ff42');
  await binding.getByRole('button', { name: '保存跑鞋', exact: true }).click();
  await expect(binding.getByRole('status')).toHaveText('已保存跑鞋');

  await page.getByRole('button', { name: /账户菜单/ }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(tabs.locator(':scope > a .settings-tab-badge')).toHaveText('1');
});

test('shrinking /settings from 1440px to 320px after select enhancement causes zero horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginRunner(page);
  await page.goto('/settings');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await page.locator('#profile-form .rn-select-toggle').waitFor({ state: 'attached' });
  await page.locator('.settings-tabs .rn-moving-copy').waitFor({ state: 'attached' });

  for (let i = 0; i < 5; i++) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.setViewportSize({ width: 320, height: 844 });
    const immediate = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(immediate.scrollWidth).toBeLessThanOrEqual(immediate.innerWidth);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const settled = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(settled.scrollWidth).toBeLessThanOrEqual(settled.innerWidth);
  }
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

    // Non-admin blank-page regression: visiting root /settings* redirects 303 to /workspace/settings* preserving query params.
    for (const [rootPath, workspacePath] of [
      ['/settings', '/workspace/settings'],
      ['/settings?from=together', '/workspace/settings?from=together'],
      ['/settings/shoes?status=retired&id=test-id', '/workspace/settings/shoes?status=retired&id=test-id'],
      ['/settings/preferences?section=goals', '/workspace/settings/preferences?section=goals'],
      [
        '/activities/shoes?status=retired&id=test-id&add=1',
        '/workspace/settings/shoes?status=retired&id=test-id&add=1',
      ],
      ['/workspace/activities/shoes?status=retired&id=test-id', '/workspace/settings/shoes?status=retired&id=test-id'],
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
        ['site', '/settings/site'],
        ['users', '/admin/users'],
      ] as const) {
        await page.goto(route);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.settings-tabs.settings-tabs-sections')).toBeVisible();
        if (slug === 'hub') {
          await expect(page.getByTestId('hub-shoes')).toContainText('双使用中');
          await expect(page.getByTestId('hub-goals')).toContainText('周 40 km');
        } else if (slug === 'shoes') {
          await expect(page.getByRole('link', { name: /长距离训练鞋/ })).toBeVisible();
        } else if (slug === 'preferences') {
          await expect(page.getByLabel('每周目标')).toHaveValue('40');
        } else if (slug === 'site') {
          await expect(page.getByLabel('站点标题', { exact: true })).toBeVisible();
        } else if (slug === 'users') {
          await expect(page.getByRole('button', { name: '新增用户', exact: true })).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        await shot(`prod-${slug}-${viewport.width}-${theme}`);
      }
    }
  }
  expect(consoleErrors).toEqual([]);

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

  // Ignore only the intentional 409/503/abort network error console messages from simulated fault tests above.
  const unexpectedConsoleErrors = consoleErrors.filter(
    (msg) => !/\b(409|503)\b|ERR_ABORTED|Failed to load resource/i.test(msg),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('mobile settings section tabs use a 2-column grid for 3, 4, and 5 links without affecting other segmented controls', async ({
  page,
  browser,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await loginRunner(page);

  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((value) => localStorage.setItem('runnote-theme', value), theme);
    await page.goto('/admin/users');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const tabs = page.locator('.settings-tabs.settings-tabs-sections');
    await expect(tabs).toBeVisible();
    await tabs.locator('.rn-moving-copy').waitFor({ state: 'attached' });
    await expect(tabs.locator(':scope > a .settings-tab-badge')).toHaveText('1');
    await expect(tabs.getByRole('link', { name: '用户管理', exact: true })).toHaveAttribute('aria-current', 'page');

    const gridMetrics = await tabs.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const adminStart = el.querySelector('a.settings-tab-admin-start')!;
      const separatorStyle = getComputedStyle(adminStart, '::before');
      const links = [...el.querySelectorAll(':scope > a')].map((link) => {
        const rect = link.getBoundingClientRect();
        return {
          text: link.textContent?.trim() ?? '',
          top: Math.round(rect.top),
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      });
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        boxLeft: box.left,
        boxRight: box.right,
        docOverflow: document.documentElement.scrollWidth > window.innerWidth,
        adminMarginStart: getComputedStyle(adminStart).marginInlineStart,
        separatorDisplay: separatorStyle.display,
        links,
      };
    });

    expect(gridMetrics.scrollWidth).toBeLessThanOrEqual(gridMetrics.clientWidth);
    expect(gridMetrics.docOverflow).toBe(false);
    expect(gridMetrics.adminMarginStart).toBe('0px');
    expect(gridMetrics.separatorDisplay).toBe('none');
    expect(new Set(gridMetrics.links.map((link) => link.top)).size).toBe(3);
    for (const link of gridMetrics.links) {
      expect(link.left).toBeGreaterThanOrEqual(gridMetrics.boxLeft - 1);
      expect(link.right).toBeLessThanOrEqual(gridMetrics.boxRight + 1);
      expect(link.height).toBeGreaterThanOrEqual(44);
    }
    // Odd 5th item spans both columns.
    expect(gridMetrics.links[4].width).toBeGreaterThan(gridMetrics.links[0].width * 1.5);

    // Active lens outline aligns over the spanning active tab.
    await page.waitForTimeout(350);
    const activeAlignment = await tabs.evaluate((el) => {
      const active = el.querySelector(':scope > a[aria-current="page"]')!.getBoundingClientRect();
      const outline = el.querySelector('.rn-moving-outline')!.getBoundingClientRect();
      return {
        dx: Math.abs(active.left - outline.left),
        dy: Math.abs(active.top - outline.top),
        dw: Math.abs(active.width - outline.width),
      };
    });
    expect(activeAlignment.dx).toBeLessThan(2);
    expect(activeAlignment.dy).toBeLessThan(2);
    expect(activeAlignment.dw).toBeLessThan(2);
  }

  // Keyboard focus remains clearly visible with ring above the glass layer.
  await page.evaluate(() => localStorage.setItem('runnote-theme', 'light'));
  await page.goto('/settings');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  const hubTabs = page.locator('.settings-tabs.settings-tabs-sections');
  await expect(hubTabs.locator(':scope > a')).toHaveCount(5);
  await hubTabs.locator('.rn-moving-copy').waitFor({ state: 'attached' });
  const firstTab = hubTabs.locator(':scope > a').first();
  await firstTab.focus();
  await page.keyboard.press('Tab');
  const secondTab = hubTabs.locator(':scope > a').nth(1);
  await expect(secondTab).toBeFocused();
  const focusStyle = await secondTab.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, zIndex: s.zIndex };
  });
  expect(focusStyle.outlineStyle).toBe('solid');
  expect(focusStyle.outlineWidth).toBe('2px');
  expect(focusStyle.zIndex).toBe('5');
  const outDir = process.env.RUNNOTE_SETTINGS_SCREENSHOTS;
  if (outDir) {
    await page.screenshot({ path: join(outDir, 'mobile-focus-390-light.png'), animations: 'disabled' });
  }

  // Long Chinese labels wrap cleanly without overflow, and 4 visible links form a balanced 2x2 grid.
  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator('.settings-tabs.settings-tabs-sections').evaluate((el) => {
    const links = el.querySelectorAll(':scope > a');
    links[0].textContent = '账户资料与安全总览设置';
    links[4]?.remove();
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fourLinkMetrics = await page.locator('.settings-tabs.settings-tabs-sections').evaluate((el) => {
    const links = [...el.querySelectorAll(':scope > a')].map((link) => {
      const rect = link.getBoundingClientRect();
      return { top: Math.round(rect.top), width: rect.width, height: rect.height };
    });
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth,
      links,
    };
  });
  expect(fourLinkMetrics.scrollWidth).toBeLessThanOrEqual(fourLinkMetrics.clientWidth);
  expect(fourLinkMetrics.docOverflow).toBe(false);
  expect(fourLinkMetrics.links).toHaveLength(4);
  expect(new Set(fourLinkMetrics.links.map((link) => link.top)).size).toBe(2);
  expect(Math.abs(fourLinkMetrics.links[3].width - fourLinkMetrics.links[0].width)).toBeLessThan(2);
  for (const link of fourLinkMetrics.links) expect(link.height).toBeGreaterThanOrEqual(44);

  // Other segmented .settings-tabs controls remain single-row on mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/shoes');
  const statusSwitch = page.getByRole('group', { name: '跑鞋状态' });
  await expect(statusSwitch).toHaveClass(/settings-tabs/);
  await expect(statusSwitch).not.toHaveClass(/settings-tabs-sections/);
  const statusRows = await statusSwitch
    .locator(':scope > button')
    .evaluateAll((buttons) => new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size);
  expect(statusRows).toBe(1);

  // Tablet and desktop breakpoints (480px, 768px, 1440px) keep the flex layout and admin separator.
  for (const width of [480, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    const desktopMetrics = await page.locator('.settings-tabs.settings-tabs-sections').evaluate((el) => {
      const adminStart = el.querySelector('a.settings-tab-admin-start')!;
      const rows = new Set([...el.querySelectorAll(':scope > a')].map((a) => Math.round(a.getBoundingClientRect().top)))
        .size;
      return {
        display: getComputedStyle(el).display,
        rows,
        separatorDisplay: getComputedStyle(adminStart, '::before').display,
        marginStart: Number.parseFloat(getComputedStyle(adminStart).marginInlineStart),
      };
    });
    expect(desktopMetrics.display).toBe('flex');
    if (width >= 768) expect(desktopMetrics.rows).toBe(1);
    expect(desktopMetrics.separatorDisplay).not.toBe('none');
    expect(desktopMetrics.marginStart).toBeGreaterThan(0);
  }

  // Non-admin member with 3 visible links renders 2 + 1 with the 3rd item spanning both columns.
  const memberUsername = `ui_mobile_tabs_${Date.now().toString(36)}`;
  const memberEmail = `${memberUsername}@example.com`;
  const memberPassword = 'Synthetic-member-password-2026';
  const created = await page.request.post('/api/v1/admin/users', {
    headers: csrf,
    data: {
      email: memberEmail,
      username: memberUsername,
      display_name: '普通移动端用户',
      timezone: 'Asia/Shanghai',
      password: memberPassword,
      is_active: true,
      showcase_enabled: false,
    },
  });
  expect(created.status()).toBe(201);
  const context = await browser.newContext();
  const member = await context.newPage();
  try {
    await member.goto('/admin?next=%2Fworkspace%2Fsettings');
    await member.getByLabel('邮箱', { exact: true }).fill(memberEmail);
    await member.getByLabel('密码', { exact: true }).fill(memberPassword);
    await member.getByRole('button', { name: '登录', exact: true }).click();
    await expect(member).toHaveURL(/\/workspace\/settings$/);
    await expect(member.locator('header')).toHaveAttribute('data-auth-ready', 'true');
    await member.setViewportSize({ width: 390, height: 844 });
    const memberTabs = member.locator('.settings-tabs.settings-tabs-sections');
    await expect(memberTabs).toBeVisible();
    const memberMetrics = await memberTabs.evaluate((el) => {
      const links = [...el.querySelectorAll(':scope > a')].map((link) => {
        const rect = link.getBoundingClientRect();
        return { top: Math.round(rect.top), width: rect.width, height: rect.height };
      });
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        docOverflow: document.documentElement.scrollWidth > window.innerWidth,
        links,
      };
    });
    expect(memberMetrics.links).toHaveLength(3);
    expect(memberMetrics.scrollWidth).toBeLessThanOrEqual(memberMetrics.clientWidth);
    expect(memberMetrics.docOverflow).toBe(false);
    expect(new Set(memberMetrics.links.map((link) => link.top)).size).toBe(2);
    expect(memberMetrics.links[2].width).toBeGreaterThan(memberMetrics.links[0].width * 1.5);
    for (const link of memberMetrics.links) expect(link.height).toBeGreaterThanOrEqual(44);
    if (outDir) {
      await member.screenshot({ path: join(outDir, 'member-3tabs-390-light.png'), animations: 'disabled' });
    }
  } finally {
    await context.close();
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
