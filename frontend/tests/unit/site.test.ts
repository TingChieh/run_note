import { describe, expect, it, vi } from 'vitest';
import { SITE_DEFAULTS, brandInitial, pageTitle } from '../../src/lib/site.ts';
import { parseSite, safeImagePath, updateSite, uploadAvatar, uploadSiteImage } from '../../src/lib/api/site.ts';

const site = { ...SITE_DEFAULTS, title: '晨跑站', logo_url: '/api/v1/site/images/logo?v=0123456789abcdef' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, error: null }), { status });

describe('site contract', () => {
  it('formats titles and brand initials with defaults', () => {
    expect(pageTitle('数据汇总', site)).toBe('数据汇总 · 晨跑站');
    expect(pageTitle('数据汇总', null)).toBe('数据汇总 · RunNote');
    expect(brandInitial('晨跑站')).toBe('晨');
    expect(brandInitial('  ')).toBe('R');
  });
  it('accepts only same-origin fixed image paths', () => {
    expect(safeImagePath('/api/v1/site/images/favicon?v=0123456789abcdef')).toBe('/api/v1/site/images/favicon?v=0123456789abcdef');
    expect(safeImagePath('/api/v1/me/avatar?v=0123456789abcdef')).not.toBeNull();
    expect(safeImagePath('/api/v1/showcase/users/runner_2/avatar?v=0123456789abcdef')).not.toBeNull();
    for (const bad of ['https://evil.example/x.png', '//evil.example/a', '/api/v1/site/images/logo', 'javascript:alert(1)', '/api/v1/site/images/logo?v=0123456789abcdef&x=1', 5]) expect(safeImagePath(bad)).toBeNull();
  });
  it('rebuilds a whitelisted site object and rejects invalid fields', () => {
    expect(parseSite({ ...site, extra: 'drop' })).toEqual(site);
    for (const bad of [{ ...site, title: '' }, { ...site, title: 'x'.repeat(41) }, { ...site, default_theme: 'blue' }, { ...site, logo_url: 'https://evil.example/a.png' }, { ...site, description: 3 }])
      expect(() => parseSite(bad)).toThrow('站点设置服务返回了无效响应');
  });
  it('writes with fresh CSRF and multipart uploads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ csrf_token: 'a' })).mockResolvedValueOnce(response(site))
      .mockResolvedValueOnce(response({ csrf_token: 'b' })).mockResolvedValueOnce(response(site))
      .mockResolvedValueOnce(response({ csrf_token: 'c' })).mockResolvedValueOnce(response({ avatar_url: '/api/v1/me/avatar?v=0123456789abcdef' }));
    await updateSite({ title: '晨跑站' }, fetcher);
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/site');
    expect(fetcher.mock.calls[1][1].method).toBe('PATCH');
    expect(fetcher.mock.calls[1][1].headers['X-CSRF-Token']).toBe('a');
    const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' });
    await uploadSiteImage('logo', file, fetcher);
    expect(fetcher.mock.calls[3][0]).toBe('/api/v1/site/images/logo');
    expect(fetcher.mock.calls[3][1].method).toBe('PUT');
    expect(fetcher.mock.calls[3][1].body).toBeInstanceOf(FormData);
    expect(await uploadAvatar(file, fetcher)).toBe('/api/v1/me/avatar?v=0123456789abcdef');
  });
});
