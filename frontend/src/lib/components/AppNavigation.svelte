<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { User } from '#lib/api/auth.ts';
  import RunningGoal from './RunningGoal.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  let { pathname, user, checking, busy, mounted, onlogout, sports = false, identityBlocked = false }: { pathname: string; user: User; checking: boolean; busy: boolean; mounted: boolean; onlogout: () => void; sports?: boolean; identityBlocked?: boolean } = $props();
  let open = $state(false);
  let mobile = $state(false);
  let toggle: HTMLButtonElement;
  onMount(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => { mobile = media.matches; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
  const navigation = [
    { href: '/dashboard', label: '数据汇总', path: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7' },
    { href: '/activities', label: '跑步记录', path: 'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16 M8 14h3 M8 17h7' },
    { href: '/activities/wall', label: '足迹墙', path: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
    { href: '/footprints', label: '个人足迹', path: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16' },
    { href: '/ai', label: 'AI 分析', path: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z' },
    { href: '/settings', label: '设置', path: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6' }
  ];
  const active = (href: string) => href === '/activities' && pathname.startsWith('/activities/wall') ? false : pathname === href || pathname.startsWith(`${href}/`);
  afterNavigate(() => { open = false; });
  function close(event: KeyboardEvent) { if (event.key === 'Escape' && open) { open = false; toggle?.focus(); } }
</script>
<svelte:window onkeydown={close} />
<div class="mobile-bar">
  <a href="/" class="brand" aria-label="RunNote 数据汇总"><span class="brand-mark" aria-hidden="true">R</span>RunNote</a>
  <div class="mobile-actions"><ThemeToggle compact />
  <button bind:this={toggle} type="button" class="nav-toggle" aria-expanded={open} aria-controls="app-navigation" aria-label={open ? '关闭导航' : '打开导航'} onclick={() => { open = !open; }}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d={open ? 'm6 6 12 12 M6 18 18 6' : 'M4 6h16 M4 12h16 M4 18h16'} /></svg><span>导航</span>
  </button>
  </div>
</div>
<aside id="app-navigation" class="app-sidebar" class:nav-open={open} inert={mobile && !open}>
  <a href="/" class="brand desktop-brand" aria-label="RunNote 数据汇总"><span class="brand-mark" aria-hidden="true">R</span>RunNote</a>
  <p class="nav-caption">你的跑步空间</p>
  <nav aria-label="主要导航">
    {#each navigation as item}
      <a href={item.href} aria-current={active(item.href) ? 'page' : undefined} class="nav-link" onclick={(event) => {
        open = false;
        if (pathname === item.href && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
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
    {#if sports && mounted && !identityBlocked}<div class="goal-container" hidden={checking} inert={checking}>{#key user.id}<RunningGoal {user} />{/key}</div>{/if}
    <div class="runner-identity">
      {#if sports}<div class="runner-avatar" aria-hidden="true">{checking ? '…' : Array.from(user.display_name || user.username)[0]}</div>{/if}
      <div class="runner-identity-text">
        <p class="text-sm font-semibold runner-name" title={checking ? undefined : user.display_name || user.username}>{checking ? '正在确认身份…' : user.display_name || user.username}</p>
        <p class="account-email" title={checking ? undefined : user.email} data-testid="current-user">{checking ? '正在确认身份…' : `已登录：${user.email}`}</p>
      </div>
    </div>
    {#if !checking}<button type="button" onclick={onlogout} disabled={busy || !mounted} class="button-secondary mt-3 w-full">{busy ? '退出中…' : '退出登录'}</button>{/if}
  </div>
</aside>
<style>
  .mobile-actions { display: flex; align-items: center; gap: var(--space-2); }
  .appearance-row { margin-bottom: var(--space-2); }
</style>
