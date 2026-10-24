import { expect, type Locator, type Page } from '@playwright/test';

const SELECTED = '[aria-current="page"], [aria-pressed="true"]';
const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
const luminance = ([r, g, b]: number[]) => {
  const [lr, lg, lb] = [r, g, b].map(v => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * lr + .7152 * lg + .0722 * lb;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))];
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};

/** Resolves a design token to the computed colour the browser would paint with. */
async function token(group: Locator, name: string) {
  return group.evaluate((el, prop) => {
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;color:var(${prop})`;
    el.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}
const paint = (item: Locator) => item.evaluate(el => {
  const style = getComputedStyle(el);
  return { background: style.backgroundColor, image: style.backgroundImage, color: style.color, classes: el.className };
});
const clear = (value: string) => value === 'rgba(0, 0, 0, 0)' || value === 'transparent';

/** Without the glass enhancer the app.css fallback must paint the selected item itself. */
export async function expectUnenhancedFallback(group: Locator) {
  await expect(group).not.toHaveClass(/rn-liquid-navigation/);
  const items = group.locator(':scope > :is(a, button)');
  const primary = await token(group, '--primary'), onPrimary = await token(group, '--primary-foreground');
  const selected = group.locator(`:scope > :is(${SELECTED})`);
  await expect(selected).toHaveCount(1);
  // Colours transition for a moment after the enhancer goes away, so poll for the settled value.
  await expect.poll(async () => (await paint(selected)).background, 'selected item keeps the primary fill').toBe(primary);
  await expect.poll(async () => (await paint(selected)).color, 'selected item uses the primary foreground').toBe(onPrimary);
  const chosen = await paint(selected);
  expect(contrast(chosen.color, chosen.background)).toBeGreaterThanOrEqual(4.5);
  for (const item of await items.all()) {
    if (await item.evaluate((el, sel) => el.matches(sel), SELECTED)) continue;
    const other = await paint(item);
    await expect.poll(async () => clear((await paint(item)).background), 'unselected item has no plate').toBe(true);
    expect(other.image).toBe('none');
  }
}

/** With the enhancer on, tab buttons stay plain: no glass layer classes, plate or gradient behind the lens. */
export async function expectEnhancedLook(group: Locator) {
  await expect(group).toHaveClass(/rn-liquid-navigation/);
  await expect(group.locator('.rn-moving-copy')).toHaveCount(1);
  const lens = await group.locator('.rn-moving-copy').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  const selected = group.locator(`:scope > :is(${SELECTED})`);
  for (const item of await group.locator(':scope > :is(a, button)').all()) {
    const state = await paint(item);
    expect(state.classes).not.toMatch(/rn-glass-control|rn-glass-static/);
    expect(await item.locator('.rn-glass-layer').count()).toBe(0);
    expect(state.image, 'no gradient plate').toBe('none');
    await expect.poll(async () => clear((await paint(item)).background), 'no plate behind the lens').toBe(true);
  }
  // The lens carries the primary colour; the label drawn on it must stay readable.
  expect(contrast(lens.color, lens.background)).toBeGreaterThanOrEqual(4.5);
  await expect(selected).toHaveCount(1);
}

/** Switch off the optical layer the way users do (reduced transparency); returns the CDP cleanup. */
export async function reduceTransparency(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  return cdp;
}
/** Make the glass modules fail to load, as on a broken network or CSP block: the page is never enhanced. */
export async function blockGlassModules(page: Page) {
  await page.route('**/lib/styles/liquid-glass-indicator.ts*', route => route.abort());
}
