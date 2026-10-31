import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

// One thin scrollbar for the whole site, in both themes: the standard properties on every element (and the page itself), a semantic token for the thumb.
// The few containers that hide their own scrollbar (the range switches, the time picker's wheels) keep doing so.
const style = (locator: Locator) => locator.evaluate(el => { const cs = getComputedStyle(el); return { width: cs.scrollbarWidth, color: cs.scrollbarColor }; });
/** The token's colour as the browser serialises it, by painting a throwaway element with it (fully transparent when the token does not exist, so a missing token fails). */
const token = (page: Page, name: string) => page.evaluate(variable => {
  const probe = document.createElement('i');
  probe.style.color = `var(${variable}, transparent)`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}, name);
const alpha = (value: string) => { const m = value.match(/\/\s*([\d.]+)\s*\)|,\s*([\d.]+)\)$/); return m ? Number(m[1] ?? m[2]) : 1; };
const theme = (page: Page, value: 'light' | 'dark') => page.evaluate(next => { document.documentElement.dataset.theme = next; }, value);

async function recordsTable(page: Page) {
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  const fold = page.locator('details.data-table').first();
  await fold.locator('summary').click();
  const scroller = fold.locator('.table-scroll');
  await expect(scroller).toBeVisible();
  // A real scroller: its table is taller than the 20rem it is allowed.
  expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  return scroller;
}

for (const mode of ['light', 'dark'] as const) {
  test(`every scrollbar is the same thin one with a themed thumb (${mode})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const scroller = await recordsTable(page);
    await theme(page, mode);
    const thumb = await token(page, '--scrollbar-thumb'), hover = await token(page, '--scrollbar-thumb-hover');
    // Both tokens are real colours, and the hover one is the stronger.
    expect(alpha(thumb)).toBeGreaterThan(0.15);
    expect(alpha(hover)).toBeGreaterThan(alpha(thumb));
    // The page itself and a container that really scrolls: thin, and the colour is the token's (and a transparent track), not "auto".
    for (const target of [page.locator('html'), scroller]) {
      const { width, color } = await style(target);
      expect(width).toBe('thin');
      expect(color).not.toBe('auto');
      expect(color.startsWith(thumb)).toBe(true);
    }
  });
}

test('the thumb differs between the themes and stays visible on each background', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await theme(page, 'light');
  const light = await token(page, '--scrollbar-thumb');
  await theme(page, 'dark');
  const dark = await token(page, '--scrollbar-thumb');
  for (const value of [light, dark]) expect(alpha(value)).toBeGreaterThan(0.15);
  expect(light).not.toBe(dark);
});

test('the range switches and the time picker wheels keep their own hidden scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 361, height: 800 });
  await loginRunner(page);
  await page.goto('/wellbeing');
  await expect(page.getByTestId('wellbeing-editor')).toBeVisible();
  await expect(page.locator('.wellbeing-tabs')).toBeVisible();
  expect((await style(page.locator('.wellbeing-tabs'))).width).toBe('none');
  await page.getByTestId('wellbeing-add-dose').click();
  await expect(page.getByTestId('wellbeing-dose-form')).toBeVisible();
  for (const id of ['time-hours', 'time-minutes']) expect((await style(page.getByTestId(id))).width).toBe('none');
});

// A box that scrolls only where it must: nothing is allowed to give it a scrollbar it has no use for.
test('the users table scrolls sideways only when it is too narrow; at desktop width it has no scrollbar at all', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginRunner(page);
  await page.goto('/admin/users');
  const scroller = page.locator('.table-scroll');
  await expect(scroller.getByRole('row').nth(1)).toBeVisible();
  // The glass of the row buttons paints a few pixels past them; that must not become a vertical scrollbar.
  expect(await scroller.evaluate(el => ({ x: el.scrollWidth <= el.clientWidth, y: el.scrollHeight <= el.clientHeight }))).toEqual({ x: true, y: true });
  await page.setViewportSize({ width: 361, height: 800 });
  await expect.poll(() => scroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true); // too narrow: it scrolls sideways, as it must
});

test('the yearly records table fits its card at desktop width instead of showing a sideways scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  const fold = page.locator('details.data-table', { hasText: '查看逐年数据' });
  await fold.locator('summary').click();
  const scroller = fold.locator('.table-scroll');
  await expect(scroller.getByRole('row').nth(1)).toBeVisible();
  expect(await scroller.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
