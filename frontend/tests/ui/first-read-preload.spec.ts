import { expect, test, type Page } from '@playwright/test';

// Pages whose content is one large read start it from the HTML (<link rel="preload" as="fetch">), so it
// does not wait for hydration; the page's own fetch must reuse that response instead of asking again.
const pages = [
  {
    name: 'together',
    path: '/together?period=month',
    api: '/api/v1/together?period=month',
    body: {
      data: {
        next_cursor: null,
        tracks_truncated: false,
        distance_m: 3000,
        count: 0,
        participants: [],
        recent: [],
        tracks: [],
      },
      error: null,
      meta: { request_id: 'test' },
    },
    loaded: (page: Page) => expect(page.getByText('还没有人加入')).toBeVisible(),
  },
  {
    name: 'footprints',
    path: '/footprints?mode=heatmap',
    api: '/api/v1/showcase/footprints/all?mode=heatmap&encoding=delta',
    body: {
      data: { status: 'failed', generated_at: null, refreshing: false, result: null },
      error: null,
      meta: { request_id: 'test' },
    },
    loaded: (page: Page) => expect(page.getByText('足迹生成暂未完成，请稍后重新读取')).toBeVisible(),
  },
  {
    // A personal showcase reads its own owner's address, which the preload must name the same way.
    name: 'personal footprints',
    path: '/p/runner/footprints',
    api: '/api/v1/showcase/users/runner/footprints/all?mode=tracks&encoding=delta',
    body: {
      data: { status: 'failed', generated_at: null, refreshing: false, result: null },
      error: null,
      meta: { request_id: 'test' },
    },
    loaded: (page: Page) => expect(page.getByText('足迹生成暂未完成，请稍后重新读取')).toBeVisible(),
  },
];

async function countReads(page: Page, api: string, body: object) {
  const reads: string[] = [];
  await page.route(`**${api.split('?')[0]}?*`, (route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname + url.search);
    return route.fulfill({ json: body });
  });
  return reads;
}

for (const target of pages) {
  test(`${target.name}: the HTML itself starts the first read`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const reads = await countReads(page, target.api, target.body);
    await page.goto(target.path);
    await expect.poll(() => reads).toEqual([target.api]);
    await context.close();
  });

  test(`${target.name}: the page reuses the preloaded read instead of asking again`, async ({ page }) => {
    const reads = await countReads(page, target.api, target.body);
    await page.goto(target.path);
    await target.loaded(page);
    await page.waitForTimeout(500);
    expect(reads).toEqual([target.api]);
  });
}
