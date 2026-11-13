import { expect, test, type Locator, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/admin?next=%2Fsettings');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await page.getByLabel('邮箱', { exact: true }).fill('runner@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
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
    for (const path of ['/admin', ...paths]) {
      await page.goto(path);
      await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
      const header = page.locator('.public-header');
      const brandText = await header.locator('.brand').evaluate(el => {
        const node = [...el.childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())!;
        const range = document.createRange(); range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      const boxes = [await header.locator('.brand-mark').boundingBox(), brandText, await header.locator('.theme-toggle').boundingBox()];
      for (const box of boxes) { expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(header.getByText('我的运动统计')).toBeHidden();
      await expect(header.getByText('退出登录')).toBeHidden();
      const actions = path === '/admin' ? page.getByRole('navigation', { name: '管理入口' }) : page.locator('.public-mobile-actions');
      await singleLine(actions.getByRole('link', { name: '我的运动统计' }));
      await singleLine(actions.getByRole('button', { name: '退出登录' }));
    }
    await page.goto('/admin');
    const longBrand = page.locator('.public-header .brand');
    await longBrand.evaluate(el => { el.lastChild!.textContent = '很长的站点名称'.repeat(12); });
    expect(await longBrand.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true);
    const brandBox = (await longBrand.boundingBox())!, themeBox = (await page.locator('.public-header .theme-toggle').boundingBox())!;
    expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(themeBox.x);
    await page.getByRole('navigation', { name: '管理入口' }).getByRole('link', { name: '我的运动统计' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/admin');
    await page.getByRole('navigation', { name: '管理入口' }).getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByTestId('current-user')).toHaveText('未登录');
    for (const path of paths) { await page.goto(path); await expect(page.locator('.public-mobile-actions')).toHaveCount(0); }
  });
}
test('桌面保留顶栏操作，其他位置不显示', async ({ page }) => {
  await login(page);
  for (const path of ['/admin', ...paths]) {
    await page.goto(path);
    const header = page.locator('.public-header');
    await expect(header.getByRole('link', { name: '我的运动统计' })).toBeVisible();
    await expect(header.getByRole('button', { name: '退出登录' })).toBeVisible();
    if (path === '/admin') {
      const actions = page.getByRole('navigation', { name: '管理入口' });
      await expect(actions.getByText('我的运动统计')).toBeHidden();
      await expect(actions.getByText('退出登录')).toBeHidden();
    } else await expect(page.locator('.public-mobile-actions')).toBeHidden();
  }
});
