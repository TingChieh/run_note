import { expect, test } from '@playwright/test';

test('showcase reuses theme controls without losing drafts or making API calls', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RunNote 组件展示', exact: true })).toBeVisible();
  await page.getByLabel('训练名称', { exact: true }).fill('保留草稿');
  await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('训练名称', { exact: true })).toHaveValue('保留草稿');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '跟随系统外观', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '不可用操作', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重新加载示例', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '示例已恢复' })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test('date keyboard selection respects bounds, Escape restores focus and layouts fit', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T12:00:00Z') });
  await page.goto('/');
  for (const width of [320, 390, 639, 640, 768, 1023, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  const trigger = page.getByRole('button', { name: '选择训练日期', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '选择训练日期', exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await expect(dialog.getByRole('button', { name: '2026年10月16日', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('训练日期', { exact: true })).toHaveValue('2026-10-17');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByRole('button', { name: '2026年10月1日', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel('禁用日期', { exact: true })).toBeDisabled();
});

test('time picker types 24-hour digits, greys out later times, and keeps focus and bounds', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 320, height: 800 });
  const field = page.getByLabel('服药时间', { exact: true });
  await expect(field).toHaveValue('09:30');
  // A colon is added while typing; a short entry is completed when the field is left.
  await field.fill('');
  await field.pressSequentially('1245');
  await expect(field).toHaveValue('12:45');
  await field.fill('830');
  await field.blur();
  await expect(field).toHaveValue('08:30');
  await field.fill('2575');
  await field.blur();
  await expect(field).toHaveValue('08:30');
  const trigger = page.getByRole('button', { name: '选择服药时间', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '选择服药时间', exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  // Times after max (18:30) cannot be chosen; the nearest allowed one is used instead.
  const hours = dialog.getByTestId('time-hours'), minutes = dialog.getByTestId('time-minutes');
  await expect(hours.getByRole('option', { name: '19', exact: true })).toBeDisabled();
  await hours.getByRole('option', { name: '18', exact: true }).click();
  await expect(field).toHaveValue(/^18:/);
  await expect(minutes.getByRole('option', { name: '31', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '现在', exact: true }).click();
  await expect(field).toHaveValue('18:30');
  await expect(hours.getByRole('option', { name: '18', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel('禁用时间', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '选择禁用时间', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} component composition keeps readable tokens and visual baseline`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-16T12:00:00Z') });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    const reference = page.getByTestId('visual-reference');
    await expect(reference).toBeVisible();
    await expect(reference.locator('.sr-only')).toHaveCSS('position', 'absolute');
    await expect(page.locator('.rn-glass-control').first()).toBeAttached();
    await expect(reference).toHaveScreenshot(`composition-${theme}.png`);
    await expect(page.getByTestId('surface-mapping')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(51, 49, 47)' : 'rgb(255, 255, 255)');
    const contrast = await page.getByTestId('surface-mapping').evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => {
          const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const fg = luminance(style.color), bg = luminance(style.backgroundColor);
      return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(reference).toHaveScreenshot(`composition-${theme}-mobile.png`);
  });
}

test('forced colors keeps native controls operable and visible keyboard focus', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  const field = page.getByLabel('训练名称', { exact: true });
  await field.focus();
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS('outline-style', 'solid');
  await field.fill('键盘训练');
  await page.getByRole('checkbox', { name: '包含恢复训练', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: '包含恢复训练', exact: true })).toBeChecked();
});

test('reduced transparency removes optical filters while controls retain native values', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: '主要操作', exact: true });
  await expect(button.locator('.rn-glass-layer')).toBeAttached();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-transparency', value: 'reduce' },
    { name: 'prefers-reduced-motion', value: 'reduce' }
  ] });
  await expect(button.locator('.rn-glass-layer')).toHaveCount(0);
  await expect(button).toHaveCSS('backdrop-filter', 'none');
  await expect(button).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.skeleton-block').first()).toHaveCSS('animation-name', 'none');
  await page.getByLabel('训练类型', { exact: true }).selectOption({ label: '恢复跑' });
  await expect(page.getByLabel('训练类型', { exact: true })).toHaveValue('恢复跑');
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: '展示草稿已保存' })).toBeVisible();
});

test('switch, segmented control and save bar keep native semantics', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('#switches');
  const toggle = section.getByRole('switch', { name: '公开个人主页', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(section.getByRole('region', { name: '保存设置' })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const bar = section.getByRole('region', { name: '保存设置' });
  await expect(bar).toContainText('有未保存的更改');
  await bar.getByRole('button', { name: '放弃', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(bar).toHaveCount(0);
  await expect(section.getByRole('switch', { name: /不可调节/ })).toBeDisabled();
  const group = section.getByRole('group', { name: '示例筛选' });
  await group.getByRole('button', { name: '已启用', exact: true }).click();
  await expect(group.getByRole('button', { name: '已启用', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(group.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('records banner showcase: compact, hero and phone-width variants', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('#records-banner');
  const banners = section.getByTestId('records-banner');
  await expect(banners).toHaveCount(5);
  // Each banner is named by its own visible heading (unique ids per instance).
  const ids = await section.locator('h2[id]').evaluateAll(items => items.map(item => item.id));
  expect(new Set(ids).size).toBe(ids.length);
  const hero = banners.filter({ has: page.getByRole('heading', { name: '最佳成绩' }) });
  await expect(hero).toHaveCount(1);
  await expect(hero).toHaveAccessibleName('最佳成绩');
  // One flat card like the dashboard cards (24px padding, hairline-separated columns, no tinted blocks inside).
  await expect(hero).toHaveCSS('padding-top', '24px');
  await expect(banners.first()).toHaveCSS('padding-top', '24px');
  await expect(banners.first().getByTestId('records-banner-10km')).toHaveCSS('border-left-width', '1px');
  await expect(banners.first().getByTestId('records-banner-5km')).toHaveCSS('background-image', 'none');
  await expect(hero.getByTestId('records-banner-10km')).toContainText('还没有 10K 记录');
  // Desktop compact: three columns in one row; inside the 390px frame they stack.
  const row = await Promise.all(['5km', '10km', 'total'].map(id => banners.first().getByTestId(`records-banner-${id}`).boundingBox()));
  expect(new Set(row.map(item => Math.round(item!.y))).size).toBe(1);
  const phone = section.locator('.phone-frame').getByTestId('records-banner');
  const stack = await Promise.all(['5km', '10km', 'total'].map(id => phone.getByTestId(`records-banner-${id}`).boundingBox()));
  expect(stack[1]!.y).toBeGreaterThan(stack[0]!.y + stack[0]!.height - 1);
  expect(stack[2]!.y).toBeGreaterThan(stack[1]!.y + stack[1]!.height - 1);
});
