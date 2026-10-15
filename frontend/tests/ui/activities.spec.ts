import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity, incompleteActivity } from '../fixtures/activities';
const file = { name: 'morning.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx version="1.1" creator="synthetic"></gpx>') };
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function capture(page: Page, path: string) {
  await page.evaluate(async () => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  await page.screenshot({ path, fullPage: false });
}

test('scan-friendly records expose pace and visibility, with compact optional upload fields', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities');
  await expect(page.getByRole('heading', { name: '河畔晨跑' })).toBeVisible();
  const record = page.getByRole('link').filter({ has: page.getByRole('heading', { name: '河畔晨跑' }) });
  await expect(record).toContainText('配速'); await expect(record).toContainText('私人');
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
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities');
  await page.getByText('补充导入信息', { exact: true }).click();
  await page.getByLabel('标题（可选）').fill('晨跑输入'); await page.getByLabel('时区（可选）').fill('Asia/Shanghai'); await page.getByLabel('补录日期（可选）').fill('2026-10-12');
  await page.locator('input[type=file]').setInputFiles(file); state.uploadMode = 'error';
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('上传暂时失败');
  await expect(page.getByLabel('标题（可选）')).toHaveValue('晨跑输入');
  expect(await page.locator('input[type=file]').evaluate((el: HTMLInputElement) => el.files?.length)).toBe(1);
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
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities');
  await page.locator('input[type=file]').setInputFiles({ ...file, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('不能超过 10 MiB'); expect(state.uploadCount).toBe(0);
  await page.locator('input[type=file]').setInputFiles(file); state.uploadMode = 'duplicate';
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已经导入');
  await expect(page.getByRole('link', { name: '查看已有活动' })).toHaveAttribute('href', `/activities/${sampleActivity.id}`);
});
test('list error retry, empty guidance and pagination remain usable', async ({ page }) => {
  const state = await installActivities(page); state.listFailures = 1; await loginRunner(page); await page.goto('/activities');
  await expect(page.getByRole('alert')).toContainText('暂时无法读取');
  await page.getByRole('button', { name: '重新读取活动' }).click(); await expect(page.getByRole('heading', { name: '河畔晨跑' })).toBeVisible();
  state.records = Array.from({ length: 22 }, (_, i) => ({ ...incompleteActivity, id: `${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`, title: `第 ${i + 1} 条跑步` }));
  await page.reload(); await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByRole('heading', { name: '第 21 条跑步' })).toBeVisible(); await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled();
  await page.getByRole('button', { name: '上一页' }).click(); await expect(page.getByRole('heading', { name: '第 1 条跑步', exact: true })).toBeVisible();
  state.records = []; await page.reload(); await expect(page.getByRole('region', { name: /^我的活动/ }).getByRole('status')).toContainText('还没有活动'); await noOverflow(page);
});
test('detail puts route before sharing and keeps quality available through keyboard disclosure', async ({ page }) => {
  await installActivities(page); await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
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
test('detail retry and sharing operations preserve existing API payloads and private restriction', async ({ page }) => {
  const state = await installActivities(page); state.detailFailures = 1; await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('alert')).toContainText('暂时无法读取'); await page.getByRole('button', { name: '重新读取活动详情' }).click();
  await expect(page.getByRole('heading', { name: '河畔晨跑', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建分享链接' })).toBeDisabled();
  await page.getByLabel('记录可见性').selectOption('unlisted'); await page.getByRole('button', { name: '保存可见性' }).click();
  await expect(page.getByRole('status').filter({ hasText: '可见性已保存' })).toBeVisible();
  await page.getByLabel('链接有效期').selectOption('forever'); await page.getByRole('button', { name: '创建分享链接' }).click();
  await expect(page.getByLabel('新分享链接')).toHaveValue(/synthetic-token/);
  expect(state.writes[0].data).toEqual({ visibility: 'unlisted' }); expect(state.writes[1].data).toEqual({ expires_at: null });
  await page.getByRole('button', { name: '撤销链接' }).click(); await expect(page.getByRole('status').filter({ hasText: '分享已撤销' })).toBeVisible();
  await page.getByLabel('记录可见性').selectOption('private'); await page.getByRole('button', { name: '保存可见性' }).click();
  await expect(page.getByRole('button', { name: '创建分享链接' })).toBeDisabled(); await expect(page.getByRole('status').filter({ hasText: '已设为私人' })).toBeVisible();
});

test('successful import followed by list outage reports separate outcomes and retries only the list', async ({ page }) => {
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities');
  await expect(page.getByRole('heading', { name: '河畔晨跑' })).toBeVisible();
  state.listFailures = 1; await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导入成功' })).toBeVisible();
  await expect(page.getByRole('region', { name: '我的活动', exact: true }).getByRole('alert')).toContainText('暂时无法读取');
  await expect(page.getByRole('region', { name: '导入 GPX / TCX', exact: true }).getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '重新读取活动' }).click(); await expect(page.getByRole('heading', { name: '新导入的跑步', level: 3 })).toBeVisible();
  expect(state.uploadCount).toBe(1);
});
test('sharing errors keep private restriction until save succeeds; copy and route retry remain usable', async ({ page, context }) => {
  await installActivities(page); await loginRunner(page);
  let patchFailed = false, routeFailed = false;
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, async route => {
    if (route.request().method() === 'PATCH' && !patchFailed) { patchFailed = true; return route.fulfill({ status: 503, json: { error: { message: '保存失败，请重试' } } }); }
    await route.fallback();
  });
  await page.route(`**/api/v1/activities/${sampleActivity.id}/route`, async route => {
    if (!routeFailed) { routeFailed = true; return route.fulfill({ status: 503, json: { error: { message: '路线读取失败' } } }); }
    await route.fallback();
  });
  await page.goto(`/activities/${sampleActivity.id}`); await expect(page.getByRole('alert')).toContainText('路线读取失败');
  await page.getByRole('button', { name: '重新读取路线' }).click(); await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
  await page.getByLabel('记录可见性').selectOption('unlisted'); await page.getByRole('button', { name: '保存可见性' }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败'); await expect(page.getByRole('button', { name: '创建分享链接' })).toBeDisabled();
  await page.getByRole('button', { name: '保存可见性' }).click(); await expect(page.getByRole('button', { name: '创建分享链接' })).toBeEnabled();
  await page.getByRole('button', { name: '创建分享链接' }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制分享链接' }).click();
  await expect(page.getByRole('status').filter({ hasText: '链接已复制' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('/shared/synthetic-token');
});
test('expired activity response redirects without retaining private content', async ({ page }) => {
  await installActivities(page); await loginRunner(page);
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, route => route.fulfill({ status: 401, json: { error: { message: '登录已过期' } } }));
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
  await expect(page.getByRole('heading', { name: '河畔晨跑' })).toHaveCount(0);
});

test('file picker focus and successful session checks preserve selected GPX and upload form', async ({ page }) => {
  const state = await installActivities(page); await loginRunner(page); await page.goto('/activities');
  await expect(page.getByRole('heading',{name:'河畔晨跑'})).toBeVisible();
  await page.getByText('补充导入信息',{exact:true}).click();
  await page.getByLabel('标题（可选）').fill('保留选中文件');
  await page.locator('input[type=file]').setInputFiles(file);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/v1/auth/session', async route => { entered(); await held; await route.fallback(); });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  await expect(page.getByRole('heading',{name:'跑步记录',exact:true})).toBeHidden();
  release(); await expect(page.getByRole('heading',{name:'跑步记录',exact:true})).toBeVisible();
  expect(await page.locator('input[type=file]').evaluate((el: HTMLInputElement) => el.files?.[0]?.name)).toBe('morning.gpx');
  await expect(page.getByLabel('标题（可选）')).toHaveValue('保留选中文件');
  await page.getByRole('button',{name:'导入 GPX',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'导入成功。'})).toBeVisible();
  expect(state.uploadCount).toBe(1);
});
