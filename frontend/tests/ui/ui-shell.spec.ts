import { expect, test, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/login?next=%2Fsettings');
  await page.getByLabel('邮箱', { exact: true }).fill('runner@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
test('desktop sidebar highlights route, keyboard skip works, session survives navigation and logout', async ({ page }) => {
  await login(page);
  const saveButton = page.getByRole('button', { name: '保存公开设置', exact: true });
  const normalColor = await saveButton.evaluate(el => getComputedStyle(el).backgroundColor);
  await saveButton.hover();
  await expect.poll(() => saveButton.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(normalColor);
  const nav = page.getByRole('navigation', { name: '主要导航' });
  await expect(nav.getByRole('link', { name: '设置', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: '数据汇总', exact: true }).click();
  await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '数据汇总', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('status').filter({ hasText: '正在读取' })).toHaveCount(0);
  await expect(page.locator('.calendar-scroll')).toBeVisible();
  await expect(page.getByTestId('trend-empty')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'退出登录',exact:true})).toBeEnabled();
  await page.screenshot({ path: 'test-results/ui-desktop-dashboard.png', fullPage: true });
  await page.reload();
  await expect(page.getByTestId('current-user')).toContainText('runner.with.a.long');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳转到主要内容' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await noOverflow(page);
  const activitiesLink = nav.getByRole('link', { name: '跑步记录', exact: true });
  await activitiesLink.focus();
  expect(await activitiesLink.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('region', { name: '我的活动' }).getByRole('status')).toContainText('还没有活动');
  await page.route('**/api/v1/auth/logout', route => route.fulfill({ status: 503, json: { error: { message: '退出失败，请重试' } } }));
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('退出失败');
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
  await page.unroute('**/api/v1/auth/logout');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=logout$/);
  await expect(page.getByTestId('current-user')).toContainText('未登录');
});
test('mobile menu supports keyboard, Escape and navigation without overflow', async ({ page }) => {
  await login(page);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    const toggle = page.getByRole('button', { name: '打开导航' });
    await toggle.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '关闭导航' })).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(page.getByRole('navigation', { name: '主要导航' })).toBeHidden();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.screenshot({ path: 'test-results/ui-mobile-menu.png', fullPage: true });
  await page.getByRole('navigation').getByRole('link', { name: '跑步记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开导航' })).toHaveAttribute('aria-expanded', 'false');
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/ui-mobile-activities.png', fullPage: true });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /年运动日历/ })).toBeVisible();
  await noOverflow(page);
  await expect(page.getByRole('status').filter({ hasText: '正在读取' })).toHaveCount(0);
  await expect(page.locator('.calendar-scroll')).toBeVisible();
  await expect(page.getByTestId('trend-empty')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ui-mobile-dashboard.png', fullPage: true });
});
test('anonymous auth/public layout, protected SSR and cross-tab identity change remain intact', async ({ page, context, request }) => {
  for (const path of ['/activities', '/dashboard', '/footprints', '/ai', '/settings']) {
    const response = await request.get(path, { maxRedirects: 0 }); expect(response.status()).toBe(303);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/login', '/register', '/', '/u/runner', '/shared/example']) {
    await page.goto(path); await noOverflow(page);
    await expect(page.locator('.app-sidebar')).toHaveCount(0);
  }
  await page.goto('/login');
  await page.screenshot({ path: 'test-results/ui-mobile-login.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/ui-desktop-login.png', fullPage: true });
  await login(page);
  const second = await context.newPage(); await second.goto('/settings');
  await expect(second.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(second).toHaveURL(/\/login\?reason=changed/);
  await expect(second.getByTestId('current-user')).toContainText('未登录');
});

test('all P0 route shells fit narrow and desktop viewports; details retain parent navigation', async ({ page }) => {
  await login(page);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/activities', '/dashboard', '/footprints', '/ai', '/settings']) {
      await page.goto(path);
      await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
      await noOverflow(page);
    }
  }
  await page.goto('/activities/example');
  await expect(page.getByRole('navigation').getByRole('link', { name: '跑步记录', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/u/runner');
    await expect(page.locator('.app-sidebar')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '我的运动统计' })).toBeVisible();
    await noOverflow(page);
  }
});
test('session verification failure hides private content and a later successful check restores it', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/auth/session', route => route.fulfill({ status: 503, json: { error: { message: '无法确认登录状态' } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('无法确认登录状态');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/auth/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
});

test('long saved nickname stays inside navigation at mobile and desktop widths', async ({ page }) => {
  await login(page);
  const nickname = 'LongSyntheticRunner'.repeat(4);
  await page.getByLabel('昵称', { exact: true }).fill(nickname);
  await page.getByRole('button', { name: '保存公开设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '资料已保存' })).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard');
    await expect(page.locator('.calendar-scroll')).toBeVisible();
    if (width < 1024) await page.getByRole('button', { name: '打开导航' }).click();
    const sidebar = page.locator('.app-sidebar');
    await expect(sidebar).toBeVisible();
    const dimensions = await sidebar.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(dimensions.scroll, `Navigation fits ${width}px with an unbroken nickname`).toBeLessThanOrEqual(dimensions.width);
    await expect(sidebar.locator('.runner-name')).toHaveAttribute('title', nickname);
    await noOverflow(page);
  }
});

test('unified sports shell spans every private route and keeps account widgets off public pages', async ({page}) => {
  await login(page);
  for (const [route,title] of [['/','数据汇总'],['/activities','跑步记录'],['/dashboard','数据汇总'],['/footprints','个人足迹'],['/ai','AI 跑步分析'],['/settings','设置']]) {
    await page.goto(route); await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'跑量目标'})).toBeVisible();
    const nav = page.getByRole('navigation',{name:'主要导航'});
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    expect(await page.locator('.app-sidebar').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(33, 133, 56)');
    await noOverflow(page);
    if(route==='/')await page.screenshot({path:'test-results/unified-overview-desktop.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:900}); await page.goto('/');
  await page.screenshot({path:'test-results/unified-overview-mobile.png',fullPage:true});
  for (const route of ['/login','/register','/u/runner','/shared/example']) {
    await page.goto(route); await expect(page.locator('.app-sidebar')).toHaveCount(0);
    await expect(page.getByRole('region',{name:'跑量目标'})).toHaveCount(0); await noOverflow(page);
  }
});
