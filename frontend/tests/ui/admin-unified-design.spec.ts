import { expect, test, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';
import { openAccountMenu } from '../fixtures/top-navigation.ts';

const entries = [
  { name: '导入与管理记录', href: '/workspace/activities' },
  { name: '目标与数据汇总', href: '/workspace/dashboard' },
  { name: '管理 AI 分析', href: '/workspace/ai' },
  { name: '账户设置', href: '/workspace/settings' },
  { name: '用户管理', href: '/admin/users' },
];

async function openNavigation(page: Page, width: number) {
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  if (width < 800) await page.getByRole('button', { name: '打开导航', exact: true }).click();
  return page.getByRole('navigation', { name: '主要导航', exact: true });
}

async function contentBounds(page: Page) {
  return page.locator('#main, .page-header').evaluateAll((elements) =>
    elements.map((element) => {
      const { x, width } = element.getBoundingClientRect();
      return { x, width };
    }),
  );
}

for (const width of [375, 390, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`已登录站点管理复用应用导航与页面布局 ${width}px ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await loginRunner(page);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
      const dashboardBounds = await contentBounds(page);
      const dashboardNavigation = await openNavigation(page, width);
      const links = await dashboardNavigation
        .locator(':scope > a.nav-link')
        .evaluateAll((elements) =>
          elements.map((element) => ({ name: element.getAttribute('aria-label'), href: element.getAttribute('href') })),
        );
      const account = await openAccountMenu(page);
      const accountLinks = await account
        .locator('a')
        .evaluateAll((elements) => elements.map((el) => el.getAttribute('href')));

      // Exercise both spellings; SvelteKit may canonicalize the trailing slash.
      await page.goto(theme === 'dark' ? '/admin/' : '/admin');
      await expect(page.getByRole('heading', { name: '站点管理', level: 1, exact: true })).toBeVisible();
      await expect(page.locator('.app-shell')).toHaveCount(1);
      await expect(page.locator('.public-header, #public-mobile-menu, .auth-content')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '公开页面导航' })).toHaveCount(0);
      expect(await contentBounds(page)).toEqual(dashboardBounds);

      const navigation = await openNavigation(page, width);
      expect(
        await navigation.locator(':scope > a.nav-link').evaluateAll((elements) =>
          elements.map((element) => ({
            name: element.getAttribute('aria-label'),
            href: element.getAttribute('href'),
          })),
        ),
      ).toEqual(links);
      await expect(page.locator('#app-navigation [aria-current="page"]')).toHaveCount(0);
      const adminAccount = await openAccountMenu(page);
      expect(
        await adminAccount.locator('a').evaluateAll((elements) => elements.map((el) => el.getAttribute('href'))),
      ).toEqual(accountLinks);
      for (const entry of entries) {
        await expect(page.locator('header').getByRole('link', { name: entry.name, exact: true })).toHaveCount(0);
      }
      await page.keyboard.press('Escape');

      const card = page.getByRole('region', { name: '站点管理', exact: true });
      await expect(card).toHaveClass(/aux-panel/);
      await expect(card.getByRole('navigation', { name: '管理入口' }).getByRole('link')).toHaveCount(entries.length);
      for (const entry of entries) {
        const link = card.getByRole('link', { name: entry.name, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', entry.href);
        const box = (await link.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const cardBounds = (await card.boundingBox())!;
      const heroBounds = (await page.locator('.page-header').boundingBox())!;
      expect(cardBounds.x).toBe(heroBounds.x);
      expect(cardBounds.width).toBe(heroBounds.width);
      await page.screenshot({ path: `test-results/admin-unified-${width}-${theme}.png`, fullPage: true });

      const firstLink = card.getByRole('link', { name: entries[0].name, exact: true });
      await firstLink.focus();
      await expect(firstLink).toBeFocused();
      expect(await firstLink.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
      await page.keyboard.press('Tab');
      await expect(card.getByRole('link', { name: entries[1].name, exact: true })).toBeFocused();

      const nav = await openNavigation(page, width);
      await nav.getByRole('link', { name: '数据汇总', exact: true }).click();
      await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
      const activeNavigation = await openNavigation(page, width);
      await expect(activeNavigation.getByRole('link', { name: '数据汇总', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(errors).toEqual([]);
    });
  }

  test(`未登录管理页保留认证布局 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin');
    await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
    await expect(page.locator('.public-shell .public-header')).toBeVisible();
    await expect(page.locator('#main')).toHaveClass(/auth-content/);
    await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible();
    await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
    await expect(page.locator('#app-navigation')).toHaveCount(0);
    if (width < 800) {
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
      const menu = page.getByRole('navigation', { name: '公开页面导航' });
      await expect(menu.getByRole('link', { name: '跑步记录', exact: true })).toBeVisible();
      await expect(menu.getByRole('link', { name: '一起跑步', exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
