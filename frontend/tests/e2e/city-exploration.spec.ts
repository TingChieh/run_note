import { csrfToken, expect, login, test } from './support/fixtures';

test('a member explores their imported run through the private footprint page', async ({ page, member, baseURL }) => {
  const root = '/workspace/footprints';
  await page.goto(`${root}/exploration`);
  await expect(page).toHaveURL(/\/admin\?next=/);
  await login(page, member, root);

  const track = `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="RunNote test">
    <trk><trkseg>
      <trkpt lat="31.23" lon="121.48"><time>2025-02-02T01:00:00Z</time></trkpt>
      <trkpt lat="31.23" lon="121.483"><time>2025-02-02T01:05:00Z</time></trkpt>
    </trkseg></trk>
  </gpx>`;
  const imported = await page.request.post('/api/v1/gpx-imports', {
    headers: { Origin: baseURL!, 'X-CSRF-Token': await csrfToken(page.request) },
    multipart: {
      timezone: 'UTC',
      file: { name: 'exploration-test.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(track) },
    },
  });
  expect(imported.status(), await imported.text()).toBe(201);
  await page.getByRole('link', { name: '城市探索', exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}${root}/exploration`);
  await expect(page.getByRole('link', { name: /上海市/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /上海市/ }).click();
  await expect(page.getByRole('heading', { name: '上海市' })).toBeVisible();
  const viewport = page.waitForResponse(
    (response) =>
      response.url().includes('/city/310000/cells?year=2025') &&
      Boolean(response.request().headers()['x-footprint-viewport']),
  );
  await page.getByLabel('年份').selectOption('2025');
  await expect(page.getByTestId('exploration-map')).toHaveAttribute('data-drawn', 'true');
  const response = await viewport;
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(new URL(response.url()).searchParams.has('bbox')).toBe(false);
  await expect(page.getByText('2025 年每月新增格网')).toBeVisible();
});
