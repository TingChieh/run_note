import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities.ts';

async function create(page: Page, username: string, published = false) {
  await page.getByRole('button', { name: '新增用户', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增用户', exact: true });
  await dialog.getByLabel('邮箱', { exact: true }).fill(`${username}@example.com`);
  await dialog.getByLabel('用户名', { exact: true }).fill(username);
  await dialog.getByLabel('昵称', { exact: true }).fill(`合成 ${username}`);
  await dialog.getByLabel('初始密码', { exact: true }).fill('Synthetic-only-password');
  if (published) await dialog.getByLabel('公开该用户的全部内容').check();
  await dialog.getByRole('button', { name: '创建用户', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  return page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`@${username} `) }) });
}

test('owner creates, edits, publishes and disables accounts while protecting the owner', async ({ page }) => {
  await loginRunner(page); await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
  await expect(page.getByText('受保护账号', { exact: true })).toBeVisible();
  const row = await create(page, 'ui_account_a');
  await expect(row.getByRole('switch', { name: '公开展示 合成 ui_account_a', exact: true })).toHaveAttribute('aria-checked', 'false');
  await row.getByRole('button', { name: '编辑 合成 ui_account_a', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑用户', exact: true });
  await expect(editor.getByLabel('用户名', { exact: true })).toBeDisabled();
  await editor.getByLabel('昵称', { exact: true }).fill('合成修改用户');
  await editor.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await row.getByRole('switch', { name: '公开展示 合成修改用户', exact: true }).click();
  await expect(row.getByRole('link', { name: '查看展示 合成修改用户', exact: true })).toHaveAttribute('href', '/p/ui_account_a');
  await row.getByRole('switch', { name: '允许登录 合成修改用户', exact: true }).click();
  await expect(row.getByRole('switch', { name: '允许登录 合成修改用户', exact: true })).toHaveAttribute('aria-checked', 'false'); await expect(row.getByRole('switch', { name: '公开展示 合成修改用户', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(row.getByRole('link', { name: /查看展示/ })).toHaveCount(0);
  await row.getByRole('switch', { name: '允许登录 合成修改用户', exact: true }).click();
  await expect(row.getByRole('switch', { name: '允许登录 合成修改用户', exact: true })).toHaveAttribute('aria-checked', 'true'); await expect(row.getByRole('switch', { name: '公开展示 合成修改用户', exact: true })).toHaveAttribute('aria-checked', 'false');
});

test('reset verifies confirmation, clears sensitive inputs, and search preserves the active filter', async ({ page }) => {
  await loginRunner(page); await page.goto('/admin/users');
  const row = await create(page, 'ui_account_b');
  await row.getByRole('button', { name: '重置密码 合成 ui_account_b', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重置用户密码', exact: true });
  await dialog.getByLabel('新密码', { exact: true }).fill('Replacement-password-only');
  await dialog.getByLabel('再次输入新密码', { exact: true }).fill('Different-password-only');
  await dialog.getByRole('button', { name: '确认重置密码', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('两次输入的密码不一致');
  await dialog.getByLabel('再次输入新密码', { exact: true }).fill('Replacement-password-only');
  await dialog.getByRole('button', { name: '确认重置密码', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '密码已重置' })).toBeVisible();
  await expect(page.locator('input[type=password]').first()).toHaveValue('');
  await page.getByLabel('邮箱或用户名').fill('ui_account_b');
  await page.getByRole('group', { name: '登录状态' }).getByRole('button', { name: '已启用', exact: true }).click();
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(row).toContainText('ui_account_b@example.com');
});

test('new account dialog keeps drafts after conflict and supports Escape and narrow dark layout', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('runnote-theme', 'dark'));
  await page.setViewportSize({ width: 390, height: 900 });
  await loginRunner(page); await page.goto('/admin/users');
  await page.getByRole('button', { name: '新增用户', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增用户', exact: true });
  await dialog.getByLabel('邮箱', { exact: true }).fill('conflict@example.com');
  await dialog.getByLabel('用户名', { exact: true }).fill('runner');
  await dialog.getByLabel('昵称', { exact: true }).fill('保留草稿');
  await dialog.getByLabel('初始密码', { exact: true }).fill('Synthetic-only-password');
  await dialog.getByRole('button', { name: '创建用户', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('已存在');
  await expect(dialog.getByLabel('昵称', { exact: true })).toHaveValue('保留草稿');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('admin-users-mobile-dark.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '新增用户', exact: true })).toBeFocused();
});

async function provision(page: Page, username: string, published: boolean) {
  const response = await page.request.post('/api/v1/admin/users', {
    headers: { Origin: 'http://127.0.0.1:5191', 'X-CSRF-Token': 'ui-csrf' },
    data: { email: `${username}@example.com`, username, display_name: `跑者 ${username}`, timezone: 'Asia/Shanghai', password: 'Synthetic-only-password', is_active: true, showcase_enabled: published },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

test('client navigation refreshes the displayed subject and sidebar goals', async ({ page }) => {
  await loginRunner(page);
  await provision(page, 'ui_client_subject', true);
  await page.route(/\/api\/v1\/(?:showcase\/users\/ui_client_subject|showcase)\/running-goals$/, route => route.fulfill({ json: { data: { week: route.request().url().includes('/showcase/users/') ? 37 : 89, month: null, year: null }, error: null } }));
  await page.goto('/p/ui_client_subject/dashboard');
  await expect(page.locator('.runner-name')).toContainText('跑者 ui_client_subject');
  await expect(page.locator('.app-sidebar .goal-readonly')).toContainText('37 km');
  const navigation = page.getByRole('navigation', { name: '主要导航' });
  await expect(navigation.getByRole('link', { name: '本人工作区', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: '用户管理', exact: true })).toHaveCount(0);
  // User management now lives under settings; a showcase page has no settings link, so trigger a client-side navigation with an in-app anchor.
  await page.evaluate(() => { const link = document.createElement('a'); link.href = '/admin/users'; link.id = 'ui-users-link'; link.textContent = 'users'; document.body.append(link); });
  await page.locator('#ui-users-link').dispatchEvent('click');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/users');
  await expect(page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '用户管理', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.soft(page.locator('.runner-name')).toContainText('晨跑者');
  await expect.soft(page.locator('.app-sidebar .goal-readonly')).toContainText('89 km');
});

test('two full personal showcases keep navigation, records, routes and reports scoped and read-only', async ({ page }, info) => {
  await loginRunner(page);
  const users = ['ui_person_one', 'ui_person_two'];
  for (const username of users) await provision(page, username, true);
  const writes: string[] = [], reads: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/') && request.method() !== 'GET') writes.push(path);
    if (path.startsWith('/api/v1/') && /\/activities|\/ai-reports|\/statistics|\/footprints|\/running-goals/.test(path)) reads.push(path);
  });
  await installActivities(page);
  await page.route(/\/api\/v1\/showcase\/users\/ui_person_(?:one|two)\/activities/, async route => {
    const url = new URL(route.request().url()), username = url.pathname.split('/')[5];
    const record = { ...sampleActivity, title: `专属记录 ${username}` };
    if (url.pathname.endsWith('/route')) return route.fulfill({ json: { data: { type: 'FeatureCollection', start: [0, 0], end: [0.001, 0], features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] }, properties: { segment_index: 0, point_count: 2 } }] }, error: null } });
    if (url.pathname.endsWith('/categories')) return route.fulfill({ json: { data: [], error: null } });
    return route.fulfill({ json: { data: url.pathname.endsWith(sampleActivity.id) ? record : { items: [record], total: 1, limit: Number(url.searchParams.get('limit') ?? 20), offset: Number(url.searchParams.get('offset') ?? 0) }, error: null } });
  });
  for (const username of users) {
    for (const [section, title] of [['dashboard', '数据汇总'], ['activities', '跑步记录'], ['activities/wall', '足迹墙'], ['footprints', '个人足迹'], ['ai', 'AI 跑步分析']]) {
      await page.goto(`/p/${username}/${section}`);
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      const navigation = page.getByRole('navigation', { name: '主要导航' });
      await expect(navigation.getByRole('link', { name: '跑步记录', exact: true })).toHaveAttribute('href', `/p/${username}/activities`);
      await expect(navigation.getByRole('link', { name: '数据汇总', exact: true })).toHaveAttribute('href', `/p/${username}/dashboard`);
      await expect(page.getByRole('button', { name: /^(导入 GPX|编辑记录|生成近期总结与下周建议)/ })).toHaveCount(0);
    }
    await page.goto(`/p/${username}/activities`);
    await expect(page.getByRole('link', { name: /专属记录/ }).first()).toHaveAttribute('href', `/p/${username}/activities/${sampleActivity.id}`);
    await page.getByRole('link', { name: /专属记录/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/p/${username}/activities/${sampleActivity.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: `专属记录 ${username}`, exact: true })).toBeVisible();
    await expect(page.getByTestId('route-map-ready')).toBeVisible();
    await expect(page.getByRole('region', { name: '管理跑步记录' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '公开与分享' })).toHaveCount(0);
    if (username === users[1]) await page.screenshot({ path: info.outputPath('personal-detail-desktop.png'), fullPage: true });
  }
  expect(writes).toEqual([]);
  expect(reads.length).toBeGreaterThan(10);
  expect(reads.every(path => path.startsWith('/api/v1/showcase/users/'))).toBe(true);
  await page.goto('/dashboard');
  await expect(page.locator('.runner-name')).toContainText('晨跑者');
});

test('ordinary user changes own password and logs in again after all sessions expire', async ({ page, browser }) => {
  await loginRunner(page);
  await provision(page, 'ui_password_user', false);
  const context = await browser.newContext();
  const own = await context.newPage();
  try {
    await own.goto('/admin');
    await own.getByLabel('邮箱', { exact: true }).fill('ui_password_user@example.com');
    await own.getByLabel('密码', { exact: true }).fill('Synthetic-only-password');
    await own.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => new URL(own.url()).pathname).toBe('/workspace/dashboard');
    await own.goto('/workspace/settings');
    await own.getByRole('button', { name: '修改密码', exact: true }).click();
    await own.getByLabel('当前密码', { exact: true }).fill('Synthetic-only-password');
    await own.getByLabel('新密码（至少 12 位）', { exact: true }).fill('Replacement-only-password');
    await own.getByRole('button', { name: '修改密码并重新登录', exact: true }).click();
    await expect(own).toHaveURL(/\/admin\?reason=changed$/);
    await expect(own.locator('input[type=password]')).toHaveValue('');
    await own.getByLabel('邮箱', { exact: true }).fill('ui_password_user@example.com');
    await own.getByLabel('密码', { exact: true }).fill('Replacement-only-password');
    await own.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => new URL(own.url()).pathname).toBe('/workspace/dashboard');
  } finally { await context.close(); }
});

test('ordinary workspace stays private, cannot manage accounts, and disabled sessions are rejected', async ({ page, browser }) => {
  await loginRunner(page);
  const account = await provision(page, 'ui_private_user', false);
  const privateContext = await browser.newContext();
  const own = await privateContext.newPage();
  try {
    const response = await own.goto('/p/ui_private_user/dashboard');
    expect(response?.status()).toBe(404);
    await installActivities(own);
    await own.goto('/admin');
    await own.getByLabel('邮箱', { exact: true }).fill('ui_private_user@example.com');
    await own.getByLabel('密码', { exact: true }).fill('Synthetic-only-password');
    await own.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => new URL(own.url()).pathname).toBe('/workspace/dashboard');
    await own.goto('/workspace/activities');
    await expect(own.getByRole('button', { name: '导入 GPX', exact: true })).toBeVisible();
    const ownNavigation = own.getByRole('navigation', { name: '主要导航' });
    await expect(ownNavigation.getByRole('link', { name: '本人工作区', exact: true })).toHaveAttribute('href', '/workspace/dashboard');
    await expect(ownNavigation.getByRole('link', { name: '用户管理', exact: true })).toHaveCount(0);
    await expect(own.getByRole('link', { name: sampleActivity.title, exact: false }).first()).toHaveAttribute('href', `/workspace/activities/${sampleActivity.id}`);
    const forbidden = await own.goto('/admin/users');
    expect(forbidden?.status()).toBe(403);
    await expect(own.getByRole('button', { name: '新增用户', exact: true })).toHaveCount(0);
    await own.goto('/activities');
    await expect(own.getByRole('button', { name: '导入 GPX', exact: true })).toHaveCount(0);
    const disabled = await page.request.patch(`/api/v1/admin/users/${account.id}`, { headers: { 'X-CSRF-Token': 'ui-csrf' }, data: { is_active: false } });
    expect(disabled.status()).toBe(200);
    await own.goto('/workspace/dashboard');
    await expect(own).toHaveURL(/\/admin\?next=/);
  } finally { await privateContext.close(); }
});

test('owner selects accounts on the current page and permanently deletes them', async ({ page }) => {
  await loginRunner(page); await page.goto('/admin/users');
  await expect(page.getByRole('rowheader', { name: /· 站主/ })).toBeVisible();
  await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /· 站主/ }) }).getByRole('checkbox')).toHaveCount(0);
  const first = await create(page, 'ui_bulk_one');
  const second = await create(page, 'ui_bulk_two');
  await page.getByLabel('邮箱或用户名', { exact: true }).fill('ui_bulk_');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('row')).toHaveCount(3);

  const header = page.getByRole('checkbox', { name: '全选本页', exact: true });
  const toolbar = page.getByRole('region', { name: '批量管理用户' });
  await expect(toolbar).toHaveCount(0);
  await first.getByRole('checkbox').check();
  await expect(toolbar).toContainText('已选 1 个');
  expect(await header.evaluate(element => (element as HTMLInputElement).indeterminate)).toBe(true);
  await header.check();
  await expect(second.getByRole('checkbox')).toBeChecked();
  await expect(toolbar).toContainText('已选 2 个');

  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(toolbar).toHaveCount(0);
  await header.check();

  const remove = toolbar.getByRole('button', { name: '删除所选', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: '永久删除 2 个用户？', exact: true });
  await expect(dialog).toContainText('@ui_bulk_one');
  await expect(dialog).toContainText('@ui_bulk_two');
  const confirm = dialog.getByRole('button', { name: '永久删除', exact: true });
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(remove).toBeFocused();

  await remove.click();
  await dialog.getByLabel('输入“删除”以确认').fill('删');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('输入“删除”以确认').fill('删除');
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('已删除 2 个用户。', { exact: true })).toBeVisible();
  await expect(page.getByText('没有符合条件的用户。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增用户', exact: true })).toBeFocused();
});
