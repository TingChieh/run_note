import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, incompleteActivity, sampleActivity } from '../fixtures/activities';

type Plan = 'ok' | 'duplicate' | 'error' | 'hold';
const gpx = (name: string) => ({ name, mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx version="1.1" creator="synthetic"></gpx>') });
const tcx = (name: string) => ({ name, mimeType: 'application/xml', buffer: Buffer.from('<TrainingCenterDatabase></TrainingCenterDatabase>') });
async function noOverflow(page: Page) { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

// Registered after installActivities, so it wins over the default single-upload route.
async function batchApi(page: Page, plan: Record<string, Plan>) {
  const uploaded: string[] = [];
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/gpx-imports', async route => {
    const name = /filename="([^"]+)"/.exec(route.request().postData() ?? '')?.[1] ?? '';
    uploaded.push(name);
    const mode = plan[name] ?? 'ok';
    if (mode === 'hold') await hold;
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: '保存暂时失败，请稍后重试' } } });
    if (mode === 'duplicate') return route.fulfill({ status: 409, json: { error: { code: 'GPX_DUPLICATE', message: '此运动记录已经导入', details: [{ existing_activity_id: sampleActivity.id, duplicate_kind: 'raw' }] } } });
    const imported = { ...incompleteActivity, id: '44444444-4444-4444-8444-444444444444', title: name, visibility: 'private' as const };
    return route.fulfill({ json: { data: { activity: imported, warnings: ['TIME_INCOMPLETE'] }, error: null } });
  });
  return { uploaded, release };
}
async function openActivities(page: Page) {
  await page.goto('/activities');
  // The controls stay disabled until hydration finishes; selecting files earlier is silently lost.
  await expect(page.getByRole('button', { name: '导入 GPX', exact: true })).toBeEnabled();
}
async function open(page: Page) {
  await installActivities(page); await loginRunner(page);
}
const picker = (page: Page) => page.locator('input[type=file][name=file]');
const status = (page: Page) => page.getByTestId('import-batch').getByRole('status');

test('several files import in order, the list refreshes once and the summary counts them', async ({ page }) => {
  await open(page); const api = await batchApi(page, {}); await openActivities(page);
  await page.evaluate(() => { (window as unknown as { changed: number }).changed = 0; window.addEventListener('runnote-activities-changed', () => { (window as unknown as { changed: number }).changed++; }); });
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx'), gpx('c.gpx')]);
  await expect(page.getByText('已选择 3 个文件')).toBeVisible();
  await page.getByRole('button', { name: '导入 3 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('导入完成：成功 3 · 重复跳过 0 · 失败 0');
  expect(api.uploaded).toEqual(['a.gpx', 'b.gpx', 'c.gpx']);
  expect(await page.evaluate(() => (window as unknown as { changed: number }).changed)).toBe(1);
  await expect(page.getByText('3 个文件导入时有提示')).toBeVisible();
});

test('duplicates are skipped, failures are listed and retrying resends only the failed file', async ({ page }) => {
  await open(page); const plan: Record<string, Plan> = { 'b.gpx': 'duplicate', 'c.gpx': 'error' };
  const api = await batchApi(page, plan); await openActivities(page);
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx'), gpx('c.gpx')]);
  await page.getByRole('button', { name: '导入 3 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('成功 1 · 重复跳过 1 · 失败 1');
  const failures = page.getByRole('list', { name: '失败的文件' });
  await expect(failures).toContainText('c.gpx'); await expect(failures).toContainText('保存暂时失败');
  plan['c.gpx'] = 'ok';
  await page.getByRole('button', { name: '重试失败项', exact: true }).click();
  await expect(status(page)).toContainText('成功 2 · 重复跳过 1 · 失败 0');
  expect(api.uploaded).toEqual(['a.gpx', 'b.gpx', 'c.gpx', 'c.gpx']);
});

test('stopping keeps finished files and leaves the rest unprocessed', async ({ page }) => {
  await open(page); const api = await batchApi(page, { 'b.gpx': 'hold' }); await openActivities(page);
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx'), gpx('c.gpx')]);
  await page.getByRole('button', { name: '导入 3 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('正在导入第 2 / 3 个：b.gpx');
  await expect(page.getByRole('button', { name: '正在批量导入…' })).toBeDisabled();
  await page.getByRole('button', { name: '停止', exact: true }).click(); api.release();
  await expect(status(page)).toContainText('成功 2 · 重复跳过 0 · 失败 0 · 未处理 1');
  expect(api.uploaded).toEqual(['a.gpx', 'b.gpx']);
});

test('mixed formats are refused before anything is sent, and batch mode disables per-file fields', async ({ page }) => {
  await open(page); const api = await batchApi(page, {}); await openActivities(page);
  await picker(page).setInputFiles([gpx('a.gpx'), tcx('b.tcx')]);
  await expect(page.getByRole('alert')).toContainText('请分开导入同一种格式');
  await page.getByRole('button', { name: /^导入 2 个/ }).click();
  expect(api.uploaded).toEqual([]);
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx')]);
  await page.getByText('补充导入信息', { exact: true }).click();
  await expect(page.getByLabel('标题（可选）')).toBeDisabled();
  await expect(page.getByLabel('补录日期（可选）')).toBeDisabled();
  await expect(page.getByLabel('时区（可选）', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('文件格式', { exact: true })).toBeDisabled();
});

test('a single file keeps the existing flow and the summary fits a phone screen', async ({ page }) => {
  await open(page); const plan: Record<string, Plan> = { 'long-name-for-a-phone-layout-check-0001.gpx': 'error' };
  await batchApi(page, plan); await page.setViewportSize({ width: 390, height: 900 }); await openActivities(page);
  await picker(page).setInputFiles(gpx('single.gpx'));
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导入成功' })).toBeVisible();
  await expect(page.getByTestId('import-batch')).toHaveCount(0);
  await picker(page).setInputFiles([gpx('long-name-for-a-phone-layout-check-0001.gpx'), gpx('b.gpx')]);
  await page.getByRole('button', { name: '导入 2 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('失败 1'); await noOverflow(page);
});
