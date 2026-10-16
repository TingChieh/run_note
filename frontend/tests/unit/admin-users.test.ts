import { describe, expect, it, vi } from 'vitest';
import { readAdminUsers, createAdminUser, updateAdminUser, resetAdminUserPassword } from '../../src/lib/api/admin-users.ts';

const user = {
  id: '00000000-0000-4000-8000-000000000123', email: 'synthetic@example.com', username: 'synthetic',
  display_name: '合成跑者', timezone: 'Asia/Shanghai', bio: '', profile_is_public: false,
  created_at: '2026-10-16T00:00:00Z', is_admin: false, is_active: true, showcase_enabled: false,
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, error: null }), { status });

describe('admin user contracts', () => {
  it('validates a paginated account list and drops secret extras', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ items: [{ ...user, password_hash: 'must-drop' }], total: 1, limit: 20, offset: 0 }));
    const result = await readAdminUsers({ search: 'a+b@example.com', is_active: false }, fetcher);
    expect(result.items).toEqual([user]);
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/admin/users?limit=20&offset=0&search=a%2Bb%40example.com&is_active=false');
  });
  it('rejects malformed status and pagination instead of treating an account as enabled', async () => {
    for (const body of [
      { items: [{ ...user, is_admin: 'true' }], total: 1, limit: 20, offset: 0 },
      { items: [{ ...user, is_active: undefined }], total: 1, limit: 20, offset: 0 },
      { items: [user], total: -1, limit: 20, offset: 0 },
      { items: [user], total: 1, limit: 101, offset: 0 },
    ]) await expect(readAdminUsers({}, vi.fn().mockResolvedValue(response(body)))).rejects.toThrow('用户管理服务返回了无效响应');
  });
  it('gets fresh CSRF before create and never sends a client administrator role', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ csrf_token: 'synthetic-csrf' })).mockResolvedValueOnce(response(user, 201));
    const result = await createAdminUser({ email: user.email, username: user.username, password: 'Synthetic-only-password', display_name: user.display_name, timezone: user.timezone, is_active: true, showcase_enabled: false }, fetcher);
    expect(result).toEqual(user);
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/csrf');
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe('/api/v1/admin/users');
    expect(init.method).toBe('POST');
    expect(init.headers['X-CSRF-Token']).toBe('synthetic-csrf');
    expect(JSON.parse(init.body)).not.toHaveProperty('is_admin');
  });
  it('patches only supplied fields and verifies password-reset acknowledgement', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ csrf_token: 'first' }))
      .mockResolvedValueOnce(response({ ...user, is_active: false }))
      .mockResolvedValueOnce(response({ csrf_token: 'second' }))
      .mockResolvedValueOnce(response({ password_reset: true }));
    expect((await updateAdminUser(user.id, { is_active: false }, fetcher)).is_active).toBe(false);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ is_active: false });
    await resetAdminUserPassword(user.id, 'New-synthetic-password', fetcher);
    expect(fetcher.mock.calls[3][0]).toBe(`/api/v1/admin/users/${user.id}/reset-password`);
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual({ new_password: 'New-synthetic-password' });
    expect(fetcher.mock.calls[3][1].headers['X-CSRF-Token']).toBe('second');
    const malformed = vi.fn().mockResolvedValueOnce(response({ csrf_token: 'third' })).mockResolvedValueOnce(response({ password_reset: false }));
    await expect(resetAdminUserPassword(user.id, 'New-synthetic-password', malformed)).rejects.toThrow();
  });
  it('keeps authorization errors and rejects identifiers that could escape the resource path', async () => {
    const forbidden = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: '仅站主可管理用户', code: 'ADMIN_REQUIRED' } }), { status: 403 }));
    await expect(readAdminUsers({}, forbidden)).rejects.toMatchObject({ status: 403, code: 'ADMIN_REQUIRED' });
    const fetcher = vi.fn();
    await expect(updateAdminUser('../other', { is_active: false }, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
