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
  onMount(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => { mobile = media.matches; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
  const navigation = $derived([
    { href: '/dashboard', label: '数据汇总', path: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7' },
    { href: '/activities', label: '跑步记录', path: 'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16 M8 14h3 M8 17h7' },
    { href: '/activities/wall', label: '足迹墙', path: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
    { href: '/footprints', label: '个人足迹', path: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16' },
    { href: '/routes', label: '常跑路线', path: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 17h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5' },
    { href: '/ai', label: 'AI 分析', path: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z' },
    { href: '/settings', label: '设置', path: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6' }
    ,...(user && !user.is_admin ? [{ href: '/workspace/dashboard', label: '本人工作区', path: 'M3 10 12 3l9 7v10H3z' }] : [])
  ].filter(item => item.href !== '/settings' || view.manage));
  const active = (href: string) => href === '/' ? pathname === '/' : href === '/settings' && pathname.startsWith('/admin/users') ? true : href.endsWith('/activities') && pathname.startsWith(`${href}/wall`) ? false : pathname === href || pathname.startsWith(`${href}/`);
  afterNavigate(() => { open = false; });
  function close(event: KeyboardEvent) { if (event.key === 'Escape' && open) { open = false; toggle?.focus(); } }
</script>
<svelte:window onkeydown={close} />
<div class="mobile-bar">
  <a href={view.href("/dashboard")} class="brand" aria-label={`${site.title} 数据汇总`}>{#if site.logo_url && !logoFailed}<img class="brand-mark brand-logo" src={site.logo_url} alt="" width="32" height="32" onerror={() => { logoFailed = true; }} />{:else}<span class="brand-mark" aria-hidden="true">{brandInitial(site.title)}</span>{/if}{site.title}</a>
  <div class="mobile-actions"><ThemeToggle compact />
  <button bind:this={toggle} type="button" class="nav-toggle" aria-expanded={open} aria-controls="app-navigation" aria-label={open ? '关闭导航' : '打开导航'} onclick={() => { open = !open; }}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d={open ? 'm6 6 12 12 M6 18 18 6' : 'M4 6h16 M4 12h16 M4 18h16'} /></svg><span>导航</span>
  </button>
  </div>
</div>
<aside id="app-navigation" class="app-sidebar" class:nav-open={open} inert={mobile && !open}>
  <div class="sidebar-brand">
    <a href={view.href("/dashboard")} class="brand desktop-brand" aria-label={`${site.title} 数据汇总`}>{#if site.logo_url && !logoFailed}<img class="brand-mark brand-logo" src={site.logo_url} alt="" width="32" height="32" onerror={() => { logoFailed = true; }} />{:else}<span class="brand-mark" aria-hidden="true">{brandInitial(site.title)}</span>{/if}{site.title}</a>
    {#if site.subtitle}<p class="nav-caption">{site.subtitle}</p>{/if}
  </div>
  <nav aria-label="主要导航">
    {#each navigation as item, index}
      <a href={view.href(item.href)} aria-current={active(view.href(item.href)) ? 'page' : undefined} class="nav-link" onclick={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          const currentIndex = navigation.findIndex(entry => active(view.href(entry.href)));
          if (currentIndex !== index) onnav(index > currentIndex ? 1 : -1);
        }
        open = false;
        if (pathname === view.href(item.href) && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          if (mobile) toggle?.focus({ preventScroll: true });
        }
      }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={item.path} /></svg>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
  <div class="nav-account">
    <div class="appearance-row"><ThemeToggle /></div>
    {#if sports && mounted && profile && !identityBlocked}<div class="goal-container" hidden={checking && !!user} inert={checking && !!user}>{#key context.prefix}<RunningGoal user={profile} readonly={!view.manage} />{/key}</div>{/if}
    <div class="runner-identity">
      {#if sports}<div class="runner-avatar" aria-hidden={checking || !profile?.avatar_url || avatarFailed}>{#if checking}…{:else if profile?.avatar_url && !avatarFailed}<img src={profile.avatar_url} alt={`${profile.display_name}的头像`} onerror={() => { avatarFailed = true; }} />{:else}{Array.from(profile?.display_name || '跑者')[0]}{/if}</div>{/if}
      <div class="runner-identity-text">
        <p class="text-sm font-semibold runner-name" title={checking ? undefined : profile?.display_name || '跑步记录'}>{checking ? '正在确认身份…' : profile?.display_name || '跑步记录'}</p>
        <p class="account-email" data-testid="current-user">{checking ? '正在确认身份…' : context.kind === 'workspace' ? '本人工作区' : context.manage ? '管理员模式' : '个人跑步展示'}</p>
      </div>
    </div>
    {#if user && !checking}<button type="button" onclick={onlogout} disabled={busy || !mounted} class="button-secondary w-full">{busy ? '退出中…' : '退出登录'}</button>{/if}
  </div>
</aside>
<style>
  .mobile-actions { display: flex; align-items: center; gap: var(--space-2); }
  .runner-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
  .appearance-row { margin: 0; }
</style>
