import { expect, test, type Page, type Locator } from '@playwright/test';
import { loginRunner, sampleActivity } from '../fixtures/activities';
import { installBaselineFootprints, installBaselineMilestones } from '../fixtures/map-baseline';

async function switchProjection(page: Page, name: string) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="global-map-ready"]') as HTMLElement;
    const button = document.querySelector('.proj-toggle-btn') as HTMLButtonElement;
    const w = window as any;
    w.__switchResult = null;
    const values = () =>
      [el.dataset.viewAlt, el.dataset.viewYaw, el.dataset.viewPitch, el.dataset.viewPanX, el.dataset.viewPanY].join(
        ',',
      );
    button.addEventListener(
      'click',
      () => {
        const start = performance.now();
        let last = values(),
          changed = false,
          lastChange = start;
        const sample = (now: number) => {
          const next = values();
          if (next !== last) {
            changed = true;
            last = next;
            lastChange = now;
          }
          if (changed && now - lastChange >= 250)
            w.__switchResult = { elapsedMs: now - start, lastChangeMs: lastChange - start };
          else if (now - start > 8000) w.__switchResult = { error: 'camera did not converge' };
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { once: true, capture: true },
    );
  });
  await page.getByRole('button', { name }).click();
  await page.waitForFunction(() => (window as any).__switchResult !== null, null, { timeout: 10_000 });
  const result = await page.evaluate(() => (window as any).__switchResult);
  expect(result.error).toBeUndefined();
  return result;
}
async function view(target: Locator) {
  return target.evaluate((el) => ({ ...(el as HTMLElement).dataset }));
}
async function gestures(page: Page, target: Locator, mobile: boolean, globe: boolean) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Map has no bounds');
  const x = Math.round(box.x + box.width / 2),
    y = Math.round(box.y + box.height / 2);
  const before = globe ? await view(target) : null;
  await page.evaluate(() => {
    const b = (window as any).__baseline;
    b.frames = [];
    b.tasks = [];
    b.active = true;
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x + i * 2, y + i);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const afterDrag = globe ? await view(target) : null;
  await page.mouse.move(x, y);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -40);
    await page.waitForTimeout(30);
  }
  const afterWheel = globe ? await view(target) : null;
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 25, y, id: 1 },
        { x: x + 25, y, id: 2 },
      ],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 25 - i * 3, y: y + i, id: 1 },
          { x: x + 25 + i * 4, y: y + i, id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  const afterPinch = globe ? await view(target) : null;
  if (globe && before && afterDrag && afterWheel && afterPinch) {
    const key = before.viewMode === 'globe' ? 'viewYaw' : 'viewPanX';
    expect(Number(afterDrag[key])).not.toBe(Number(before[key]));
    expect(Number(afterWheel.viewAlt)).toBeLessThan(Number(before.viewAlt));
    if (mobile) {
      expect(Number(afterPinch.viewAlt)).toBeLessThan(Number(afterWheel.viewAlt));
      const panKey = before.viewMode === 'globe' ? 'viewPitch' : 'viewPanY';
      expect(Number(afterPinch[panKey])).not.toBe(Number(afterWheel[panKey]));
    }
  }
  const performance = await page.evaluate(() => {
    const b = (window as any).__baseline;
    b.active = false;
    const f: number[] = b.frames.sort((a: number, c: number) => a - c);
    const t: number[] = b.tasks;
    if (f.length < 5) throw new Error('Too few frame samples');
    return {
      frames: f.length,
      mean: f.reduce((a, c) => a + c, 0) / f.length,
      p95: f[Math.ceil(f.length * 0.95) - 1],
      max: f[f.length - 1],
      intervalsOver33ms: f.filter((v) => v > 33.34).length,
      longTaskCount: t.length,
      longTaskMs: t.reduce((a, c) => a + c, 0),
    };
  });
  return { performance, before, afterDrag, afterWheel, afterPinch };
}
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
])
  for (const colorScheme of ['light', 'dark'] as const)
    for (const mobile of [false, true])
      for (let run = 1; run <= (mobile ? 1 : 3); run++) {
        test(`${viewport.width}x${viewport.height} ${colorScheme} ${mobile ? 'mobile' : 'desktop'} run ${run}`, async ({
          browser,
        }) => {
          const context = await browser.newContext({
            viewport,
            colorScheme,
            hasTouch: mobile,
            isMobile: mobile,
            deviceScaleFactor: mobile ? 2 : 1,
          });
          const page = await context.newPage();
          page.setDefaultTimeout(10_000);
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          await page.addInitScript(() => {
            const w = window as any;
            w.__baseline = { frames: [], tasks: [], active: false };
            if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
              throw new Error('Long Task API unavailable');
            new PerformanceObserver((list) =>
              w.__baseline.tasks.push(...list.getEntries().map((e) => e.duration)),
            ).observe({ type: 'longtask', buffered: true });
            let last = 0;
            const frame = (t: number) => {
              if (w.__baseline.active && last) w.__baseline.frames.push(t - last);
              last = w.__baseline.active ? t : 0;
              requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
          await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
          await installBaselineFootprints(page);
          await installBaselineMilestones(page);
          await loginRunner(page);
          const results = [];
          for (const [name, url, id] of [
            ['footprints', '/footprints?mode=tracks', 'footprint-map-ready'],
            ['route', `/activities/${sampleActivity.id}`, 'route-map-ready'],
            ['globe', '/dashboard', 'global-map-ready'],
          ]) {
            const start = Date.now();
            await page.goto(url);
            const target = page.getByTestId(id);
            await expect(target).toBeVisible({ timeout: 30_000 });
            const readyMs = Date.now() - start;
            await target.scrollIntoViewIfNeeded();
            if (name !== 'globe') {
              results.push({ name, readyMs, ...(await gestures(page, target, mobile, false)) });
              continue;
            }
            const first = await gestures(page, target, mobile, true);
            const to2d = await switchProjection(page, '切换为 2D 平面地图');
            const second = await gestures(page, target, mobile, true);
            const to3d = await switchProjection(page, '切换为 3D 地球');
            results.push({ name, readyMs, first, to2d, second, to3d });
          }
          expect(errors).toEqual([]);
          console.log('BASELINE ' + JSON.stringify({ viewport, colorScheme, mobile, run, results }));
          await context.close();
        });
      }

test('MapLibre synthetic gestures visibly change both maps', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await installBaselineFootprints(page);
  await loginRunner(page);
  for (const [url, id] of [
    ['/footprints?mode=tracks', 'footprint-map-ready'],
    [`/activities/${sampleActivity.id}`, 'route-map-ready'],
  ]) {
    await page.goto(url);
    const map = page.getByTestId(id);
    await expect(map).toBeVisible({ timeout: 30_000 });
    await map.scrollIntoViewIfNeeded();
    const canvas = map.locator('canvas.maplibregl-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const x = Math.round(box.x + box.width / 2),
      y = Math.round(box.y + box.height / 2);
    const stable = async () => {
      let old = await canvas.screenshot();
      await expect
        .poll(
          async () => {
            const next = await canvas.screenshot();
            const same = next.equals(old);
            old = next;
            return same;
          },
          { timeout: 5000, intervals: [150] },
        )
        .toBe(true);
      return old;
    };
    let previous = await stable();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 30, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => !(await canvas.screenshot()).equals(previous), { timeout: 5000 }).toBe(true);
    previous = await stable();
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -240);
    await expect.poll(async () => !(await canvas.screenshot()).equals(previous), { timeout: 5000 }).toBe(true);
    previous = await stable();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 25, y, id: 1 },
        { x: x + 25, y, id: 2 },
      ],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 25 - i * 3, y: y + i, id: 1 },
          { x: x + 25 + i * 4, y: y + i, id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => !(await canvas.screenshot()).equals(previous), { timeout: 5000 }).toBe(true);
    previous = await stable();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 25, y, id: 1 },
        { x: x + 25, y, id: 2 },
      ],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 25 + i * 4, y: y + i * 2, id: 1 },
          { x: x + 25 + i * 4, y: y + i * 2, id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(async () => !(await canvas.screenshot()).equals(previous), { timeout: 5000 }).toBe(true);
  }
  await context.close();
});
