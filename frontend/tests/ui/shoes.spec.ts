import { expect, test, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

const activity = '34567890-1234-4567-8899-012345678901';
const sampleShoe = '45d68910-3d3d-4c10-8e13-ea016883ff41';

async function signIn(page: Page, path: string) {
  await page.goto('/admin?next=' + encodeURIComponent(path));
  await page.getByLabel('邮箱', { exact: true }).fill('runner@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === path);
  await expect(page.locator('header').first()).toHaveAttribute('data-auth-ready', 'true');
}

test('restricts the entry to private activities and handles a session expiring on read', async ({ page }) => {
  await page.goto('/activities');
  await expect(page.getByRole('link', { name: '跑鞋', exact: true })).toHaveCount(0);
  await page.goto('/activities/shoes');
  await expect(page).toHaveURL(/\/admin\?next=/);
  await signIn(page, '/activities');
  await expect(page.getByRole('link', { name: '跑鞋', exact: true })).toBeVisible();
  await page.goto('/p/runner/activities');
  await expect(page.getByRole('link', { name: '跑鞋', exact: true })).toHaveCount(0);
  await page.route('**/api/v1/me/shoes?*', (route) =>
    route.fulfill({ status: 401, json: { data: null, error: { code: 'AUTH_REQUIRED' } } }),
  );
  await page.goto('/activities/shoes');
  await expect(page).toHaveURL(/\/admin\?reason=expired/);
  await expect(page.getByText('长距离训练鞋')).toHaveCount(0);
});

test('a delayed list response cannot replace the selected shoe group', async ({ page }) => {
  await signIn(page, '/activities/shoes');
  const list = page.getByRole('region', { name: '跑鞋列表' });
  const active = list.getByRole('button', { name: '使用中', exact: true });
  const retired = list.getByRole('button', { name: '已退役', exact: true });
  const activeCards = list.locator('.shoe-card:not([href*="status=retired"])');
  const retiredCards = list.locator('.shoe-card[href*="status=retired"]');
  await expect(activeCards).toHaveCount(2);

  for (const { target, visited, group, expected, unexpected, expectedCount, wrongCard } of [
    {
      target: active,
      visited: retired,
      group: 'retired',
      expected: activeCards,
      unexpected: retiredCards,
      expectedCount: 2,
      wrongCard: '.shoe-card[href*="status=retired"]',
    },
    {
      target: retired,
      visited: active,
      group: 'active',
      expected: retiredCards,
      unexpected: activeCards,
      expectedCount: 1,
      wrongCard: '.shoe-card:not([href*="status=retired"])',
    },
  ]) {
    await target.click();
    await expect(expected).toHaveCount(expectedCount);
    const matches = (url: URL) => url.pathname === '/api/v1/me/shoes' && url.searchParams.get('status') === group;
    const held = Promise.withResolvers<void>();
    await page.route(
      matches,
      async (route) => {
        await held.promise;
        await route.fallback();
      },
      { times: 1 },
    );
    const started = page.waitForRequest((request) => matches(new URL(request.url())));
    await visited.click();
    await started;
    await expect(visited).toHaveAttribute('aria-pressed', 'true');
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect(expected).toHaveCount(expectedCount);

    const monitor = await list.evaluateHandle((element, selector) => {
      let flashed = false;
      const observer = new MutationObserver(() => {
        flashed ||= !!element.querySelector(selector);
      });
      observer.observe(element, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        return flashed;
      };
    }, wrongCard);
    const response = page.waitForResponse((result) => matches(new URL(result.url())));
    held.resolve();
    await (await response).finished();
    await expect(list).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect(unexpected).toHaveCount(0);
    await expect(expected).toHaveCount(expectedCount);
    expect(await monitor.evaluate((stop) => stop())).toBe(false);
  }
});

test('creates a shoe at 320px, restores dialog focus, and retires and recovers a referenced shoe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, '/activities/shoes');
  const add = page.getByRole('button', { name: '添加跑鞋' });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '添加跑鞋' });
  await expect(dialog.getByLabel('鞋名')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await add.click();
  const title = 'LONG'.repeat(20);
  await dialog.getByLabel('鞋名').fill(title);
  await dialog.getByLabel('初始里程（km）').fill('999999.999999');
  await dialog.getByRole('button', { name: '保存跑鞋', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '里程' })).toContainText('1,000,000.0 km');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('link', { name: /跑鞋列表/ }).click();
  await page.getByRole('link', { name: /长距离训练鞋/ }).click();
  await expect(page.getByRole('heading', { name: '长距离训练鞋' })).toBeFocused();
  await page.getByRole('link', { name: /跑鞋列表/ }).click();
  await expect(page.getByRole('link', { name: /长距离训练鞋/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '长距离训练鞋' })).toBeFocused();
  await page.getByRole('button', { name: '删除跑鞋', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: '删除跑鞋？' });
  await deleteDialog.getByRole('button', { name: '确认删除' }).click();
  await expect(deleteDialog.getByRole('alert')).toContainText('关联活动');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '删除跑鞋', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '退役跑鞋', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '跑鞋已退役' })).toBeVisible();
  await expect(page.getByRole('region', { name: '里程' })).not.toContainText('替换里程');
  await page.getByRole('button', { name: '恢复使用', exact: true }).click();
  await expect(page.getByRole('region', { name: '里程' })).toContainText('接近替换里程');
});

test('the activity exposes the retired current binding and supports unbinding', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/activities/shoes');
  await page.getByRole('link', { name: /长距离训练鞋/ }).click();
  await page.getByRole('button', { name: '退役跑鞋', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复使用' })).toBeVisible();
  await page.goto('/activities/' + activity);
  const binding = page.getByRole('region', { name: '活动的跑鞋' });
  const picker = binding.getByRole('combobox');
  await expect(picker).toHaveValue(sampleShoe);
  await expect(binding).toContainText('长距离训练鞋（已退役）');
  await picker.selectOption('');
  await binding.getByRole('button', { name: '保存跑鞋' }).click();
  await expect(binding.getByRole('status')).toHaveText('已解绑跑鞋');
  await expect(picker.getByRole('option', { name: /长距离训练鞋/ })).toHaveCount(0);
  await page.goto('/p/runner/activities/' + activity);
  await expect(binding).toHaveCount(0);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  for (const theme of ['light', 'dark']) {
    test('renders ' + viewport.width + 'px ' + theme + ' without overflow', async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('runnote-theme', value), theme);
      await signIn(page, '/activities/shoes');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('link', { name: /长距离训练鞋/ })).toBeVisible();
      const prefix = 'shoes-' + viewport.width + '-' + theme;
      const directory = process.env.RUNNOTE_SHOE_SCREENSHOTS;
      const screenshot = (name: string) =>
        page.screenshot({
          path: directory ? join(directory, name + '.png') : info.outputPath(name + '.png'),
          animations: 'disabled',
        });
      if (viewport.width >= 1024) {
        await expect(page.getByRole('region', { name: '里程' })).toContainText('762.4 km');
      } else {
        await expect(page.getByRole('region', { name: '跑鞋详情' })).toBeHidden();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await screenshot(prefix);
      if (viewport.width < 1024) {
        await page.getByRole('link', { name: /长距离训练鞋/ }).click();
        await expect(page.getByRole('region', { name: '里程' })).toContainText('762.4 km');
        await expect(page.getByRole('link', { name: /周末长距离/ })).toBeVisible();
        await screenshot(prefix + '-detail');
      }
      if (viewport.width === 390) {
        await page.goto('/activities/' + activity);
        await expect(page.getByRole('combobox')).toHaveValue(sampleShoe);
        await page.getByRole('region', { name: '活动的跑鞋' }).scrollIntoViewIfNeeded();
        await screenshot(prefix + '-binding');
      }
    });
  }
}

const rectsOverlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// The save bar is the dialog footer: it must not intersect any field, whatever the scroll position.
async function expectBarClear(dialog: Locator) {
  const bar = (await dialog.getByRole('region', { name: '保存设置' }).boundingBox())!;
  const body = (await dialog.locator('.form-dialog-body').boundingBox())!;
  for (const name of ['鞋名', '备注', '初始里程（km）', '替换阈值（km）']) {
    const raw = await dialog.getByLabel(name).boundingBox();
    // Only the part inside the scrolling body is visible; anything scrolled out of it cannot be covered.
    const top = Math.max(raw!.y, body.y);
    const bottom = Math.min(raw!.y + raw!.height, body.y + body.height);
    if (bottom > top) expect(rectsOverlap({ ...raw!, y: top, height: bottom - top }, bar), name).toBe(false);
  }
}

async function scrollAndCheck(dialog: Locator) {
  const body = dialog.locator('.form-dialog-body');
  await body.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expectBarClear(dialog);
  const notes = (await dialog.getByLabel('备注').boundingBox())!;
  const bar = (await dialog.getByRole('region', { name: '保存设置' }).boundingBox())!;
  expect(notes.y + notes.height).toBeLessThanOrEqual(bar.y + 1);
  await dialog.getByLabel('备注').focus();
  await expectBarClear(dialog);
  await body.evaluate((node) => node.scrollTo(0, 0));
}

test('shoe dialog motion is off under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, '/activities/shoes');
  await page.getByRole('button', { name: '添加跑鞋' }).click();
  const dialog = page.getByRole('dialog', { name: '添加跑鞋' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s');
  expect(await dialog.evaluate((node) => getComputedStyle(node, '::backdrop').transitionDuration)).toBe('0s');
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  for (const theme of ['light', 'dark']) {
    test('shoe dialogs are centred cards at ' + viewport.width + 'px ' + theme, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('runnote-theme', value), theme);
      await signIn(page, '/activities/shoes');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const directory = process.env.RUNNOTE_SHOE_SCREENSHOTS;
      const shot = (name: string) =>
        page.screenshot({
          path: directory
            ? join(directory, 'dialog-' + viewport.width + '-' + theme + '-' + name + '.png')
            : info.outputPath(name + '.png'),
          animations: 'disabled',
        });
      const check = async (name: string) => {
        const dialog = page.getByRole('dialog', { name });
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(400);
        const box = (await dialog.boundingBox())!;
        const style = await dialog.evaluate((node) => {
          const css = getComputedStyle(node);
          return {
            background: css.backgroundColor,
            padding: parseFloat(css.paddingLeft),
            border: parseFloat(css.borderTopWidth),
            borderColor: css.borderTopColor,
            radius: parseFloat(css.borderTopLeftRadius),
            color: css.color,
            backdrop: getComputedStyle(node, '::backdrop').backgroundColor,
          };
        });
        expect(style.border).toBeGreaterThan(0);
        expect(style.borderColor).not.toBe(style.background);
        expect(style.radius).toBeGreaterThan(0);
        expect(style.color).not.toBe(style.background);
        expect(style.backdrop).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        expect(style.background).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        expect(style.padding).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThan(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        return dialog;
      };

      await page.getByRole('button', { name: '添加跑鞋' }).click();
      let dialog = await check('添加跑鞋');
      await shot('add');
      await dialog.getByLabel('鞋名').fill('晨跑训练鞋');
      await expect(dialog.getByRole('button', { name: '保存跑鞋', exact: true })).toBeVisible();
      await page.waitForTimeout(600);
      await shot('add-dirty');
      await expectBarClear(dialog);
      await scrollAndCheck(dialog);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      if (!(await page.getByRole('button', { name: '编辑', exact: true }).isVisible())) {
        await page.getByRole('link', { name: /长距离训练鞋/ }).click();
      }
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      dialog = await check('编辑跑鞋');
      await page.waitForTimeout(600);
      expect(await dialog.locator('.form-dialog-body').evaluate((node) => node.scrollTop)).toBe(0);
      await shot('edit');
      await expectBarClear(dialog);
      await scrollAndCheck(dialog);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      await page.getByRole('button', { name: '删除跑鞋', exact: true }).click();
      await check('删除跑鞋？');
      await shot('delete');
    });
  }
}
