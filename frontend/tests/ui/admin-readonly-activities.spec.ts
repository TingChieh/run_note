import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

for (const width of [1440, 390]) {
  test(`管理员只读查看其他用户记录 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await loginRunner(page);
    const username = `readonly_${width}`;
    const created = await page.request.post('/api/v1/admin/users', {
      headers: { Origin: 'http://127.0.0.1:5191', 'X-CSRF-Token': 'ui-csrf' },
      data: {
        email: `${username}@example.com`,
        username,
        display_name: `合成用户 ${width}`,
        timezone: 'UTC',
        password: 'Synthetic-only-password',
        is_active: true,
        showcase_enabled: false,
      },
    });
    expect(created.status()).toBe(201);
    const user = (await created.json()).data;
    await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
    await page.goto('/admin/users');
    await page.getByRole('link', { name: `查看记录 合成用户 ${width}` }).click();
    await expect(page.getByText(`正在查看 合成用户 ${width} 的记录（只读）`)).toBeVisible();
    await expect(page.getByText('合成河畔晨跑')).toBeVisible();
    for (const name of ['导入轨迹', '编辑', '删除', '分享', '生成分享图'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: '合成河畔晨跑' }).click();
    await expect(page.getByText(`正在查看 合成用户 ${width} 的记录（只读）`)).toBeVisible();
    await expect(page.getByText('合成备注')).toBeVisible();
    await expect(page.getByLabel('运动指标')).toContainText('120 kcal');
    await expect(page.getByLabel('运动指标')).toContainText('1800 步');
    await expect(page.getByLabel('运动指标')).toContainText('08:00:00');
    await page.getByText('数据质量与指标说明').click();
    await expect(page.getByText('有效轨迹点')).toBeVisible();
    await page.getByText('心率数据表').click();
    await expect(page.getByRole('table', { name: '本次活动心率（bpm）' })).toContainText('148');
    await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
    for (const name of ['编辑', '删除', '分享', '生成分享图'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await page.goto('/workspace/activities/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await expect(page).toHaveURL(
      new RegExp(`/admin/users/${user.id}/activities/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$`),
    );
    await expect(page.getByText('合成备注')).toBeVisible();
    await page.route(`**/api/v1/admin/users/${user.id}/activities?*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
      body.data = {
        items:
          offset === 0
            ? Array.from({ length: 20 }, (_, index) => ({
                ...body.data.items[0],
                id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
              }))
            : [],
        total: 21,
        limit: 20,
        offset,
      };
      await route.fulfill({ json: body });
    });
    await page.goto(`/admin/users/${user.id}/activities`);
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page.getByText('本页没有运动记录')).toBeVisible();
    await expect(page.getByRole('button', { name: '上一页' })).toBeEnabled();
  });
}

test('普通用户不能访问管理员只读页或通过本人详情跳转', async ({ page }) => {
  await loginRunner(page);
  const email = 'readonly_ordinary@example.com';
  const password = 'Synthetic-only-password';
  const created = await page.request.post('/api/v1/admin/users', {
    headers: { Origin: 'http://127.0.0.1:5191', 'X-CSRF-Token': 'ui-csrf' },
    data: {
      email,
      username: 'readonly_ordinary',
      display_name: '普通用户',
      timezone: 'UTC',
      password,
      is_active: true,
      showcase_enabled: false,
    },
  });
  const user = (await created.json()).data;
  const logged = await page.request.post('/api/v1/auth/login', { data: { email, password } });
  expect(logged.status()).toBe(200);
  expect((await page.goto(`/admin/users/${user.id}/activities`))?.status()).toBe(403);
  expect((await page.goto('/workspace/activities/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))?.status()).toBe(404);
});
