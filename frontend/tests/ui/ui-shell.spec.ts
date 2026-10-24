import { expect, test, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/admin?next=%2Fsettings');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
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
  await page.getByLabel('昵称', { exact: true }).fill('悬停测试');
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
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('退出失败');
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
  await page.unroute('**/api/v1/auth/logout');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
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
  await nav.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { pageAnimations: { name: string }[] }).pageAnimations.length)).toBe(animationCount);
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
  await expect(page.locator('.app-sidebar')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/ui-mobile-menu.png', fullPage: true });
  await page.getByRole('navigation').getByRole('link', { name: '跑步记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开导航' })).toHaveAttribute('aria-expanded', 'false');
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
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
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
  await page.getByRole('button', { name: '保存公开设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '资料已保存' })).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard');
    await expect(page.getByTestId('trend-empty')).toBeVisible();
    if (width < 768) await expect(page.locator('.calendar-scroll')).toBeHidden();
    else await expect(page.locator('.calendar-scroll')).toBeVisible();
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
  for (const route of ['/admin','/public/activities/11111111-1111-4111-8111-111111111111','/shared/synthetic-token']) {
    await page.goto(route); await expect(page.locator('.app-sidebar')).toHaveCount(0);
    await expect(page.getByRole('region',{name:'跑量目标'})).toHaveCount(0); await noOverflow(page);
  }
});

test('private navigation preserves sidebar drafts, loads only the right side and skips repeated menu clicks', async ({ page }) => {
  await login(page);
  const sidebar = page.locator('.app-sidebar');
  const original = await sidebar.elementHandle();
  const goal = page.getByRole('region', { name: '跑量目标' });
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
    await expect(goal.getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
    expect(await original!.evaluate(el => el === document.querySelector('.app-sidebar'))).toBe(true);
    await expect(page.getByRole('region', { name: '我的活动' }).getByRole('status')).toContainText('暂无跑步记录');
    const loadedCount = activities.length;
    await nav.getByRole('link', { name: '跑步记录', exact: true }).click();
    expect(activities).toHaveLength(loadedCount);
    await nav.getByRole('link', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(goal.getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
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

test('sidebar subtitle stays against the logo at every desktop height', async ({ page }) => {
  await page.goto('/');
  for (const height of [1080, 900, 768, 720]) {
    await page.setViewportSize({ width: 1440, height });
    const gap = await page.evaluate(() => {
      const brand = document.querySelector('.desktop-brand')!.getBoundingClientRect();
      const caption = document.querySelector('.nav-caption')!.getBoundingClientRect();
      const nav = document.querySelector('.app-sidebar nav')!.getBoundingClientRect();
      return { logo: caption.top - brand.bottom, beforeNav: nav.top - caption.bottom, caption: getComputedStyle(document.querySelector('.nav-caption')!).display };
    });
    expect(gap.caption, `caption at ${height}`).not.toBe('none');
    expect(gap.logo, `logo gap at ${height}`).toBeGreaterThanOrEqual(2);
    expect(gap.logo, `logo gap at ${height}`).toBeLessThanOrEqual(8);
    expect(gap.beforeNav, `nav gap at ${height}`).toBeGreaterThan(gap.logo);
  }
});

test('signed-in sidebar keeps one layout and scrolls instead of compressing', async ({ page }) => {
  await page.route('**/api/v1/me/running-goals', route => route.fulfill({ json: { data: { week: 5, month: null, year: null }, error: null } }));
  await login(page);
  const goal = page.getByRole('region', { name: '跑量目标' });
  await expect(goal.locator('.goal-distance')).toBeVisible();
  await expect(goal.getByLabel('目标周期')).toBeVisible();
  const sidebar = page.locator('.app-sidebar');
  const sizes = [[1280, 720], [1366, 768], [1536, 864], [1920, 1080]] as const;
  const linkHeights: number[] = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await sidebar.evaluate(el => { el.scrollTop = 0; });
    const measure = await sidebar.evaluate(el => {
      const caption = el.querySelector('.nav-caption');
      const links = [...el.querySelectorAll('nav .nav-link')].map(link => Math.round(link.getBoundingClientRect().height));
      const account = el.querySelector('.nav-account')!;
      const kids = [...account.children].filter(node => node instanceof HTMLElement && getComputedStyle(node).display !== 'none' && !node.hasAttribute('hidden'));
      const gaps = [];
      for (let index = 1; index < kids.length; index += 1) gaps.push(kids[index].getBoundingClientRect().top - kids[index - 1].getBoundingClientRect().bottom);
      const logout = account.querySelector('button')!;
      el.scrollTop = el.scrollHeight;
      const bottom = el.getBoundingClientRect().bottom - logout.getBoundingClientRect().bottom;
      return {
        caption: caption ? getComputedStyle(caption).display : 'missing',
        links,
        gaps,
        bottom,
        scrolls: el.scrollHeight > el.clientHeight + 1,
        overflowX: el.scrollWidth <= el.clientWidth + 1,
      };
    });
    expect(measure.caption, `${width}×${height} caption`).not.toBe('none');
    expect(measure.links.length, `${width}×${height} links`).toBeGreaterThan(0);
    for (const link of measure.links) expect(link, `${width}×${height} link`).toBe(56);
    expect(Math.min(...measure.gaps), `${width}×${height} account gaps`).toBeGreaterThanOrEqual(8);
    expect(measure.bottom, `${width}×${height} logout inset`).toBeGreaterThanOrEqual(24);
    expect(measure.overflowX, `${width}×${height} horizontal clip`).toBe(true);
    // 864 still fits the 1080 baseline; only shorter windows scroll inside the sidebar.
    if (height <= 768) expect(measure.scrolls, `${width}×${height} should scroll`).toBe(true);
    if (height >= 1080) expect(measure.scrolls, `${width}×${height} should fit`).toBe(false);
    linkHeights.push(measure.links[0]);
    await sidebar.evaluate(el => { el.scrollTop = 0; });
    await sidebar.screenshot({ path: test.info().outputPath(`sidebar-${width}x${height}-top.png`) });
    await sidebar.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await sidebar.screenshot({ path: test.info().outputPath(`sidebar-${width}x${height}-bottom.png`) });
  }
  expect(new Set(linkHeights).size).toBe(1);
});

test('mobile navigation pops open and closes without losing its instance or keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const sidebar = page.locator('.app-sidebar');
  const original = await sidebar.elementHandle();
  await sidebar.evaluate(el => {
    el.addEventListener('transitionrun', event => {
      if ((event as TransitionEvent).propertyName !== 'opacity' || event.target !== el) return;
      const animation = el.getAnimations().find(item => item instanceof CSSTransition && item.transitionProperty === 'opacity');
      if (!animation?.effect) return;
      animation.pause(); animation.currentTime = Number(animation.effect.getComputedTiming().duration) / 2;
      el.setAttribute('data-mid-opacity', getComputedStyle(el).opacity);
      animation.play();
    });
  });
  const toggle = page.getByRole('button', { name: '打开导航' });
  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect.poll(() => sidebar.getAttribute('data-mid-opacity')).not.toBeNull();
  const opacity = Number(await sidebar.getAttribute('data-mid-opacity'));
  expect(opacity).toBeGreaterThan(0); expect(opacity).toBeLessThan(1);
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).press('Enter');
  await expect(sidebar).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click(); await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden(); await expect(toggle).toBeFocused();
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.keyboard.press('Escape'); await expect(sidebar).toBeHidden();
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
