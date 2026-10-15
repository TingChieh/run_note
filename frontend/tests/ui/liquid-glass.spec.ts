import { expect, test } from '@playwright/test';
import { installActivities, loginRunner } from '../fixtures/activities';

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
