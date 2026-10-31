<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  import { viewContext } from '#lib/api/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;

  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { SITE_DEFAULTS, brandInitial } from '#lib/site.ts';
  import { onMount } from 'svelte';
  import type { ShowcaseProfile } from '#lib/api/showcase.ts';
  import type { User } from '#lib/api/auth.ts';
  import RunningGoal from './RunningGoal.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import AnchoredPanel from './AnchoredPanel.svelte';
  import GoalRing from './GoalRing.svelte';
  import { attachFloatingGlass } from '#lib/styles/menu-glass.ts';
  let { pathname, user, profile = null, checking, busy, mounted, onlogout, onnav, sports = false, identityBlocked = false }: { pathname: string; user: User | null; profile?: ShowcaseProfile | null; checking: boolean; busy: boolean; mounted: boolean; onlogout: () => void; onnav: (direction: 1 | -1) => void; sports?: boolean; identityBlocked?: boolean } = $props();
  const site = $derived(page.data.site ?? SITE_DEFAULTS);
  let logoFailed = $state(false);
  $effect(() => { void site.logo_url; logoFailed = false; });
  let avatarFailed = $state(false);
  $effect(() => { void profile?.avatar_url; avatarFailed = false; });
  const context = $derived(viewContext(pathname, user?.is_admin === true));
  let open = $state(false);
  let mobile = $state(false);
  let toggle: HTMLButtonElement;
  let accountMenu = $state<ReturnType<typeof AnchoredPanel>>();
  let sidebar = $state<HTMLElement | undefined>(), floating = $state(false);
  // Floating exactly while page content extends under the bar: the first content row (below #main's top padding) has reached the bar's bottom edge.
  $effect(() => {
    if (mobile || !sidebar) { floating = false; return; }
    const main = document.getElementById('main');
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!main || !sidebar) return;
      const contentTop = main.getBoundingClientRect().top + (parseFloat(getComputedStyle(main).paddingTop) || 0);
      floating = contentTop < sidebar.getBoundingClientRect().bottom;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  });
  $effect(() => { if (!floating || mobile || !sidebar) return; return attachFloatingGlass(sidebar); });
  let goal = $state<{ progress: number | null; period: 'week' | 'month' | 'year'; loading: boolean }>({ progress: null, period: 'week', loading: true });
  const periodLabel = { week: '本周', month: '本月', year: '今年' };
  const goalLabel = $derived(goal.loading ? '跑量目标' : goal.progress === null ? '跑量目标，未设置' : `跑量目标，${periodLabel[goal.period]}已完成 ${Math.round(goal.progress)}%`);
  onMount(() => {
    // Keep in sync with the shell breakpoint (800px) in app.css, liquid-glass-controls.css and enhanceNavigation.
    const media = window.matchMedia('(max-width: 799px)');
    const update = () => { mobile = media.matches; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
  const navigation = $derived([
    { href: '/dashboard', label: '数据汇总', path: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7' },
    { href: '/records', label: '个人记录', path: 'M5 20V10 M12 20V4 M19 20v-7 M3 20h18' },
    { href: '/activities', label: '跑步记录', path: 'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16 M8 14h3 M8 17h7' },
    { href: '/activities/wall', label: '足迹墙', path: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
    { href: '/footprints', label: '个人足迹', path: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16' },
    { href: '/routes', label: '常跑路线', path: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 17h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5' },
    { href: '/ai', label: 'AI 分析', path: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z' },
    { href: '/wellbeing', label: '身心健康', path: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z M9 12h2l1-2 1.5 4 1-2H17' },
    ...(user && !user.is_admin ? [{ href: '/workspace/dashboard', label: '本人工作区', path: 'M3 10 12 3l9 7v10H3z' }] : [])
  ].filter(item => (item.href !== '/ai' || !!user) && (item.href !== '/wellbeing' || !!user && view.manage)));
  const modeLabel = $derived(checking ? '正在确认身份…' : context.kind === 'workspace' ? '本人工作区' : context.manage ? '管理员模式' : '个人跑步展示');
  const settings = { href: '/settings', label: '设置', path: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6' };
  const active = (href: string) => href === '/' ? pathname === '/' : href === '/settings' && pathname.startsWith('/admin/users') ? true : href.endsWith('/activities') && pathname.startsWith(`${href}/wall`) ? false : pathname === href || pathname.startsWith(`${href}/`);
  const settingsActive = $derived(active(view.href(settings.href)));
  /** The settings entry sits after the last navigation link, so reaching it always counts as moving down. */
  function visit(event: MouseEvent, href: string, index: number) {
    const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (plain) {
      const currentIndex = active(view.href(settings.href)) ? navigation.length : navigation.findIndex(entry => active(view.href(entry.href)));
      if (currentIndex !== index) onnav(index > currentIndex ? 1 : -1);
    }
    open = false;
    if (pathname === view.href(href) && plain) {
      event.preventDefault();
      if (mobile) toggle?.focus({ preventScroll: true });
    }
  }
  afterNavigate(() => { open = false; accountMenu?.close(); });
  function close(event: KeyboardEvent) { if (event.key === 'Escape' && open) { open = false; toggle?.focus(); } }
</script>
<svelte:window onkeydown={close} />
{#snippet avatarFace(alt: string)}{#if checking}…{:else if profile?.avatar_url && !avatarFailed}<img src={profile.avatar_url} {alt} onerror={() => { avatarFailed = true; }} />{:else}{Array.from(profile?.display_name || '跑者')[0]}{/if}{/snippet}
<div class="mobile-bar">
  <a href={view.href("/dashboard")} class="brand" aria-label={`${site.title} 数据汇总`}>{#if site.logo_url && !logoFailed}<img class="brand-mark brand-logo" src={site.logo_url} alt="" width="32" height="32" onerror={() => { logoFailed = true; }} />{:else}<span class="brand-mark" aria-hidden="true">{brandInitial(site.title)}</span>{/if}<span class="brand-name">{site.title}</span></a>
  <div class="mobile-actions"><ThemeToggle compact />
  <button bind:this={toggle} type="button" class="nav-toggle" aria-expanded={open} aria-controls="app-navigation" aria-label={open ? '关闭导航' : '打开导航'} onclick={() => { open = !open; }}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d={open ? 'm6 6 12 12 M6 18 18 6' : 'M4 6h16 M4 12h16 M4 18h16'} /></svg><span>导航</span>
  </button>
  </div>
</div>
<aside bind:this={sidebar} id="app-navigation" class="app-sidebar" data-floating={floating ? '' : undefined} class:nav-open={open} data-dense={navigation.length > 8 ? '' : undefined} inert={mobile && !open}>
  <div class="sidebar-brand">
    <a href={view.href("/dashboard")} class="brand desktop-brand" aria-label={`${site.title} 数据汇总`}>{#if site.logo_url && !logoFailed}<img class="brand-mark brand-logo" src={site.logo_url} alt="" width="32" height="32" onerror={() => { logoFailed = true; }} />{:else}<span class="brand-mark" aria-hidden="true">{brandInitial(site.title)}</span>{/if}<span class="brand-name">{site.title}</span></a>
    {#if site.subtitle}<p class="nav-caption">{site.subtitle}</p>{/if}
  </div>
  <nav aria-label="主要导航">
    {#each navigation as item, index}
      <a href={view.href(item.href)} aria-current={active(view.href(item.href)) ? 'page' : undefined} class="nav-link" title={item.label} aria-label={item.label} onclick={(event) => visit(event, item.href, index)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={item.path} /></svg>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
  <div class="nav-account">
    <div class="appearance-row"><ThemeToggle /></div>
    {#if sports && mounted && profile && !identityBlocked}<div class="goal-container" hidden={checking && !!user} inert={checking && !!user}>
      <AnchoredPanel label={goalLabel} panelLabel="跑量目标面板" inline={mobile}>
        {#snippet trigger()}<GoalRing progress={goal.progress} />{/snippet}
        {#key context.prefix}<RunningGoal user={profile} readonly={!view.manage} onprogress={(value) => { goal = value; }} />{/key}
      </AnchoredPanel>
    </div>{/if}
    {#if user && !checking}<div class="account-menu-host">
      <AnchoredPanel bind:this={accountMenu} label="账户菜单" panelLabel="账户">
        {#snippet trigger()}<span class="runner-avatar account-avatar" data-current={settingsActive ? '' : undefined}>{@render avatarFace('')}</span>{/snippet}
        <div class="account-menu">
          <div class="account-menu-id"><p class="text-sm font-semibold">{profile?.display_name || '跑步记录'}</p><p class="account-email" data-testid="current-user-menu">{modeLabel}</p></div>
          {#if view.manage}<a href={view.href(settings.href)} class="rn-menu-option" aria-current={settingsActive ? 'page' : undefined} onclick={(event) => { visit(event, settings.href, navigation.length); accountMenu?.close(); }}>{settings.label}</a>{/if}
          <button type="button" class="rn-menu-option" disabled={busy || !mounted} onclick={() => { accountMenu?.close(); onlogout(); }}>{busy ? '退出中…' : '退出登录'}</button>
        </div>
      </AnchoredPanel>
    </div>{:else if sports}<div class="account-avatar-slot"><span class="runner-avatar account-avatar" aria-hidden={checking || !profile?.avatar_url || avatarFailed}>{@render avatarFace(`${profile?.display_name ?? ''}的头像`)}</span></div>{/if}
    <div class="account-inline">
      <div class="runner-identity">
        {#if sports}<div class="runner-avatar" aria-hidden={checking || !profile?.avatar_url || avatarFailed}>{@render avatarFace(`${profile?.display_name ?? ''}的头像`)}</div>{/if}
        <div class="runner-identity-text">
          <p class="text-sm font-semibold runner-name" title={checking ? undefined : profile?.display_name || '跑步记录'}>{checking ? '正在确认身份…' : profile?.display_name || '跑步记录'}</p>
          <p class="account-email" data-testid="current-user">{modeLabel}</p>
        </div>
      </div>
      {#if user && !checking}<div class="account-actions">
        <button type="button" onclick={onlogout} disabled={busy || !mounted} class="button-secondary account-logout">{busy ? '退出中…' : '退出登录'}</button>
        {#if view.manage}<a href={view.href(settings.href)} class="button-secondary settings-link" aria-label={settings.label} title={settings.label} aria-current={settingsActive ? 'page' : undefined} onclick={(event) => visit(event, settings.href, navigation.length)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={settings.path} /></svg></a>{/if}
      </div>{/if}
    </div>
  </div>
</aside>
<style>
  .mobile-actions { display: flex; align-items: center; gap: var(--space-2); }
  .runner-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
  .appearance-row { margin: 0; }
  .account-actions { display: flex; align-items: center; gap: var(--space-2); }
  .account-logout { flex: 1; min-width: 0; }
  .settings-link { flex-shrink: 0; width: 2.75rem; padding: 0; }
</style>
