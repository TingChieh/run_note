import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

test('list quickly edits private name/category/tags with draft retry and keeps import draft', async ({ page }) => {
  const state = await installActivities(page);
  let failures = 1;
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, async route => {
    if (route.request().method() === 'PATCH' && failures-- > 0) return route.fulfill({ status: 503, json: { error: { message: '保存暂时失败，请重试' } } });
    return route.fallback();
  });
  await loginRunner(page); await page.goto('/activities');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByText('补充导入信息', { exact: true }).click();
  await page.getByLabel('标题（可选）', { exact: true }).fill('保留的导入草稿');
  const edit = page.getByRole('button', { name: `编辑 ${sampleActivity.title}`, exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: '编辑跑步记录', exact: true });
  await expect(dialog.getByLabel('标题', { exact: true })).toBeFocused();
  await dialog.getByLabel('标题', { exact: true }).fill('我的五公里');
  await dialog.getByLabel('分类', { exact: true }).fill('轻松跑');
  await dialog.getByLabel('标签', { exact: true }).fill('清晨， 公园,清晨');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('保存暂时失败');
  await expect(dialog.getByLabel('标签', { exact: true })).toHaveValue('清晨， 公园,清晨');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const card = page.locator('.activity-card').filter({ has: page.getByRole('heading', { name: '我的五公里', exact: true }) });
  await expect(card).toContainText('轻松跑'); await expect(card).toContainText('#清晨'); await expect(card).toContainText('#公园');
  await expect(page.getByRole('button', { name: '编辑 我的五公里', exact: true })).toBeFocused();
  await expect(page.getByLabel('标题（可选）', { exact: true })).toHaveValue('保留的导入草稿');
  expect(state.records[0].tags).toEqual(['清晨', '公园']);
  await page.reload(); await expect(page.getByRole('heading', { name: '我的五公里', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '编辑 我的五公里', exact: true }).click();
  await page.getByRole('dialog').getByLabel('标题', { exact: true }).fill('未保存');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '我的五公里', exact: true })).toBeVisible();
});

test('batch delete confirms count, cancels, preserves selection on failure and retries once', async ({ page }) => {
  const state = await installActivities(page);
  let calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/activities/batch-delete', async route => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, json: { error: { message: '删除暂时失败，请重试' } } });
    await held; return route.fallback();
  });
  await loginRunner(page); await page.goto('/activities');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('checkbox', { name: '全选本页', exact: true }).check();
  await expect(page.getByText('已选 2 条', { exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: '删除所选', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '删除 2 条跑步记录？', exact: true });
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); expect(calls).toBe(0);
  await expect(trigger).toBeFocused();
  await trigger.click(); await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('删除暂时失败');
  await expect(page.getByText('已选 2 条', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '删除中…' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  release(); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '我的活动（0）', exact: true })).toBeVisible();
  expect(calls).toBe(2); expect(state.records).toHaveLength(0);
});

test('selection is page scoped and deletion clamps the final page without replaying after list failure', async ({ page }) => {
  const state = await installActivities(page);
  state.records = Array.from({ length: 21 }, (_, i) => ({ ...sampleActivity, id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, title: `跑步 ${i + 1}` }));
  await loginRunner(page); await page.goto('/activities');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 跑步 1', exact: true }).check();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('已选 0 条', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除 跑步 21', exact: true }).click();
  state.listFailures = 1;
  await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新读取活动', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重新读取活动', exact: true }).click();
  await expect(page.getByText('第 1 页 / 1 页', { exact: true })).toBeVisible();
  expect(state.writes.filter(w => w.path.endsWith('/batch-delete'))).toHaveLength(1);
  await expect(page.getByRole('heading', { name: '跑步 21', exact: true })).toHaveCount(0);
});

test('mobile quick editor fits and validates metadata before saving', async ({ page }) => {
  const state = await installActivities(page);
  await loginRunner(page); await page.goto('/activities');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: `编辑 ${sampleActivity.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await dialog.getByLabel('标签', { exact: true }).fill(Array.from({ length: 11 }, (_, i) => `标签${i}`).join(','));
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('最多 10 个');
  expect(state.writes).toHaveLength(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await dialog.screenshot({ path: '.cache/activity-library/editor-mobile-dark.png', animations: 'disabled' });
});


test('editing only a title preserves existing tags containing punctuation', async ({ page }) => {
  const state = await installActivities(page);
  state.records[0].tags = ['比赛、训练', 'park,track'];
  await loginRunner(page); await page.goto('/activities');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: `编辑 ${sampleActivity.title}`, exact: true }).click();
  await page.getByRole('dialog').getByLabel('标题', { exact: true }).fill('只改名称');
  await page.getByRole('dialog').getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(state.records[0].tags).toEqual(['比赛、训练', 'park,track']);
});


test('selection and record controls appear only in edit mode; finishing clears selection', async ({ page }) => {
  const state = await installActivities(page);
  await loginRunner(page); await page.goto('/activities');
  await expect(page.getByRole('heading', { name: sampleActivity.title, exact: true })).toBeVisible();
  await expect(page.locator('.activity-card input, .activity-card button')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '全选本页', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除所选', exact: true })).toHaveCount(0);
  const toggle = page.getByRole('button', { name: '编辑', exact: true });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '完成', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('checkbox', { name: `选择 ${sampleActivity.title}`, exact: true }).check();
  await expect(page.getByText('已选 1 条', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.activity-card input, .activity-card button')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `选择 ${sampleActivity.title}`, exact: true })).not.toBeChecked();
  await expect(page.getByText('已选 0 条', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await expect(page.locator('.activity-card input, .activity-card button')).toHaveCount(0);
});
