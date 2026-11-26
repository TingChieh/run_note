<script lang="ts">
  import { onMount } from 'svelte';
  import { useViewContext } from '#lib/view-context.ts';
  import { mobileNavigation, mobileTabFor } from '#lib/navigation.ts';
  import { attachFloatingGlass } from '#lib/styles/menu-glass.ts';
  import type { User } from '#lib/api/auth.ts';
  let { pathname, user }: { pathname: string; user: User | null } = $props();
  const view = useViewContext();
  const navigation = $derived(mobileNavigation(user, view.href));
  const current = $derived(mobileTabFor(pathname));
  let bar = $state<HTMLElement | undefined>(), mobile = $state(false);
  onMount(() => {
    // Keep in sync with the shell breakpoint (800px) in app.css and AppNavigation.svelte.
    const media = window.matchMedia('(max-width: 799px)');
    const update = () => { mobile = media.matches; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
  // Content always scrolls under this bar, so it carries the same floating glass as the phone top bar; on desktop it is display: none and keeps no filter.
  $effect(() => { if (!mobile || !bar) return; return attachFloatingGlass(bar); });
  /** Tapping the tab of the page already open returns to its top instead of reloading it. */
  function visit(event: MouseEvent, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || pathname !== href) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
</script>
{#snippet tab(item: (typeof navigation.tabs)[number])}
  <a href={item.href} class="mobile-tab" aria-current={current === item.key ? (pathname === item.href ? 'page' : 'true') : undefined} onclick={(event) => visit(event, item.href)}>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={item.icon} /></svg>
    <span>{item.label}</span>
  </a>
{/snippet}
<nav bind:this={bar} class="mobile-tabbar" aria-label="底部导航" data-testid="mobile-tabbar">
  {#each navigation.tabs.slice(0, 2) as item (item.key)}{@render tab(item)}{/each}
  {#if navigation.record}<a href={navigation.record} class="mobile-tab-record">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
    <span>开跑</span>
  </a>{/if}
  {#each navigation.tabs.slice(2) as item (item.key)}{@render tab(item)}{/each}
</nav>
