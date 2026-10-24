import { expect, type Locator, type Page } from '@playwright/test';

export const fitViewports = [
  { width: 1280, height: 720 }, { width: 1440, height: 800 }, { width: 1024, height: 700 }, { width: 390, height: 800 }, { width: 844, height: 390 },
] as const;

type Box = { x: number; y: number; width: number; height: number };
const inside = (inner: Box, outer: Box, slack = 1) => inner.x >= outer.x - slack && inner.y >= outer.y - slack
  && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;

/** Scroll every scrollable region inside the dialog to its end (wide: the columns; narrow: the body). */
const scrollAllToEnd = (dialog: Locator) => dialog.evaluate((root) => {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
  }
});

/** Stacked layout applies on narrow or short viewports (mirrors the dialogs' media query). */
const stackedAt = (view: { width: number; height: number }) => view.width <= 719 || view.height <= 500;

/** The poster dialog must fit the viewport and keep every control and the preview reachable. */
export async function expectPosterDialogFits(page: Page, dialog: Locator, lastStyle: Locator) {
  const view = page.viewportSize()!;
  const stacked = stackedAt(view);
  const viewport: Box = { x: 0, y: 0, width: view.width, height: view.height };
  const close = dialog.getByRole('button', { name: '关闭', exact: true });
  const preview = dialog.locator('.poster-preview img').first();
  const save = dialog.locator('.poster-save').getByRole('button').first();
  await expect(preview).toBeVisible();
  // Let the entrance transition finish so measurements and screenshots see the settled dialog.
  await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity + getComputedStyle(el).transform)).toBe('1none');
  await page.waitForTimeout(100);
  const frame = (await dialog.boundingBox())!;
  expect(inside(frame, viewport), `dialog ${JSON.stringify(frame)} inside ${view.width}x${view.height}`).toBe(true);
  expect(inside((await close.boundingBox())!, frame)).toBe(true);
  // Phones: the dialog content is indented by --space-4 (16px) plus the 1px border, not the desktop 24px.
  if (view.width <= 719) {
    const indent = await dialog.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(indent, 'phone dialog padding is 16px').toBe(16);
  }
  const options = (await dialog.locator('.poster-options').boundingBox())!;
  const previewBox = (await dialog.locator('.poster-preview').boundingBox())!;
  if (!stacked) {
    // Side by side: the preview shrinks to the available height instead of being cut by its column.
    expect(inside((await preview.boundingBox())!, previewBox), 'preview fully inside its own column without scrolling').toBe(true);
    expect(inside((await preview.boundingBox())!, viewport)).toBe(true);
  }
  // The primary actions are visible straight away, without scrolling the options column.
  const saveBox = (await save.boundingBox())!;
  expect(inside(saveBox, stacked ? frame : options), 'save button visible without scrolling').toBe(true);
  expect(inside(saveBox, viewport)).toBe(true);
  await scrollAllToEnd(dialog);
  // The header (title, 关闭) stays reachable while the content scrolls.
  expect(inside((await close.boundingBox())!, viewport), '关闭 stays visible after scrolling').toBe(true);
  await lastStyle.scrollIntoViewIfNeeded();
  const cardBox = (await lastStyle.boundingBox())!;
  expect(inside(cardBox, viewport), 'last style card reachable').toBe(true);
  expect(inside(cardBox, frame)).toBe(true);
  // ...and is never hidden behind the sticky action bar.
  const bar = (await dialog.locator('.poster-save').boundingBox())!;
  expect(cardBox.y + cardBox.height <= bar.y + 1 || cardBox.y >= bar.y + bar.height - 1, 'style card not under the sticky bar').toBe(true);
  // Keyboard focus on the card's radio scrolls the whole card into view.
  await lastStyle.locator('input').focus();
  const focused = (await lastStyle.boundingBox())!;
  expect(inside(focused, viewport) && focused.y + focused.height <= bar.y + 1, 'focused card fully visible above the bar').toBe(true);
  if (view.height <= 500) await preview.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  else await preview.scrollIntoViewIfNeeded();
  const shown = (await preview.boundingBox())!;
  // A short landscape phone cannot show a whole 9:16 image; there its top edge must be reachable instead.
  const reachable = view.height <= 500 ? inside({ ...shown, height: 1 }, frame) : inside(shown, viewport) && inside(shown, frame);
  expect(reachable, 'preview reachable by scrolling').toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.evaluate((root) => { for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) el.scrollTop = 0; });
  expect(inside((await save.boundingBox())!, stacked ? frame : options), 'save button visible at the top of the scroll').toBe(true);
}
