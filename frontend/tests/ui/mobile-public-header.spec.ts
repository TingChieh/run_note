import { expect, test, type Locator, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/admin?next=%2Fsettings');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await page.getByLabel('邮箱', { exact: true }).fill('runner@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
}
async function ready(page: Page) {
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
}
async function openPublicMenu(page: Page) {
  const menu = page.getByRole('navigation', { name: '公开页面导航' });
  if (!await menu.isVisible()) await page.getByRole('button', { name: '打开导航' }).click();
  await expect(menu).toBeVisible();
  return menu;
}
async function singleLine(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(el => {
    const text = [...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    if (!text) return false;
    const range = document.createRange();
    range.selectNodeContents(text);
    return range.getClientRects().length === 1;
  })).toBe(true);
}
const paths = ['/shared/synthetic-token', '/public/activities/11111111-1111-4111-8111-111111111111'];
for (const width of [375, 390]) {
  test(`手机 ${width}px 的公开页面操作与顶栏`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    for (const path of paths) {
      await page.goto(path);
      await ready(page);
      const header = page.locator('.public-header');
      const boxes = await Promise.all(['.brand-mark', '.brand-name', '.theme-toggle', '.nav-toggle'].map(selector => header.locator(selector).boundingBox()));
      for (const box of boxes) { expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(header.getByText('我的运动统计')).toBeHidden();
      await expect(page.locator('.public-mobile-actions, .public-mobile-only')).toHaveCount(0);
      await expect(header.getByText('退出登录')).toBeHidden();
      const actions = await openPublicMenu(page);
      await singleLine(actions.getByRole('link', { name: '我的运动统计' }));
      await singleLine(actions.getByRole('button', { name: '退出登录' }));
    }
    await page.goto(paths[0]);
    await ready(page);
    const measured = await page.locator('.public-header').evaluate((header, width) => {
      const name = header.querySelector('.brand-name') as HTMLElement;
      const theme = header.querySelector('.theme-toggle') as HTMLElement;
      name.textContent = '很长的站点名称'.repeat(12);
      const brandBox = name.getBoundingClientRect();
      const themeBox = theme.getBoundingClientRect();
      return {
        ellipsis: name.scrollWidth > name.clientWidth && getComputedStyle(name).textOverflow === 'ellipsis',
        noOverlap: brandBox.right <= themeBox.left,
        overflow: document.documentElement.scrollWidth > width,
      };
    }, width);
    expect(measured.ellipsis).toBe(true);
    expect(measured.noOverlap).toBe(true);
    expect(measured.overflow).toBe(false);
    const menu = await openPublicMenu(page);
    await menu.getByRole('link', { name: '我的运动统计' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto(paths[0]);
    await ready(page);
    await (await openPublicMenu(page)).getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByTestId('current-user')).toHaveText('未登录');
    for (const path of paths) {
      await page.goto(path);
      await ready(page);
      await expect(page.locator('.public-mobile-actions')).toHaveCount(0);
      const loggedOut = await openPublicMenu(page);
      await expect(loggedOut.getByRole('link', { name: '跑步记录' })).toBeVisible();
      await loggedOut.getByRole('link', { name: '一起跑步' }).click();
      await expect(page).toHaveURL(/\/together$/);
    }
  });
}
test('桌面保留顶栏操作，其他位置不显示', async ({ page }) => {
  await login(page);
  for (const path of paths) {
    await page.goto(path);
    await ready(page);
    const header = page.locator('.public-header');
    await expect(header.getByRole('link', { name: '我的运动统计' })).toBeVisible();
    await expect(header.getByRole('button', { name: '退出登录' })).toBeVisible();
    await expect(page.locator('.public-mobile-actions')).toHaveCount(0);
    await expect(header.locator('.nav-toggle')).toBeHidden();
  }
});
