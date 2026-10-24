<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { authWrite, safeNext } from '#lib/api/auth.ts';
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
      window.location.assign(safeNext(page.url.searchParams.get('next') ?? (result.user?.is_admin ? '/' : '/workspace/dashboard')));
    } catch (cause) { password = ''; message = cause instanceof Error ? cause.message : '认证失败，请重试'; busy = false; await tick(); errorElement?.focus(); }
  }
</script>
<svelte:head><title>{pageTitle(label, page.data.site)}</title></svelte:head>
<section class="auth-card">
  <div class="auth-intro"><p class="auth-eyebrow">RUNNOTE · 每一步都有意义</p><h1>{label}</h1>
  <p class="auth-lead">使用已启用账号的邮箱和密码登录。</p></div>
  {#if page.url.searchParams.has('next') || page.url.searchParams.get('reason') === 'changed'}
    <div class="mt-4"><FeedbackState kind="empty" title="请登录后继续。会话可能已过期或身份已发生变化。" /></div>
  {:else if page.url.searchParams.get('reason') === 'logout'}
    <div class="mt-4"><FeedbackState kind="success" title="已退出登录。" /></div>
  {/if}
  <noscript><p role="alert" class="mt-4">请启用 JavaScript 后使用认证页面。</p></noscript>
  <form aria-describedby={message ? 'auth-error' : undefined} method="POST" onsubmit={submit} class="mt-6 grid gap-4" aria-busy={busy}>
    <label class="grid gap-2">邮箱<input disabled={busy} name="email" type="email" bind:value={email} required maxlength="254" autocomplete="email" class="rounded-lg border border-border px-3 py-2" /></label>
    <label class="grid gap-2">密码<input disabled={busy} name="password" type={showPassword ? 'text' : 'password'} bind:value={password} required minlength="12" maxlength="128" autocomplete="current-password" aria-describedby="password-help" class="rounded-lg border border-border px-3 py-2" /></label>
    <button type="button" class="button-secondary justify-self-end" aria-pressed={showPassword} disabled={busy} onclick={() => { showPassword = !showPassword; }}>{showPassword ? '隐藏密码' : '显示密码'}</button>
    <p id="password-help" class="auth-help">12–128 个字符。密码不会保存在浏览器本地存储中。</p>
    {#if busy}<FeedbackState kind="loading" title="正在验证账户，请勿重复提交。" />{/if}
    {#if message}<div id="auth-error" tabindex="-1" bind:this={errorElement}><FeedbackState kind="error" title={message} /></div>{/if}
    <button type="submit" disabled={busy || !ready} class="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50">{busy ? '处理中…' : label}</button>
  </form>
  <p class="mt-5 text-sm"><a class="text-primary underline" href="/">返回展示页面</a></p>
</section>
