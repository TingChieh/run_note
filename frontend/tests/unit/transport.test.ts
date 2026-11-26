import { describe, expect, it, vi } from 'vitest';
import type { CapacitorWindowRuntime } from '#lib/capacitor-env.ts';
import {
  assertSafeApiPath,
  compareSemver,
  getMobileSessionState,
  isNativeTransportAvailable,
  mobileLogin,
  mobileLogout,
  onMobileSessionInvalidated,
  parseClientCapabilities,
  readClientCapabilities,
  readMobileProfile,
  TransportError,
  transportFetch,
} from '#lib/api/transport.ts';

function nativeWindow(
  overrides: Partial<NonNullable<NonNullable<CapacitorWindowRuntime['Plugins']>['RunNoteTransport']>> = {},
) {
  return {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        RunNoteTransport: {
          request: vi.fn(),
          login: vi.fn(),
          logout: vi.fn(),
          getSessionState: vi.fn(),
          getServerConfig: vi.fn(),
          ...overrides,
        },
      },
    },
  } as unknown as Window & { Capacitor?: CapacitorWindowRuntime };
}

const SAMPLE_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'runner@example.test',
  username: 'runner',
  display_name: 'Runner',
  timezone: 'Asia/Shanghai',
  created_at: '2026-11-26T00:00:00Z',
  bio: '',
  profile_is_public: false,
  is_admin: false,
  showcase_enabled: false,
  together_allowed: false,
  together_enabled: false,
  wellbeing_allowed: false,
  wellbeing_enabled: false,
  avatar_url: null,
};

describe('mobile transport abstraction', () => {
  it('passes through directly to fetch on standard web browsers', async () => {
    const webWin = {} as Window & { Capacitor?: CapacitorWindowRuntime };
    expect(isNativeTransportAvailable(webWin)).toBe(false);

    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    const response = await transportFetch('/api/v1/health/live', { method: 'GET' }, mockFetch as unknown as typeof fetch, webWin);
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/health/live', { method: 'GET' });
  });

  it('routes native API calls through RunNoteTransport and strips browser auth headers', async () => {
    const requestMock = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { 'content-type': 'application/json', 'set-cookie': 'run_session=forbidden' },
      body: JSON.stringify({ data: SAMPLE_USER, error: null, meta: { request_id: 'req-1' } }),
      sessionState: 'active' as const,
    }));
    const win = nativeWindow({ request: requestMock });
    const webFetch = vi.fn();

    const response = await transportFetch(
      '/api/v1/me',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer should-be-stripped',
          Cookie: 'run_session=should-be-stripped',
          'X-CSRF-Token': 'should-be-stripped',
        },
      },
      webFetch as unknown as typeof fetch,
      win,
    );

    expect(webFetch).not.toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/v1/me',
      headers: { Accept: 'application/json' },
      body: null,
      timeoutMs: 12000,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    const profile = await readMobileProfile(webFetch as unknown as typeof fetch, win);
    expect(profile.username).toBe('runner');
  });

  it('rejects non-/api/ paths and traversal on native transport', async () => {
    const win = nativeWindow();
    for (const bad of ['https://evil.example/api/v1/me', '//evil.example/api/v1/me', '/login', '/api/../secret']) {
      expect(() => assertSafeApiPath(bad)).toThrow(TransportError);
      await expect(transportFetch(bad, {}, fetch, win)).rejects.toThrow(TransportError);
    }
  });

  it('notifies listeners only on reauth_required or signed_out, never on active 401', async () => {
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        body: JSON.stringify({ data: null, error: { code: 'INVALID_CREDENTIALS', message: '密码错误' } }),
        sessionState: 'active' as const,
      })
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        body: JSON.stringify({ data: null, error: { code: 'AUTH_REQUIRED', message: '请先登录' } }),
        sessionState: 'reauth_required' as const,
      });
    const win = nativeWindow({ request: requestMock });
    const seen: string[] = [];
    const stop = onMobileSessionInvalidated((state) => seen.push(state));
    try {
      const nonSession401 = await transportFetch('/api/v1/me/password', { method: 'PATCH', body: '{}' }, fetch, win);
      expect(nonSession401.status).toBe(401);
      expect(seen).toEqual([]);

      const sessionExpired = await transportFetch('/api/v1/me', {}, fetch, win);
      expect(sessionExpired.status).toBe(401);
      expect(seen).toEqual(['reauth_required']);
    } finally {
      stop();
    }
  });

  it('keeps tokens out of JS on mobileLogin and parses user safely', async () => {
    const loginMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      user: SAMPLE_USER,
    }));
    const win = nativeWindow({ login: loginMock });
    const user = await mobileLogin({ email: 'runner@example.test', password: 'a-valid-long-password' }, win);
    expect(user.id).toBe(SAMPLE_USER.id);
    expect('access_token' in (user as unknown as Record<string, unknown>)).toBe(false);
    expect('refresh_token' in (user as unknown as Record<string, unknown>)).toBe(false);

    // Non-native browser cannot execute mobileLogin directly.
    await expect(
      mobileLogin({ email: 'runner@example.test', password: 'a-valid-long-password' }, {} as Window & { Capacitor?: CapacitorWindowRuntime }),
    ).rejects.toMatchObject({ code: 'NATIVE_TRANSPORT_REQUIRED' });
  });

  it('handles session state query and logout notification', async () => {
    const logoutMock = vi.fn(async () => ({ ok: true, status: 200 }));
    const stateMock = vi.fn(async () => ({
      state: 'active' as const,
      serverUrl: 'https://run.example.test',
      serverOriginHash: 'abc123',
      accountId: SAMPLE_USER.id,
      user: SAMPLE_USER,
    }));
    const win = nativeWindow({ getSessionState: stateMock, logout: logoutMock });
    const state = await getMobileSessionState(win);
    expect(state.state).toBe('active');
    expect(state.user?.username).toBe('runner');

    const events: string[] = [];
    const stop = onMobileSessionInvalidated((s) => events.push(s));
    try {
      await mobileLogout({ revokeAllDevices: false }, win);
      expect(logoutMock).toHaveBeenCalledWith({ revokeAllDevices: false });
      expect(events).toEqual(['signed_out']);
    } finally {
      stop();
    }
  });

  it('validates client capabilities payload and semver ordering', async () => {
    const caps = parseClientCapabilities({
      server_version: '2.6.0',
      mobile_api_version: 1,
      min_mobile_app_version: '2.6.0',
      features: ['mobile_auth_v1', 'activities_sync_v1'],
    });
    expect(caps.server_version).toBe('2.6.0');
    expect(compareSemver('2.6.0', '2.6.0')).toBe(0);
    expect(compareSemver('2.5.9', '2.6.0')).toBe(-1);
    expect(compareSemver('2.7.0', '2.6.0')).toBe(1);

    expect(() => parseClientCapabilities({ server_version: 'bad', mobile_api_version: 1 })).toThrow(TransportError);
    expect(() =>
      parseClientCapabilities({
        server_version: '2.6.0',
        mobile_api_version: 0,
        min_mobile_app_version: '2.6.0',
        features: [],
      }),
    ).toThrow(TransportError);

    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            server_version: '2.6.0',
            mobile_api_version: 1,
            min_mobile_app_version: '2.6.0',
            features: ['mobile_auth_v1'],
          },
          error: null,
          meta: { request_id: 'r1' },
        }),
        { status: 200 },
      ),
    );
    const loaded = await readClientCapabilities(
      mockFetch as unknown as typeof fetch,
      {} as Window & { Capacitor?: CapacitorWindowRuntime },
    );
    expect(loaded.features).toEqual(['mobile_auth_v1']);
  });
});
