<script lang="ts">
  import '../app.css';
  import type { Component, Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { navigating, page } from '$app/state';
  import AppNavigation from '#lib/components/AppNavigation.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import { AuthError, authWrite, isProtected, readSession } from '#lib/api/auth.ts';
  import { liquidGlass } from '#lib/styles/liquid-glass.ts';
  import ThemeToggle from '#lib/components/ThemeToggle.svelte';
  import { initializeTheme } from '#lib/components/system-theme.ts';

  let { children }: { children: Snippet } = $props();
  let checking = $state(false), busy = $state(false), mounted = $state(false), message = $state('');
  let identityBlocked = $state(false);
  let GlassTuner = $state<Component | null>(null);
  onMount(initializeTheme);
  onMount(() => {
    if (!import.meta.env.DEV) return;
    let disposed = false;
    void import('#lib/components/LiquidGlassTuner.svelte').then(module => { if (!disposed) GlassTuner = module.default; }).catch(() => { /* The optional dev panel must not block the page. */ });
    return () => { disposed = true; };
  });
  const appLayout = $derived(!!page.data.user && (isProtected(page.url.pathname) || page.url.pathname === '/'));
  const authPage = $derived(/^\/(login|register)\/?$/.test(page.url.pathname));
  const routeLoading = $derived(!!navigating.to && !navigating.shallow && !navigating.willUnload && navigating.to.url.pathname !== page.url.pathname);
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
      if (inFlight) { pending = true; return; }
      inFlight = true; pending = false; message = '';
      try {
        const current = await readSession();
        if (disposed || busy || pending) return;
        if ((current?.id ?? null) !== (page.data.user?.id ?? null)) {
          identityBlocked = true;
          if (isProtected(page.url.pathname) && !current) window.location.replace('/login?reason=changed');
          else window.location.reload();
          return;
        }
        identityBlocked = false; checking = false;
      } catch (cause) {
        // Fail closed: hide private children and identity until verification succeeds.
        checking = true;
        identityBlocked = true;
        message = cause instanceof Error ? cause.message : '无法确认登录状态';
      } finally {
        inFlight = false;
        if (pending && !disposed && !busy) void verifyIdentity();
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void verifyIdentity(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void verifyIdentity(); };
    if (channel) { channel.onmessage = () => { checking = true; void verifyIdentity(); }; channel.postMessage('check'); }
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
<a href="#main" class="skip-link">跳转到主要内容</a>
<div use:liquidGlass class:app-shell={appLayout} class:public-shell={!appLayout} class="sport-theme">
  <header data-auth-ready={mounted}>
    {#if appLayout && page.data.user}
      <AppNavigation pathname={page.url.pathname} user={page.data.user} {checking} {busy} {mounted} {identityBlocked} sports onlogout={logout} />
    {:else}
      <div class="public-header">
        <a href="/" class="brand"><span class="brand-mark" aria-hidden="true">R</span>RunNote</a>
        <nav aria-label="主要导航" class="public-navigation">
          <ThemeToggle compact />
          {#if page.data.user}<a href="/dashboard" data-sveltekit-reload class="button-secondary">我的运动统计</a>{#if !checking}<button type="button" onclick={logout} disabled={busy || !mounted} class="button-secondary">{busy ? '退出中…' : '退出登录'}</button>{/if}
          {:else}<a href="/activities" data-sveltekit-reload class="public-activities">跑步记录</a><a href="/login" aria-current={page.url.pathname === '/login' ? 'page' : undefined}>登录</a><a href="/register" class="button-secondary" aria-current={page.url.pathname === '/register' ? 'page' : undefined}>注册</a>{/if}
        </nav>
        <span class="sr-only" data-testid="current-user">{checking ? '正在确认身份…' : page.data.user ? `已登录：${page.data.user.email}` : '未登录'}</span>
      </div>
    {/if}
  </header>
  <div class="content-column">
    {#if navigating.to && !navigating.willUnload}<div class="navigation-progress" role="status" data-testid="navigation-progress"><span class="sr-only">正在加载页面…</span></div>{/if}
    <main id="main" tabindex="-1" class="page-content" class:auth-content={authPage} aria-busy={!!navigating.to}>
      {#if message || page.data.authError}<div class="mb-5"><FeedbackState kind="error" title={message || page.data.authError || ''} /></div>{/if}
      {#if checking && isProtected(page.url.pathname)}
        <FeedbackState kind="loading" title="正在确认登录状态。若检查失败，请刷新重试。" />
      {/if}
      {#if !(identityBlocked && isProtected(page.url.pathname))}
        {#if routeLoading}<div data-testid="navigation-skeleton"><PageSkeleton /></div>{/if}
        <!-- Preserve file inputs and drafts across successful focus/session checks. -->
        {#key page.url.pathname}<div class="page-reveal" hidden={routeLoading || checking && isProtected(page.url.pathname)} inert={routeLoading || checking && isProtected(page.url.pathname)}>{@render children()}</div>{/key}
      {/if}
    </main>
    <footer class="app-footer"><span>RunNote</span><span>记录每一步，看见你的进步。</span></footer>
  </div>
  {#if GlassTuner}<GlassTuner />{/if}
</div>
