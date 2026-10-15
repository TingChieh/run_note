import { expect, test } from '@playwright/test';
import { installActivities, loginRunner } from '../fixtures/activities';

test('file format select ignores empty space to the right of its label', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities');
  const select = page.getByLabel('文件格式', { exact: true });
  await expect(select).toHaveClass(/rn-liquid-select/);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const formBox = (await page.locator('.import-card form').boundingBox())!;
    const selectBox = (await select.boundingBox())!;
    const blank = { x: formBox.x + formBox.width - 8, y: selectBox.y + selectBox.height / 2 };
    expect(blank.x).toBeGreaterThan(selectBox.x + selectBox.width + 8);
    await page.mouse.click(blank.x, blank.y);
    await expect(select).toHaveAttribute('aria-expanded', 'false');
    // The visible text still activates its associated select.
    await page.locator('.import-format').click({ position: { x: 4, y: selectBox.height / 2 } });
    await expect(select).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.click(blank.x, blank.y);
    await expect(select).toHaveAttribute('aria-expanded', 'false');
  }
});

test('selected menu capsule stays translucent and follows the glass transparency setting', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.getByLabel('文件格式', {exact:true})).toHaveClass(/rn-liquid-select/);
    await page.getByLabel('文件格式', { exact: true }).click({ position: { x: 12, y: 20 } });
    const menu = page.getByRole('listbox', { name: '文件格式选项' });
    await expect(menu).toBeVisible();
    const selectionAlpha = () => menu.locator('.rn-moving-copy').evaluate(el => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = getComputedStyle(el).backgroundColor; ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    });
    const alpha = await selectionAlpha();
    expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThan(180);
    await expect(menu).toHaveCSS('opacity', '1');
    await expect(menu).toHaveCSS('scale', '1');
    await page.screenshot({ path: `test-results/translucent-selected-${colorScheme}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name:'玻璃调节',exact:true}).click();
    const panel = page.getByRole('region', {name:'Liquid Glass 调节'});
    await panel.getByRole('slider', {name:'透明度',exact:true}).fill('45');
    await page.keyboard.press('Escape');
    await page.getByLabel('文件格式', {exact:true}).click({position:{x:12,y:20}});
    await expect(menu).toBeVisible();
    expect(await selectionAlpha()).toBeGreaterThan(alpha);
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name:'玻璃调节',exact:true}).click();
    await panel.getByRole('button', {name:'恢复默认',exact:true}).click();
    await page.keyboard.press('Escape');
  }
});

test('themed arrow buttons toggle the native select and animate with its expanded state', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities');
  const select = page.getByLabel('文件格式', { exact: true });
  await expect(select).toHaveClass(/rn-liquid-select/);
  const toggle = select.locator('..').locator('.rn-select-toggle');
  await expect(toggle).toBeVisible();
  const selectBox = (await select.boundingBox())!, toggleBox = (await toggle.boundingBox())!;
  expect(toggleBox.x).toBeGreaterThan(selectBox.x + selectBox.width / 2);
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(selectBox.x + selectBox.width);
  const arrow = toggle.locator('svg');
  const rest = await arrow.evaluate(el => getComputedStyle(el).transform);
  await toggle.click();
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => arrow.evaluate(el => getComputedStyle(el).transform)).not.toBe(rest);
  await toggle.click(); await expect(select).toHaveAttribute('aria-expanded', 'false');
  await expect(select).toBeFocused();
  await toggle.click();
  await page.getByRole('listbox', { name: '文件格式选项' }).getByRole('option', { name: 'TCX', exact: true }).click();
  await expect(select).toHaveValue('tcx');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: 'test-results/themed-select-arrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.hover(); await page.mouse.down();
  expect(await toggle.evaluate(el => getComputedStyle(el).scale)).toBe('1');
  expect(await arrow.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.mouse.up();
});

test('pressing a glass preview button deforms its sampled backdrop and restores it on release', async ({ page }) => {
  await page.goto('/login'); await page.getByRole('button', { name: '玻璃调节', exact: true }).click();
  const button = page.getByRole('button', { name: '普通按钮', exact: true });
  const copy = button.locator('.rn-glass-copy');
  const scale = () => copy.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
  await expect(copy).toBeAttached(); const rest = await scale();
  await button.hover(); await page.mouse.down();
  await expect.poll(scale).toBeGreaterThan(rest + .03);
  await page.getByRole('region', { name: 'Liquid Glass 调节' }).locator('.preview-stage').screenshot({ path: 'test-results/glass-backdrop-pressed.png' });
  await page.mouse.up(); await expect.poll(scale).toBeCloseTo(rest, 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button.hover(); await page.mouse.down(); expect(await scale()).toBeCloseTo(rest, 2); await page.mouse.up();
});

test('select menus animate both ways and a second trigger click dismisses without reopening', async ({ page }) => {
  await loginRunner(page);
  const select = page.locator('.app-sidebar select').first();
  await expect(select).toHaveClass(/rn-liquid-select/);
  await select.click();
  const menu = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(el => getComputedStyle(el).transitionProperty)).toContain('opacity');
  await expect.poll(() => menu.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await select.click();
  await expect(select).toHaveAttribute('aria-expanded', 'false');
  expect(await menu.evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
  await expect(menu).toBeHidden();
  await select.click(); await expect(menu).toBeVisible();
  await select.press('Escape'); await expect(menu).toBeHidden();
  await expect(select).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select.click();
  expect(await menu.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
});

test('liquid navigation follows hover then returns to the current vertical route', async ({ page }) => {
  await loginRunner(page);
  const nav = page.getByRole('navigation', { name: '主要导航' });
  const indicator = nav.locator('.rn-moving-outline');
  const current = nav.getByRole('link', { name: '设置', exact: true });
  const footprint = nav.getByRole('link', { name: '个人足迹', exact: true });
  await expect(indicator).toBeVisible();
  const position = () => indicator.evaluate(el => el.getBoundingClientRect().y);
  await expect.poll(position).toBeCloseTo((await current.boundingBox())!.y, 0);
  await footprint.hover();
  await expect.poll(position).toBeCloseTo((await footprint.boundingBox())!.y, 0);
  await expect(current).toHaveAttribute('aria-current', 'page');
  await page.getByRole('heading', { level: 1 }).hover();
  await expect.poll(position).toBeCloseTo((await current.boundingBox())!.y, 0);
  const dimensions = await indicator.evaluate(el => ({ radius: parseFloat(getComputedStyle(el).borderRadius), height: el.getBoundingClientRect().height }));
  expect(dimensions.radius).toBeCloseTo(dimensions.height / 2, 0);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(indicator).toHaveCount(0);
  await expect(current).toHaveAttribute('aria-current', 'page');
});

test('liquid select preserves native values, keyboard selection and Escape focus', async ({ page }) => {
  await loginRunner(page); await page.goto('/dashboard');
  const select = page.getByLabel('日历维度', { exact: true });
  await expect(select).toHaveClass(/rn-liquid-select/);
  await select.click();
  const menu = page.getByRole('listbox', { name: '日历维度选项' });
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: '次数', exact: true }).click();
  await expect(select).toHaveValue('count'); await expect(menu).toBeHidden();
  await expect(select).toBeFocused();
  await select.press('ArrowDown'); await expect(menu).toBeVisible();
  await select.press('ArrowUp'); await select.press('Escape');
  await expect(select).toHaveValue('count'); await expect(select).toBeFocused();
  await select.press('ArrowDown');
  await expect(select).toHaveAttribute('aria-activedescendant', /-1$/);
  await select.press('ArrowUp');
  await expect(select).toHaveAttribute('aria-activedescendant', /-0$/);
  await select.press('Enter');
  await expect(select).toHaveValue('distance');
  await select.selectOption('count');
  await expect(select).toHaveValue('count');
  await page.setViewportSize({ width: 320, height: 844 });
  await select.click(); await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
});

test('liquid slider squishes its thumb while retaining native range geometry and advanced optics', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '玻璃调节', exact: true }).click();
  const slider = page.getByRole('slider', { name: '透明度', exact: true });
  const thumb = slider.locator('..').locator('.rn-slider-thumb');
  await expect(thumb).toBeVisible();
  const box = (await slider.boundingBox())!;
  const width = await thumb.evaluate(el => el.getBoundingClientRect().width);
  await slider.hover(); await page.mouse.down();
  await expect.poll(() => thumb.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(width + 6);
  expect(await slider.boundingBox()).toEqual(box);
  await page.mouse.up();
  await expect.poll(() => thumb.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(width, 0);
  for (const [label, value] of [['弯折带宽', '0.5'], ['边缘曲率', '4'], ['折射率', '1.8'], ['色散', '0.2'], ['高光宽度', '3'], ['光照角度', '-90']]) {
    await page.getByRole('slider', { name: label, exact: true }).fill(value);
  }
  await page.reload(); await page.getByRole('button', { name: '玻璃调节', exact: true }).click();
  await expect(page.getByRole('slider', { name: '折射率', exact: true })).toHaveValue('1.8');
  await expect(page.getByRole('slider', { name: '光照角度', exact: true })).toHaveValue('-90');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.getByRole('slider', { name: '折射率', exact: true })).toHaveValue('1.5');
});

test('non-Blink fallback remains frosted with zero optical blur', async ({ page }) => {
  // Exercise the engine's fallback branch in Chrome; this is not a real Firefox rendering test.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 Firefox/150.0', configurable: true });
  });
  await page.goto('/login');
  const layer = page.getByRole('button', { name: '登录', exact: true }).locator('.rn-glass-layer');
  await expect(layer).toHaveCSS('backdrop-filter', 'blur(16px) saturate(1.6)');
  await expect(page.locator('body > svg defs filter')).toHaveCount(0);
  await page.getByRole('button', { name: '玻璃调节', exact: true }).click();
  await page.getByRole('slider', { name: '模糊程度', exact: true }).fill('8');
  await expect(layer).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.6)');
});

test('official button surface squishes independently of its native hit area', async ({ page }) => {
  await page.goto('/login');
  const submit = page.getByRole('button', { name: '登录', exact: true });
  const surface = submit.locator(':scope > .rn-glass-surface');
  await expect(surface).toHaveAttribute('aria-hidden', 'true');
  const shadow = surface.locator('.rn-glass-shadow');
  const box = (await submit.boundingBox())!;
  const rest = await shadow.evaluate(el => el.getBoundingClientRect().width);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => shadow.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(rest + 7);
  expect(await submit.boundingBox()).toEqual(box);
  expect(await submit.evaluate(el => getComputedStyle(el).filter)).toBe('none');
  await page.mouse.up();
  await expect.poll(() => shadow.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(rest, 0);
  await submit.focus(); await page.keyboard.down('Space');
  await expect.poll(() => shadow.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(rest + 7);
  await page.keyboard.up('Space');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => shadow.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(rest, 0);
  await page.mouse.down();
  expect(await shadow.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(rest, 0);
  await page.mouse.up();
});

test('native buttons refract their backdrop and retain keyboard form behaviour', async ({ page }) => {
  await page.goto('/login');
  const submit = page.getByRole('button', { name: '登录', exact: true });
  await expect.poll(() => submit.locator('.rn-glass-layer').evaluate(el => getComputedStyle(el).backdropFilter)).toMatch(/url\("?#lg/);
  await expect(page.locator('body > svg defs feDisplacementMap').first()).toBeAttached();
  expect(await submit.evaluate(el => getComputedStyle(el).filter)).toBe('none');
  await submit.focus(); await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.getByLabel('邮箱', { exact: true }).evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect.poll(() => submit.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none');
  await expect(page.locator('body > svg defs filter')).toHaveCount(0);
  await page.emulateMedia({ forcedColors: 'none' });
  await expect.poll(() => submit.locator('.rn-glass-layer').evaluate(el => getComputedStyle(el).backdropFilter)).toMatch(/url\("?#lg/);
});

test('dynamic edit buttons get glass and removed dialogs release their lenses', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '编辑 河畔晨跑', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole('button', { name: '取消编辑', exact: true });
  await expect.poll(() => cancel.locator('.rn-glass-layer').evaluate(el => getComputedStyle(el).backdropFilter)).toMatch(/url\("?#lg/);
  const filterId = await cancel.locator('.rn-glass-layer').evaluate(el => el.style.backdropFilter.match(/#(lg\d+)-v/)?.[1]);
  expect(filterId).toBeTruthy();
  await cancel.click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator(`filter[id^="${filterId}-v"]`)).toHaveCount(0);
  await page.goto('/dashboard?year=2026');
  await expect(page.locator('button[data-date]').first()).toBeAttached();
  expect(await page.locator('button[data-date]').first().evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none');
  const zoom = page.locator('.maplibregl-ctrl-zoom-in');
  await expect(zoom).toBeVisible();
  await page.keyboard.press('Tab'); await zoom.focus();
  expect(await zoom.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  expect(await zoom.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
});

test('development tuner previews live optics, remembers choices and restores defaults', async ({ page }) => {
  await page.goto('/login');
  const trigger = page.getByRole('button', { name: '玻璃调节', exact: true });
  await trigger.click();
  const panel = page.getByRole('region', { name: 'Liquid Glass 调节' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.preview-stage')).toHaveCSS('background-image', /glass-debug-background.*\.webp/);
  await expect(panel.locator('.rn-glass-copy')).toHaveCount(3);
  const submit = page.getByRole('button', { name: '登录', exact: true });
  const appearance = () => submit.evaluate(el => ({
    opacity: getComputedStyle(el.closest('.sport-theme')!).getPropertyValue('--glass-opacity'),
    fill: getComputedStyle(el.querySelector('.rn-glass-tint')!).backgroundColor,
    filter: getComputedStyle(el.querySelector('.rn-glass-layer')!).backdropFilter
  }));
  await expect.poll(async () => (await appearance()).filter).toMatch(/url/);
  const before = await appearance();
  const bend = () => submit.evaluate(el => {
    const id = getComputedStyle(el.querySelector('.rn-glass-layer')!).backdropFilter.match(/#([^"\)]+)/)?.[1];
    return id ? Number(document.getElementById(id)?.querySelector('feDisplacementMap')?.getAttribute('scale')) : null;
  });
  const originalBend = await bend();
  await panel.getByRole('slider', { name: '透明度', exact: true }).fill('90');
  await expect.poll(async () => Number((await appearance()).opacity)).toBeCloseTo(.1);
  expect((await appearance()).fill).not.toBe(before.fill);
  const refraction = panel.getByRole('slider', { name: '折射强度', exact: true });
  await refraction.fill('28');
  await refraction.focus(); await page.keyboard.press('ArrowLeft');
  await expect(refraction).toHaveValue('27');
  await expect.poll(bend).not.toBe(originalBend);
  expect((await appearance()).filter.match(/#(lg\d+)/)?.[1]).toBe(before.filter.match(/#(lg\d+)/)?.[1]);
  await page.reload(); await trigger.click();
  await expect(panel.getByRole('slider', { name: '透明度', exact: true })).toHaveValue('90');
  await expect(refraction).toHaveValue('27');
  await panel.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(panel.getByRole('slider', { name: '透明度', exact: true })).toHaveValue('86');
  await expect(refraction).toHaveValue('14');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible(); await expect(trigger).toBeFocused();
});

test('development preview handles corrupt or blocked storage and respects reduced transparency', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('runnote:dev-liquid-glass:v1', '{broken');
    Storage.prototype.setItem = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
  });
  await page.goto('/login');
  await page.getByRole('button', { name: '玻璃调节', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Liquid Glass 调节' });
  await expect(panel.getByRole('slider', { name: '透明度', exact: true })).toHaveValue('86');
  await panel.getByRole('slider', { name: '透明度', exact: true }).fill('95');
  await expect.poll(() => page.locator('.sport-theme').evaluate(el => Number(getComputedStyle(el).getPropertyValue('--glass-opacity')))).toBeCloseTo(.05);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const submit = page.getByRole('button', { name: '登录', exact: true });
  await expect.poll(() => submit.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none');
  await panel.getByRole('slider', { name: '折射强度', exact: true }).fill('32');
  await expect(page.locator('body > svg defs filter')).toHaveCount(0);
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await expect.poll(() => submit.locator('.rn-glass-layer').evaluate(el => getComputedStyle(el).backdropFilter)).toMatch(/url/);
});
