<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import type { User } from '#lib/api/auth.ts';
  import RunningGoal from './RunningGoal.svelte';
  let { pathname, user, checking, busy, mounted, onlogout, sportSample = false }: { pathname: string; user: User; checking: boolean; busy: boolean; mounted: boolean; onlogout: () => void; sportSample?: boolean } = $props();
  let open = $state(false);
  let toggle: HTMLButtonElement;
  const navigation = [
    { href: '/', label: '项目概览', path: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7' },
    { href: '/activities', label: '跑步记录', path: 'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16 M8 14h3 M8 17h7' },
    { href: '/dashboard', label: '运动统计', path: 'M4 20h16 M6 16v-5 M12 16V4 M18 16V8' },
    { href: '/footprints', label: '个人足迹', path: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16' },
    { href: '/ai', label: 'AI 分析', path: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z' },
    { href: '/settings', label: '设置', path: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6' }
  ];
  const active = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  afterNavigate(() => { open = false; });
  function close(event: KeyboardEvent) { if (event.key === 'Escape' && open) { open = false; toggle?.focus(); } }
</script>
<svelte:window onkeydown={close} />
<div class="mobile-bar">
  <a href="/" class="brand" aria-label="RunNote 项目概览"><span class="brand-mark" aria-hidden="true">R</span>RunNote</a>
  <button bind:this={toggle} type="button" class="nav-toggle" aria-expanded={open} aria-controls="app-navigation" aria-label={open ? '关闭导航' : '打开导航'} onclick={() => { open = !open; }}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d={open ? 'm6 6 12 12 M6 18 18 6' : 'M4 6h16 M4 12h16 M4 18h16'} /></svg><span>导航</span>
  </button>
</div>
<aside id="app-navigation" class="app-sidebar" class:nav-open={open}>
  <a href="/" class="brand desktop-brand" aria-label="RunNote 项目概览"><span class="brand-mark" aria-hidden="true">R</span>RunNote</a>
  <p class="nav-caption">你的跑步空间</p>
  <nav aria-label="主要导航">
    {#each navigation as item}
      <a href={item.href} data-sveltekit-reload aria-current={active(item.href) ? 'page' : undefined} class="nav-link" onclick={() => { open = false; }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={item.path} /></svg>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
  <div class="nav-account">
    {#if sportSample && mounted && !checking}{#key user.id}<RunningGoal {user} />{/key}{/if}
    <div class="runner-identity">
      {#if sportSample}<div class="runner-avatar" aria-hidden="true">{checking ? '…' : Array.from(user.display_name || user.username)[0]}</div>{/if}
      <div class="runner-identity-text">
        <p class="text-sm font-semibold runner-name" title={checking ? undefined : user.display_name || user.username}>{checking ? '正在确认身份…' : user.display_name || user.username}</p>
        <p class="account-email" title={checking ? undefined : user.email} data-testid="current-user">{checking ? '正在确认身份…' : `已登录：${user.email}`}</p>
      </div>
    </div>
    {#if !checking}<button type="button" onclick={onlogout} disabled={busy || !mounted} class="button-secondary mt-3 w-full">{busy ? '退出中…' : '退出登录'}</button>{/if}
  </div>
</aside>
