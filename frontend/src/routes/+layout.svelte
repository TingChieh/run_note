<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { AuthError, authWrite, isProtected, readSession } from '#lib/api/auth.ts';

  let { children }: { children: Snippet } = $props();
  let checking = $state(false), busy = $state(false), mounted = $state(false), message = $state('');
  const navigation = [
    { href: '/', label: '项目概览' }, { href: '/activities', label: '跑步记录' },
    { href: '/footprints', label: '个人足迹' }, { href: '/dashboard', label: '运动统计' }, { href: '/ai', label: 'AI 分析' }, { href: '/settings', label: '设置' }
  ];
  async function logout() {
    if (busy) return; busy = true; message = '';
    try {
      await authWrite('logout', {});
      checking = true;
      window.location.assign('/login?reason=logout');
    } catch (cause) {
      if (cause instanceof AuthError && cause.status === 401) { checking = true; window.location.replace('/login?reason=changed'); return; }
      message = cause instanceof Error ? cause.message : '退出失败，请重试'; busy = false;
    }
  }
  onMount(() => {
    mounted = true;
    let inFlight = false, pending = false, disposed = false;
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('runnote-auth');
    async function verifyIdentity() {
      if (disposed || busy) return;
      checking = true;
      if (inFlight) { pending = true; return; }
      inFlight = true; pending = false; message = '';
      try {
        const current = await readSession();
        if (disposed || busy || pending) return;
        if ((current?.id ?? null) !== (page.data.user?.id ?? null)) {
          if (isProtected(page.url.pathname) && !current) window.location.replace('/login?reason=changed');
          else window.location.reload();
          return;
        }
        checking = false;
      } catch (cause) {
        // Fail closed: hide private children until identity can be confirmed.
        message = cause instanceof Error ? cause.message : '无法确认登录状态';
      } finally {
        inFlight = false;
        if (pending && !disposed && !busy) void verifyIdentity();
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void verifyIdentity(); else checking = true; };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void verifyIdentity(); };
    if (channel) { channel.onmessage = () => { void verifyIdentity(); }; channel.postMessage('check'); }
    window.addEventListener('focus', verifyIdentity);
    window.addEventListener('pageshow', restored);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void verifyIdentity(); }, 60000);
    return () => {
      disposed = true; channel?.close(); clearInterval(timer);
      window.removeEventListener('focus', verifyIdentity); window.removeEventListener('pageshow', restored);
      document.removeEventListener('visibilitychange', visible);
    };
  });
</script>
<a href="#main" class="sr-only focus:not-sr-only">跳转到主要内容</a>
<header data-auth-ready={mounted} class="border-b border-border bg-white">
  <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-5 px-6 py-5">
    <a href="/" class="text-xl font-semibold tracking-tight">Run Note</a>
    <nav aria-label="主要导航" class="flex flex-wrap gap-5 text-sm text-muted-foreground">
      {#each navigation as item}<a href={item.href} data-sveltekit-reload class="hover:text-primary">{item.label}</a>{/each}
    </nav>
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <span data-testid="current-user">{checking ? '正在确认身份…' : page.data.user ? `已登录：${page.data.user.email}` : '未登录'}</span>
      {#if page.data.user && !checking}
        <button onclick={logout} disabled={busy || !mounted} class="text-primary underline disabled:opacity-50">{busy ? '退出中…' : '退出登录'}</button>
      {:else if !checking}
        <a href="/login" class="text-primary underline">登录</a><a href="/register" class="text-primary underline">注册</a>
      {/if}
    </div>
  </div>
</header>
<main id="main" class="mx-auto min-h-[75vh] max-w-5xl px-6 py-10">
  {#if message || page.data.authError}<p role="alert" class="mb-5 text-red-700">{message || page.data.authError}</p>{/if}
  {#if checking && isProtected(page.url.pathname)}
    <p role="status">正在确认登录状态。若检查失败，请刷新重试。</p>
  {:else}{@render children()}{/if}
</main>
<footer class="mx-auto max-w-5xl border-t border-border px-6 py-5 text-sm text-muted-foreground">软件工程毕业设计 · GPX 导入与路线地图</footer>
