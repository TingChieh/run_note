<script lang="ts">
  import { setContext } from "svelte";
  import { VIEW_CONTEXT } from "#lib/view-context.ts";
  import { viewContext } from "#lib/api/view-context.ts";
  import '../app.css';
  import type { Component, Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { navigating, page } from '$app/state';
  import AppNavigation from '#lib/components/AppNavigation.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import SettingsTabs from '#lib/components/SettingsTabs.svelte';
  import { provideSettingsHeader } from '#lib/settings-header.svelte.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import { AuthError, authWrite, isProtected, readSession } from '#lib/api/auth.ts';
  import { liquidGlass } from '#lib/styles/liquid-glass.ts';
  import ThemeToggle from '#lib/components/ThemeToggle.svelte';
  import { SITE_DEFAULTS, brandInitial } from '#lib/site.ts';
  import { pageDescription, pageNoindex } from '#lib/seo.ts';
  import { initializeTheme } from '#lib/components/system-theme.ts';

  let { children }: { children: Snippet } = $props();
  let checking = $state(false), busy = $state(false), mounted = $state(false), message = $state('');
  let identityBlocked = $state(false);
  let pageDirection = $state<1 | -1 | 0>(0), menuNavigationPending = false;
  let GlassTuner = $state<Component | null>(null);
  // Switching between the settings sections keeps the old page on screen and skips the skeleton and fade.
  const settingsSection = (path?: string) => !!path && /^(\/workspace)?\/(settings(\/site)?|admin\/users)\/?$/.test(path);
  let quietSwap = $state(false);
  const settingsHeader = provideSettingsHeader();
  const settingsKind = $derived.by(() => {
    const path = page.url.pathname.replace(/^\/workspace/, '').replace(/\/$/, '');
    return path === '/settings' ? 'account' : path === '/settings/site' ? 'site' : path === '/admin/users' ? 'users' : null;
  });
  const settingsMeta = { account: ['设置', '管理账户资料与公开主页。'], site: ['站点设置', '管理站点名称、标语、默认外观和图标。'], users: ['用户管理', '管理账号、登录权限和独立个人展示链接。'] } as const;
  beforeNavigate(navigation => {
    quietSwap = settingsSection(navigation.from?.url.pathname) && settingsSection(navigation.to?.url.pathname);
    if (!menuNavigationPending) pageDirection = 0;
    menuNavigationPending = false;
  });
  onMount(initializeTheme);
  onMount(() => {
    if (!import.meta.env.DEV) return;
    let disposed = false;
    void import('#lib/components/LiquidGlassTuner.svelte').then(module => { if (!disposed) GlassTuner = module.default; }).catch(() => { /* The optional dev panel must not block the page. */ });
    return () => { disposed = true; };
  });
  const site = $derived(page.data.site ?? SITE_DEFAULTS);
  let logoFailed = $state(false);
  $effect(() => { void site.logo_url; logoFailed = false; });
  const appLayout = $derived(/^\/(dashboard|activities|footprints|routes|ai|settings|admin|p|workspace)(\/|$)/.test(page.url.pathname) && page.url.pathname !== '/admin' || page.url.pathname === '/' || page.status >= 400 && !/^\/admin\/?$/.test(page.url.pathname));
  const privateView = $derived(!!page.data.user || isProtected(page.url.pathname));
  setContext(VIEW_CONTEXT, () => {
    const context = viewContext(page.url.pathname, page.data.user?.is_admin === true);
    // A missing personal showcase 404 keeps the shell, but must not advertise that user's links.
    if (context.kind === 'public' && !page.data.showcase) return viewContext('/', page.data.user?.is_admin === true);
    return context;
  });
  const description = $derived(pageDescription(page.url.pathname, page.status, site.description));
  const noindex = $derived(pageNoindex(page.url.pathname, page.status));
  const authPage = $derived(/^\/admin\/?$/.test(page.url.pathname));
  const routeLoading = $derived(!!navigating.to && !navigating.shallow && !navigating.willUnload && navigating.to.url.pathname !== page.url.pathname && !(settingsSection(page.url.pathname) && settingsSection(navigating.to.url.pathname)));
  async function logout() {
    if (busy) return; busy = true; message = '';
    try {
      await authWrite('logout', {});
      checking = true;
      window.location.assign(viewContext(page.url.pathname).kind === 'workspace' ? '/' : page.url.pathname);
    } catch (cause) {
      if (cause instanceof AuthError && cause.status === 401) { checking = true; window.location.replace('/admin?reason=changed'); return; }
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
          if (isProtected(page.url.pathname) && !current) window.location.replace('/admin?reason=changed');
          else window.location.reload();
          return;
        }
        identityBlocked = false; checking = false;
      } catch (cause) {
        // Fail closed: hide private children and identity until verification succeeds.
        if (page.data.user || isProtected(page.url.pathname)) {
          checking = true; identityBlocked = true;
          message = cause instanceof Error ? cause.message : '无法确认登录状态';
        } else { checking = false; }
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
<svelte:head><meta name="description" content={description} />{#if noindex}<meta name="robots" content="noindex,nofollow" />{/if}</svelte:head>
<a href="#main" class="skip-link">跳转到主要内容</a>
<div use:liquidGlass class:app-shell={appLayout} class:public-shell={!appLayout} class="sport-theme">
  <header data-auth-ready={mounted}>
    {#if appLayout}
      <AppNavigation pathname={page.url.pathname} user={page.data.user} profile={page.data.showcase} {checking} {busy} {mounted} {identityBlocked} sports onlogout={logout} onnav={(direction) => { menuNavigationPending = true; pageDirection = direction; }} />
    {:else}
      <div class="public-header">
        <a href="/" class="brand">{#if site.logo_url && !logoFailed}<img class="brand-mark brand-logo" src={site.logo_url} alt="" width="32" height="32" onerror={() => { logoFailed = true; }} />{:else}<span class="brand-mark" aria-hidden="true">{brandInitial(site.title)}</span>{/if}{site.title}</a>
        <nav aria-label="主要导航" class="public-navigation">
          <ThemeToggle compact />
          {#if page.data.user}<a href="/" data-sveltekit-reload class="button-secondary">我的运动统计</a>{#if !checking}<button type="button" onclick={logout} disabled={busy || !mounted} class="button-secondary">{busy ? '退出中…' : '退出登录'}</button>{/if}
          {:else}<a href="/activities" data-sveltekit-reload class="public-activities">跑步记录</a>{/if}
        </nav>
        <span class="sr-only" data-testid="current-user">{checking ? '正在确认身份…' : page.data.user ? `已登录：${page.data.user.email}` : '未登录'}</span>
      </div>
    {/if}
  </header>
  <div class="content-column">
    {#if navigating.to && !navigating.willUnload}<div class="navigation-progress" role="status" data-testid="navigation-progress"><span class="sr-only">正在加载页面…</span></div>{/if}
    <main id="main" tabindex="-1" class="page-content" class:auth-content={authPage} aria-busy={!!navigating.to}>
      {#if message || page.data.authError || page.data.showcaseError && page.status < 400}<div class="mb-5"><FeedbackState kind="error" title={message || page.data.authError || page.data.showcaseError || ''} /></div>{/if}
      {#if checking && privateView}
        <FeedbackState kind="loading" title="正在确认登录状态。若检查失败，请刷新重试。" />
      {/if}
      {#if !(identityBlocked && privateView)}
        {#if routeLoading}<div data-testid="navigation-skeleton"><PageSkeleton /></div>{/if}
        {#if settingsKind}<div hidden={routeLoading || checking && privateView} inert={routeLoading || checking && privateView}>
          <PageHeader title={settingsMeta[settingsKind][0]} description={settingsMeta[settingsKind][1]}>
            {#snippet actions()}{#if settingsHeader.create}<button id="create-user" type="button" class="button-secondary" disabled={settingsHeader.createDisabled} onclick={settingsHeader.create}>新增用户</button>{/if}{/snippet}
            {#snippet footer()}<SettingsTabs current={settingsKind} />{/snippet}
          </PageHeader>
        </div>{/if}
        <!-- Preserve file inputs and drafts across successful focus/session checks. -->
        {#key page.url.pathname}<div class="page-reveal" class:quiet-swap={quietSwap} class:page-enter-up={pageDirection === 1} class:page-enter-down={pageDirection === -1} hidden={routeLoading || checking && privateView} inert={routeLoading || checking && privateView}>{@render children()}</div>{/key}
      {/if}
    </main>
    <footer class="app-footer"><span>{site.title}</span>{#if site.footer_tagline}<span>{site.footer_tagline}</span>{/if}</footer>
  </div>
  {#if GlassTuner}<GlassTuner />{/if}
</div>
