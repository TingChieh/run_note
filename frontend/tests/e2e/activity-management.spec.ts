import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const tcx = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap><TotalTimeSeconds>300</TotalTimeSeconds><DistanceMeters>500</DistanceMeters><Track><Trackpoint><Time>2026-10-04T00:00:00Z</Time><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>0</LongitudeDegrees></Position></Trackpoint><Trackpoint><Time>2026-10-04T00:05:00Z</Time><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>0.001</LongitudeDegrees></Position></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>`;

for (const format of ['gpx', 'tcx'] as const) {
  test(`real ${format.toUpperCase()} record can be edited, reloaded and deleted through same-origin proxy`, async ({ page, context }) => {
    await page.route('**/*tile.openstreetmap.org/**', route => route.abort());
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const id = randomUUID().replaceAll('-', '').slice(0, 18);
    await page.goto('/register');
    await page.getByLabel('邮箱', { exact: true }).fill(`${id}@example.com`);
    await page.getByLabel('用户名', { exact: true }).fill(`u_${id}`);
    await page.getByLabel('密码', { exact: true }).fill('Synthetic-management-e2e-2026');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/activities');
    await expect(page.getByRole('button', { name: '导入 GPX', exact: true })).toBeEnabled();
    await page.locator('input[type=file][name=file]').setInputFiles({ name: `synthetic.${format}`, mimeType: 'application/xml', buffer: format === 'gpx' ? readFileSync('../backend/tests/fixtures/gpx/equator-six.gpx') : Buffer.from(tcx) });
    await page.getByRole('button', { name: `导入 ${format.toUpperCase()}`, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '导入成功' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('link', { name: '查看活动与路线', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑记录', exact: true })).toBeVisible();
    const path = new URL(page.url()).pathname;
    await page.getByRole('button', { name: '编辑记录', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill('真实接口修改标题');
    await page.getByLabel('备注', { exact: true }).fill('备注仅本人可见');
    await page.screenshot({ path: `.cache/activity-management/${format}-desktop-edit.png`, fullPage: true });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('真实接口修改标题');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('真实接口修改标题');
    await expect(page.getByText('备注仅本人可见', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '删除记录', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click();
    await expect(page).toHaveURL(/\/activities$/);
    await expect(page.getByRole('status').filter({ hasText: '还没有活动' })).toBeVisible();
    expect((await context.request.get('/api/v1' + path)).status()).toBe(404);
    expect((await (await context.request.get('/api/v1/statistics/summary')).json()).data.activity_count).toBe(0);
    expect(errors).toEqual([]);
  });
}
