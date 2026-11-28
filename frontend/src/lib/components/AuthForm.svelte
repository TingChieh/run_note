<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { authWrite, safeNext } from '#lib/api/auth.ts';
  import { claimRecordingAccountAtomic } from '#lib/recording-store.ts';
  let email = $state(''), password = $state('');
  let errorElement = $state<HTMLDivElement>();
  let showPassword = $state(false);
  let busy = $state(false), ready = $state(false), message = $state('');
  onMount(() => { ready = true; });
  const label = '登录';
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (busy) return;
    busy = true; message = '';
    try {
      const result = await authWrite('login', { email, password });
      password = '';
      if (result.user?.id) {
        await claimRecordingAccountAtomic(result.user.id).catch(() => {});
      }
      window.location.assign(safeNext(page.url.searchParams.get('next') ?? (result.user?.is_admin ? '/' : '/workspace/dashboard')));
    } catch (cause) { password = ''; message = cause instanceof Error ? cause.message : '认证失败，请重试'; busy = false; await tick(); errorElement?.focus(); }
  }
</script>
<svelte:head><title>{pageTitle(label, page.data.site)}</title></svelte:head>
<section class="auth-card">
  <div class="auth-intro">
    <h1>{label}</h1>
    <p class="auth-lead">使用已启用账号的邮箱和密码登录。</p>
  </div>
  {#if page.url.searchParams.has('next') || page.url.searchParams.get('reason') === 'changed'}
    <div class="auth-notice"><FeedbackState kind="empty" title="请登录后继续。会话可能已过期或身份已发生变化。" /></div>
  {:else if page.url.searchParams.get('reason') === 'logout'}
    <div class="auth-notice"><FeedbackState kind="success" title="已退出登录。" /></div>
  {/if}
  <noscript><p role="alert" class="auth-notice">请启用 JavaScript 后使用认证页面。</p></noscript>
  <form aria-describedby={message ? 'auth-error' : undefined} method="POST" onsubmit={submit} class="auth-form" aria-busy={busy}>
    <label class="auth-field">
      <span>邮箱</span>
      <input
        disabled={busy}
        name="email"
        type="email"
        bind:value={email}
        required
        maxlength="254"
        autocomplete="email"
        class="text-field"
      />
    </label>
    <label class="auth-field">
      <span>密码</span>
      <input
        disabled={busy}
        name="password"
        type={showPassword ? 'text' : 'password'}
        bind:value={password}
        required
        minlength="12"
        maxlength="128"
        autocomplete="current-password"
        aria-describedby="password-help"
        class="text-field"
      />
    </label>
    <div class="auth-password-meta">
      <p id="password-help" class="auth-help">12–128 个字符。密码不会保存在浏览器本地存储中。</p>
      <button
        type="button"
        class="button-secondary button-compact auth-password-toggle"
        aria-pressed={showPassword}
        disabled={busy}
        onclick={() => {
          showPassword = !showPassword;
        }}>{showPassword ? '隐藏密码' : '显示密码'}</button
      >
    </div>
    {#if busy}<FeedbackState kind="loading" title="正在验证账户，请勿重复提交。" />{/if}
    {#if message}<div id="auth-error" tabindex="-1" bind:this={errorElement}><FeedbackState kind="error" title={message} /></div>{/if}
    <button type="submit" disabled={busy || !ready} class="button-primary auth-submit">{busy ? '处理中…' : label}</button>
  </form>
  <p class="auth-back"><a href="/">← 返回展示页面</a></p>
</section>

<style>
  .auth-card {
    display: grid;
    gap: var(--space-6);
    border: 1px solid var(--border);
    border-top: 2px solid var(--rule);
    border-radius: var(--radius-sheet);
    background: var(--paper);
    padding: clamp(1.25rem, 4vw, 1.75rem);
  }
  .auth-intro {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border: 0;
    border-radius: var(--radius-header);
    background: var(--header-tint);
  }
  .auth-intro h1 {
    margin: 0;
    font-size: var(--text-title);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-heading);
    letter-spacing: var(--tracking-tight);
    color: var(--foreground);
  }
  .auth-lead {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .auth-notice {
    min-width: 0;
  }
  .auth-form {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .auth-field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    color: var(--foreground);
  }
  .auth-field input {
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
    border-color: var(--control-border);
    border-radius: var(--radius-control);
  }
  .auth-password-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .auth-password-toggle {
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: 0.5rem 0.75rem;
    flex-shrink: 0;
  }
  .auth-help {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
  }
  .auth-submit {
    width: 100%;
    justify-content: center;
  }
  .auth-back {
    margin: 0;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
    font-size: var(--text-small);
  }
  .auth-back a {
    color: var(--primary);
    font-weight: var(--weight-medium);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
</style>
