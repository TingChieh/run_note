import { expect, test } from './support/fixtures';

test('the real stack is wired: health through the proxy, closed registration, public home', async ({
  page,
  request,
  baseURL,
}) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect((await health.json()).data).toMatchObject({ status: 'ok', database: 'connected', schema: 'current' });

  for (const path of ['/login', '/register']) expect((await request.get(path)).status()).toBe(404);
  const register = await request.post('/api/v1/auth/register', {
    headers: { Origin: baseURL! },
    data: { email: 'nobody@example.com', username: 'nobody', password: 'Synthetic-password-2026' },
  });
  expect(register.status()).toBe(403);
  expect((await register.json()).error.code).toBe('REGISTRATION_DISABLED');

  // Anonymous visitors see the site owner's showcase; the owner has no records yet in a fresh run.
  await page.goto('/');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  await expect(page.getByRole('link', { name: '站点管理' })).toHaveCount(0);
});
