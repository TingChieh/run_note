import { apiSession, expect, login, newContext, owner, test, write } from './support/fixtures';
import { apiPath, equatorGpx, importTrack } from './support/tracks';

test('owner GPX import draws the route with every third-party request refused; forged, token-less and cross-user writes are blocked', async ({
  page,
  context,
  browser,
  baseURL,
  member,
}) => {
  await login(page, owner, '/activities');
  const session = (await context.cookies()).find((cookie) => cookie.name === 'run_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');

  const path = await importTrack(page, equatorGpx());
  await page.goto(path);
  await expect(page.getByTestId('activity-distance')).toBeVisible();
  // The basemap provider is unreachable (fixtures refuse non-local hosts); the track still renders.
  await expect(page.getByTestId('route-map-ready')).toBeVisible();

  const file = {
    name: 'forged.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from('<gpx version="1.1"></gpx>'),
  };
  const token = (await (await context.request.get('/api/v1/auth/csrf')).json()).data.csrf_token;
  const forged = await context.request.post('/api/v1/gpx-imports', {
    headers: { Origin: 'https://attacker.invalid', 'X-CSRF-Token': token },
    multipart: { file },
  });
  expect(forged.status()).toBe(403);
  const tokenless = await context.request.post('/api/v1/gpx-imports', {
    headers: { Origin: baseURL! },
    multipart: { file },
  });
  expect(tokenless.status()).toBe(403);

  // Another account sees nothing and can change nothing (404, never 403).
  const other = await apiSession(baseURL!, member);
  expect((await other.get(apiPath(path))).status()).toBe(404);
  expect((await write(other, 'PATCH', apiPath(path), { visibility: 'public' })).status()).toBe(404);
  expect((await write(other, 'DELETE', apiPath(path))).status()).toBe(404);
  await other.dispose();

  // The site owner's showcase is public: an anonymous visitor reads it, without management controls.
  const visitor = await newContext(browser, baseURL);
  const anonymous = await visitor.newPage();
  await anonymous.goto(path);
  await expect(anonymous.getByTestId('activity-distance')).toBeVisible();
  await expect(anonymous.getByTestId('route-map-ready')).toBeVisible();
  await expect(anonymous.getByRole('button', { name: '编辑记录', exact: true })).toHaveCount(0);
  await visitor.close();

  const stored = (await (await context.request.get(apiPath(path))).json()).data;
  expect(stored.visibility).toBe('private');
});
