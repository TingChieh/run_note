import { expect, type Locator, type Page } from '@playwright/test';

export const fitViewports = [
  { width: 1280, height: 720 }, { width: 1440, height: 800 }, { width: 1024, height: 700 }, { width: 390, height: 800 },
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

/** The poster dialog must fit the viewport and keep every control and the preview reachable. */
export async function expectPosterDialogFits(page: Page, dialog: Locator, lastStyle: Locator) {
  const view = page.viewportSize()!;
  const viewport: Box = { x: 0, y: 0, width: view.width, height: view.height };
  const close = dialog.getByRole('button', { name: '关闭', exact: true });
  const preview = dialog.locator('.poster-preview img').first();
  await expect(preview).toBeVisible();
  // Let the entrance transition finish so measurements and screenshots see the settled dialog.
  await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity + getComputedStyle(el).transform)).toBe('1none');
  await page.waitForTimeout(100);
  const frame = (await dialog.boundingBox())!;
  expect(inside(frame, viewport), `dialog ${JSON.stringify(frame)} inside ${view.width}x${view.height}`).toBe(true);
  expect(inside((await close.boundingBox())!, frame)).toBe(true);
  if (view.width >= 720) {
    // Side by side: the preview shrinks to the available height instead of being cut.
    expect(inside((await preview.boundingBox())!, frame), 'preview fully inside dialog without scrolling').toBe(true);
    expect(inside((await preview.boundingBox())!, viewport)).toBe(true);
  }
  await scrollAllToEnd(dialog);
  // The header (title, 关闭) stays reachable while the content scrolls.
  expect(inside((await close.boundingBox())!, viewport), '关闭 stays visible after scrolling').toBe(true);
  await lastStyle.scrollIntoViewIfNeeded();
  expect(inside((await lastStyle.boundingBox())!, viewport), 'last style card reachable').toBe(true);
  expect(inside((await lastStyle.boundingBox())!, frame)).toBe(true);
  await preview.scrollIntoViewIfNeeded();
  const shown = (await preview.boundingBox())!;
  expect(inside(shown, viewport) && inside(shown, frame), 'preview reachable by scrolling').toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
