import { describe, expect, it, vi } from 'vitest';
import { VersionError, builtAtLabel, parseVersion, readVersion } from '../../src/lib/api/version.ts';

const build = { release_id: '20261119163755-2d1d6c553e57', git_sha: '2d1d6c553e57', built_at: '2026-11-19T16:37:55Z' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, error: null }), { status });

describe('version contract', () => {
  it('rebuilds a whitelisted version, with or without a build', () => {
    expect(parseVersion({ version: '1.0.0', build, extra: 'drop' })).toEqual({ version: '1.0.0', build });
    expect(parseVersion({ version: '1.0.0', build: { ...build, extra: 'drop' } })).toEqual({ version: '1.0.0', build });
    expect(parseVersion({ version: '1.0.0', build: null })).toEqual({ version: '1.0.0', build: null });
    expect(parseVersion({ version: '1.0.0', build: { ...build, git_sha: '2d1d6c553e57-dirty' } }).build?.git_sha).toBe(
      '2d1d6c553e57-dirty',
    );
  });
  it('rejects anything the backend does not send', () => {
    const bad = [
      null,
      [],
      { build: null },
      { version: 1, build: null },
      { version: '1.0', build: null },
      { version: 'v1.0.0', build: null },
      { version: '1.0.0' },
      { version: '1.0.0', build: 'x' },
      { version: '1.0.0', build: [] },
      { version: '1.0.0', build: { ...build, release_id: 'abc' } },
      { version: '1.0.0', build: { ...build, git_sha: '<script>' } },
      { version: '1.0.0', build: { ...build, built_at: 'yesterday' } },
      { version: '1.0.0', build: { git_sha: build.git_sha } },
    ];
    for (const value of bad) expect(() => parseVersion(value)).toThrow('版本信息服务返回了无效响应');
  });
  it('reads the admin endpoint and maps failures to VersionError', async () => {
    const ok = vi.fn().mockResolvedValue(response({ version: '1.0.0', build: null }));
    expect(await readVersion(ok)).toEqual({ version: '1.0.0', build: null });
    expect(ok).toHaveBeenCalledWith('/api/v1/admin/version', expect.objectContaining({ credentials: 'same-origin' }));
    const expired = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(readVersion(expired)).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
    await expect(readVersion(expired)).rejects.toBeInstanceOf(VersionError);
    const refused = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: null, error: { code: 'ADMIN_REQUIRED', message: '仅站主可管理账号' } }), {
        status: 403,
      }),
    );
    await expect(readVersion(refused)).rejects.toMatchObject({ status: 403, code: 'ADMIN_REQUIRED' });
  });
  it('shows the build time as UTC without local conversion', () => {
    expect(builtAtLabel('2026-11-19T16:37:55Z')).toBe('2026-11-19 16:37 UTC');
  });
});
