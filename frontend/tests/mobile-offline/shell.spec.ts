import { expect, test } from '@playwright/test';

const SAMPLE_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'runner@example.test',
  username: 'mobile_runner',
  display_name: 'Offline Runner',
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

test.describe('mobile local static shell (P0)', () => {
  test('renders offline shell, logs in via native bridge without cookies or JS tokens, and handles 401 reauth_required', async ({
    page,
    context,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.addInitScript((user) => {
      // Simulate native Android Keystore state inside the mock plugin closure (never in localStorage/cookies).
      let sessionState: 'signed_out' | 'active' | 'reauth_required' = 'signed_out';
      let forceReauthOnNextRequest = false;
      (window as unknown as Record<string, unknown>).__triggerPasswordChangedRevocation = () => {
        forceReauthOnNextRequest = true;
      };
      (window as unknown as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          SystemAppearance: { setTheme: async () => {} },
          RunNoteTransport: {
            getServerConfig: async () => ({
              serverUrl: 'https://run.example.test',
              defaultServerUrl: 'https://run.example.test',
              valid: true,
              reason: null,
            }),
            getSessionState: async () => ({
              state: sessionState,
              serverUrl: 'https://run.example.test',
              serverOriginHash: 'sha256-example',
              accountId: sessionState === 'signed_out' ? null : user.id,
              user: sessionState === 'active' ? user : null,
            }),
            login: async ({ email, password }: { email: string; password: string }) => {
              if (email === user.email && password === 'Synthetic-password-2026') {
                sessionState = 'active';
                return { ok: true, status: 200, user };
              }
              return { ok: false, status: 401, errorCode: 'INVALID_CREDENTIALS', errorMessage: '邮箱或密码不正确' };
            },
            logout: async () => {
              sessionState = 'signed_out';
              return { ok: true, status: 200 };
            },
            request: async ({ path }: { path: string }) => {
              if (path === '/api/v1/client/capabilities') {
                return {
                  status: 200,
                  ok: true,
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    data: {
                      server_version: '2.6.0',
                      mobile_api_version: 1,
                      min_mobile_app_version: '2.6.0',
                      features: ['mobile_auth_v1', 'activities_sync_v1', 'gpx_idempotency_v1'],
                    },
                    error: null,
                    meta: { request_id: 'req-cap' },
                  }),
                  sessionState,
                };
              }
              if (path === '/api/v1/me') {
                if (forceReauthOnNextRequest) {
                  sessionState = 'reauth_required';
                  return {
                    status: 401,
                    ok: false,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      data: null,
                      error: { code: 'AUTH_REQUIRED', message: '登录已过期，请重新登录' },
                      meta: { request_id: 'req-401' },
                    }),
                    sessionState: 'reauth_required',
                  };
                }
                return {
                  status: 200,
                  ok: true,
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ data: user, error: null, meta: { request_id: 'req-me' } }),
                  sessionState: 'active',
                };
              }
              return { status: 404, ok: false, headers: {}, body: '{}', sessionState };
            },
          },
        },
      };
    }, SAMPLE_USER);

    // 1. Load local shell and verify zero cookies, zero console errors, zero overflow.
    await page.goto('/');
    await expect(page.getByTestId('mobile-local-shell')).toBeVisible();
    await expect(page.getByTestId('mobile-session-state')).toHaveText('未登录');
    await expect(page.getByTestId('mobile-transport-mode')).toHaveText('原生安全传输');

    // 2. Toggle offline mode: local shell displays offline badge without crashing.
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByTestId('mobile-offline-badge')).toBeVisible();

    // 3. Back online: navigate to /login and sign in through native transport bridge.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.getByTestId('mobile-go-login').click();
    await expect(page.getByTestId('mobile-login-card')).toBeVisible();
    await page.locator('input[name="email"]').fill(SAMPLE_USER.email);
    await page.locator('input[name="password"]').fill('Synthetic-password-2026');
    await page.getByTestId('mobile-login-submit').click();

    await expect(page.getByTestId('mobile-session-state')).toHaveText('已登录');
    await expect(page.getByTestId('mobile-user-name')).toContainText('Offline Runner');

    // Verify WebView has ZERO session cookies and ZERO tokens in browser storage.
    const storageAudit = await page.evaluate(() => ({
      cookie: document.cookie,
      localKeys: Object.keys(localStorage),
      sessionKeys: Object.keys(sessionStorage),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    expect(storageAudit.cookie).toBe('');
    expect(storageAudit.localKeys.join(',')).not.toMatch(/token|session|refresh|bearer/i);
    expect(storageAudit.sessionKeys).toEqual([]);
    expect(storageAudit.overflow).toBe(false);

    // 4. Verify online capabilities + profile check, then simulate password-change 401 -> reauth_required.
    await page.getByTestId('mobile-verify-session').click();
    await expect(page.getByTestId('mobile-server-version')).toHaveText('2.6.0');

    await page.evaluate(() => {
      (window as unknown as { __triggerPasswordChangedRevocation: () => void }).__triggerPasswordChangedRevocation();
    });
    await page.getByTestId('mobile-verify-session').click();
    await expect(page.getByTestId('mobile-reauth-banner')).toBeVisible();
    await expect(page.getByTestId('mobile-session-state')).toHaveText('需要重新登录');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
