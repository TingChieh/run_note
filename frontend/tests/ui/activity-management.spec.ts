import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

test('metadata edits preserve drafts on failure and update details/list after save and reload', async ({ page }) => {
  const state = await installActivities(page);
  let failures = 1;
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, async route => {
    if (route.request().method() === 'PATCH' && failures-- > 0) return route.fulfill({ status: 503, json: { error: { message: '保存暂时失败，请重试' } } });
    return route.fallback();
  });
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await expect(page.getByLabel('标题', { exact: true })).toBeFocused();
  await page.getByLabel('标题', { exact: true }).fill('周末晨跑');
  await page.getByLabel('备注', { exact: true }).fill('轻松跑\n<script>只是文字</script>');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('保存暂时失败');
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('周末晨跑');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('轻松跑\n<script>只是文字</script>');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('周末晨跑');
  await expect(page.getByText('轻松跑\n<script>只是文字</script>', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑记录', exact: true })).toBeFocused();
  expect(state.writes[0].data).toEqual({ title: '周末晨跑', notes: '轻松跑\n<script>只是文字</script>', category: '', tags: [] });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('周末晨跑');
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('未保存');
  await page.getByRole('button', { name: '取消编辑' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('周末晨跑');
  await page.getByRole('link', { name: '← 返回跑步记录' }).click();
  await expect(page.getByRole('heading', { name: '周末晨跑', exact: true })).toBeVisible();
});

test('delete requires confirmation, supports Escape and retry, and returns to the refreshed list', async ({ page }) => {
  const state = await installActivities(page);
  let deletes = 0;
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    expect(route.request().headers()['x-csrf-token']).toBe('ui-csrf');
    if (++deletes === 1) return route.fulfill({ status: 503, json: { error: { message: '删除暂时失败，请重试' } } });
    state.records = state.records.filter(a => a.id !== sampleActivity.id);
    return route.fulfill({ json: { data: { deleted: true }, error: null } });
  });
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  const trigger = page.getByRole('button', { name: '删除记录', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '删除这条跑步记录？' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); expect(deletes).toBe(0);
  await expect(trigger).toBeFocused();
  await trigger.click(); await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(dialog.getByRole('alert')).toContainText('删除暂时失败');
  await expect(page).toHaveURL(new RegExp(`/activities/${sampleActivity.id}$`));
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('heading', { name: sampleActivity.title, exact: true })).toHaveCount(0);
  expect(deletes).toBe(2);
});

test('mobile editor and deletion dialog fit narrow viewports; pending writes cannot be duplicated', async ({ page }) => {
  await installActivities(page);
  let release!: () => void, writes = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, async route => {
    if (route.request().method() === 'PATCH') { writes++; await held; }
    return route.fallback();
  });
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('窄屏跑步记录');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: '.cache/activity-management/mobile-edit.png', fullPage: true });
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '删除记录', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('窄屏跑步记录');
  expect(writes).toBe(1);
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.cache/activity-management/mobile-delete.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '.cache/activity-management/mobile-delete-dark.png', fullPage: true });
  await dialog.getByRole('button', { name: '取消' }).click();
});
