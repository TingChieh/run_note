import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

test('username change requires confirmation and refreshes the identity', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/settings');
  await page.getByLabel('新用户名').fill('runner_new');
  await page.getByRole('button', { name: '修改用户名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认修改用户名' });
  await expect(dialog).toContainText('旧的 /p/runner 链接将失效');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('@runner', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '修改用户名', exact: true }).click();
  await dialog.getByRole('button', { name: '确认修改' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('@runner_new', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/剩余约 30 天/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('@runner_new', { exact: true }).first()).toBeVisible();
});
