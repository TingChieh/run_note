import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

const dialog = (page: Page) => page.getByRole('dialog', { name: '生成分享图' });
const preview = (page: Page) => dialog(page).getByRole('img', { name: '单次跑步分享图预览' });
async function visit(page: Page, id = sampleActivity.id) {
  const state = await installActivities(page);
  await loginRunner(page); await page.goto(`/activities/${id}`);
  await expect(page.getByRole('heading', { name: sampleActivity.title, level: 1 })).toBeVisible();
  return state;
}
const open = async (page: Page) => { await page.getByRole('button', { name: '生成分享图', exact: true }).click(); await expect(preview(page)).toBeVisible(); };

test('renders four styles, saves a 1080x1920 PNG and restores focus on Escape', async ({ page }, info) => {
  await visit(page); await open(page);
  for (const name of ['路线大图', '运动海报', '跑步票根', '大字里程']) {
    await dialog(page).getByRole('radio', { name }).check(); await expect(preview(page)).toBeVisible();
    await dialog(page).screenshot({ path: info.outputPath(`dialog-${name}.png`) });
  }
  await expect(dialog(page)).toContainText('图片只包含统计数字');
  await dialog(page).getByRole('radio', { name: '路线大图' }).check();
  await expect(dialog(page)).toContainText('图片包含路线形状和起终点');
  const download = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: '保存 PNG', exact: true }).click();
  const path = info.outputPath('activity-poster.png'); await (await download).saveAs(path);
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.readUInt32BE(16)).toBe(1080); expect(bytes.readUInt32BE(20)).toBe(1920);
  await page.keyboard.press('Escape'); await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole('button', { name: '生成分享图', exact: true })).toBeFocused();
});

test('follows the fixed appearance and fits a phone', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page); await open(page);
  for (const name of ['日间', '夜间']) { await dialog(page).getByRole('radio', { name }).check(); await expect(preview(page)).toBeVisible(); await dialog(page).screenshot({ path: info.outputPath(`mobile-${name}.png`) }); }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('hides the button for records without a route', async ({ page }) => {
  const state = await installActivities(page); state.records[0] = { ...state.records[0], has_route: false };
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('heading', { name: sampleActivity.title, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成分享图', exact: true })).toHaveCount(0);
});

test('shows a retryable error when the record cannot be read', async ({ page }) => {
  const state = await visit(page); state.detailFailures = 1;
  await page.getByRole('button', { name: '生成分享图', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: '保存 PNG', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(preview(page)).toBeVisible();
});
