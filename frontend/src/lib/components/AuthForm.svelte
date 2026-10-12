<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { authWrite, safeNext } from '#lib/api/auth.ts';
  let { mode }: { mode: 'login' | 'register' } = $props();
  let email = $state(''), username = $state(''), password = $state('');
  let busy = $state(false), ready = $state(false), message = $state('');
  onMount(() => { ready = true; });
  const label = $derived(mode === 'login' ? '登录' : '注册');
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (busy) return;
    busy = true; message = '';
    try {
      await authWrite(mode, { email, password, ...(mode === 'register' ? { username, timezone: 'Asia/Shanghai' } : {}) });
      password = '';
      window.location.assign(safeNext(page.url.searchParams.get('next')));
    } catch (cause) { password = ''; message = cause instanceof Error ? cause.message : '认证失败，请重试'; busy = false; }
  }
</script>
<svelte:head><title>{label} · Run Note</title></svelte:head>
<section class="mx-auto max-w-md rounded-xl border border-border bg-white p-7">
  <h1 class="text-3xl font-semibold">{label}</h1>
  <p class="mt-3 text-sm text-muted-foreground">{mode === 'register' ? '创建私人账号。注册成功后自动登录。' : '使用你的邮箱和密码登录。'}</p>
  {#if page.url.searchParams.has('next') || page.url.searchParams.get('reason') === 'changed'}
    <p role="status" class="mt-4 text-sm">请登录后继续。会话可能已过期或身份已发生变化。</p>
  {:else if page.url.searchParams.get('reason') === 'logout'}
    <p role="status" class="mt-4 text-sm">已退出登录。</p>
  {/if}
  <noscript><p role="alert" class="mt-4">请启用 JavaScript 后使用认证页面。</p></noscript>
  <form method="POST" onsubmit={submit} class="mt-6 grid gap-4">
    <label class="grid gap-2">邮箱<input name="email" type="email" bind:value={email} required maxlength="254" autocomplete="email" class="rounded-lg border border-border px-3 py-2" /></label>
    {#if mode === 'register'}
      <label class="grid gap-2">用户名<input name="username" bind:value={username} required minlength="3" maxlength="30" pattern="[a-z0-9_]+" autocomplete="username" aria-describedby="username-help" class="rounded-lg border border-border px-3 py-2" /></label>
      <p id="username-help" class="text-sm text-muted-foreground">3–30 个小写字母、数字或下划线。</p>
    {/if}
    <label class="grid gap-2">密码<input name="password" type="password" bind:value={password} required minlength="12" maxlength="128" autocomplete={mode === 'register' ? 'new-password' : 'current-password'} aria-describedby="password-help" class="rounded-lg border border-border px-3 py-2" /></label>
    <p id="password-help" class="text-sm text-muted-foreground">12–128 个字符。密码不会保存在浏览器本地存储中。</p>
    {#if message}<p role="alert" class="text-sm text-red-700">{message}</p>{/if}
    <button type="submit" disabled={busy || !ready} class="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50">{busy ? '处理中…' : label}</button>
  </form>
  <p class="mt-5 text-sm"><a class="text-primary underline" href={`${mode === 'register' ? '/login' : '/register'}?next=${encodeURIComponent(safeNext(page.url.searchParams.get('next')))}`}>{mode === 'register' ? '已有账号？去登录' : '没有账号？去注册'}</a></p>
</section>
