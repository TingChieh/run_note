import { expect, test, type Page } from '@playwright/test';
import { openAccountMenu, openGoalPanel, settingsLink } from '../fixtures/top-navigation';
async function login(page: Page) {
  await page.goto('/admin?next=%2Fsettings');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await page.getByLabel('邮箱', { exact: true }).fill('runner@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/, { timeout: 15_000 });
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
test('desktop sidebar highlights route, keyboard skip works, session survives navigation and logout', async ({ page }) => {
  await login(page);
  await page.getByLabel('昵称', { exact: true }).fill('悬停测试');
  const saveButton = page.getByRole('button', { name: '保存个人资料', exact: true });
  const normalColor = await saveButton.evaluate(el => getComputedStyle(el).backgroundColor);
  await saveButton.hover();
  await expect.poll(() => saveButton.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(normalColor);
  const nav = page.getByRole('navigation', { name: '主要导航' });
  await expect(await settingsLink(page)).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await nav.getByRole('link', { name: '数据汇总', exact: true }).click();
  await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '数据汇总', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('status').filter({ hasText: '正在读取' })).toHaveCount(0);
  await expect(page.locator('.calendar-scroll')).toBeVisible();
  await expect(page.getByTestId('trend-empty')).toBeVisible();
  // Empty trend data draws no chart; the footprint map's WebGL canvas is not a chart.
  await expect(page.locator('canvas:not(.globe-canvas > canvas)')).toHaveCount(0);
  await expect((await openAccountMenu(page)).getByRole('button', {name:'退出登录',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/ui-desktop-dashboard.png', fullPage: true });
  await page.reload();
  await expect(page.getByTestId('current-user')).toContainText('管理员模式');
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
  await expect(page.getByRole('region', { name: '我的活动' }).getByRole('status')).toContainText('暂无跑步记录');
  await page.route('**/api/v1/auth/logout', route => route.fulfill({ status: 503, json: { error: { message: '退出失败，请重试' } } }));
  await (await openAccountMenu(page)).getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('退出失败');
  await page.unroute('**/api/v1/auth/logout');
  const retry = (await openAccountMenu(page)).getByRole('button', { name: '退出登录', exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  // Logging out reloads the same showcase page as an anonymous visitor instead of redirecting to the admin login.
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByTestId('current-user')).toContainText('个人跑步展示');
});
test('menu navigation slides pages in the order of the menu', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: '主要导航' });
  await page.evaluate(() => {
    const target = window as typeof window & { pageAnimations: { name: string; opacity: string; duration: string }[] };
    target.pageAnimations = [];
    document.addEventListener('animationstart', event => {
      if (event.target instanceof HTMLElement && event.target.classList.contains('page-reveal')) {
        const style = getComputedStyle(event.target);
        target.pageAnimations.push({ name: event.animationName, opacity: style.opacity, duration: style.animationDuration });
      }
    }, true);
  });

  await nav.getByRole('link', { name: '数据汇总', exact: true }).click();
  await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { pageAnimations: { name: string }[] }).pageAnimations.map(animation => animation.name))).toContain('page-enter-down');
  const downAnimation = await page.evaluate(() => (window as typeof window & { pageAnimations: { name: string; opacity: string; duration: string }[] }).pageAnimations.find(animation => animation.name === 'page-enter-down'));
  expect(downAnimation?.opacity).toBe('1');
  expect(downAnimation?.duration).toBe('0.42s');

  await nav.getByRole('link', { name: '跑步记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { pageAnimations: { name: string }[] }).pageAnimations.map(animation => animation.name))).toContain('page-enter-up');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animationCount = await page.evaluate(() => (window as typeof window & { pageAnimations: { name: string }[] }).pageAnimations.length);
  await (await settingsLink(page)).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { pageAnimations: { name: string }[] }).pageAnimations.length)).toBe(animationCount);
});
test('mobile tab bar supports keyboard and navigation without overflow', async ({ page }) => {
  await login(page);
  const tabs = page.getByRole('navigation', { name: '底部导航' });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('button', { name: '打开导航' })).toHaveCount(0);
    await tabs.getByRole('link', { name: '今天', exact: true }).focus();
    for (const name of ['记录', '开跑', '探索', '我的']) {
      await page.keyboard.press('Tab');
      await expect(tabs.getByRole('link', { name, exact: true })).toBeFocused();
    }
    expect(await tabs.getByRole('link', { name: '我的', exact: true }).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/ui-mobile-settings.png', fullPage: true });
  await tabs.getByRole('link', { name: '记录', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  await expect(tabs.getByRole('link', { name: '记录', exact: true })).toHaveAttribute('aria-current', 'page');
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/ui-mobile-activities.png', fullPage: true });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
  await noOverflow(page);
  await expect(page.getByRole('status').filter({ hasText: '正在读取' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /年运动日历/ })).toBeHidden();
  await expect(page.locator('.calendar-scroll')).toBeHidden();
  await expect(page.getByTestId('trend-empty')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ui-mobile-dashboard.png', fullPage: true });
});
test('anonymous auth/public layout, protected SSR and cross-tab identity change remain intact', async ({ page, context, request }) => {
  for (const path of ['/', '/activities', '/footprints', '/ai']) {
    const response = await request.get(path, { maxRedirects: 0 }); expect(response.status()).toBe(200);
  }
  const legacyHome = await request.get('/dashboard?year=2026', { maxRedirects: 0 });
  expect(legacyHome.status()).toBe(308);
  expect(new URL(legacyHome.headers().location ?? '', 'http://127.0.0.1').search).toBe('?year=2026');
  expect((await request.get('/settings', { maxRedirects: 0 })).status()).toBe(303);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/admin', '/public/activities/11111111-1111-4111-8111-111111111111', '/shared/synthetic-token']) {
    await page.goto(path); await noOverflow(page);
    await expect(page.locator('.app-sidebar')).toHaveCount(0);
  }
  await page.goto('/admin');
  await page.screenshot({ path: 'test-results/ui-mobile-login.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/ui-desktop-login.png', fullPage: true });
  await login(page);
  const second = await context.newPage(); await second.goto('/settings');
  await expect(second.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await (await openAccountMenu(page)).getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(second).toHaveURL(/\/admin\?reason=changed/);
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
    await page.goto('/public/activities/11111111-1111-4111-8111-111111111111');
    await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
    await expect(page.locator('.app-sidebar')).toHaveCount(0);
    if (width <= 639) {
      await page.getByRole('button', { name: '打开导航' }).click();
      await expect(page.getByRole('navigation', { name: '公开页面导航' })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: '我的运动统计' }).filter({ visible: true })).toBeVisible();
    await noOverflow(page);
  }
});
test('session verification failure hides private content and a later successful check restores it', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/auth/session', route => route.fulfill({ status: 503, json: { error: { message: '无法确认登录状态' } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('无法确认登录状态');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('current-user')).toHaveText('正在确认身份…');
  await expect(page.locator('.runner-name')).not.toHaveAttribute('title');
  await page.unroute('**/api/v1/auth/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
});

test('long saved nickname stays inside navigation at mobile and desktop widths', async ({ page }) => {
  await login(page);
  const nickname = 'LongSyntheticRunner'.repeat(4);
  await page.getByLabel('昵称', { exact: true }).fill(nickname);
  await page.getByRole('button', { name: '保存个人资料', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '资料已保存' })).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard');
    await expect(page.getByTestId('trend-empty')).toBeVisible();
    if (width < 768) await expect(page.locator('.calendar-scroll')).toBeHidden();
    else await expect(page.locator('.calendar-scroll')).toBeVisible();
    if (width < 800) {
      // 800px is the shell breakpoint (see top-navigation.spec.ts): phones navigate with the tab bar, which shows no nickname.
      const tabs = page.getByTestId('mobile-tabbar');
      await expect(tabs).toBeVisible();
      const fit = await tabs.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      expect(fit.scroll, `Tab bar fits ${width}px`).toBeLessThanOrEqual(fit.width);
      await noOverflow(page);
      continue;
    }
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
  for (const [route,title] of [['/','数据汇总'],['/activities','跑步记录'],['/dashboard','数据汇总'],['/footprints','个人足迹'],['/ai','AI 助手'],['/settings','设置'],['/admin','站点管理']]) {
    await page.goto(route); await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    await openGoalPanel(page);
    // Admin has no matching navigation entry; other routes mark a link or the settings avatar.
    await expect(page.locator('.app-sidebar :is([aria-current="page"], [data-current]):visible')).toHaveCount(route === '/admin' ? 0 : 1);
    await expect(await settingsLink(page)).toHaveAttribute('href','/settings');
    await page.keyboard.press('Escape');
    // Docked at the top the bar is a plain card; the glass surface is what it becomes over content, so scroll it under the bar first (routes too short to scroll keep the card).
    const scrollable = await page.evaluate(() => { window.scrollTo(0, 400); return window.scrollY > 0; });
    if (scrollable) { await expect(page.locator('.app-sidebar')).toHaveAttribute('data-floating', ''); await expect.poll(() => page.locator('.app-sidebar').evaluate(el=>getComputedStyle(el).backdropFilter), 'the top bar is the same glass surface on every private route').not.toBe('none'); }
    else { await expect(page.locator('.app-sidebar'), 'a route with nothing under the bar keeps the solid card').not.toHaveAttribute('data-floating'); expect(await page.locator('.app-sidebar').evaluate(el=>getComputedStyle(el).backdropFilter)).toBe('none'); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await noOverflow(page);
    if(route==='/')await page.screenshot({path:'test-results/unified-overview-desktop.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:900}); await page.goto('/');
  await page.screenshot({path:'test-results/unified-overview-mobile.png',fullPage:true});
  for (const route of ['/public/activities/11111111-1111-4111-8111-111111111111','/shared/synthetic-token']) {
    await page.goto(route); await expect(page.locator('.app-sidebar')).toHaveCount(0);
    await expect(page.getByRole('region',{name:'跑量目标'})).toHaveCount(0); await noOverflow(page);
  }
});

test('private navigation preserves sidebar drafts, loads only the right side and skips repeated menu clicks', async ({ page }) => {
  await login(page);
  const sidebar = page.locator('.app-sidebar');
  const original = await sidebar.elementHandle();
  const goal = await openGoalPanel(page);
  await goal.getByRole('button', { name: '设置', exact: true }).click();
  await goal.getByLabel('目标距离（km）', { exact: true }).fill('42');
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/src/routes/activities/+page.svelte', async route => { await waiting; await route.continue(); });
  const documents: string[] = [], activities: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    if (new URL(request.url()).pathname === '/api/v1/showcase/activities') activities.push(request.url());
  });
  const nav = page.getByRole('navigation', { name: '主要导航' });
  try {
    const clicked = nav.getByRole('link', { name: '跑步记录', exact: true }).click();
    await expect(page.getByTestId('navigation-progress')).toBeVisible();
    await expect(page.getByTestId('navigation-skeleton')).toBeVisible();
    await page.screenshot({path:'test-results/menu-navigation-skeleton.png',animations:'disabled'});
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeHidden();
    await expect(nav.getByRole('link', { name: '数据汇总', exact: true })).toBeEnabled();
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
    release(); await clicked;
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
    await expect(page.getByTestId('navigation-progress')).toHaveCount(0);
    await expect(page.getByTestId('navigation-skeleton')).toHaveCount(0);
    expect(await page.locator('.page-reveal').evaluate(el => getComputedStyle(el).animationName)).toBe('page-enter-down');
    await expect((await openGoalPanel(page)).getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
    expect(await original!.evaluate(el => el === document.querySelector('.app-sidebar'))).toBe(true);
    await expect(page.getByRole('region', { name: '我的活动' }).getByRole('status')).toContainText('暂无跑步记录');
    const loadedCount = activities.length;
    await nav.getByRole('link', { name: '跑步记录', exact: true }).click();
    expect(activities).toHaveLength(loadedCount);
    await (await settingsLink(page)).click();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect((await openGoalPanel(page)).getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
    expect(documents).toEqual([]);
  } finally { release(); }
});

test('successful background session checks keep loaded content and drafts visible', async ({ page }) => {
  await login(page);
  await page.getByLabel('昵称', { exact: true }).fill('Unsubmitted synthetic draft');
  const original = await page.getByRole('heading', { name: '设置', exact: true }).elementHandle();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const checked = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/v1/auth/session', async route => { started(); await waiting; await route.continue(); });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await checked;
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('Unsubmitted synthetic draft');
    release();
    await expect(page.getByRole('status').filter({ hasText: '正在确认登录' })).toHaveCount(0);
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  } finally { release(); }
});

test('top bar keeps its size at every desktop height', async ({ page }) => {
  await page.goto('/');
  for (const height of [1080, 900, 768, 720]) {
    await page.setViewportSize({ width: 1440, height });
    const box = await page.locator('.app-sidebar').boundingBox();
    expect(box!.height, `bar height at ${height}`).toBeCloseTo(64, 0);
    expect(box!.y, `bar offset at ${height}`).toBeCloseTo(14, 0);
  }
});

// Was "signed-in sidebar keeps one layout and scrolls instead of compressing": the sidebar is now a floating top bar that never scrolls.
// Same intent, restated for a row: a signed-in user's navigation has one stable layout at every desktop size, nothing is compressed or overlapping.
test('signed-in top bar keeps one layout at every desktop size instead of compressing', async ({ page }) => {
  await page.route('**/api/v1/me/running-goals', route => route.fulfill({ json: { data: { week: 5, month: null, year: null }, error: null } }));
  await login(page);
  const goal = await openGoalPanel(page);
  await expect(goal.locator('.goal-distance')).toBeVisible();
  await expect(goal.getByLabel('目标周期')).toBeVisible();
  await page.keyboard.press('Escape');
  const sidebar = page.locator('.app-sidebar');
  const sizes = [[1024, 720], [1280, 720], [1359, 720], [1360, 720], [1366, 768], [1536, 864], [1920, 1080]] as const;
  const linkHeights = new Set<number>(), linkWidthsByWidth = new Map<number, string>();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const measure = await sidebar.evaluate(el => {
      const box = (node: Element) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
      const links = [...el.querySelectorAll('nav .nav-link')].map(box);
      const parts = ['.desktop-brand', 'nav', '.nav-account'].map(selector => box(el.querySelector(selector)!));
      const account = [...el.querySelector('.nav-account')!.children].filter(node => node instanceof HTMLElement && getComputedStyle(node).display !== 'none' && !node.hasAttribute('hidden')).map(box).sort((a, b) => a.left - b.left);
      return {
        bar: box(el), links, parts, account,
        scrollsX: el.scrollWidth > el.clientWidth + 1, overflowY: getComputedStyle(el).overflowY,
        position: getComputedStyle(el).position,
      };
    });
    const label = `${width}x${height}`;
    expect(measure.links.length, `${label} links`).toBeGreaterThan(0);
    expect(measure.bar.height, `${label} bar height`).toBeCloseTo(64, 0);
    expect(measure.bar.top, `${label} bar offset`).toBeCloseTo(14, 0);
    expect(measure.position, `${label} bar stays put`).toBe('fixed');
    expect(measure.scrollsX, `${label} no horizontal clip`).toBe(false);
    // The bar is a fixed 64px row: it is not a scroll container, and every part and link sits inside it vertically.
    expect(measure.overflowY, `${label} the bar is not a scroll container`).toBe('visible');
    for (const part of [...measure.parts, ...measure.links]) { expect(part.top, `${label} content inside the bar (top)`).toBeGreaterThanOrEqual(measure.bar.top); expect(part.bottom, `${label} content inside the bar (bottom)`).toBeLessThanOrEqual(measure.bar.bottom); }
    // Brand, navigation and account stay on one line, in order, without overlapping.
    const [brand, nav, accountBox] = measure.parts;
    expect(brand.right, `${label} brand before nav`).toBeLessThanOrEqual(nav.left + 1);
    expect(nav.right, `${label} nav before account`).toBeLessThanOrEqual(accountBox.left + 1);
    expect(accountBox.right, `${label} account inside the bar`).toBeLessThanOrEqual(measure.bar.right + 1);
    const centre = measure.bar.top + measure.bar.height / 2;
    for (const part of measure.parts) expect(Math.abs((part.top + part.bottom) / 2 - centre), `${label} part is centred on the bar`).toBeLessThan(2);
    // Links never overlap each other, and the account controls never overlap each other or the links.
    for (let index = 1; index < measure.links.length; index += 1) expect(measure.links[index].left, `${label} link ${index} clear of the previous`).toBeGreaterThanOrEqual(measure.links[index - 1].right - 1);
    for (let index = 1; index < measure.account.length; index += 1) expect(measure.account[index].left, `${label} account control ${index} clear of the previous`).toBeGreaterThanOrEqual(measure.account[index - 1].right - 1);
    expect(measure.links.at(-1)!.right, `${label} last link clear of the account row`).toBeLessThanOrEqual(accountBox.left + 1);
    for (const link of measure.links) { linkHeights.add(Math.round(link.height)); expect(link.height, `${label} link height`).toBeCloseTo(40, 0); }
    // Window height must not change link sizes at a given width: remember the widths and compare after the loop.
    const widths = measure.links.map(link => Math.round(link.width)).join(',');
    if (linkWidthsByWidth.has(width)) expect(widths, `${label} link widths`).toBe(linkWidthsByWidth.get(width));
    linkWidthsByWidth.set(width, widths);
    await sidebar.screenshot({ path: test.info().outputPath(`topbar-${label}.png`) });
  }
  expect(linkHeights.size, 'one link height at every size').toBe(1);
  // The same widths at a different window height must give identical link sizes.
  for (const [width, height] of [[1280, 1080], [1360, 1080], [1536, 600]] as const) {
    await page.setViewportSize({ width, height });
    const widths = await sidebar.evaluate(el => [...el.querySelectorAll('nav .nav-link')].map(link => Math.round(link.getBoundingClientRect().width)).join(','));
    if (linkWidthsByWidth.has(width)) expect(widths, `${width}x${height} link widths match the other heights`).toBe(linkWidthsByWidth.get(width));
  }
});

test('mobile tab bar and the hidden top-bar list keep their instances across tab navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const sidebar = page.locator('.app-sidebar');
  const tabs = page.getByTestId('mobile-tabbar');
  const originalSidebar = await sidebar.elementHandle();
  const originalTabs = await tabs.elementHandle();
  await expect(sidebar).toBeHidden();
  expect(await sidebar.evaluate(el => (el as HTMLElement).inert), 'the hidden list takes no focus').toBe(true);
  for (const [name, heading] of [['今天', '数据汇总'], ['记录', '跑步记录'], ['探索', '个人足迹'], ['我的', '设置']] as const) {
    await tabs.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(tabs.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  expect(await originalSidebar!.evaluate(el => el.isConnected)).toBe(true);
  expect(await originalTabs!.evaluate(el => el.isConnected)).toBe(true);
});

test('unknown, retired and unpublished routes share one styled 404 page inside the app shell', async ({ page }) => {
  for (const path of ['/no-such-page', '/login', '/register', '/p/ui_missing_subject/dashboard']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: '页面不存在', exact: true })).toBeVisible();
    await expect(page.getByTestId('error-page')).toBeVisible();
    await expect(page.locator('.app-sidebar')).toHaveCount(1);
  }
});

test('AI 助手 navigation entry is hidden from anonymous visitors on desktop and mobile, but the route stays reachable', async ({ page }) => {
  await page.goto('/');
  // Assert only after hydration and the anonymous session resolved, not just the SSR markup.
  await expect(page.locator('header[data-auth-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: '功能入口' })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: '主要导航' });
  await expect(nav.getByRole('link', { name: '跑步记录', exact: true })).toHaveAttribute('href', '/activities');
  await expect(page.locator('.nav-account').getByRole('link', { name: '设置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '跑步记录', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AI 助手', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByRole('navigation', { name: '底部导航' });
  await expect(tabs.getByRole('link', { name: '记录', exact: true })).toHaveAttribute('href', '/activities');
  // Anonymous visitors browse the showcase: no 开跑 and no 我的.
  await expect(tabs.getByRole('link')).toHaveText(['今天', '记录', '探索']);
  await expect(page.getByRole('link', { name: 'AI 助手', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'AI 助手', exact: true })).toHaveCount(0);
  await page.goto('/ai');
  await expect(page.getByRole('heading', { level: 1, name: 'AI 助手' })).toBeVisible();
});

test('AI 助手 navigation entry is shown to logged-in users on desktop and mobile', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: 'AI 助手', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('header[data-auth-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: '功能入口' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: 'AI 助手', exact: true })).toHaveAttribute('href', '/ai');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: '底部导航' }).getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('mobile-account-links').getByRole('link', { name: 'AI 助手', exact: true })).toHaveAttribute('href', '/ai');
});

for (const width of [320, 358, 361, 375]) {
  test(`narrow ${width}px: the 我的 appearance button keeps its glass surface and settings tabs show all sections in a 2-column grid`, async ({ page }) => {
    await page.setViewportSize({ width, height: 851 });
    await login(page);
    // Phones have no top bar; the theme control lives in the 我的 panel on the account page.
    await page.goto('/settings');
    const button = page.getByTestId('mobile-account-links').locator('.theme-toggle');
    await button.scrollIntoViewIfNeeded();
    await expect.poll(() => button.locator('.rn-glass-layer').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(0);
    await page.goto('/settings/site');
    const tabs = page.locator('.underline-tabs.settings-tabs-sections');
    await expect(tabs).toBeVisible();
    const metrics = await tabs.evaluate(el => {
      const box = el.getBoundingClientRect();
      const links = [...el.querySelectorAll(':scope > a')].map(link => {
        const rect = link.getBoundingClientRect();
        return { top: Math.round(rect.top), left: rect.left, right: rect.right, height: rect.height };
      });
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, boxLeft: box.left, boxRight: box.right, links };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(new Set(metrics.links.map(link => link.top)).size).toBe(3);
    for (const link of metrics.links) {
      expect(link.left).toBeGreaterThanOrEqual(metrics.boxLeft - 1);
      expect(link.right).toBeLessThanOrEqual(metrics.boxRight + 1);
      expect(link.height).toBeGreaterThanOrEqual(44);
    }
    await noOverflow(page);
  });
}

test('narrow 361px with enlarged text: the 我的 appearance row keeps its label clear of the theme buttons', async ({ page }) => {
  await page.setViewportSize({ width: 361, height: 851 });
  await login(page);
  await page.goto('/settings');
  await page.addStyleTag({ content: 'html { font-size: 25px !important; }' });
  const row = page.locator('.mobile-account-appearance');
  await row.scrollIntoViewIfNeeded();
  const fit = await row.evaluate((el) => {
    const label = el.querySelector(':scope > span')!.getBoundingClientRect(), controls = el.querySelector('.theme-controls')!.getBoundingClientRect();
    return { gap: controls.left - label.right, right: controls.right, width: innerWidth };
  });
  expect(fit.gap).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.width);
  await noOverflow(page);
});

test('touch taps leave no hover colour behind on glass buttons', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 851 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await login(page);
  await page.goto('/settings');
  const toggle = page.getByTestId('mobile-account-links').locator('.theme-toggle');
  await toggle.scrollIntoViewIfNeeded();
  const tint = () => toggle.locator('.rn-glass-tint').evaluate(el => getComputedStyle(el).backgroundColor);
  await expect.poll(() => toggle.locator('.rn-glass-tint').count()).toBe(1);
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
  const theme = await page.locator('html').getAttribute('data-theme');
  const before = await tint();
  await toggle.tap();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', theme!);
  await toggle.tap();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme!);
  await page.waitForTimeout(500);
  expect(await toggle.evaluate(el => el.matches(':hover'))).toBe(true);
  expect(await tint()).toBe(before);
  await context.close();
});
