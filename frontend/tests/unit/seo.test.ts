import { describe, expect, it } from 'vitest';
import { pageDescription, pageNoindex, robotsTxt, sitemapXml } from '../../src/lib/seo';

describe('public metadata', () => {
  it('gives each public page its own description and keeps private pages out of the index', () => {
    expect(pageDescription('/', 200, 'fallback')).toContain('日历');
    expect(pageDescription('/activities', 200, 'fallback')).not.toBe(pageDescription('/', 200, 'fallback'));
    expect(pageDescription('/p/runner/activities/wall', 200, 'fallback')).toContain('足迹');
    expect(pageDescription('/nope', 404, 'fallback')).toContain('不存在');
    expect(pageNoindex('/admin', 200)).toBe(true);
    expect(pageNoindex('/workspace/activities', 200)).toBe(true);
    expect(pageNoindex('/activities', 404)).toBe(true);
    expect(pageNoindex('/activities', 200)).toBe(false);
  });
  it('publishes a robots file and a static sitemap', () => {
    const robots = robotsTxt('https://run.example');
    for (const path of ['/admin', '/workspace', '/settings', '/api', '/shared', '/public']) {
      expect(robots).toContain(`Disallow: ${path}\n`);
    }
    expect(robots).not.toContain('Disallow: /\n');
    expect(robots).toContain('Sitemap: https://run.example/sitemap.xml');
    const sitemap = sitemapXml('https://run.example');
    expect(sitemap).toContain('https://run.example/');
    expect(sitemap).toContain('https://run.example/activities/wall');
    for (const path of ['/admin', '/settings', '/shared', '/public', '/api']) expect(sitemap).not.toContain(path);
  });
});