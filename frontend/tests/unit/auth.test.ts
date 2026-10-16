import { describe, expect, it } from 'vitest';
import { authWrite, readSession, safeNext, changePassword } from '../../src/lib/api/auth';

const envelope = (data: unknown) => Response.json({ data, error: null, meta: { request_id: 'test' } });
describe('authentication boundary', () => {
  it('obtains current CSRF with cookies before every write, never reuses identity tokens', async () => {
    let token = 0;
    const fetcher: typeof fetch = async (input, init) => {
      expect(init?.credentials).toBe('same-origin');
      expect(init?.cache).toBe('no-store');
      if (input === '/api/v1/auth/csrf') return envelope({ csrf_token: `csrf-${++token}` });
      expect(input).toBe('/api/v1/auth/login');
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(`csrf-${token}`);
      expect(new Headers(init?.headers).has('Origin')).toBe(false);
      expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@example.com', password: 'long-password' });
      return envelope({ user: { id: `user-${token}`, email: 'a@example.com', username: 'runner', display_name: '跑者', timezone: 'UTC', created_at: '2026-10-16T00:00:00Z', bio: '', profile_is_public: false, is_admin: false, showcase_enabled: false }, csrf_token: 'rotated' });
    };
    expect(await authWrite('login', { email: 'a@example.com', password: 'long-password' }, fetcher)).toMatchObject({ user: { id: 'user-1' } });
    expect(await authWrite('login', { email: 'a@example.com', password: 'long-password' }, fetcher)).toMatchObject({ user: { id: 'user-2' } });
  });
  it('fails closed on CSRF failure without resubmitting the write', async () => {
    let writes = 0;
    const fetcher: typeof fetch = async input => {
      if (input === '/api/v1/auth/csrf') return envelope({ csrf_token: 'fresh' });
      writes++;
      return Response.json({ data: null, error: { code: 'CSRF_FAILED', message: '请求来源或CSRF令牌不合法' } }, { status: 403 });
    };
    await expect(authWrite('logout', {}, fetcher)).rejects.toThrow('请求来源或CSRF令牌不合法');
    expect(writes).toBe(1);
  });
  it('treats expired credentials as anonymous but distinguishes a backend outage', async () => {
    await expect(readSession(async () => Response.json({ error: { code: 'AUTH_REQUIRED', message: '请先登录' } }, { status: 401 }))).resolves.toBeNull();
    await expect(readSession(async () => Response.json({ error: { code: 'AUTH_UNAVAILABLE', message: '认证配置未就绪' } }, { status: 503 }))).rejects.toThrow('认证配置未就绪');
  });
  it('reports rate-limit wait and invalid responses without returning a user', async () => {
    await expect(readSession(async () => new Response('gateway', { status: 502 }))).rejects.toThrow('无效响应');
    await expect(authWrite('login', {}, async () => Response.json({ error: { code: 'AUTH_RATE_LIMITED', message: '请求过于频繁' } }, { status: 429, headers: { 'Retry-After': '20' } }))).rejects.toThrow('20 秒');
  });
  it('rejects session identities without explicit permissions', async () => {
    await expect(readSession(async () => envelope({user: {id:'old-user'}}))).rejects.toThrow('身份无效');
  });
  it('only allows local paths after authentication', () => {
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext('/settings?tab=me')).toBe('/settings?tab=me');
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/login', '/register', '/api/v1/me', '/%2f%2fevil.example', '/settings\n']) expect(safeNext(value)).toBe('/dashboard');
  });
});

describe('own password change', () => { it('uses CSRF and rejects invalid confirmation', async () => { const calls: string[]=[]; await expect(changePassword('current-long-pass','new-long-password',async (input,init)=>{ calls.push(String(input)); if(String(input).endsWith('/csrf')) return envelope({csrf_token:'fresh'}); expect(init?.method).toBe('PATCH'); expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('fresh'); return envelope({password_changed:false}); })).rejects.toThrow(); expect(calls).toEqual(['/api/v1/auth/csrf','/api/v1/me/password']); }); });
