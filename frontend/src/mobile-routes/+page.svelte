<script lang="ts">
  import { onMount } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import type { User } from '#lib/api/auth.ts';
  import {
    compareSemver,
    getMobileServerConfig,
    getMobileSessionState,
    isNativeTransportAvailable,
    mobileLogout,
    onMobileSessionInvalidated,
    readClientCapabilities,
    readMobileProfile,
    TransportError,
    type ClientCapabilities,
    type MobileServerConfig,
    type MobileSessionState,
  } from '#lib/api/transport.ts';

  const appVersion = typeof __RUNNOTE_APP_VERSION__ === 'string' ? __RUNNOTE_APP_VERSION__ : '2.6.0';

  let online = $state(true);
  let ready = $state(false);
  let nativeAvailable = $state(false);
  let session = $state<MobileSessionState>({
    state: 'signed_out',
    serverUrl: null,
    serverOriginHash: null,
    accountId: null,
    user: null,
  });
  let serverConfig = $state<MobileServerConfig>({
    serverUrl: null,
    defaultServerUrl: null,
    valid: false,
    reason: null,
  });
  let verifiedUser = $state<User | null>(null);
  let capabilities = $state<ClientCapabilities | null>(null);
  let checking = $state(false);
  let loggingOut = $state(false);
  let statusError = $state('');

  let requestToken = 0;

  let activeUser = $derived(verifiedUser ?? session.user);
  let appUpgradeRequired = $derived(
    capabilities !== null && compareSemver(appVersion, capabilities.min_mobile_app_version) < 0,
  );
  let serverSupportsMobileAuth = $derived(
    capabilities === null || capabilities.features.includes('mobile_auth_v1'),
  );

  async function refreshNativeState() {
    const token = ++requestToken;
    const [nextSession, nextConfig] = await Promise.all([
      getMobileSessionState(),
      getMobileServerConfig(),
    ]);
    if (token !== requestToken) return;
    session = nextSession;
    serverConfig = nextConfig;
    if (nextSession.state !== 'active') {
      verifiedUser = null;
    }
  }

  async function verifyOnlineConnection() {
    if (!online) {
      statusError = '当前处于离线模式，已保留本地状态。';
      return;
    }
    const token = ++requestToken;
    checking = true;
    statusError = '';
    try {
      const caps = await readClientCapabilities();
      if (token !== requestToken) return;
      capabilities = caps;
      if (session.state === 'active') {
        const profile = await readMobileProfile();
        if (token !== requestToken) return;
        verifiedUser = profile;
      }
    } catch (cause) {
      if (token !== requestToken) return;
      if (cause instanceof TransportError && cause.status === 401) {
        session = { ...session, state: 'reauth_required' };
        verifiedUser = null;
        statusError = cause.message;
      } else {
        statusError = cause instanceof Error ? cause.message : '无法连接 RunNote 服务';
      }
    } finally {
      if (token === requestToken) checking = false;
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    loggingOut = true;
    statusError = '';
    try {
      await mobileLogout();
      await refreshNativeState();
      verifiedUser = null;
    } catch (cause) {
      statusError = cause instanceof Error ? cause.message : '退出登录失败，请重试';
    } finally {
      loggingOut = false;
    }
  }

  onMount(() => {
    let disposed = false;
    online = navigator.onLine;
    nativeAvailable = isNativeTransportAvailable();

    const handleOnline = () => {
      online = true;
    };
    const handleOffline = () => {
      online = false;
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const stopInvalidation = onMobileSessionInvalidated((nextState) => {
      if (disposed) return;
      session = { ...session, state: nextState };
      if (nextState !== 'active') {
        verifiedUser = null;
      }
    });

    void (async () => {
      try {
        await refreshNativeState();
      } catch {
        /* Cold start offline shell stays usable even if native state query fails. */
      } finally {
        if (!disposed) ready = true;
      }
    })();

    return () => {
      disposed = true;
      requestToken += 1;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      stopInvalidation();
    };
  });
</script>

<svelte:head>
  <title>RunNote</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-md flex-col gap-4 py-4">
  <header class="flex items-center justify-between gap-3">
    <div>
      <p class="auth-eyebrow">RUNNOTE</p>
      <h1 class="text-2xl font-semibold tracking-tight">本地离线壳</h1>
    </div>
    {#if !online}
      <span
        class="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground"
        data-testid="mobile-offline-badge"
      >
        离线模式
      </span>
    {/if}
  </header>

  {#if !ready}
    <FeedbackState kind="loading" title="正在加载本地状态…" />
  {:else}
    {#if session.state === 'reauth_required'}
      <div data-testid="mobile-reauth-banner">
        <FeedbackState kind="error" title="登录已过期 · 请重新登录以继续同步">
          <p>本地未上传记录已保留，不会自动清除。</p>
        </FeedbackState>
      </div>
    {/if}

    {#if appUpgradeRequired}
      <FeedbackState kind="error" title="客户端版本过旧">
        <p>请更新 RunNote App 后继续同步，本地数据不会被清除。</p>
      </FeedbackState>
    {:else if !serverSupportsMobileAuth}
      <FeedbackState kind="error" title="服务端版本过旧">
        <p>当前服务器不支持移动端令牌认证，请升级 RunNote 服务端。</p>
      </FeedbackState>
    {/if}

    <section class="aux-panel grid gap-3" aria-labelledby="session-heading" data-testid="mobile-session-card">
      <h2 id="session-heading" class="text-base font-semibold">会话状态</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-muted-foreground">状态</dt>
        <dd data-testid="mobile-session-state">
          {session.state === 'active'
            ? '已登录'
            : session.state === 'reauth_required'
              ? '需要重新登录'
              : '未登录'}
        </dd>
        <dt class="text-muted-foreground">传输通道</dt>
        <dd data-testid="mobile-transport-mode">{nativeAvailable ? '原生安全传输' : '浏览器模式'}</dd>
        <dt class="text-muted-foreground">应用版本</dt>
        <dd>{appVersion}</dd>
        <dt class="text-muted-foreground">服务器</dt>
        <dd class="break-all" data-testid="mobile-server-url">
          {session.serverUrl ?? serverConfig.serverUrl ?? '未配置'}
        </dd>
        {#if activeUser}
          <dt class="text-muted-foreground">账号</dt>
          <dd data-testid="mobile-user-name">{activeUser.display_name} (@{activeUser.username})</dd>
        {/if}
        {#if capabilities}
          <dt class="text-muted-foreground">服务端版本</dt>
          <dd data-testid="mobile-server-version">{capabilities.server_version}</dd>
        {/if}
      </dl>

      {#if statusError}
        <FeedbackState kind="error" title={statusError} />
      {/if}

      <div class="mt-2 flex flex-wrap gap-2">
        {#if session.state !== 'active'}
          <a
            href="/login"
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            data-testid="mobile-go-login"
          >
            {session.state === 'reauth_required' ? '重新登录' : '登录账号'}
          </a>
        {:else}
          <button
            type="button"
            class="button-secondary"
            disabled={checking || !online}
            onclick={verifyOnlineConnection}
            data-testid="mobile-verify-session"
          >
            {checking ? '验证中…' : '验证在线连接'}
          </button>
          <button
            type="button"
            class="button-secondary"
            disabled={loggingOut}
            onclick={handleLogout}
            data-testid="mobile-logout-button"
          >
            {loggingOut ? '退出中…' : '退出登录'}
          </button>
        {/if}
      </div>
    </section>
  {/if}
</main>
