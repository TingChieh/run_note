import { expect, test, type Locator } from '@playwright/test';

// Catch an incorrect/missing anchor or an exit that removes the panel immediately.
async function atButton(panel: Locator, trigger: Locator, closing = false) {
  await expect.poll(() => panel.evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
  await panel.evaluate((el, exit) => {
    for (const animation of el.getAnimations()) {
      animation.pause();
      animation.currentTime = exit ? Number(animation.effect!.getTiming().duration) - 1 : 0;
    }
  }, closing);
  const button = (await trigger.boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - button.x - button.width / 2)).toBeLessThan(3);
  expect(Math.abs(box.y + box.height / 2 - button.y - button.height / 2)).toBeLessThan(3);
  expect(Math.abs(box.width - button.width)).toBeLessThan(3);
  expect(Math.abs(box.height - button.height)).toBeLessThan(3);
  await panel.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: date and nested select emerge from their own controls and return on selection`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '选择训练日期', exact: true });
    await trigger.click();
    const panel = page.locator('.date-popover').first();
    await atButton(panel, trigger);
    const year = panel.getByRole('combobox', { name: '年份', exact: true });
    await expect(year).toHaveClass(/rn-liquid-select/);
    await year.click();
    const years = page.locator(`#${await year.getAttribute('aria-controls')}`);
    await atButton(years, year);
    await year.press('Enter');
    await atButton(years, year, true);
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '2026年10月18日', exact: true }).click();
    await atButton(panel, trigger, true);
    await expect(page.getByLabel('训练日期', { exact: true })).toHaveValue('2026-10-18');
    await expect(trigger).toBeFocused();
  });
}

test('edge placement, native light dismissal, rapid reopen and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const select = page.getByLabel('训练类型', { exact: true });
  await expect(select).toHaveClass(/rn-liquid-select/);
  await select.click();
  const menu = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await atButton(menu, select);
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.mouse.click(2, 2);
  await atButton(menu, select, true);
  await expect(select).toHaveAttribute('aria-expanded', 'false');
  await select.click();
  await select.press('Escape');
  await select.press('ArrowDown');
  await expect(menu).toBeVisible();
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await select.press('Escape');
  await expect(menu).toBeHidden();
  await expect(select).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select.click();
  expect(await menu.evaluate(el => el.getAnimations().length)).toBe(0);
  await expect(menu).toHaveCSS('scale', '1');
  await select.press('Escape');
  await expect(menu).toBeHidden();
});

test('map menu returns to its button on Escape and selection at desktop and mobile widths', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '切换底图', exact: true });
  const menu = page.locator('.basemap-options');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    await atButton(menu, trigger);
    await page.keyboard.press('Escape');
    await atButton(menu, trigger, true);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await atButton(menu, trigger);
    await menu.getByRole('button', { name: 'Dark', exact: true }).click();
    await atButton(menu, trigger, true);
    await trigger.click();
    await atButton(menu, trigger);
    await expect(menu.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test('capture actual intermediate frames for the calendar and map menu', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const [name, label, selector] of [
    ['date', '选择训练日期', '.date-popover'],
    ['map', '切换底图', '.basemap-options']
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const panel = page.locator(selector).first();
    await expect.poll(() => panel.evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
    for (const fraction of [.15, .5, .85]) {
      await panel.evaluate((el, progress) => el.getAnimations().forEach(animation => {
        animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) * progress;
      }), fraction);
      await page.screenshot({ path: testInfo.outputPath(`popover-${name}-enter-${fraction}.png`), animations: 'allow' });
    }
    await panel.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
    await page.keyboard.press('Escape');
    await expect.poll(() => panel.evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
    await panel.evaluate(el => el.getAnimations().forEach(animation => {
      animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) * .5;
    }));
    await expect(panel).toHaveCSS('pointer-events', 'none');
    await page.screenshot({ path: testInfo.outputPath(`popover-${name}-exit.png`), animations: 'allow' });
    await panel.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
    await expect(panel).toBeHidden();
  }
});
