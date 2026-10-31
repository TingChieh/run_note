import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner } from '../fixtures/activities';
import { openAccountMenu, openGoalPanel, settingsLink } from '../fixtures/top-navigation';

const bar = (page: Page) => page.locator('.app-sidebar');
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('desktop top bar', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await expect(bar(page)).toBeVisible();
  });

  test('navigation floats above the content instead of taking a left column', async ({ page }) => {
    const box = (await bar(page).boundingBox())!;
    expect(box.y).toBeCloseTo(14, 0);
    expect(box.height).toBeCloseTo(64, 0);
    expect(await bar(page).evaluate(el => getComputedStyle(el).position)).toBe('fixed');
    const main = (await page.locator('main').boundingBox())!;
    expect(main.x, 'content starts near the left edge, no sidebar offset').toBeLessThan(100);
    expect(main.y).toBeGreaterThanOrEqual(box.y + box.height);
    await page.evaluate(() => window.scrollTo(0, 600));
    expect((await bar(page).boundingBox())!.y).toBeCloseTo(14, 0);
    await noOverflow(page);
  });

  test('the bar keeps the brand, the navigation links and the account row on one line', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await expect(nav.getByRole('link', { name: '数据汇总', exact: true })).toHaveAttribute('title', '数据汇总');
    const rects = await page.evaluate(() => {
      const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return { brand: top('.desktop-brand'), nav: top('.app-sidebar nav'), account: top('.nav-account'), bar: top('.app-sidebar') };
    });
    expect(rects.brand.right).toBeLessThanOrEqual(rects.nav.left + 1);
    expect(rects.nav.right).toBeLessThanOrEqual(rects.account.left + 1);
    expect(Math.abs((rects.nav.top + rects.nav.height / 2) - (rects.bar.top + rects.bar.height / 2))).toBeLessThan(2);
  });

  test('the loading bar spans the full width', async ({ page }) => {
    const left = await page.evaluate(() => {
      const probe = document.createElement('div'); probe.className = 'navigation-progress';
      document.querySelector('.app-shell')!.append(probe);
      const value = getComputedStyle(probe).left; probe.remove(); return value;
    });
    expect(left).toBe('0px');
  });
});

test.describe('goal ring', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
  });

  test('the ring opens the goal panel, Escape closes it and returns focus to the ring', async ({ page }) => {
    const ring = page.locator('.goal-container .anchored-trigger');
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAccessibleName(/跑量目标/);
    await expect(page.getByRole('region', { name: '跑量目标' })).toBeHidden();
    const goal = await openGoalPanel(page);
    await expect(ring).toHaveAttribute('aria-expanded', 'true');
    await expect(goal.getByLabel('目标周期', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(goal).toBeHidden();
    await expect(ring).toBeFocused();
  });

  test('the goal draft survives navigation and the period select works inside the panel', async ({ page }) => {
    let goal = await openGoalPanel(page);
    await goal.getByRole('button', { name: '设置', exact: true }).click();
    await goal.getByLabel('目标距离（km）', { exact: true }).fill('42');
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '跑步记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
    goal = await openGoalPanel(page);
    await expect(goal.getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
    await goal.getByLabel('目标周期', { exact: true }).click();
    await page.getByRole('listbox', { name: '目标周期选项' }).getByRole('option', { name: '每月' }).click();
    await expect(goal.getByLabel('目标周期', { exact: true })).toHaveValue('month');
  });
});

test('on a phone the goal stays inline in the menu and the ring is hidden', async ({ page }) => {
  await installActivities(page); await loginRunner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect(page.locator('.goal-container')).toBeAttached();
  await expect(page.locator('.goal-container .anchored-trigger')).toBeHidden();
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('region', { name: '跑量目标' })).toBeVisible();
});

test('resizing below the desktop breakpoint with the goal panel open leaves no stale popover state', async ({ page }) => {
  await installActivities(page); await loginRunner(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  await openGoalPanel(page);
  const ring = page.locator('.goal-container .anchored-trigger');
  const panel = page.locator('.goal-container .anchored-panel');
  await expect(ring).toHaveAttribute('aria-expanded', 'true');
  // attachMenuGlass paints the panel itself: an inline backdrop-filter (Chromium/Firefox) or the rn-static-glass class (WebKit).
  const glassed = () => panel.evaluate(el => el.style.backdropFilter !== '' || el.classList.contains('rn-static-glass'));
  expect(await glassed()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).not.toHaveAttribute('popover', /.*/);
  await expect.poll(glassed).toBe(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(ring).toBeVisible();
  await expect(ring).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveAttribute('popover', 'auto');
  await expect.poll(glassed).toBe(false);
  await expect(page.getByRole('region', { name: '跑量目标' })).toBeHidden();
});

test.describe('horizontal lens', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
  });

  test('the lens sits under the current link and follows hover along the x axis', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await expect(nav).toHaveAttribute('data-axis', 'x');
    const outline = nav.locator('.rn-moving-outline');
    const current = nav.getByRole('link', { name: '数据汇总', exact: true });
    const other = nav.getByRole('link', { name: '个人足迹', exact: true });
    const x = () => outline.evaluate(el => el.getBoundingClientRect().x);
    await expect.poll(x).toBeCloseTo((await current.boundingBox())!.x, 0);
    await other.hover();
    await expect.poll(x).toBeCloseTo((await other.boundingBox())!.x, 0);
    await page.getByRole('heading', { level: 1 }).hover();
    await expect.poll(x).toBeCloseTo((await current.boundingBox())!.x, 0);
  });

  test('the lens never blurs the label copy it filters, whatever the glass blur default is', async ({ page }) => {
    const copy = page.getByRole('navigation', { name: '主要导航' }).locator('.rn-moving-copy');
    await expect.poll(() => copy.evaluate(el => /^url\(/.test(el.style.filter))).toBe(true);
    const blurs = await copy.evaluate(el => {
      const id = /url\("?#([^")]+)"?\)/.exec(el.style.filter)?.[1] ?? '';
      const filter = document.getElementById(id);
      return filter ? [...filter.querySelectorAll('feGaussianBlur')].map(node => node.getAttribute('stdDeviation')) : null;
    });
    expect(blurs, 'the filter referenced by the lens copy must exist').not.toBeNull();
    expect(blurs!.filter(value => (value ?? '').split(/\s+/).some(part => Number(part) > 0))).toEqual([]);
  });

  test('the lens is hidden on a page that has no navigation link', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('navigation', { name: '主要导航' })).toHaveAttribute('data-idle', '');
  });

  test('crossing the desktop breakpoint rebuilds the lens on the other axis', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    // Hydration gate: a click before the page has hydrated does nothing, the menu stays closed (inert) and the navigation can never be found.
    await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(nav).toHaveAttribute('data-axis', 'y');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(nav).toHaveAttribute('data-axis', 'x');
  });

  // The current link keeps its real colour whenever the lens has moved off it (hover elsewhere), so it must read on the bar in both themes.
  for (const scheme of ['light', 'dark'] as const) {
    test(`the current link stays legible on the bar in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const nav = page.getByRole('navigation', { name: '主要导航' });
      await expect(nav).toHaveClass(/rn-liquid-navigation/);
      await expect(nav.getByRole('link', { name: '数据汇总', exact: true })).toHaveAttribute('aria-current', 'page');
      // The scheme switch starts a colour transition on the bar; read the colours only once it has finished (otherwise a mid-transition value like 235,235,232 is compared).
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
      const probe = await page.evaluate(() => {
        const rgb = (value: string) => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const link = document.querySelector('.app-sidebar nav > .nav-link[aria-current="page"]')!;
        const ink = document.createElement('i'); ink.style.color = 'var(--sport-nav-active-ink)';
        const surface = document.createElement('i'); surface.style.color = 'var(--surface)';
        const host = document.querySelector('.app-sidebar')!; host.append(ink, surface);
        const result = { link: rgb(getComputedStyle(link).color), ink: rgb(getComputedStyle(ink).color), surface: rgb(getComputedStyle(surface).color) };
        ink.remove(); surface.remove(); return result;
      });
      expect(probe.link).toEqual(probe.ink);
      const luminance = (c: number[]) => { const [r, g, b] = c.map(v => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
      const [light, dark] = [luminance(probe.link), luminance(probe.surface)].sort((a, b) => b - a);
      expect((light + .05) / (dark + .05), 'current link contrast against the bar').toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('responsive steps', () => {
  for (const [width, labelled] of [[1440, true], [1360, true], [1359, false], [1280, false], [1100, false], [1024, false], [800, false]] as const) {
    test(`${width}px: links ${labelled ? 'show' : 'hide'} their text and the last link stays clear of the account row`, async ({ page }) => {
      await installActivities(page); await loginRunner(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dashboard');
      const nav = page.getByRole('navigation', { name: '主要导航' });
      const link = nav.getByRole('link', { name: '数据汇总', exact: true });
      const text = link.locator('span').first();
      if (labelled) await expect(text).toBeVisible(); else await expect(text).toBeHidden();
      await expect(link).toHaveAttribute('title', '数据汇总');
      const metrics = await bar(page).evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height }));
      expect(metrics.scroll, 'bar content fits').toBeLessThanOrEqual(metrics.client);
      expect(metrics.height).toBeCloseTo(64, 0);
      // The bar is overflow: visible, so scrollWidth cannot see links that spill over the account row: compare the boxes.
      const gap = await page.evaluate(() => {
        const links = [...document.querySelectorAll('.app-sidebar nav .nav-link')];
        return document.querySelector('.nav-account')!.getBoundingClientRect().left - links.at(-1)!.getBoundingClientRect().right;
      });
      expect(gap, 'the last link ends before the account row').toBeGreaterThanOrEqual(8);
      await noOverflow(page);
    });
  }
});

test.describe('horizontal page transition', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    // A click before hydration is a plain document navigation and carries no direction; the goal container only renders once the app is hydrated.
    await page.locator('.app-sidebar .goal-container:not([hidden])').waitFor({ state: 'attached' });
  });
  const firstTransform = (page: Page) => page.locator('.page-reveal').evaluate(el => (el.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]?.transform ?? '');

  test('moving down the menu enters from the right, moving up enters from the left', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await nav.getByRole('link', { name: '跑步记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
    await expect.poll(() => firstTransform(page)).toContain('translate3d(24px');
    await nav.getByRole('link', { name: '数据汇总', exact: true }).click();
    await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
    await expect.poll(() => firstTransform(page)).toContain('translate3d(-24px');
  });
});

// An ordinary enabled account gets a ninth link ("本人工作区"). Nine labelled links never fit next to the account row, so the bar stays icon-only at every desktop width.
test('a signed-in ordinary account with nine links stays icon-only and clear of the account row at every desktop width', async ({ page, browser }) => {
  await installActivities(page); await loginRunner(page);
  const username = `ui_dense_${Date.now() % 1000000}`;
  const created = await page.request.post('/api/v1/admin/users', {
    headers: { Origin: new URL(page.url()).origin, 'X-CSRF-Token': 'ui-csrf' },
    data: { email: `${username}@example.com`, username, display_name: `跑者 ${username}`, timezone: 'Asia/Shanghai', password: 'Synthetic-only-password', is_active: true, showcase_enabled: false },
  });
  expect(created.status()).toBe(201);
  const context = await browser.newContext();
  const own = await context.newPage();
  try {
    await installActivities(own);
    await own.goto('/admin');
    await own.getByLabel('邮箱', { exact: true }).fill(`${username}@example.com`);
    await own.getByLabel('密码', { exact: true }).fill('Synthetic-only-password');
    await own.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => new URL(own.url()).pathname).toBe('/workspace/dashboard');
    for (const width of [800, 1024, 1360, 1440, 1680]) {
      await own.setViewportSize({ width, height: 900 });
      await own.goto('/workspace/dashboard');
      const nav = own.getByRole('navigation', { name: '主要导航' });
      await own.locator('.app-sidebar .goal-container:not([hidden])').waitFor({ state: 'attached' });
      await expect(nav.locator(':scope > .nav-link'), `${width}px: nine links`).toHaveCount(9);
      await expect(nav.getByRole('link', { name: '本人工作区', exact: true })).toHaveAttribute('title', '本人工作区');
      await expect(nav.getByRole('link', { name: '数据汇总', exact: true }).locator('span').first(), `${width}px: icon-only`).toBeHidden();
      await expect(nav).toHaveAttribute('data-axis', 'x');
      const rects = await own.evaluate(() => {
        const box = (node: Element) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width }; };
        const links = [...document.querySelectorAll('.app-sidebar nav > .nav-link')].map(box);
        return { links, brand: box(document.querySelector('.desktop-brand')!), nav: box(document.querySelector('.app-sidebar nav')!), account: box(document.querySelector('.nav-account')!), bar: box(document.querySelector('.app-sidebar')!) };
      });
      expect(rects.links.at(-1)!.right, `${width}px: last link ends before the account row`).toBeLessThanOrEqual(rects.account.left - 8);
      expect(rects.brand.right, `${width}px: brand before nav`).toBeLessThanOrEqual(rects.nav.left + 1);
      expect(rects.nav.right, `${width}px: nav before account`).toBeLessThanOrEqual(rects.account.left + 1);
      expect(rects.account.right, `${width}px: account inside the bar`).toBeLessThanOrEqual(rects.bar.right + 1);
      // The lens follows the current link and hover with the icon-only link widths, not with stale labelled ones.
      const outline = nav.locator('.rn-moving-outline');
      const x = () => outline.evaluate(el => el.getBoundingClientRect().x);
      const current = nav.getByRole('link', { name: '数据汇总', exact: true }), other = nav.getByRole('link', { name: '本人工作区', exact: true });
      await expect.poll(x, `${width}px: lens under the current link`).toBeCloseTo((await current.boundingBox())!.x, 0);
      await other.hover();
      await expect.poll(x, `${width}px: lens follows hover`).toBeCloseTo((await other.boundingBox())!.x, 0);
      await own.getByRole('heading', { level: 1 }).hover();
      await noOverflow(own);
    }
  } finally { await context.close(); }
});

test.describe('floating glass state', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await expect(bar(page)).toBeVisible();
  });
  const alpha = (page: Page) => bar(page).evaluate(el => {
    const value = getComputedStyle(el).backgroundColor;
    const match = value.match(/\/\s*([\d.]+)\s*\)|rgba\([^)]*,\s*([\d.]+)\)/);
    return match ? Number(match[1] ?? match[2]) : 1;
  });

  test('at the top, with nothing under it, the bar is a solid card', async ({ page }) => {
    await expect(bar(page)).not.toHaveAttribute('data-floating');
    expect(await alpha(page)).toBe(1);
  });

  test('content scrolling under the bar makes it clear glass, and it settles back at the top', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar(page)).toHaveAttribute('data-floating', '');
    await expect.poll(() => alpha(page)).toBeLessThanOrEqual(0.2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar(page)).not.toHaveAttribute('data-floating');
    await expect.poll(() => alpha(page)).toBe(1);
  });

  test('the floating bar text has no halo or glow around the glyphs', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar(page)).toHaveAttribute('data-floating', '');
    const shadows = await bar(page).evaluate(el => [...el.querySelectorAll('.brand-name, nav .nav-link > span')].map(node => getComputedStyle(node).textShadow));
    expect(shadows.length).toBeGreaterThan(0);
    for (const shadow of shadows) expect(shadow).toBe('none');
  });

  // Inactive labels and icons read in the full foreground colour while the bar floats (muted grey was too weak over the yellow header); docked they stay muted. The current link keeps its lens ink.
  for (const scheme of ['light', 'dark'] as const) {
    test(`inactive links use the foreground colour while floating and the muted colour when docked, in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const resolve = (token: string) => bar(page).evaluate((el, name) => { const probe = document.createElement('i'); probe.style.color = `var(${name})`; el.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; }, token);
      const link = page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '个人记录', exact: true });
      const color = (target = link) => target.evaluate(el => getComputedStyle(el).color);
      await expect(bar(page)).not.toHaveAttribute('data-floating');
      await expect.poll(color).toBe(await resolve('--muted-foreground'));
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(bar(page)).toHaveAttribute('data-floating', '');
      await expect.poll(color).toBe(await resolve('--foreground'));
      const current = page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '数据汇总', exact: true });
      await expect.poll(() => color(current)).toBe(await resolve('--sport-nav-active-ink'));
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(bar(page)).not.toHaveAttribute('data-floating');
      await expect.poll(color).toBe(await resolve('--muted-foreground'));
    });
  }

  test('forced colors keep the solid card and attach no refraction', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar(page)).toHaveAttribute('data-floating', '');
    expect(await bar(page).evaluate(el => el.style.backdropFilter || el.style.getPropertyValue('-webkit-backdrop-filter'))).toBe('');
  });

  test('the phone menu is not affected', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar(page)).not.toHaveAttribute('data-floating');
  });
});

// The shell breakpoint. CSS (app.css, liquid-glass-controls.css) and JS (enhanceNavigation, AppNavigation) cannot share a constant, so this test pins them all to the same width.
const SHELL_BREAKPOINT = 800;
test.describe('shell breakpoint', () => {
  test.beforeEach(async ({ page }) => { await installActivities(page); await loginRunner(page); });
  for (const width of [SHELL_BREAKPOINT - 1, SHELL_BREAKPOINT, SHELL_BREAKPOINT + 1, 1023, 1024]) {
    const top = width >= SHELL_BREAKPOINT;
    test(`${width}px: ${top ? 'floating top bar, no mobile bar, lens on x' : 'mobile bar and closed menu, lens on y'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dashboard');
      await page.locator('.app-sidebar .goal-container:not([hidden])').waitFor({ state: 'attached' });
      const nav = page.getByRole('navigation', { name: '主要导航' });
      if (top) {
        await expect(page.locator('.mobile-bar')).toBeHidden();
        await expect(bar(page)).toBeVisible();
        expect(await bar(page).evaluate(el => getComputedStyle(el).position)).toBe('fixed');
        await expect(nav).toHaveAttribute('data-axis', 'x');
        await expect(page.locator('.goal-container .anchored-trigger')).toBeVisible();
      } else {
        await expect(page.locator('.mobile-bar')).toBeVisible();
        await expect(bar(page)).toBeHidden();
        await page.getByRole('button', { name: '打开导航' }).click();
        await expect(bar(page)).toBeVisible();
        expect(await bar(page).evaluate(el => getComputedStyle(el).position)).not.toBe('fixed');
        await expect(nav).toHaveAttribute('data-axis', 'y');
        await expect(page.locator('.goal-container .anchored-trigger')).toBeHidden();
      }
      await noOverflow(page);
    });
  }

  test('resizing across the breakpoint switches the bar and the lens axis together', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await page.setViewportSize({ width: SHELL_BREAKPOINT, height: 900 });
    await page.goto('/dashboard');
    await expect(nav).toHaveAttribute('data-axis', 'x');
    await page.setViewportSize({ width: SHELL_BREAKPOINT - 1, height: 900 });
    await expect(page.locator('.mobile-bar')).toBeVisible();
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(nav).toHaveAttribute('data-axis', 'y');
    await page.setViewportSize({ width: SHELL_BREAKPOINT, height: 900 });
    await expect(nav).toHaveAttribute('data-axis', 'x');
  });
});

// The phone bar and its menu use the same surface, border and foreground tokens as the desktop bar: no solid green block (Oppo Find X8s is ~361px wide).
test.describe('phone bar and menu colours', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`361px ${scheme}: bar and menu sit on the card surface with legible text`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await installActivities(page); await loginRunner(page);
      await page.setViewportSize({ width: 361, height: 800 });
      await page.goto('/dashboard');
      await expect(page.locator('.mobile-bar')).toBeVisible();
      await page.locator('.app-sidebar .goal-container:not([hidden])').waitFor({ state: 'attached' }); // hydrated: an earlier click is not handled
      await page.getByRole('button', { name: '打开导航' }).click();
      await expect(bar(page)).toBeVisible();
      await expect(page.getByRole('navigation', { name: '主要导航' })).toHaveAttribute('data-axis', 'y');
      await page.locator('.app-sidebar').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined))));
      const probe = await page.evaluate(() => {
        const rgb = (value: string) => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        // Tokens resolve inside .sport-theme, not on body.
        const token = (name: string) => { const i = document.createElement('i'); i.style.color = `var(${name})`; document.querySelector('.mobile-bar')!.append(i); const value = rgb(getComputedStyle(i).color); i.remove(); return value; };
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        const link = document.querySelector('.app-sidebar nav > .nav-link:not([aria-current="page"])')!;
        const mark = style('.mobile-bar .brand-mark');
        return {
          surface: token('--surface'), border: token('--border'), foreground: token('--foreground'), muted: token('--muted-foreground'), brand: token('--sport-brand'), active: token('--sport-nav-active'), ink: token('--sport-nav-active-ink'),
          barBackground: rgb(style('.mobile-bar').backgroundColor), barBorder: rgb(style('.mobile-bar').borderBottomColor), barText: rgb(style('.mobile-bar .brand-name').color),
          markBackground: rgb(mark.backgroundColor), markText: rgb(mark.color),
          menuBackground: rgb(style('.app-sidebar').backgroundColor), menuBorder: rgb(style('.app-sidebar').borderBottomColor), menuLink: rgb(getComputedStyle(link).color),
          currentLink: rgb(style('.app-sidebar nav > .nav-link[aria-current="page"]').color),
          accountBorder: rgb(style('.app-sidebar .nav-account').borderTopColor),
        };
      });
      expect(probe.barBackground, 'bar background').toEqual(probe.surface);
      expect(probe.barBorder, 'bar bottom border').toEqual(probe.border);
      expect(probe.barText, 'bar text').toEqual(probe.foreground);
      expect(probe.markBackground, 'logo square').toEqual(probe.brand);
      expect(probe.markText, 'logo letter').toEqual([255, 255, 255]);
      expect(probe.menuBackground, 'menu background').toEqual(probe.surface);
      expect(probe.menuBorder, 'menu bottom border').toEqual(probe.border);
      expect(probe.menuLink, 'menu link').toEqual(probe.muted);
      expect(probe.currentLink, 'current menu link').toEqual(probe.ink);
      expect(probe.accountBorder, 'account divider').toEqual(probe.border);
      const luminance = (c: number[]) => { const [r, g, b] = c.map(v => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
      const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
      expect(contrast(probe.barText, probe.barBackground), 'bar text contrast').toBeGreaterThanOrEqual(4.5);
      expect(contrast(probe.menuLink, probe.menuBackground), 'menu link contrast').toBeGreaterThanOrEqual(4.5);
      expect(contrast(probe.currentLink, probe.active), 'current link on the active plate').toBeGreaterThanOrEqual(4.5);
      expect(contrast(probe.markText, probe.markBackground), 'logo letter contrast').toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('account menu', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
  });

  test('the avatar opens a menu with the name, settings and logout; Escape returns focus', async ({ page }) => {
    const trigger = page.getByRole('button', { name: '账户菜单' });
    const menu = await openAccountMenu(page);
    await expect(menu.getByTestId('current-user-menu')).toContainText('管理员模式');
    await expect(menu.getByRole('link', { name: '设置', exact: true })).toHaveAttribute('href', '/settings');
    await expect(menu.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('settings opens from the menu, closes the menu and is marked as the current page', async ({ page }) => {
    await (await settingsLink(page)).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('group', { name: '账户' })).toBeHidden();
    await expect(await settingsLink(page)).toHaveAttribute('aria-current', 'page');
  });

  test('logout from the menu signs out', async ({ page }) => {
    const menu = await openAccountMenu(page);
    await menu.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '账户菜单' })).toHaveCount(0);
  });

  test('only one logout button is exposed on desktop', async ({ page }) => {
    await expect(page.locator('.account-menu-host')).toBeAttached();
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
    await openAccountMenu(page);
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(1);
  });

  test('the avatar carries a ring on the settings pages and none elsewhere', async ({ page }) => {
    const ring = () => page.locator('.account-menu-host .account-avatar').evaluate(el => getComputedStyle(el).boxShadow);
    await expect(page.locator('.account-menu-host .anchored-trigger')).toBeVisible();
    expect(await ring()).toBe('none');
    await page.goto('/settings');
    await expect(page.locator('.account-menu-host .anchored-trigger')).toBeVisible();
    await expect.poll(ring).toContain('0px 0px 0px 2px');
    await expect(page.locator('.account-menu-host .account-avatar')).toHaveAttribute('data-current', '');
  });

  test('pressing the avatar button squeezes the avatar together with the glass and releases it again', async ({ page }) => {
    const trigger = page.locator('.account-menu-host .anchored-trigger');
    const avatar = page.locator('.account-menu-host .account-avatar');
    await expect(page.locator('.account-menu-host button.rn-menu-option')).toBeEnabled();
    await expect(trigger).toHaveClass(/rn-glass-control/);
    const rest = (await avatar.boundingBox())!;
    const box = (await trigger.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await avatar.boundingBox())!.width, 'the avatar widens while pressed').toBeGreaterThan(rest.width + 1);
    expect((await avatar.boundingBox())!.height, 'and flattens').toBeLessThan(rest.height - 0.5);
    expect(await avatar.evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
    // Releasing away from the button is no click, so the menu stays closed.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 120);
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await avatar.boundingBox())!.width - rest.width), 'the avatar springs back').toBeLessThan(0.5);
    // The spring snaps to exactly 0 only a moment after the width is within tolerance.
    await expect.poll(() => avatar.evaluate(el => getComputedStyle(el).transform), 'and ends at rest').toBe('matrix(1, 0, 0, 1, 0, 0)');
    await expect(page.getByRole('group', { name: '账户' })).toBeHidden();
  });

  test('keyboard: Enter opens the menu, Tab reaches settings and logout, Escape closes', async ({ page }) => {
    const trigger = page.getByRole('button', { name: '账户菜单' });
    // Wait for hydration to enable the menu controls; popovertarget is added only after mount.
    await expect(page.locator('.account-menu-host button.rn-menu-option')).toBeEnabled();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('group', { name: '账户' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('link', { name: '设置', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('button', { name: '退出登录', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('on a phone the inline account block is used and there is no avatar menu', async ({ page }) => {
    await page.setViewportSize({ width: 361, height: 740 });
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(page.locator('.account-menu-host')).toBeHidden();
    await expect(page.getByTestId('current-user')).toContainText('管理员模式');
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(1);
    await expect(page.locator('.account-inline').getByRole('link', { name: '设置', exact: true })).toBeVisible();
  });
});

test.describe('avatar placeholder without an account menu (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  const slot = (page: Page) => page.locator('.account-avatar-slot .account-avatar');

  test('an anonymous visitor sees one non-interactive avatar and no account button', async ({ page }) => {
    await installActivities(page);
    await page.goto('/dashboard');
    await expect(page.locator('header[data-auth-ready="true"]')).toHaveCount(1);
    await expect(slot(page)).toBeVisible();
    await expect(page.locator('.nav-account .account-avatar')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '账户菜单' })).toHaveCount(0);
    await expect(page.locator('.account-avatar-slot button, .account-avatar-slot a')).toHaveCount(0);
    const box = (await slot(page).boundingBox())!;
    expect(box.width).toBeCloseTo(36, 0);
    expect(box.height).toBeCloseTo(36, 0);
  });

  test('the avatar keeps its place while the identity is being confirmed', async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.goto('/dashboard');
    const toggle = page.locator('.nav-account .appearance-row');
    // Enabled only once hydrated, i.e. once the focus listener that re-checks the session exists.
    await expect(page.locator('.account-menu-host button.rn-menu-option')).toBeEnabled();
    const trigger = (await page.locator('.account-menu-host .anchored-trigger').boundingBox())!;
    const signedIn = (await toggle.boundingBox())!;
    await page.route('**/api/v1/auth/session', route => route.fulfill({ status: 503, json: { error: { message: '无法确认登录状态' } } }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('current-user')).toHaveText('正在确认身份…');
    await expect(page.getByRole('button', { name: '账户菜单' })).toHaveCount(0);
    await expect(slot(page)).toBeVisible();
    await expect(slot(page)).toHaveText('…');
    const checking = (await toggle.boundingBox())!;
    // The goal ring is hidden while checking; what must not move is the right-hand end of the row.
    expect(checking.x + checking.width).toBeCloseTo(signedIn.x + signedIn.width, 0);
    const placeholder = (await page.locator('.account-avatar-slot').boundingBox())!;
    expect(placeholder.x).toBeCloseTo(trigger.x, 0);
    expect(placeholder.width).toBeCloseTo(trigger.width, 0);
  });
});

// The bar is fixed from 800px up: anything that sticks to the top of the viewport has to stick below it, and focus / skip links / scrollIntoView have to land below it too.
test.describe('content below the fixed bar', () => {
  const barBottom = async (page: Page) => { const box = (await bar(page).boundingBox())!; return box.y + box.height; };

  test('scroll-padding-top keeps focus and anchors below the bar on desktop and is untouched on a phone', async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    const padding = () => page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await expect(bar(page)).toBeVisible();
    // 14px offset + 4rem (64px) bar + --space-2 (0.5rem, 8px).
    expect(await padding()).toBe('86px');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await padding()).toBe('auto');
  });

  test('the wellbeing history calendar sticks below the bar, and is not sticky on a phone', async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/wellbeing');
    // Hydration first: a click on the tab before it would be lost.
    await expect(page.getByTestId('wellbeing-editor')).toBeVisible();
    await expect(page.getByTestId('wellbeing-status')).toBeVisible();
    await page.getByTestId('wellbeing-tab-history').click();
    const card = page.getByTestId('wellbeing-history').locator('section.card');
    await expect(card).toBeVisible();
    const past = new Date(Date.now() - 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    if (await page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`).count() === 0) await page.getByRole('button', { name: '上个月' }).click();
    await page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`).click();
    await expect(page.getByTestId('wellbeing-editor')).toHaveAttribute('data-day', past);
    await expect(page.getByTestId('wellbeing-status')).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
    await page.evaluate(() => window.scrollTo(0, 700));
    const bottom = await barBottom(page);
    await expect.poll(async () => (await card.boundingBox())!.y).toBeGreaterThanOrEqual(bottom + 4);
    // It does stick (it is still on screen after the scroll) and its height leaves room under the bar.
    const box = (await card.boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(bottom + 24);
    expect(box.y + box.height).toBeLessThanOrEqual(900);

    // A phone: the card scrolls away with the page.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await card.evaluate(el => getComputedStyle(el).position)).toBe('static');
    const before = (await card.boundingBox())!.y;
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(async () => Math.round(before - (await card.boundingBox())!.y)).toBe(300);
  });

  test('the site settings preview column sticks below the bar', async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    // A short window, so the page scrolls far enough for the column to leave its natural place and actually stick.
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto('/settings/site');
    const aside = page.locator('.site-layout > aside');
    await expect(aside).toBeVisible();
    const natural = (await aside.boundingBox())!.y;
    const bottom = await barBottom(page);
    // 40px past the point where the column reaches its stuck position (1rem under the bar): sticking, and not yet pushed up by the end of its row.
    await page.evaluate(target => window.scrollTo(0, target), Math.round(natural - (bottom + 16) + 40));
    await expect.poll(async () => (await aside.boundingBox())!.y).toBeGreaterThanOrEqual(bottom + 4);
    expect((await aside.boundingBox())!.y).toBeLessThanOrEqual(bottom + 24);
  });
});

test('the goal ring draws no arc at 0% (a round cap on a zero-length dash would leave a dot)', async ({ page }) => {
  await installActivities(page); await loginRunner(page);
  const distance = { value: 0 };
  await page.route('**/api/v1/*/running-goals', route => route.fulfill({ json: { data: { week: 20, month: null, year: null }, error: null } }));
  await page.route('**/statistics/summary**', route => route.fulfill({ json: { data: { distance_m: distance.value }, error: null } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  const ring = page.locator('.goal-container .anchored-trigger svg');
  await expect(page.locator('.goal-container .anchored-trigger')).toHaveAccessibleName('跑量目标，本周已完成 0%');
  await expect(ring.locator('circle')).toHaveCount(1); // the track only
  await expect(ring.locator('.goal-arc')).toHaveCount(0);
  distance.value = 10000;
  await page.reload();
  await expect(page.locator('.goal-container .anchored-trigger')).toHaveAccessibleName('跑量目标，本周已完成 50%');
  await expect(ring.locator('.goal-arc')).toHaveCount(1);
});
