import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

/** Sixteen synthetic cards recreate the backdrop-filter strip that stalled WebKit. */
async function seedStrip(page: Page) {
  const state = await installActivities(page);
  state.records = [
    { ...sampleActivity },
    ...Array.from({ length: 15 }, (_, index) => ({
      ...sampleActivity,
      id: `11111111-1111-4111-8111-${String(index + 2).padStart(12, '0')}`,
      title: `合成记录 ${index + 2}`,
      activity_date: `2026-10-${String((index % 27) + 1).padStart(2, '0')}`,
    })),
  ];
  return state;
}

/** Reject inside the page so a frozen compositor fails instead of hanging the worker. */
async function frames(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const start = performance.now();
    let count = 0;
    const timer = window.setTimeout(() => reject(new Error('30 requestAnimationFrame callbacks did not finish within 3s')), 3000);
    const step = () => {
      count += 1;
      if (count >= 30) { window.clearTimeout(timer); resolve(performance.now() - start); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
}

async function blurCount(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('*')].filter(element => {
    const value = getComputedStyle(element).backdropFilter;
    return value !== 'none' && value !== '';
  }).length);
}

test('history cards stay sharp and thirty frames finish well under a second', async ({ page, browserName, isMobile }) => {
  await seedStrip(page);
  await page.goto('/dashboard');
  const cards = page.locator('button.history-card');
  await expect(cards).toHaveCount(16);
  for (const card of await cards.all()) await expect(card).toHaveCSS('backdrop-filter', 'none');
  const arrow = page.getByRole('button', { name: '下一条运动记录' });
  await expect(arrow).toBeVisible();
  if (browserName !== 'chromium') {
    await expect(arrow).toHaveClass(/rn-glass-static/);
    await expect(arrow.locator('.rn-glass-layer')).toHaveCSS('backdrop-filter', 'none');
    expect(await blurCount(page)).toBeLessThan(8);
  }
  if (browserName === 'webkit' && !isMobile) {
    const copy = page.locator('.app-sidebar nav .rn-moving-copy');
    await expect(copy).toBeAttached();
    await expect.poll(() => copy.evaluate(element => getComputedStyle(element).clipPath)).not.toBe('none');
    expect(await copy.evaluate(element => getComputedStyle(element).filter)).toBe('none');
  }
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  const elapsed = await frames(page);
  expect(elapsed).toBeLessThan(1000);
  const shot = isMobile ? 'after-iphone-dashboard.png' : browserName === 'webkit' ? 'after-webkit-dashboard.png' : '';
  if (shot) await page.screenshot({ path: `test-results/${shot}` });
});

test('activity detail keeps animating after the route is on screen', async ({ page, browserName, isMobile }) => {
  await seedStrip(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '河畔晨跑' })).toBeVisible();
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  const elapsed = await frames(page);
  expect(elapsed).toBeLessThan(1000);
  const shot = isMobile ? 'after-iphone-detail.png' : browserName === 'webkit' ? 'after-webkit-detail.png' : '';
  if (shot) await page.screenshot({ path: `test-results/${shot}` });
});

test('an open dialog keeps the page from scrolling underneath', async ({ page, isMobile }) => {
  await installActivities(page);
  await loginRunner(page);
  if (isMobile) {
    await page.goto(`/activities/${sampleActivity.id}`);
    await expect(page.getByRole('button', { name: '生成分享图' })).toBeEnabled();
    await page.evaluate(() => { document.body.style.minHeight = '240vh'; window.scrollTo(0, 240); });
    await page.getByRole('button', { name: '生成分享图' }).click();
    const dialog = page.getByRole('dialog', { name: '生成分享图' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    await expect(page.locator('html')).toHaveClass(/rn-dialog-lock/);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');
    const top = await page.evaluate(() => document.body.style.top);
    expect(Number.parseFloat(top)).toBeLessThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(0, 2000));
    expect(await page.evaluate(() => document.body.style.top)).toBe(top);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/rn-dialog-lock/);
    return;
  }
  await page.goto('/activities');
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeEnabled();
  await page.evaluate(() => { document.body.style.minHeight = '300vh'; window.scrollTo(0, 420); });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '编辑 河畔晨跑', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
  const locked = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 900);
  expect(await page.evaluate(() => window.scrollY)).toBe(locked);
  await expect(page.locator('html')).not.toHaveClass(/rn-dialog-lock/);
  await dialog.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('a height-only resize keeps the menu and a width change closes it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'phones keep the platform select');
  await installActivities(page);
  await loginRunner(page);
  await page.goto('/activities');
  const format = page.getByLabel('文件格式', { exact: true });
  await expect(format).toHaveClass(/rn-liquid-select/);
  await format.click({ position: { x: 12, y: 20 } });
  const menu = page.getByRole('listbox', { name: '文件格式选项' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('opacity', '1');
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height - 140 });
  await expect(format).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: size.width - 160, height: size.height - 140 });
  await expect(format).toHaveAttribute('aria-expanded', 'false');
});

test('coarse pointers do not stack a custom menu on the native select', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'desktop keeps the custom menu');
  await installActivities(page);
  await loginRunner(page);
  await page.goto('/activities');
  const format = page.getByLabel('文件格式', { exact: true });
  await expect(format).toBeVisible();
  await expect(format).not.toHaveClass(/rn-liquid-select/);
  const card = page.locator('.activity-card').first();
  await card.hover();
  expect(await card.evaluate(element => getComputedStyle(element).transform)).toBe('none');
});

test('engines without overflow-clip-margin let the glass rim paint', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the fallback is for engines that lack overflow-clip-margin');
  await page.goto('/admin');
  const layer = page.getByRole('button', { name: '登录', exact: true }).locator('.rn-glass-layer');
  await expect(layer).toHaveCSS('backdrop-filter', /blur\(16px\) saturate\(1\.6\)/);
  const surface = page.locator('.rn-glass-surface').first();
  await expect(surface).toBeAttached();
  const supported = await page.evaluate(() => CSS.supports('overflow-clip-margin: 1px'));
  const fallback = await page.evaluate(() => [...document.styleSheets].some(sheet => {
    const visit = (rules: CSSRuleList): boolean => {
      for (const rule of rules) {
        if (rule instanceof CSSSupportsRule && visit(rule.cssRules)) return true;
        if (rule.cssText.includes('overflow-clip-margin') && rule.cssText.includes('overflow: visible')) return true;
      }
      return false;
    };
    try { return visit(sheet.cssRules); } catch { return false; }
  }));
  expect(fallback).toBe(true);
  if (!supported) await expect(surface).toHaveCSS('overflow', 'visible');
});

test('goal titles stay on one line and the progress bar drops the native chrome', async ({ page, isMobile, browserName }) => {
  test.skip(isMobile, 'the sidebar goal sits inside the closed phone navigation');
  await loginRunner(page);
  await page.goto('/dashboard');
  const title = page.getByRole('heading', { name: '年度目标', exact: true });
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS('white-space', 'nowrap');
  const goal = page.getByRole('region', { name: '跑量目标' });
  await goal.getByRole('button', { name: /^(设置|调整)$/ }).click();
  await goal.getByLabel('目标距离（km）', { exact: true }).fill('20');
  await goal.getByRole('button', { name: '保存', exact: true }).click();
  const progress = goal.getByRole('progressbar');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveCSS('appearance', 'none');
  if (browserName === 'firefox') {
    const bar = await progress.evaluate(element => getComputedStyle(element, '::-moz-progress-bar').backgroundColor);
    expect(bar).not.toBe('');
    expect(bar).not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('phone navigation and the share dialog finish fully visible', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'iPhone 15 simulation only');
  await installActivities(page);
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '河畔晨跑' })).toBeVisible();
  await page.getByRole('button', { name: '打开导航' }).click();
  const nav = page.locator('#app-navigation');
  await expect(nav).toBeVisible();
  await expect(nav).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/after-iphone-nav.png' });
  await page.getByRole('button', { name: '关闭导航' }).click();
  const share = page.getByRole('button', { name: '生成分享图' });
  await expect(share).toBeEnabled();
  await share.click();
  const dialog = page.getByRole('dialog', { name: '生成分享图' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/after-iphone-share.png' });
});

test('a browser without showPopover keeps the native select', async ({ page }) => {
  await page.addInitScript(() => {
    const element = HTMLElement.prototype as { showPopover?: unknown; hidePopover?: unknown; togglePopover?: unknown };
    delete element.showPopover;
    delete element.hidePopover;
    delete element.togglePopover;
    const node = Element.prototype as { checkVisibility?: unknown };
    try { delete node.checkVisibility; } catch { /* non-configurable in this engine */ }
  });
  await installActivities(page);
  await loginRunner(page);
  await page.goto('/activities');
  const format = page.getByLabel('文件格式', { exact: true });
  await expect(format).toBeVisible();
  await expect(format).not.toHaveClass(/rn-liquid-select/);
  await expect(page.locator('.rn-glass-menu')).toHaveCount(0);
});
