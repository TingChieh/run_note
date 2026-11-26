<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import {
    getMobileServerConfig,
    isNativeTransportAvailable,
    mobileLogin,
    type MobileServerConfig,
  } from '#lib/api/transport.ts';

  const appVersion = typeof __RUNNOTE_APP_VERSION__ === 'string' ? __RUNNOTE_APP_VERSION__ : '2.6.0';

  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let busy = $state(false);
  let ready = $state(false);
  let online = $state(true);
  let nativeAvailable = $state(false);
  let serverConfig = $state<MobileServerConfig>({
    serverUrl: null,
    defaultServerUrl: null,
    valid: false,
    reason: null,
  });
  let message = $state('');
  let errorElement = $state<HTMLDivElement>();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (!online) {
      message = '当前处于离线模式，请联网后登录。';
      await tick();
      errorElement?.focus();
      return;
    }
    busy = true;
    message = '';
    try {
      await mobileLogin({
        email,
        password,
        deviceLabel: 'RunNote Android',
        clientVersion: appVersion,
      });
      password = '';
      await goto('/');
    } catch (cause) {
      password = '';
      message = cause instanceof Error ? cause.message : '登录失败，请重试';
      busy = false;
      await tick();
      errorElement?.focus();
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

    void (async () => {
      try {
        const config = await getMobileServerConfig();
        if (!disposed) serverConfig = config;
      } finally {
        if (!disposed) ready = true;
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  });
</script>

<svelte:head>
  <title>登录 · RunNote</title>
</svelte:head>

<main class="mx-auto w-full max-w-md py-4">
  <section class="auth-card" data-testid="mobile-login-card">
    <div class="auth-intro">
      <p class="auth-eyebrow">RUNNOTE</p>
      <h1>登录</h1>
      {#if serverConfig.serverUrl}
        <p class="auth-help break-all" data-testid="mobile-login-server">{serverConfig.serverUrl}</p>
      {/if}
    </div>

    {#if !online}
      <div class="mt-4">
        <FeedbackState kind="empty" title="当前处于离线模式，请联网后登录。" />
      </div>
    {/if}

    {#if ready && nativeAvailable && !serverConfig.valid}
      <div class="mt-4">
        <FeedbackState kind="error" title="未配置有效的 RunNote 服务器地址。" />
      </div>
    {/if}

    <form
      aria-describedby={message ? 'mobile-auth-error' : undefined}
      method="POST"
      onsubmit={submit}
      class="mt-6 grid gap-4"
      aria-busy={busy}
    >
      <label class="grid gap-2">
        邮箱
        <input
          disabled={busy}
          name="email"
          type="email"
          bind:value={email}
          required
          maxlength="254"
          autocomplete="email"
          class="rounded-lg border border-border px-3 py-2"
        />
      </label>
      <label class="grid gap-2">
        密码
        <input
          disabled={busy}
          name="password"
          type={showPassword ? 'text' : 'password'}
          bind:value={password}
          required
          minlength="12"
          maxlength="128"
          autocomplete="current-password"
          aria-describedby="mobile-password-help"
          class="rounded-lg border border-border px-3 py-2"
        />
      </label>
      <button
        type="button"
        class="button-secondary justify-self-end"
        aria-pressed={showPassword}
        disabled={busy}
        onclick={() => {
          showPassword = !showPassword;
        }}
      >
        {showPassword ? '隐藏密码' : '显示密码'}
      </button>
      <p id="mobile-password-help" class="auth-help">12–128 个字符。凭据仅保存在系统安全密钥库中。</p>

      {#if busy}
        <FeedbackState kind="loading" title="正在验证账户，请勿重复提交。" />
      {/if}
      {#if message}
        <div id="mobile-auth-error" tabindex="-1" bind:this={errorElement}>
          <FeedbackState kind="error" title={message} />
        </div>
      {/if}

      <button
        type="submit"
        disabled={busy || !ready || !online}
        class="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50"
        data-testid="mobile-login-submit"
      >
        {busy ? '登录中…' : '登录'}
      </button>
    </form>

    <p class="mt-5 text-sm">
      <a class="text-primary underline" href="/">返回状态页</a>
    </p>
  </section>
</main>
