import { expect, test } from '@playwright/test';

test('anonymous home reaches the protected data summary through a server redirect', async ({ page, request }) => {
  const response = await request.get('/?year=2026', { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/dashboard?year=2026');
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByTestId('annual-distance')).toHaveCount(0);
});

test('health remains available through the frontend proxy', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect((await response.json()).data.status).toBe('ok');
});
