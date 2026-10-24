import { expect, test } from '@playwright/test';

const missingId = '00000000-0000-4000-8000-000000000404';

test('server routes 404 missing resources, redirect the old home, and publish crawl rules', async ({ request }) => {
  const activity = await request.get('/activities/example', { maxRedirects: 0 });
  expect(activity.status()).toBe(404);
  expect(await activity.text()).toContain('找不到这条活动');

  const missing = await request.get(`/activities/${missingId}`, { maxRedirects: 0 });
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('找不到这条活动');

  for (const path of [`/public/activities/999999999`, `/public/activities/${missingId}`, '/shared/invalidtoken']) {
    const share = await request.get(path, { maxRedirects: 0 });
    const body = await share.text();
    expect(share.status(), path).toBe(404);
    expect(body, path).toContain('分享不存在或已停止');
    expect(body, path).not.toContain('重新读取分享');
  }

  for (const path of ['/u/runner', '/u/runner/activities']) {
    const profile = await request.get(path, { maxRedirects: 0 });
    expect(profile.status(), path).toBe(404);
    expect(await profile.text(), path).toContain('页面不存在');
  }

  const redirect = await request.get('/dashboard?year=2026&metric=count', { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  const location = new URL(redirect.headers().location ?? '', 'http://127.0.0.1');
  expect(location.pathname).toBe('/');
  expect(location.search).toBe('?year=2026&metric=count');
  const bare = await request.get('/dashboard', { maxRedirects: 0 });
  expect(bare.status()).toBe(308);
  expect(new URL(bare.headers().location ?? '', 'http://127.0.0.1').pathname).toBe('/');
  expect(new URL(bare.headers().location ?? '', 'http://127.0.0.1').search).toBe('');

  const robots = await request.get('/robots.txt', { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  const rules = await robots.text();
  for (const path of ['/admin', '/workspace', '/settings', '/api', '/shared', '/public']) {
    expect(rules).toContain(`Disallow: ${path}\n`);
  }
  expect(rules).not.toContain('Disallow: /\n');
  expect(rules).toContain('Sitemap: http://127.0.0.1:5191/sitemap.xml');

  const sitemap = await request.get('/sitemap.xml', { maxRedirects: 0 });
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('xml');
  const xml = await sitemap.text();
  for (const path of ['/', '/activities', '/activities/wall', '/footprints', '/ai']) {
    expect(xml).toContain(`<loc>http://127.0.0.1:5191${path}</loc>`);
  }
  for (const path of ['/admin', '/settings', '/shared', '/public', '/workspace']) expect(xml).not.toContain(path);
});
