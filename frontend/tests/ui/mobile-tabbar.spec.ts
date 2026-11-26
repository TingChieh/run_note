import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner } from '../fixtures/activities';

// Item 49 Phase 4a (方案 B): below the 800px shell breakpoint a bottom tab bar 今天 | 记录 | 开跑 | 探索 | 我的 replaces the menu.
const tabs = (page: Page) => page.getByRole('navigation', { name: '底部导航' });
const tab = (page: Page, name: string) => tabs(page).getByRole('link', { name, exact: true });
async function ready(page: Page) {
  await expect(page.locator('header[data-auth-ready="true"]')).toHaveCount(1);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('signed-in site owner', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page);
    await loginRunner(page);
  });

  test('each tab opens its root page and is the only one marked current', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const routes = [
      ['今天', '/', '数据汇总'],
      ['记录', '/activities', '跑步记录'],
      ['探索', '/footprints', '个人足迹'],
      ['我的', '/settings', '设置'],
    ] as const;
    await expect(tabs(page).getByRole('link')).toHaveText(['今天', '记录', '开跑', '探索', '我的']);
    for (const [name, path, heading] of routes) {
      await tab(page, name).click();
      await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/' : path}$`));
      await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
      await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
      await expect(tabs(page).locator('[aria-current]')).toHaveCount(1);
    }
    // A push page inside a tab marks the tab as the current section, not as the current page.
    await page.goto('/settings/shoes');
    await ready(page);
    await expect(tab(page, '我的')).toHaveAttribute('aria-current', 'true');
    expect(errors).toEqual([]);
  });

  test('开跑 is an action into the immersive recorder, which hides the bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/activities');
    await ready(page);
    const record = tab(page, '开跑');
    await expect(record).toHaveAttribute('href', '/activities/record');
    await expect(record).not.toHaveAttribute('aria-current', /.*/);
    await record.click();
    await expect(page).toHaveURL(/\/activities\/record$/);
    await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0);
    await expect(page.locator('.app-shell')).not.toHaveAttribute('data-tabbar');
    await page.goBack();
    await expect(page).toHaveURL(/\/activities$/);
    await expect(tab(page, '记录')).toHaveAttribute('aria-current', 'page');
  });

  test('tapping the current tab returns to the top of its page instead of reloading', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByTestId('annual-distance')).toBeVisible();
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest()) documents.push(request.url());
    });
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await tab(page, '今天').click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    expect(documents).toEqual([]);
  });

  test('targets are at least 44px, the bar fits and nothing overflows at 320, 390 and 768', async ({ page }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const path of ['/', '/activities', '/footprints', '/routes', '/records', '/settings']) {
        await page.goto(path);
        await ready(page);
        await noOverflow(page);
        const metrics = await page.getByTestId('mobile-tabbar').evaluate((bar) => ({
          bar: bar.getBoundingClientRect().toJSON() as DOMRect,
          scroll: bar.scrollWidth - bar.clientWidth,
          links: [...bar.querySelectorAll('a')].map((link) => {
            const box = link.getBoundingClientRect();
            return { name: link.textContent!.trim(), width: box.width, height: box.height };
          }),
        }));
        expect(metrics.scroll, `${width}px ${path}: no clipped tab`).toBeLessThanOrEqual(0);
        expect(metrics.bar.left).toBeGreaterThanOrEqual(0);
        expect(metrics.bar.right).toBeLessThanOrEqual(width);
        expect(metrics.bar.bottom).toBeLessThanOrEqual(844);
        for (const link of metrics.links) {
          expect(link.width, `${width}px ${path} ${link.name} width`).toBeGreaterThanOrEqual(44);
          expect(link.height, `${width}px ${path} ${link.name} height`).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });

  test('the explore switcher never widens the page, not even on the frames right after a resize', async ({ page }) => {
    // /records is left out: its own records card overflows for a frame after a resize, also before the switcher existed.
    for (const path of ['/footprints', '/routes', '/together']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await ready(page);
      await expect(page.getByTestId('explore-tabs')).toBeVisible();
      await page.evaluate(() => {
        const target = window as typeof window & { overflowFrames: number[] };
        target.overflowFrames = [];
        const start = performance.now();
        const tick = () => {
          const width = document.documentElement.scrollWidth;
          if (width > window.innerWidth) target.overflowFrames.push(width);
          if (performance.now() - start < 1000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.setViewportSize({ width: 320, height: 844 });
      await page.waitForTimeout(1100);
      expect(
        await page.evaluate(() => (window as typeof window & { overflowFrames: number[] }).overflowFrames),
        `${path}: no frame wider than the viewport`,
      ).toEqual([]);
    }
  });

  test('the end of every page clears the bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/', '/activities', '/settings']) {
      await page.goto(path);
      await ready(page);
      // Scroll to the current end on every attempt: the page keeps growing while its sections load.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
              const footer = document.querySelector('.app-footer')!.getBoundingClientRect();
              const bar = document.querySelector('.mobile-tabbar')!.getBoundingClientRect();
              return footer.bottom <= bar.top + 0.5;
            }),
          `${path}: the footer is not hidden behind the tab bar`,
        )
        .toBe(true);
    }
  });

  test('tabbing from the top of the page to the footer links keeps each focused link clear of the bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/settings');
      await ready(page);
      await expect(page.getByRole('heading', { level: 1, name: '设置', exact: true })).toBeVisible();
      // The development-only glass tuner floats above the bar's right edge; production builds have none.
      await page.addStyleTag({ content: '.glass-tuner { display: none !important; }' });
      // The browser scrolls each focused element into view by itself; nothing here scrolls the page.
      for (const name of ['隐私政策', 'GitHub']) {
        let reached = false;
        for (let presses = 0; presses < 200 && !reached; presses++) {
          await page.keyboard.press('Tab');
          reached = await page.evaluate(
            (label) => (document.activeElement as HTMLElement | null)?.closest('.app-footer a')?.textContent === label,
            name,
          );
        }
        expect(reached, `${scheme}: Tab reaches the footer link ${name}`).toBe(true);
        const placement = await page.evaluate(() => {
          const link = document.activeElement as HTMLElement;
          const box = link.getBoundingClientRect();
          const bar = document.querySelector('.mobile-tabbar')!.getBoundingClientRect();
          const ring =
            parseFloat(getComputedStyle(link).outlineOffset) + parseFloat(getComputedStyle(link).outlineWidth);
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { ringBottom: box.bottom + ring, barTop: bar.top, onTop: !!hit && link.contains(hit) };
        });
        expect(placement.ringBottom, `${scheme}: ${name} and its focus ring end above the bar`).toBeLessThanOrEqual(
          placement.barTop,
        );
        expect(placement.onTop, `${scheme}: ${name} is not covered by the bar`).toBe(true);
      }
    }
  });

  test('探索 reaches routes, records and run-together through its section switcher', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab(page, '探索').click();
    const sections = page.getByRole('navigation', { name: '探索分区' });
    await expect(sections.getByRole('link', { name: '个人足迹', exact: true })).toHaveAttribute('aria-current', 'page');
    for (const [name, path] of [
      ['常跑路线', '/routes'],
      ['个人记录', '/records'],
      ['一起跑步', '/together'],
      ['个人足迹', '/footprints'],
    ] as const) {
      await sections.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(
        page.getByRole('navigation', { name: '探索分区' }).getByRole('link', { name, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(tab(page, '探索')).toHaveAttribute('aria-current', path === '/footprints' ? 'page' : 'true');
    }
    // Detail pages keep the 探索 tab but drop the switcher.
    await page.goto('/footprints/exploration');
    await ready(page);
    await expect(page.getByTestId('explore-tabs')).toHaveCount(0);
    await expect(tab(page, '探索')).toHaveAttribute('aria-current', 'true');
  });

  test('我的 keeps settings, shoes, goals, health and sync, admin pages, wellbeing, AI and sign-out reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await ready(page);
    await tab(page, '我的').click();
    await expect(page).toHaveURL(/\/settings$/);
    const sections = page.getByRole('navigation', { name: '设置分区' });
    for (const [name, href] of [
      ['跑鞋', '/settings/shoes'],
      ['目标与隐私', '/settings/preferences'],
      ['站点设置', '/settings/site'],
      ['用户管理', '/admin/users'],
    ] as const)
      await expect(sections.getByRole('link', { name, exact: false })).toHaveAttribute('href', href);
    const more = page.getByTestId('mobile-account-links');
    await expect(more).toBeVisible();
    await expect(more.getByRole('link', { name: '身心健康', exact: true })).toHaveAttribute('href', '/wellbeing');
    await expect(more.getByRole('link', { name: 'AI 助手', exact: true })).toHaveAttribute('href', '/ai');
    await expect(more.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
    for (const link of await more.getByRole('link').all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await more.getByRole('link', { name: '身心健康', exact: true }).click();
    await expect(page).toHaveURL(/\/wellbeing$/);
    await expect(tab(page, '我的')).toHaveAttribute('aria-current', 'true');
    // Only the account overview ends with these extras.
    await page.goto('/settings/preferences');
    await ready(page);
    await expect(page.getByTestId('mobile-account-links')).toHaveCount(0);
    await page.goto('/settings');
    await ready(page);
    await page.getByTestId('mobile-account-links').getByRole('button', { name: '退出登录', exact: true }).click();
    // Settings are private, so signing out there lands on the sign-in page.
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByTestId('current-user')).toContainText('未登录');
  });

  test('the save bar and the dev tools float above the tab bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('昵称', { exact: true }).fill('底栏测试');
    // The save bar only floats while its form continues below the viewport.
    await page.evaluate(() => window.scrollTo(0, 0));
    const saveBar = page.getByRole('region', { name: '保存设置' }).first();
    await expect(saveBar).toBeVisible();
    await page.getByLabel('昵称', { exact: true }).blur();
    // The bar unfolds in; measure once it has settled.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bar = document.querySelector('.mobile-tabbar')!.getBoundingClientRect();
            const save = saveSlot().getBoundingClientRect();
            return bar.top - save.bottom;
            function saveSlot() {
              return document.querySelector('.save-bar-slot')!;
            }
          }),
        { message: 'the save bar sits above the tab bar, not under it' },
      )
      .toBeGreaterThanOrEqual(8);
    const tuner = page.locator('.glass-tuner');
    if (await tuner.count()) {
      const tunerBox = (await tuner.boundingBox())!;
      const barBox = (await page.getByTestId('mobile-tabbar').boundingBox())!;
      expect(tunerBox.y + tunerBox.height).toBeLessThanOrEqual(barBox.y);
    }
  });

  test('a focused text field hides the bar so it cannot ride on the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const field = page.getByLabel('昵称', { exact: true });
    await field.focus();
    await expect(page.getByTestId('mobile-tabbar')).toBeHidden();
    await field.blur();
    await expect(page.getByTestId('mobile-tabbar')).toBeVisible();
  });

  test('safe-area insets pad the bars once, without doubling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34 } });
    await page.goto('/');
    await ready(page);
    const metrics = await page.evaluate(() => ({
      barGap: innerHeight - document.querySelector('.mobile-tabbar')!.getBoundingClientRect().bottom,
      barHeight: document.querySelector('.mobile-tabbar')!.getBoundingClientRect().height,
      contentPadding: parseFloat(getComputedStyle(document.querySelector('.content-column')!).paddingBottom),
      headerPadding: parseFloat(getComputedStyle(document.querySelector('.app-shell > header')!).paddingTop),
    }));
    expect(metrics.barGap, 'bar = 8px gap + 34px inset from the bottom edge').toBeCloseTo(8 + 34, 0);
    expect(metrics.barHeight).toBeCloseTo(64, 0);
    expect(metrics.contentPadding, 'content clears the bar plus the inset once').toBeCloseTo(64 + 8 + 34, 0);
    expect(metrics.headerPadding, 'top bar clears the status bar').toBeCloseTo(14 + 47, 0);
  });

  test('tabbar-hidden recording page keeps primary action and page content above safe-area-inset-bottom', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    const cases = [
      { label: 'pkt110-logical', width: 347, height: 754, top: 39, bottom: 16 },
      { label: 'phone-390', width: 390, height: 844, top: 47, bottom: 34 },
      { label: 'tablet-768', width: 768, height: 1024, top: 24, bottom: 20 },
    ] as const;

    for (const vp of cases) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: vp.top, bottom: vp.bottom } });
      await page.goto('/activities/record');
      await ready(page);
      await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0);
      await expect(page.locator('.app-shell')).not.toHaveAttribute('data-tabbar');
      await expect(page.getByTestId('recording-start-btn')).toBeVisible();
      await noOverflow(page);

      const initial = await page.evaluate(() => {
        const startBtn = document.querySelector('[data-testid="recording-start-btn"]')!.getBoundingClientRect();
        const contentPadding = parseFloat(getComputedStyle(document.querySelector('.content-column')!).paddingBottom);
        const scrollPadBottom = parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom);
        return {
          startBottom: startBtn.bottom,
          innerHeight: window.innerHeight,
          contentPadding,
          scrollPadBottom,
        };
      });
      expect(initial.contentPadding, `${vp.label}: content clears bottom safe area once`).toBeCloseTo(vp.bottom, 0);
      expect(
        initial.scrollPadBottom,
        `${vp.label}: root scroll-padding clears bottom safe area`,
      ).toBeGreaterThanOrEqual(vp.bottom);
      expect(
        initial.startBottom,
        `${vp.label}: 开始跑步 stays above the system gesture area at initial scroll`,
      ).toBeLessThanOrEqual(initial.innerHeight - vp.bottom);

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
              const footer = document.querySelector('.app-footer')!.getBoundingClientRect();
              return window.innerHeight - footer.bottom;
            }),
          `${vp.label}: scrolled footer clears bottom safe area`,
        )
        .toBeGreaterThanOrEqual(vp.bottom - 1);
    }

    // Native WebView fallback: Capacitor SystemBars injects --safe-area-inset-bottom; it applies when env() is 0 and never doubles when both match.
    await page.setViewportSize({ width: 390, height: 844 });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0 } });
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-bottom', '28px'));
    expect(
      await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.content-column')!).paddingBottom)),
      'Capacitor --safe-area-inset-bottom fallback pads content when env() is 0',
    ).toBeCloseTo(28, 0);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 28 } });
    expect(
      await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.content-column')!).paddingBottom)),
      'env() and --safe-area-inset-bottom do not double-count',
    ).toBeCloseTo(28, 0);
  });

  test('desktop keeps the top bar and shows none of the phone navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ['/', '/footprints', '/settings']) {
      await page.goto(path);
      await ready(page);
      await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible();
      await expect(page.getByTestId('mobile-tabbar')).toBeHidden();
      await expect(page.getByTestId('explore-tabs')).toHaveCount(path === '/footprints' ? 1 : 0);
      await expect(page.getByTestId('explore-tabs')).toBeHidden();
      await expect(page.getByTestId('mobile-account-links')).toBeHidden();
      expect(
        await page.evaluate(() => getComputedStyle(document.querySelector('.content-column')!).paddingBottom),
      ).toBe('0px');
    }
    await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link')).toHaveText([
      '数据汇总',
      '个人记录',
      '跑步记录',
      '一起跑步',
      '个人足迹',
      '常跑路线',
      'AI 助手',
      '身心健康',
    ]);
  });

  test('light and dark screenshots at phone, tablet and desktop sizes have no console errors', async ({ page }) => {
    const errors = collectErrors(page);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const [width, height] of [
        [390, 844],
        [768, 1024],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        for (const path of ['/', '/footprints', '/settings']) {
          await page.goto(path);
          await ready(page);
          await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
          await page.waitForTimeout(300);
          await noOverflow(page);
          const name = path === '/' ? 'today' : path.slice(1);
          await page.screenshot({ path: test.info().outputPath(`mobile-shell-${name}-${width}-${scheme}.png`) });
        }
      }
    }
    expect(errors).toEqual([]);
  });
});

test('anonymous visitors get the three browsing tabs on the showcase', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/activities');
  await ready(page);
  await expect(tabs(page).getByRole('link')).toHaveText(['今天', '记录', '探索']);
  await expect(tab(page, '记录')).toHaveAttribute('aria-current', 'page');
  await tab(page, '探索').click();
  await expect(page.getByRole('navigation', { name: '探索分区' }).getByRole('link')).toHaveText([
    '个人足迹',
    '常跑路线',
    '个人记录',
    '一起跑步',
  ]);
  await noOverflow(page);
});

test('public-shell tabbar-hidden routes (/admin, /privacy) keep content above safe-area-inset-bottom', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  for (const [width, height, bottom] of [
    [390, 844, 34],
    [768, 1024, 20],
  ] as const) {
    await page.setViewportSize({ width, height });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom } });
    for (const path of ['/admin', '/privacy']) {
      await page.goto(path);
      await ready(page);
      await expect(page.locator('.public-shell')).toHaveCount(1);
      await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0);
      await noOverflow(page);
      const contentPadding = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.querySelector('.content-column')!).paddingBottom),
      );
      expect(contentPadding, `${width}px ${path}: content clears bottom safe area`).toBeCloseTo(bottom, 0);
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
              const footer = document.querySelector('.app-footer')!.getBoundingClientRect();
              return window.innerHeight - footer.bottom;
            }),
          `${width}px ${path}: scrolled footer clears bottom safe area`,
        )
        .toBeGreaterThanOrEqual(bottom - 1);
    }
  }
});
