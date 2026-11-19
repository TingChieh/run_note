import { expect, login, newContext, test } from './support/fixtures';
import { apiPath, equatorGpx, importTrack, syntheticTcx } from './support/tracks';

test('the library keeps labels across reloads, marks a 10 km run and batch-deletes both sources', async ({
  page,
  context,
  browser,
  baseURL,
  member,
}) => {
  await login(page, member, '/workspace/activities');
  await importTrack(page, equatorGpx());
  await expect(page.locator('.activity-card')).toHaveCount(1);
  const tenK = await importTrack(page, syntheticTcx(3000, 10000, 'library.tcx'));
  await expect(page.locator('.activity-card')).toHaveCount(2);

  const card = page.locator('.activity-card').filter({ hasText: '10 km 达成' });
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await card.getByRole('button', { name: /^编辑 / }).click();
  const dialog = page.getByRole('dialog', { name: '编辑跑步记录', exact: true });
  await dialog.getByLabel('标题', { exact: true }).fill('我的十公里');
  await dialog.getByLabel('分类', { exact: true }).fill('长距离');
  await dialog.getByLabel('标签', { exact: true }).fill('清晨，公园,清晨');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const updated = page.locator('.activity-card').filter({ hasText: '我的十公里' });
  await expect(updated.getByText('长距离', { exact: true })).toBeVisible();
  await expect(updated.getByText('#清晨', { exact: true })).toBeVisible();
  // Labels are normalised by the server: full-width comma split, duplicates dropped.
  const stored = (await (await context.request.get(apiPath(tenK))).json()).data;
  expect(stored).toMatchObject({ title: '我的十公里', category: '长距离', tags: ['清晨', '公园'] });

  const visitor = await newContext(browser, baseURL);
  expect((await visitor.request.get(apiPath(tenK))).status()).toBe(401);
  await visitor.close();

  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('checkbox', { name: '全选本页', exact: true }).check();
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除 2 条跑步记录？', exact: true })
    .getByRole('button', { name: '确认删除', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '我的活动（0）', exact: true })).toBeVisible();
  expect((await context.request.get(apiPath(tenK))).status()).toBe(404);
  expect((await (await context.request.get('/api/v1/statistics/summary')).json()).data.activity_count).toBe(0);
});
