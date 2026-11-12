import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity, incompleteActivity, openImport } from '../fixtures/activities';
import { openGoalPanel } from '../fixtures/top-navigation';
const file = { name: 'morning.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx version="1.1" creator="synthetic"></gpx>') };
async function noOverflow(page: Page) { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function capture(page: Page, path: string) {
  await page.evaluate(async () => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  await page.screenshot({ path, fullPage: false });
}

test('scan-friendly records expose pace and visibility, with compact optional upload fields', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities'); await openImport(page);
  await expect(page.getByRole('heading', { name: '河畔晨跑' })).toBeVisible();
  const record = page.getByRole('link').filter({ has: page.getByRole('heading', { name: '河畔晨跑' }) });
  await expect(record).toContainText('配速'); await expect(record).not.toContainText('公开展示');
  await expect(page.getByLabel('标题（可选）')).toBeHidden();
  const options = page.getByText('补充导入信息', { exact: true }); await options.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('标题（可选）')).toBeVisible();
  await page.keyboard.press('Enter'); await expect(page.getByLabel('标题（可选）')).toBeHidden();
  await capture(page, 'test-results/activities-desktop-list.png');
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(page); }
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'test-results/activities-mobile-list.png');
});
test('upload preserves optional payload and file on failure; retry, busy, success and warnings work', async ({ page }) => {
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities'); await openImport(page);
  await page.getByText('补充导入信息', { exact: true }).click();
  await page.getByLabel('标题（可选）').fill('晨跑输入'); await page.getByLabel('时区（可选）', {exact:true}).fill('Asia/Shanghai'); await page.getByLabel('补录日期（可选）').fill('2026-10-12');
  await page.locator('input[type=file][name=file]').setInputFiles(file); state.uploadMode = 'error';
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('上传暂时失败');
  await expect(page.getByLabel('标题（可选）')).toHaveValue('晨跑输入');
  expect(await page.locator('input[type=file][name=file]').evaluate((el: HTMLInputElement) => el.files?.length)).toBe(1);
  state.uploadMode = 'success'; let release!: () => void; state.holdUpload = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在解析与保存…' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: '请勿重复提交' })).toBeVisible();
  release(); await expect(page.getByRole('status').filter({ hasText: '导入成功' })).toBeVisible();
  expect(state.uploadCount).toBe(2); expect(state.uploadBody).toContain('晨跑输入'); expect(state.uploadBody).toContain('Asia/Shanghai'); expect(state.uploadBody).toContain('2026-10-12');
  await expect(page.getByText('时间不完整，用时与配速不可用', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看活动与路线', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新导入的跑步', level: 1 })).toBeVisible();
});
test('duplicate entry and local file limit preserve upload behavior', async ({ page }) => {
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities'); await openImport(page);
  await page.locator('input[type=file][name=file]').setInputFiles({ ...file, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('不能超过 10 MiB'); expect(state.uploadCount).toBe(0);
  await page.locator('input[type=file][name=file]').setInputFiles(file); state.uploadMode = 'duplicate';
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已经导入');
  await expect(page.getByRole('link', { name: '查看已有活动' })).toHaveAttribute('href', `/activities/${sampleActivity.id}`);
});
test('list error retry, empty guidance and pagination remain usable', async ({ page }) => {
  const state = await installActivities(page); state.listFailures = 1; await loginRunner(page); await page.goto('/activities'); await openImport(page);
  await expect(page.getByRole('alert')).toContainText('暂时无法读取');
  await page.getByRole('button', { name: '重新读取活动' }).click(); await expect(page.getByRole('heading', { name: '河畔晨跑' })).toBeVisible();
  state.records = Array.from({ length: 22 }, (_, i) => ({ ...incompleteActivity, id: `${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`, title: `第 ${i + 1} 条跑步` }));
  await page.reload(); await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByRole('heading', { name: '第 21 条跑步' })).toBeVisible(); await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled();
  await page.getByRole('button', { name: '上一页' }).click(); await expect(page.getByRole('heading', { name: '第 1 条跑步', exact: true })).toBeVisible();
  state.records = []; await page.reload(); await expect(page.getByRole('region', { name: /^我的活动/ }).getByRole('status')).toContainText('暂无跑步记录'); await noOverflow(page);
});
test('detail puts route before legacy share links and keeps quality available through keyboard disclosure', async ({ page }) => {
  const state = await installActivities(page); state.links = [{ link_id: '33333333-3333-4333-8333-333333333333', created_at: '2026-10-13T02:00:00Z', expires_at: null, revoked_at: null, status: 'active' }]; await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('activity-distance')).toHaveText('5.1 km');
  const quality = page.getByText('数据质量与指标说明', { exact: true }); await expect(quality).toBeVisible();
  await expect(page.getByText('有效轨迹点', { exact: true })).toBeHidden(); await quality.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('有效轨迹点', { exact: true })).toBeVisible(); await expect(page.getByText('gpx-v1', { exact: false })).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await page.getByRole('heading', { name: '路线', exact: true }).evaluate(el => !!(el.compareDocumentPosition(document.querySelector('#share-title')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
  await capture(page, 'test-results/activities-desktop-detail.png');
  for (const width of [320,390,768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(page); }
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByTestId('route-map-ready')).toBeVisible(); await capture(page, 'test-results/activities-mobile-detail.png');
});
test('detail retry and legacy share links that can only be revoked', async ({ page }) => {
  const state = await installActivities(page); state.detailFailures = 1; state.links = [{ link_id: '33333333-3333-4333-8333-333333333333', created_at: '2026-10-13T02:00:00Z', expires_at: null, revoked_at: null, status: 'active' }]; await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('alert')).toContainText('暂时无法读取'); await page.getByRole('button', { name: '重新读取活动详情' }).click();
  await expect(page.getByRole('heading', { name: '河畔晨跑', level: 1 })).toBeVisible();
  await expect(page.getByLabel('记录可见性')).toHaveCount(0); await expect(page.getByRole('button', { name: '创建分享链接' })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销链接' }).click(); await expect(page.getByRole('status').filter({ hasText: '分享已撤销' })).toBeVisible();
});

test('successful import followed by list outage reports separate outcomes and retries only the list', async ({ page }) => {
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities'); await openImport(page);
  await expect(page.getByRole('heading', { name: '河畔晨跑' })).toBeVisible();
  state.listFailures = 1; await page.locator('input[type=file][name=file]').setInputFiles(file);
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导入成功' })).toBeVisible();
  await expect(page.getByRole('region', { name: '我的活动', exact: true }).getByRole('alert')).toContainText('暂时无法读取');
  await expect(page.getByRole('region', { name: '导入 GPX / TCX', exact: true }).getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '重新读取活动' }).click(); await expect(page.getByRole('heading', { name: '新导入的跑步', level: 3 })).toBeVisible();
  expect(state.uploadCount).toBe(1);
});
test('route read failure can be retried', async ({ page }) => {
  await installActivities(page); await loginRunner(page);
  let routeFailed = false;
  await page.route(`**/api/v1/showcase/activities/${sampleActivity.id}/route`, async route => {
    if (!routeFailed) { routeFailed = true; return route.fulfill({ status: 503, json: { error: { message: '路线读取失败' } } }); }
    await route.fallback();
  });
  await page.goto(`/activities/${sampleActivity.id}`); await expect(page.getByRole('alert')).toContainText('路线读取失败');
  await page.getByRole('button', { name: '重新读取路线' }).click(); await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
});
test('expired activity response redirects without retaining private content', async ({ page }) => {
  await installActivities(page); await loginRunner(page);
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, route => route.fulfill({ status: 401, json: { error: { message: '登录已过期' } } }));
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page).toHaveURL(/\/admin\?reason=expired$/);
  await expect(page.getByRole('heading', { name: '河畔晨跑' })).toHaveCount(0);
});

test('file picker focus and successful session checks preserve selected GPX and upload form', async ({ page }) => {
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities'); await openImport(page);
  await expect(page.getByRole('heading',{name:'河畔晨跑'})).toBeVisible();
  await page.getByText('补充导入信息',{exact:true}).click();
  await page.getByLabel('标题（可选）').fill('保留选中文件');
  await page.locator('input[type=file][name=file]').setInputFiles(file);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/v1/auth/session', async route => { entered(); await held; await route.fallback(); });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  await expect(page.getByRole('heading',{name:'跑步记录',exact:true})).toBeVisible();
  release(); await expect(page.getByRole('heading',{name:'跑步记录',exact:true})).toBeVisible();
  expect(await page.locator('input[type=file][name=file]').evaluate((el: HTMLInputElement) => el.files?.[0]?.name)).toBe('morning.gpx');
  await expect(page.getByLabel('标题（可选）')).toHaveValue('保留选中文件');
  await page.getByRole('button',{name:'导入 GPX',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'导入成功。'})).toBeVisible();
  expect(state.uploadCount).toBe(1);
});

test('successful imports update the persistent sidebar distance while keeping a goal draft', async ({ page }) => {
  const state = await installActivities(page);
  let summaryReads = 0;
  await page.route('**/api/v1/showcase/statistics/summary?**', route => {
    summaryReads++;
    return route.fulfill({ json: { data: { distance_m: state.uploadCount ? '8000' : '5000' }, error: null } });
  });
  await loginRunner(page);
  const goal = await openGoalPanel(page);
  await expect(goal.locator('.goal-distance strong')).toHaveText('5 km');
  await goal.getByRole('button', { name: '设置', exact: true }).click();
  await goal.getByLabel('目标距离（km）', { exact: true }).fill('42');
  await page.getByRole('navigation').getByRole('link', { name: '跑步记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  expect(summaryReads).toBe(1);
  await openImport(page);
  await page.locator('input[type=file][name=file]').setInputFiles(file);
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导入成功。' })).toBeVisible();
  await openGoalPanel(page);
  await expect(goal.locator('.goal-distance strong')).toHaveText('8 km');
  await expect(goal.getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
  expect(summaryReads).toBe(2);
});

// On a wide screen the list keeps the address clean without exposing ?id=.
const listUrl = /\/activities$/;
for (const reload of [false, true]) {
  test(`detail back returns to the list on the same page${reload ? ' after reload' : ''}`, async ({page}) => {
    const state = await installActivities(page);
    state.records = Array.from({length:50}, (_,i) => ({...incompleteActivity,
      id:`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`, title:`返回测试 ${i+1}`}));
    if(reload)await page.setViewportSize({width:390,height:844});
    await loginRunner(page);
    await page.goto('/activities');
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    const title = '返回测试 21';
    await page.getByRole('link').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();
    // On a wide screen the card only selects the record; the preview's link opens its page.
    if(!reload)await page.getByRole('link',{name:'查看完整详情 →'}).click();
    await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();
    if(reload){await page.reload();await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();}
    const back = page.getByRole('button',{name:'返回',exact:true});
    await expect(back).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await back.focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByRole('heading',{name:title,level:3})).toBeVisible();
    await expect(page.locator('.pagination')).toContainText('第 2 页');
    // Traversing forward must keep the same return target, without creating a loop.
    await page.goForward();
    await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();
    await page.getByRole('button',{name:'返回',exact:true}).click();
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByRole('heading',{name:title,level:3})).toBeVisible();
  });
}

test('direct detail entry falls back to records without trusting a return URL', async ({page}) => {
  await installActivities(page);await loginRunner(page);
  await page.goto(`/activities/${incompleteActivity.id}?returnTo=https://example.com`);
  await expect(page.getByRole('heading',{name:incompleteActivity.title,level:1})).toBeVisible();
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByRole('heading',{name:'跑步记录',level:1})).toBeVisible();
});

test.describe('the footprint wall is folded into the records page', () => {
  test.beforeEach(async ({ page }) => { await installActivities(page); await loginRunner(page); });
  test('one navigation entry, no view switch, and the share image sits in the page header', async ({ page }) => {
    await page.goto('/activities');
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await expect(nav.getByRole('link', { name: '足迹墙' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '跑步记录', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: '跑步记录视图' })).toHaveCount(0);
    await expect(page.locator('.page-header').getByRole('button', { name: '生成分享图' })).toBeVisible();
    // The preview's own button is named differently, so the two never read as the same action.
    await expect(page.getByTestId('activity-preview').getByRole('button', { name: '本次分享图' })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成分享图', exact: true })).toHaveCount(1);
  });
  test('the old wall addresses permanently redirect to the records page of the same view', async ({ page }) => {
    for (const [from, to] of [['/activities/wall', '/activities'], ['/activities/wall?offset=24', '/activities'], ['/workspace/activities/wall', '/workspace/activities'], ['/p/runner/activities/wall', '/p/runner/activities']]) {
      const response = await page.request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(308);
      expect(response.headers().location, from).toBe(to);
    }
    await page.goto('/activities/wall');
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  });
});

test.describe('records timeline with a preview pane', () => {
  const record = (n: number, date: string, title: string, distance: string) => ({ ...sampleActivity, id: `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222`, title, activity_date: date, distance_m: distance, started_at: `${date}T00:00:00Z`, ended_at: `${date}T01:00:00Z` });
  const months = [record(1, '2026-10-13', '十月三', '5000'), record(2, '2026-10-10', '十月二', '21000'), record(3, '2026-10-08', '十月一', '8000'), record(4, '2026-09-28', '九月二', '12000'), record(5, '2026-09-24', '九月一', '5000')];
  test.beforeEach(async ({ page }) => {
    const state = await installActivities(page); state.records = months.map(item => ({ ...item })); await loginRunner(page);
  });

  test('records are grouped by month with a total, and a month cut by the page border says so', async ({ page }) => {
    await page.goto('/activities');
    const groups = page.locator('.timeline .month');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText('2026 年 10 月'); await expect(groups.nth(0).getByTestId('month-total')).toHaveText('3 次 · 34.0 km');
    await expect(groups.nth(1)).toContainText('2026 年 9 月'); await expect(groups.nth(1).getByTestId('month-total')).toHaveText('2 次 · 17.0 km');
    // 25 records, 20 per page: the last month of the first page continues on the next page.
    const state = await installActivities(page); void state;
    await page.unroute(/\/api\/v1\/(?:showcase\/)?activities(?:\?|\/|$)/);
    const many = await installActivities(page);
    many.records = Array.from({ length: 25 }, (_, i) => record(100 + i, `2026-${i < 12 ? '10' : '09'}-${String(28 - (i % 12)).padStart(2, '0')}`, `长列表 ${i + 1}`, '5000'));
    await page.goto('/activities');
    await expect(page.locator('.timeline .month').last().getByTestId('month-total')).toHaveText(/^本页 /);
    await expect(page.locator('.timeline .month').first().getByTestId('month-total')).not.toHaveText(/^本页 /);
  });

  test('the first record is chosen, the address stays clean, and the preview shows its details', async ({ page }) => {
    await page.goto('/activities');
    const preview = page.getByTestId('activity-preview');
    await expect(preview).toContainText('十月三');
    await expect(page).toHaveURL(/\/activities$/);
    await expect(page.locator('.card-link[aria-current="true"]')).toHaveCount(1);
    await expect(preview.getByRole('link', { name: '查看完整详情 →' })).toHaveAttribute('href', `/activities/${months[0].id}`);
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: '九月二', exact: true }) }).click();
    await expect(preview).toContainText('九月二');
    await expect(page).toHaveURL(/\/activities$/);
    await expect(page.locator('.card-link[aria-current="true"]')).toHaveCount(1);
    await expect(preview.getByText(/^12(\.0)? km$/).first()).toBeVisible();
  });

  test('the preview card starts level with the first record, below the month heading', async ({ page }) => {
    await page.goto('/activities');
    await expect(page.getByTestId('activity-preview')).toContainText('十月三');
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; };
      return { pill: box('.timeline .month-pill'), first: box('.timeline .activity-card'), card: box('.preview') };
    });
    expect(boxes.card.top, 'the preview card and the first record share a top edge').toBeCloseTo(boxes.first.top, 0);
    expect(boxes.pill.bottom, 'the month heading sits above both').toBeLessThanOrEqual(boxes.first.top);
  });

  test('arrow keys move the choice between records', async ({ page }) => {
    await page.goto('/activities');
    await expect(page.getByTestId('activity-preview')).toContainText('十月三');
    await page.locator(`.card-link[data-activity-id="${months[0].id}"]`).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('activity-preview')).toContainText('十月二');
    await expect(page.locator(`.card-link[data-activity-id="${months[1].id}"]`)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('activity-preview')).toContainText('十月三');
  });

  test('a modified click still opens the record page', async ({ page }) => {
    await page.goto('/activities');
    const link = page.locator(`.card-link[data-activity-id="${months[1].id}"]`);
    await expect(link).toHaveAttribute('href', `/activities/${months[1].id}`);
    await link.click({ modifiers: ['ControlOrMeta'] }).catch(() => undefined); // opens a new tab; the list keeps its choice
    await expect(page.getByTestId('activity-preview')).toContainText('十月三');
  });

  test('a narrow screen has the timeline only; tapping a record opens its page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/activities');
    await expect(page.locator('.timeline .month').first()).toBeVisible();
    await expect(page.getByTestId('activity-preview')).toHaveCount(0);
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: '十月二', exact: true }) }).click();
    await expect(page).toHaveURL(new RegExp(`/activities/${months[1].id}$`));
    await expect(page.getByRole('heading', { name: '十月二', level: 1 })).toBeVisible();
  });

  test('the preview reads its route on demand and a failure only affects the preview', async ({ page }) => {
    let calls = 0;
    await page.route(`**/api/v1/showcase/activities/${months[0].id}/route`, async route => { calls++; if (calls === 1) await route.fulfill({ status: 503, json: { error: { message: '暂时不可用' } } }); else await route.fallback(); });
    await page.goto('/activities');
    const preview = page.getByTestId('activity-preview');
    await expect(preview.getByRole('button', { name: '重新读取路线' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '十月二', level: 3 })).toBeVisible(); // the list is untouched
    await preview.getByRole('button', { name: '重新读取路线' }).click();
    await expect(preview.getByTestId('route-map-ready')).toBeVisible({ timeout: 15_000 });
  });

  test('the preview edits and deletes through the list dialogs', async ({ page }) => {
    await page.goto('/activities');
    const preview = page.getByTestId('activity-preview');
    await expect(preview).toContainText('十月三');
    await preview.getByRole('button', { name: '编辑记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '编辑跑步记录' })).toBeVisible();
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    await preview.getByRole('button', { name: '删除记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '删除 1 条跑步记录？' })).toBeVisible();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByRole('heading', { name: '十月三', level: 3 })).toHaveCount(0);
    await expect(preview).toContainText('十月二'); // the choice moves on to the first record left
  });

  test('batch selection, edit and delete stay in the list', async ({ page }) => {
    await page.goto('/activities');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('checkbox', { name: '选择 十月二' }).check();
    await expect(page.getByText('已选 1 条')).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑 十月二', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '删除 十月二', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});

test.describe('the import area is folded', () => {
  test('it starts closed when there are records, opens on demand and keeps a chosen file when closed again', async ({ page }) => {
    await installActivities(page); await loginRunner(page); await page.goto('/activities');
    const toggle = page.getByRole('button', { name: '导入轨迹', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('heading', { name: '导入 GPX / TCX' })).toBeHidden();
    await openImport(page);
    await expect(page.getByRole('heading', { name: '导入 GPX / TCX' })).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'morning.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx version="1.1" creator="synthetic"></gpx>') });
    await toggle.click();
    await expect(page.getByRole('heading', { name: '导入 GPX / TCX' })).toBeHidden();
    await toggle.click();
    await expect(page.getByText('morning.gpx')).toBeVisible();
  });
  test('opening and closing slides by height instead of popping, and the arrow turns', async ({ page }) => {
    await installActivities(page); await loginRunner(page); await page.goto('/activities');
    const toggle = page.getByRole('button', { name: '导入轨迹', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.app-sidebar .goal-container:not([hidden])').waitFor({ state: 'attached' }); // hydrated: an earlier click is not handled
    const sample = (duration: number) => page.evaluate(ms => new Promise<{ heights: number[]; turn: string }>(resolve => {
      const region = document.getElementById('import-region')!, chevron = document.querySelector('.import-chevron')!;
      const heights: number[] = [], t0 = performance.now();
      const tick = () => { heights.push(region.getBoundingClientRect().height); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve({ heights, turn: getComputedStyle(chevron).transform }); };
      requestAnimationFrame(tick);
    }), duration);
    const opening = sample(800);
    await toggle.click();
    const opened = await opening;
    const full = Math.max(...opened.heights);
    expect(full, 'the area opens to its full height').toBeGreaterThan(150);
    expect(opened.heights.filter(height => height > 4 && height < full - 4).length, 'and is seen growing for several frames').toBeGreaterThanOrEqual(5);
    expect(opened.turn, 'the arrow has turned').not.toBe('none');
    const closing = sample(800);
    await toggle.click();
    const closed = await closing;
    expect(closed.heights.filter(height => height > 4 && height < full - 4).length, 'closing slides too').toBeGreaterThanOrEqual(5);
    expect(closed.heights.at(-1)).toBeLessThan(4);
    await expect(page.getByRole('heading', { name: '导入 GPX / TCX' })).toBeHidden();
  });
  test('an empty library opens it by itself', async ({ page }) => {
    const state = await installActivities(page); state.records = []; await loginRunner(page); await page.goto('/activities');
    await expect(page.getByRole('button', { name: '导入轨迹', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: '导入 GPX / TCX' })).toBeVisible();
  });
});

test('活动列表路线缩略图保留默认主题颜色', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities');
  const path = page.locator('.activity-card svg path').first();
  await expect(path).toBeAttached();
  const primary = await path.evaluate(el => getComputedStyle(el.closest('.route-thumbnail')!).color);
  await expect(path).toHaveCSS('stroke', primary);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.dispatchEvent(new Event('runnote-theme-change')); });
  const darkPrimary = await path.evaluate(el => getComputedStyle(el.closest('.route-thumbnail')!).color);
  await expect(path).toHaveCSS('stroke', darkPrimary);
});
