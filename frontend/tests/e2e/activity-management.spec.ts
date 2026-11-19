import { expect, login, test } from './support/fixtures';
import { apiPath, equatorGpx, importTrack, syntheticTcx } from './support/tracks';

for (const format of ['gpx', 'tcx'] as const) {
  test(`a managed account imports, edits, reloads and deletes a ${format.toUpperCase()} record in its workspace`, async ({
    page,
    context,
    member,
  }) => {
    await login(page, member, '/workspace/activities');
    const path = await importTrack(page, format === 'gpx' ? equatorGpx() : syntheticTcx(300, 500));
    await page.goto(path);
    await expect(page.getByTestId('route-map-ready')).toBeVisible();

    await page.getByRole('button', { name: '编辑记录', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill('真实接口修改标题');
    await page.getByLabel('备注', { exact: true }).fill('备注仅本人可见');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('真实接口修改标题');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('真实接口修改标题');
    await expect(page.getByText('备注仅本人可见', { exact: true })).toBeVisible();
    const stored = (await (await context.request.get(apiPath(path))).json()).data;
    expect(stored).toMatchObject({ title: '真实接口修改标题', notes: '备注仅本人可见', visibility: 'private' });

    await page.getByRole('button', { name: '删除记录', exact: true }).click();
    await page.getByRole('dialog', { name: '删除这条跑步记录？' }).getByRole('button', { name: '确认删除' }).click();
    await expect(page).toHaveURL(/\/workspace\/activities(\?.*)?$/);
    await expect(page.getByText('暂无跑步记录。', { exact: true })).toBeVisible();
    expect((await context.request.get(apiPath(path))).status()).toBe(404);
    const summary = (await (await context.request.get('/api/v1/statistics/summary')).json()).data;
    expect(summary.activity_count).toBe(0);
  });
}
