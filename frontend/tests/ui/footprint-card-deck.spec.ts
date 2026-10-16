import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

async function setup(page: Page, count = 4, selected = 0) {
  const state = await installActivities(page);
  state.records = Array.from({ length: count }, (_, index) => ({
    ...sampleActivity,
    id: `${(count - index).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
    title: `足迹 ${index + 1}`, activity_date: '2026-10-13',
    distance_m: String(5000 + index * 100), has_route: index === selected
  }));
  await loginRunner(page);
  await page.goto(`/activities/${state.records[selected].id}`);
  const deck = page.getByRole('region', { name: '本次足迹卡片' });
  await deck.scrollIntoViewIfNeeded();
  await expect(deck.locator('.wall-card[aria-pressed="true"]')).toBeVisible();
  await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
  return { state, deck };
}
const recordButtons = (page: Page) => page.getByRole('region', { name: '本次足迹卡片' }).getByRole('button', { name: /^查看跑步记录/ });

test('mouse drags only browse cards and a click explicitly selects a record', async ({ page }) => {
  const { deck, state } = await setup(page, 30, 8);
  const details: string[] = [];
  page.on('request', request => { if (/\/api\/v1\/activities\/[^/]+$/.test(new URL(request.url()).pathname)) details.push(request.url()); });
  async function drag(dx: number) {
    const box = (await deck.locator('.stack-viewport').boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + 2, { steps: 8 }); await page.mouse.up();
  }
  await drag(-100);
  await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '9');
  await expect(page).toHaveURL(new RegExp(`${state.records[8].id}$`));
  await expect(page.getByTestId('activity-distance')).toHaveText('5.8 km');
  expect(details).toHaveLength(0);
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  await drag(100);
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '8');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
  expect(details).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => performance.now())).toBeGreaterThan(await page.evaluate(() => performance.now() + 420));
  await recordButtons(page).filter({ hasText: '足迹 10' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
  expect(details).toHaveLength(1);
});

test('horizontal wheel only browses; an arrow explicitly selects from the visible position', async ({ page }) => {
  const { deck, state } = await setup(page, 30, 8);
  const details: string[] = [];
  page.on('request', request => { if (/\/api\/v1\/activities\/[^/]+$/.test(new URL(request.url()).pathname)) details.push(request.url()); });
  await deck.locator('.stack-viewport').hover();
  for (let i = 0; i < 12; i++) await page.mouse.wheel(20, 0);
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '13');
  const nextGesture = await page.evaluate(() => performance.now() + 200);
  await expect.poll(() => page.evaluate(() => performance.now())).toBeGreaterThan(nextGesture);
  await page.mouse.wheel(90, 0);
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '14');
  await page.mouse.wheel(-90, 0);
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '13');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
  await expect(page).toHaveURL(new RegExp(`${state.records[8].id}$`));
  expect(details).toHaveLength(0);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 15');
  expect(details).toHaveLength(1);
});

test('browsing across pages leaves detail and map intact until the central card is clicked', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { deck, state } = await setup(page, 240, 8);
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  const reads: URL[] = [], details: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/activities') reads.push(url);
    if (/\/api\/v1\/activities\/[^/]+$/.test(url.pathname)) details.push(url.pathname);
  });
  await recordButtons(page).filter({ hasText: '足迹 9' }).focus();
  for (let index = 9; index <= 48; index++) {
    await page.keyboard.press('ArrowRight');
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', String(index));
  }
  await expect(page).toHaveURL(new RegExp(`${state.records[8].id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
  await expect(page.getByTestId('activity-distance')).toHaveText('5.8 km');
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  expect(details).toHaveLength(0);
  expect(reads.map(url => Number(url.searchParams.get('offset')))).toEqual([20, 40]);
  expect(reads.every(url => url.searchParams.get('limit') === '20')).toBe(true);
  const central = deck.locator('.stack-slot.centered .wall-card');
  await expect(central).toHaveAttribute('aria-pressed', 'false');
  await central.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 49');
  await expect(central).toHaveAttribute('aria-pressed', 'true');
  expect(details).toHaveLength(1);
});

test('continuous browsing waits for a slow next page and retains the latest browse intent', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { deck } = await setup(page, 80, 8);
  await recordButtons(page).filter({ hasText: '足迹 9' }).focus();
  // The next window needs page 2 when center reaches index 16 (radius 3 + buffer 1).
  for (let index = 9; index <= 15; index++) {
    await page.keyboard.press('ArrowRight');
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', String(index));
  }
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const offsets: number[] = [];
  await page.route('**/api/v1/activities?**', async route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    offsets.push(offset);
    if (offset === 20) await hold;
    await route.fallback();
  });
  try {
    await deck.locator('.stack-viewport').hover();
    await page.mouse.wheel(48, 0);
    await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'true');
    await page.mouse.wheel(96, 0);
    release();
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '18');
    await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
    expect(offsets).toEqual([20]);
  } finally { release(); }
});

test('a failed browse retries browsing without selecting, and clicking the selected side card recenters it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { deck, state } = await setup(page, 60, 8);
  await recordButtons(page).filter({ hasText: '足迹 9' }).focus();
  for (let index = 9; index <= 15; index++) {
    await page.keyboard.press('ArrowRight');
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', String(index));
  }
  state.listFailures = 1;
  await page.keyboard.press('ArrowRight');
  await expect(deck.getByRole('alert')).toBeVisible();
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '15');
  await deck.getByRole('button', { name: '重新读取足迹' }).click();
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '16');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
  await deck.locator('.stack-slot.centered .wall-card').focus();
  for (let index = 15; index >= 10; index--) {
    await page.keyboard.press('ArrowLeft');
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', String(index));
  }
  await recordButtons(page).filter({ has: page.getByText('足迹 9', { exact: true }) }).click();
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '8');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
});

test('long browsing bounds list pages, reuses nearby pages and reloads evicted history', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reads: URL[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/v1/activities') reads.push(url); });
  const { deck } = await setup(page, 240, 8);
  expect(reads).toHaveLength(1);
  async function browseTo(target: number) {
    while (true) {
      const current = await deck.locator('.stack-slot.chosen').getAttribute('data-index');
      if (Number(current) === target) break;
      const next = Number(current) < target ? Math.min(target, Number(current) + 3) : Math.max(target, Number(current) - 3);
      await recordButtons(page).filter({ has: page.getByText(`足迹 ${next + 1}`, { exact: true }) }).click();
      await expect(deck.locator('.stack-slot.chosen')).toHaveAttribute('data-index', String(next));
      expect(await deck.locator('.stack-slot').count()).toBeLessThanOrEqual(11);
    }
  }
  await browseTo(72);
  expect(reads.map(url => Number(url.searchParams.get('offset')))).toEqual([0, 20, 40, 60]);
  const before = reads.length;
  await browseTo(68); await browseTo(72);
  expect(reads).toHaveLength(before);
  await browseTo(8);
  expect(reads.map(url => Number(url.searchParams.get('offset')))).toEqual([0, 20, 40, 60, 0]);
  expect(reads.every(url => url.searchParams.get('limit') === '20')).toBe(true);
});

test('continuous switching keeps only visible transition cards and a bounded window', async ({ page }) => {
  const { deck } = await setup(page, 120, 8);
  for (let index = 9; index <= 32; index++) {
    await deck.getByRole('button', { name: '较旧一条' }).dispatchEvent('click');
    await expect(deck.locator('.stack-slot.chosen')).toHaveAttribute('data-index', String(index));
    expect(await deck.locator('.stack-slot').count()).toBeLessThanOrEqual(22);
  }
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  expect(await deck.locator('.stack-slot').count()).toBeLessThanOrEqual(11);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 33');
});

test('rapid side jumps keep the intermediate cards along the spring travel path', async ({ page }) => {
  const { deck } = await setup(page, 120, 8);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  // Several responses arrive before the next animation frame (e.g. a busy UI).
  for (const index of [12, 16, 20]) {
    await deck.locator(`.stack-slot[data-index="${index}"] .wall-card`).dispatchEvent('click');
    await expect(deck.locator('.stack-slot.chosen')).toHaveAttribute('data-index', String(index));
  }
  await page.clock.runFor(80);
  const nearest = await deck.locator('.stack-slot').evaluateAll(slots => Math.min(...slots.map(slot => Math.abs(new DOMMatrix(getComputedStyle(slot).transform).m41))));
  expect(nearest).toBeLessThan(50);
  await page.clock.runFor(1500);
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  expect(await deck.locator('.stack-slot').count()).toBeLessThanOrEqual(11);
});

test('horizontal browsing stops at both ends without requesting detail or looping', async ({ page }) => {
  const { deck } = await setup(page, 2);
  const details: string[] = [];
  page.on('request', request => { if (/\/api\/v1\/activities\/[^/]+$/.test(new URL(request.url()).pathname)) details.push(request.url()); });
  await deck.locator('.stack-viewport').hover();
  await page.mouse.wheel(-90, 0); await page.mouse.wheel(90, 0);
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '1');
  for (let i = 0; i < 5; i++) await page.mouse.wheel(90, 0);
  await expect(deck.getByRole('button', { name: '较旧一条' })).toBeDisabled();
  await page.mouse.wheel(-90, 0);
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '0');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 1');
  expect(details).toHaveLength(0);
});

test('wide decks show nine route previews while selected detail routes load independently', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const state = await installActivities(page);
  state.records = Array.from({ length: 30 }, (_, index) => ({
    ...sampleActivity,
    id: `${(30 - index).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
    title: `足迹 ${index + 1}`, activity_date: '2026-10-13', has_route: true
  }));
  const routeReads: string[] = [];
  const detailReads: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/v1\/activities\/[^/]+$/.test(path)) detailReads.push(path.split('/').at(-1)!);
  });
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const target = state.records[9];
  await page.route('**/api/v1/activities/*/route', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    routeReads.push(id);
    await route.fallback();
  });
  await loginRunner(page);
  await page.goto(`/activities/${state.records[8].id}`);
  const deck = page.getByRole('region', { name: '本次足迹卡片' });
  await deck.scrollIntoViewIfNeeded();
  await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
  await expect(recordButtons(page)).toHaveCount(9);
  for (const card of await recordButtons(page).all()) await expect(card.locator('svg[role="img"]')).toBeVisible();
  await expect(deck.getByText('选择后加载路线')).toHaveCount(0);
  expect(detailReads).toEqual([state.records[8].id]);
  expect(new Set(routeReads).size).toBeLessThanOrEqual(11);
  await page.addStyleTag({ content: '.glass-tuner { display:none!important }' });
  await deck.screenshot({ path: info.outputPath('nine-route-previews.png') });
  await page.route(`**/api/v1/activities/${target.id}/route`, async route => { await hold; await route.fallback(); });
  const next = recordButtons(page).filter({ hasText: '足迹 10' });
  try {
    await next.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
    await expect(page).toHaveURL(new RegExp(`${target.id}$`));
    await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
    await expect(next).toHaveAttribute('aria-pressed', 'true');
    await expect(next).toContainText('正在描绘足迹');
    expect(detailReads).toEqual([state.records[8].id, target.id]);
  } finally { release(); }
  await expect(next.locator('svg[role="img"]')).toBeVisible();
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
});

test('cards have equal projected sizes and keep the current record centered', async ({ page }) => {
  const { deck } = await setup(page, 20, 8);
  const selected = recordButtons(page).filter({ hasText: '足迹 9' });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  const center = (await selected.boundingBox())!;
  const viewport = (await deck.locator('.stack-viewport').boundingBox())!;
  expect(Math.abs(center.x + center.width / 2 - viewport.x - viewport.width / 2)).toBeLessThan(2);
  const boxes = await recordButtons(page).evaluateAll(elements => elements.map(el => {
    const box = el.getBoundingClientRect(); return { width: box.width, height: box.height };
  }));
  for (const box of boxes) {
    expect(Math.abs(box.width - center.width)).toBeLessThan(1);
    expect(Math.abs(box.height - center.height)).toBeLessThan(1);
  }
});

test('mixed missing and complete metrics keep card heights and fact rows aligned', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await installActivities(page);
  state.records = Array.from({ length: 20 }, (_, index) => ({
    ...sampleActivity,
    id: `${(20 - index).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
    title: `跑步记录 ${index + 1} 的长标题，用于检查省略与统一卡片尺寸`,
    elapsed_seconds: index === 8 ? null : index === 9 ? '360000' : '2032',
    avg_pace_seconds_per_km: index === 8 ? null : '406',
    temporal_quality: index === 8 ? 'incomplete' : 'complete',
    has_route: index === 8
  }));
  await loginRunner(page);
  await page.goto(`/activities/${state.records[8].id}`);
  const deck = page.getByRole('region', { name: '本次足迹卡片' });
  await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
  await expect(deck.locator('.chosen .wall-facts')).toHaveText('用时 —配速 —');
  for (const width of [1920, 1100, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await deck.scrollIntoViewIfNeeded();
    await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => deck.locator('.stack-slot').evaluateAll(slots => {
      const boxes = slots.map(slot => slot.querySelector('.wall-card')!.getBoundingClientRect());
      return Math.max(...boxes.map(box => box.height)) - Math.min(...boxes.map(box => box.height));
    })).toBeLessThan(1);
    const rows = await deck.locator('.stack-slot .wall-card').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect();
      return [...card.querySelectorAll('.wall-facts span')].map(fact => {
        const row = fact.getBoundingClientRect();
        return { top: row.top - box.top, bottom: row.bottom - box.top, height: box.height };
      });
    }));
    for (const facts of rows) {
      expect(facts[1].top).toBeGreaterThanOrEqual(facts[0].bottom);
      expect(facts[1].bottom).toBeLessThan(facts[1].height);
      expect(Math.abs(facts[1].top - rows[0][1].top)).toBeLessThan(1);
    }
    if (width !== 1100) await deck.screenshot({ path: info.outputPath(`equal-mixed-metrics-${width}.png`) });
  }
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(deck.locator('.chosen .wall-facts')).toContainText('100:00:00');
  await expect.poll(() => deck.locator('.stack-slot .wall-card').evaluateAll(cards => {
    const heights = cards.map(card => card.getBoundingClientRect().height);
    return Math.max(...heights) - Math.min(...heights);
  })).toBeLessThan(1);
});

test('another record can be selected while its predecessor route is still loading', async ({ page }) => {
  const { deck, state } = await setup(page, 20, 8);
  state.records[9].has_route = true;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const url = `**/api/v1/activities/${state.records[9].id}/route`;
  await page.route(url, async route => { await hold; await route.fallback(); });
  try {
    await deck.getByRole('button', { name: '较旧一条' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
    await expect(deck.locator('.wall-card[aria-pressed="true"]')).toContainText('正在描绘足迹');
    await deck.getByRole('button', { name: '较旧一条' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 11');
    const response = page.waitForResponse(url);
    release(); await response;
    await expect(page.getByTestId('route-map-ready')).toHaveCount(0);
    await expect(page.getByText('此活动没有路线。', { exact: true })).toBeVisible();
    await expect(deck.locator('.wall-card[aria-pressed="true"]')).toContainText('没有路线');
  } finally { release(); }
});

test('central pointer feedback has restrained highlight, parallax and a spring return', async ({ page }) => {
  await setup(page, 20, 8);
  const card = recordButtons(page).filter({ hasText: '足迹 9' });
  await card.hover({ position: { x: 25, y: 25 } });
  await expect.poll(() => card.evaluate(el => Number(getComputedStyle(el, '::after').opacity))).toBeGreaterThan(.1);
  const shifts = await card.evaluate(el => [el.querySelector('.route-thumbnail')!, el.querySelector('.wall-card-copy')!].map(child => {
    const matrix = new DOMMatrix(getComputedStyle(child).transform); return Math.hypot(matrix.m41, matrix.m42);
  }));
  expect(shifts[0]).toBeGreaterThan(.2);
  expect(shifts[1]).toBeGreaterThan(0);
  expect(shifts[0]).toBeGreaterThan(shifts[1]);
  expect(shifts[0]).toBeLessThan(3);
  await page.mouse.move(5, 5);
  await expect.poll(() => card.evaluate(el => Math.abs(new DOMMatrix(getComputedStyle(el).transform).m13))).toBeLessThan(.001);
  await expect.poll(() => card.evaluate(el => Number(getComputedStyle(el, '::after').opacity))).toBe(0);
});

test('direction keys browse with focus and Enter or Space explicitly selects', async ({ page }) => {
  const { deck } = await setup(page, 20, 8);
  const card = recordButtons(page).filter({ hasText: '足迹 9' });
  await card.focus(); await card.press('ArrowRight');
  await expect(recordButtons(page).filter({ hasText: '足迹 10' })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
  await page.keyboard.press('ArrowLeft');
  await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '8');
  await expect(recordButtons(page).filter({ hasText: '足迹 9' })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
});

test('either side card selects its whole record and only the center owns pointer feedback', async ({ page }) => {
  const { deck, state } = await setup(page, 20, 8);
  const cards = recordButtons(page);
  const left = cards.filter({ hasText: '足迹 8' });
  await left.hover({ position: { x: 20, y: 25 } });
  expect(await left.evaluate(el => el.style.getPropertyValue('--card-highlight'))).toBe('');
  await left.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 8');
  await expect(page).toHaveURL(new RegExp(`${state.records[7].id}$`));
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  const right = cards.filter({ hasText: '足迹 10' });
  await right.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
  await expect(page.getByTestId('activity-distance')).toHaveText('5.9 km');
  await expect(right).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
});

test('leaving the detail while springs move releases animation callbacks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { deck } = await setup(page, 20, 8);
  await recordButtons(page).filter({ hasText: '足迹 9' }).hover({ position: { x: 25, y: 25 } });
  await deck.getByRole('button', { name: '较旧一条' }).dispatchEvent('click');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'true');
  const detached = await deck.locator('.stack-slot').first().elementHandle();
  await deck.getByRole('link', { name: '查看全部足迹' }).click();
  await expect(page).toHaveURL(/\/activities\/wall$/);
  expect(await detached!.evaluate(el => el.isConnected)).toBe(false);
  const transform = await detached!.evaluate(el => (el as HTMLElement).style.transform);
  // Let real browser frames run after Svelte has unmounted the deck.
  await page.evaluate(() => new Promise<void>(resolve => {
    let frames = 0;
    function frame() { if (++frames === 12) resolve(); else requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }));
  expect(await detached!.evaluate(el => (el as HTMLElement).style.transform)).toBe(transform);
  expect(errors).toEqual([]);
});

test('rapid changes retarget a moving deck and settle on the final whole record', async ({ page }) => {
  const { deck, state } = await setup(page, 60, 20);
  const original = await deck.locator('.stack-slot[data-index="20"]').elementHandle();
  const previousTransform = await original!.evaluate(el => el.style.transform);
  const next = deck.getByRole('button', { name: '较旧一条' });
  for (const title of ['足迹 22', '足迹 23', '足迹 24']) {
    await next.dispatchEvent('click');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'true');
  }
  await expect.poll(() => original!.evaluate(el => (el as HTMLElement).style.transform)).not.toBe(previousTransform);
  await deck.getByRole('button', { name: '较新一条' }).dispatchEvent('click');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 23');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  await expect(page).toHaveURL(new RegExp(`${state.records[22].id}$`));
  await expect(page.getByTestId('activity-distance')).toHaveText('7.2 km');
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  const primary = deck.locator('.stack-slot.chosen');
  expect(await primary.evaluate(el => {
    const matrix = new DOMMatrix(getComputedStyle(el).transform);
    return [matrix.m41, matrix.m43, matrix.m13, matrix.m11];
  })).toEqual([0, 0, 0, 1]);
  expect(await deck.locator('.stack-slot').count()).toBeLessThanOrEqual(11);
});

test('touch swipes browse without selecting and preserve native vertical scrolling', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const { deck, state } = await setup(page, 20, 8);
    const cdp = await context.newCDPSession(page);
    async function swipe(dx: number, dy: number) {
      const box = (await deck.locator('.stack-viewport').boundingBox())!;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 5, y: y + dy * i / 5 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await swipe(-65, 2);
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '9');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
    await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
    await expect(page).toHaveURL(new RegExp(`${state.records[8].id}$`));
    const beforeScroll = await page.evaluate(() => scrollY);
    await swipe(2, -70);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeScroll);
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '9');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
    await deck.scrollIntoViewIfNeeded();
    await swipe(65, 2);
    await expect(deck.locator('.stack-slot.centered')).toHaveAttribute('data-index', '8');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 9');
    await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
    await page.addStyleTag({ content: '.glass-tuner { display:none!important }' });
    await deck.screenshot({ path: info.outputPath('coverflow-touch.png') });
  } finally { await context.close(); }
});

test('live reduced motion stops the deck and all central pointer effects', async ({ page }) => {
  const { deck } = await setup(page, 20, 8);
  await recordButtons(page).filter({ hasText: '足迹 9' }).hover({ position: { x: 25, y: 25 } });
  await deck.getByRole('button', { name: '较旧一条' }).dispatchEvent('click');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 10');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  const primary = recordButtons(page).filter({ hasText: '足迹 10' });
  await primary.hover({ position: { x: 25, y: 25 } });
  await expect(primary).toHaveCSS('transform', 'none');
  await expect.poll(() => primary.evaluate(el => Number(getComputedStyle(el, '::after').opacity))).toBe(0);
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 11');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
});

test('reduced motion prunes departed cards while browsing beyond a full window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { deck } = await setup(page, 40, 8);
  for (let index = 9; index <= 20; index++) {
    await deck.getByRole('button', { name: '较旧一条' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`足迹 ${index + 1}`);
    await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
    expect(await deck.locator('.stack-slot').count()).toBeLessThanOrEqual(11);
  }
});

test('side arrows switch the whole record, keep it centered and stop at both boundaries', async ({ page }, info) => {
  const { deck, state } = await setup(page, 12);
  const cards = recordButtons(page);
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).not.toHaveClass(/rn-glass-control/);
  for (const card of [cards.first(), cards.nth(1)]) {
    await expect(card).toHaveCSS('backdrop-filter', 'none');
    await expect(card).toHaveCSS('background-color', await deck.evaluate(el => getComputedStyle(el).backgroundColor));
  }
  const main = (await cards.first().boundingBox())!;
  const viewport = (await deck.locator('.stack-viewport').boundingBox())!;
  expect(main.width).toBeLessThanOrEqual(150); expect(main.height).toBeLessThan(260);
  expect(Math.abs(main.x + main.width / 2 - viewport.x - viewport.width / 2)).toBeLessThan(2);
  await expect(deck.getByRole('link', { name: '查看该记录' })).toHaveCount(0);
  await expect(deck.locator('.preview-controls')).toHaveCount(0);
  await expect(deck.getByRole('button', { name: '较新一条' })).toBeDisabled();
  const beforeY = (await deck.boundingBox())!.y;
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 2');
  await expect(page.getByTestId('activity-distance')).toHaveText('5.1 km');
  await expect(page).toHaveURL(new RegExp(`${state.records[1].id}$`));
  expect(Math.abs((await deck.boundingBox())!.y - beforeY)).toBeLessThan(5);
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  await cards.last().click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('足迹 2');
  while (await deck.getByRole('button', { name: '较旧一条' }).isEnabled()) {
    await deck.getByRole('button', { name: '较旧一条' }).click();
    await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 12');
  await expect(cards.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
  const last = (await cards.last().boundingBox())!;
  expect(Math.abs(last.x + last.width / 2 - viewport.x - viewport.width / 2)).toBeLessThan(2);
  await page.addStyleTag({ content: '.glass-tuner { display:none!important }' });
  await deck.screenshot({ path: info.outputPath('coverflow-boundary.png') });
});

test('cross-page record switches retain list cache and animate card movement', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', req => { const url = new URL(req.url()); if (url.pathname === '/api/v1/activities') reads.push(url.search); });
  const { deck } = await setup(page, 85, 39);
  const cards = recordButtons(page);
  await expect(cards.filter({ hasText: '足迹 40' })).toHaveAttribute('aria-pressed', 'true');
  const before = reads.length;
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 41');
  await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'true');
  await deck.getByRole('button', { name: '较新一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 40');
  expect(reads.length).toBe(before);
  expect(reads.length).toBeLessThanOrEqual(5);
});

test('coverflow reduces visible side cards without overflowing arrows or the introduction', async ({ page }, info) => {
  const { deck } = await setup(page, 30, 8);
  const cards = recordButtons(page);
  for (const width of [1920, 1100, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
    await expect(deck.locator('.card-stack')).toHaveAttribute('data-moving', 'false');
    await deck.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(deck.locator('.preview-browser')).toHaveAttribute('aria-busy', 'false');
    await deck.scrollIntoViewIfNeeded();
    if (width <= 390) {
      await expect(cards).toHaveCount(1);
      await expect(deck.locator('.stack-slot')).toHaveCount(3);
    }
    else if (width === 1920) await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(5);
    const viewport = (await deck.locator('.stack-viewport').boundingBox())!;
    const boxes = await cards.evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect(); return { x: box.x, right: box.right };
    }));
    expect(Math.min(...boxes.map(box => box.x))).toBeGreaterThanOrEqual(viewport.x);
    expect(Math.max(...boxes.map(box => box.right))).toBeLessThanOrEqual(viewport.x + viewport.width);
    const left = (await deck.getByRole('button', { name: '较新一条' }).boundingBox())!;
    const right = (await deck.getByRole('button', { name: '较旧一条' }).boundingBox())!;
    expect(left.x + left.width).toBeLessThanOrEqual(viewport.x);
    expect(right.x).toBeGreaterThanOrEqual(viewport.x + viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const selected = cards.filter({ hasText: '足迹 9' });
    expect(await selected.evaluate(el => [...el.querySelectorAll('.wall-date, h3, .wall-distance, .wall-facts')].every(label => {
      const box = label.getBoundingClientRect();
      return document.elementFromPoint(box.x + 2, box.y + box.height / 2)?.closest('.wall-card') === el;
    }))).toBe(true);
    await page.addStyleTag({ content: '.glass-tuner { display:none!important }' });
    if ([1920, 390, 320].includes(width)) await deck.screenshot({ path: info.outputPath(`coverflow-${width}.png`) });
  }
});

test('pointer tilt follows direction, resets, and honors live reduced motion', async ({ page }) => {
  await setup(page);
  const card = recordButtons(page).first();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await card.hover({ position: { x: 25, y: 25 } });
  const rotation = () => card.evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return m.m13; });
  await expect.poll(rotation).toBeGreaterThan(.01);
  await card.hover({ position: { x: 120, y: 25 } });
  await expect.poll(rotation).toBeLessThan(-.01);
  await page.mouse.move(5, 5);
  await expect.poll(async () => Math.abs(await rotation())).toBeLessThan(.001);
  await card.hover({ position: { x: 25, y: 25 } });
  await expect.poll(rotation).toBeGreaterThan(.01);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => Math.abs(await rotation())).toBeLessThan(.001);
});

test('320px touch dark layout keeps side arrows and supports keyboard record switching', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, hasTouch: true, isMobile: true, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    const { deck } = await setup(page, 4, 2);
    const cards = recordButtons(page);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
    expect(await deck.evaluate(el => el.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const previous = deck.getByRole('button', { name: '较新一条' });
    await previous.focus(); await expect(previous).toBeFocused();
    await previous.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 2');
    await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
    await cards.first().dispatchEvent('pointermove', { pointerType: 'touch', clientX: 200, clientY: 100 });
    expect(await cards.first().evaluate(el => getComputedStyle(el).transform)).toBe('none');
    const emptyFits = await cards.first().locator('.route-thumbnail').evaluate(el => {
      const outer = el.getBoundingClientRect(), empty = el.querySelector('.thumbnail-empty')!.getBoundingClientRect();
      return empty.top >= outer.top && empty.bottom <= outer.bottom;
    });
    expect(emptyFits).toBe(true);
    await page.addStyleTag({ content: '.glass-tuner { display:none!important }' });
    await deck.screenshot({ path: info.outputPath('stack-mobile-dark.png') });
  } finally { await context.close(); }
});

test('list errors retain current record and offer retry; singleton disables both ends', async ({ page }) => {
  const state = await installActivities(page); state.records = [{ ...sampleActivity }]; state.listFailures = 1;
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  const deck = page.getByRole('region', { name: '本次足迹卡片' });
  await deck.scrollIntoViewIfNeeded();
  await expect(deck.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('河畔晨跑');
  await deck.getByRole('button', { name: '重新读取足迹' }).click();
  await expect(deck.getByRole('alert')).toHaveCount(0);
  await expect(deck.getByRole('button', { name: '较新一条' })).toBeDisabled();
  await expect(deck.getByRole('button', { name: '较旧一条' })).toBeDisabled();
});

test('list 401 clears detail and redirects to login', async ({ page }) => {
  await installActivities(page);
  await page.route('**/api/v1/activities?*', route => route.fulfill({ status: 401, json: { error: { message: '登录已过期' } } }));
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
  await expect(page.getByRole('heading', { name: sampleActivity.title, exact: true })).toHaveCount(0);
});

test('pending page reads disable switching and failed switch keeps the whole old record', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const { deck } = await setup(page, 45, 14);
  await expect(recordButtons(page).filter({ hasText: '足迹 15' })).toHaveAttribute('aria-pressed', 'true');
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/activities?limit=20&offset=20', async route => {
    await hold; await route.fulfill({ status: 503, json: { error: { message: '足迹暂时不可用' } } });
  });
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(deck.getByRole('button', { name: '较旧一条' })).toBeDisabled();
  await expect(deck.getByRole('button', { name: '较新一条' })).toBeDisabled();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 15');
  release();
  await expect(deck.getByRole('alert')).toContainText('足迹暂时不可用');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 15');
});

test('switching while the previous route is pending cannot overwrite the new detail', async ({ page }) => {
  const state = await installActivities(page);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/activities/${sampleActivity.id}/route`, async route => { await hold; await route.fallback(); });
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  const deck = page.getByRole('region', { name: '本次足迹卡片' });
  await deck.scrollIntoViewIfNeeded();
  await expect(deck.getByRole('button', { name: '较旧一条' })).toBeEnabled();
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(state.records[1].title);
  const response = page.waitForResponse(`**/api/v1/activities/${sampleActivity.id}/route`);
  release(); await response;
  await expect(page.getByTestId('route-map-ready')).toHaveCount(0);
  await expect(page.getByText('此活动没有路线。', { exact: true })).toBeVisible();
});

test('detail read failure keeps URL and record; retry changes the record', async ({ page }) => {
  const { deck, state } = await setup(page);
  await expect(deck.getByRole('button', { name: '较旧一条' })).toBeEnabled();
  state.detailFailures = 1;
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(deck.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${state.records[0].id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 1');
  await deck.getByRole('button', { name: '重新读取足迹' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 2');
});

test('switching records and reloading preserves the original wall page on Back', async ({ page }) => {
  const { state } = await setup(page, 60);
  await page.goto('/activities/wall?offset=24');
  await page.locator(`a.wall-card[href="/activities/${state.records[24].id}"]`).click();
  const deck = page.getByRole('region', { name: '本次足迹卡片' });
  await deck.scrollIntoViewIfNeeded();
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 26');
  await deck.getByRole('button', { name: '较旧一条' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 27');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('足迹 27');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/\/activities\/wall\?offset=24$/);
  await expect(page.locator('a.wall-card').first()).toContainText('足迹 25');
});
