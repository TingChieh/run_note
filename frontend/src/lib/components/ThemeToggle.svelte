<script lang="ts">
  import { onMount } from 'svelte';
  import { backOut, cubicInOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import { setThemePreference, siteDefaultTheme, themePreference, watchSystemTheme } from './system-theme.ts';
  let { compact = false }: { compact?: boolean } = $props();
  let dark = $state(false), automatic = $state(true), mounted = $state(false), siteSystem = $state(true);
  const autoLabel = $derived(siteSystem ? '跟随系统外观' : '恢复站点默认外观');
  let toggle: HTMLButtonElement;
  function absorbAuto(node: HTMLElement): (options?: { direction: 'in' | 'out' }) => TransitionConfig {
    const width = node.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(node).marginLeft);
    const target = toggle.getBoundingClientRect();
    const expansion = compact ? 0 : width + gap;
    const distance = node.getBoundingClientRect().left + expansion - (target.left + (target.width + expansion) / 2);
    return ({ direction } = { direction: 'in' }) => ({
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : direction === 'in' ? 420 : 360,
      easing: direction === 'in' ? backOut : cubicInOut,
      css: t => `width:${width * t}px;margin-left:${gap * t}px;opacity:${Math.min(t, 1)};transform:translateX(${-distance * (1 - t)}px) scale(${.06 + .94 * t});transform-origin:left center;`
    });
  }
  function followSystem() {
    toggle.focus({ preventScroll: true });
    setThemePreference('system');
  }
  onMount(() => {
    mounted = true;
    const stop = watchSystemTheme(value => { dark = value; automatic = themePreference() === 'system'; siteSystem = siteDefaultTheme() === 'system'; });
    return () => { mounted = false; stop(); };
  });
</script>
<div class="theme-controls" class:compact>
  <button bind:this={toggle} type="button" class="button-secondary theme-toggle" disabled={!mounted} aria-label={dark ? '切换到浅色模式' : '切换到深色模式'} title={dark ? '当前为夜间模式，点击切换到日间模式' : '当前为日间模式，点击切换到夜间模式'} onclick={() => setThemePreference(dark ? 'light' : 'dark')}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {#if !dark}<circle cx="12" cy="12" r="4" /><path d="M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5" />
      {:else}<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />{/if}
    </svg>
    {#if !compact}<span>{dark ? '夜间模式' : '日间模式'}</span>{/if}
  </button>
  {#if !automatic}<span class="theme-auto-slot" transition:absorbAuto inert={automatic}><button type="button" class="button-secondary theme-auto" aria-label={autoLabel} title={autoLabel} onclick={followSystem}><span aria-hidden="true">自动</span></button></span>{/if}
</div>
<style>
  .theme-controls { display: flex; align-items: center; min-width: 0; }
  .theme-toggle { flex: 1; }
  .theme-controls.compact { flex-shrink: 0; }
  .compact .theme-toggle { width: 2.75rem; padding: var(--space-2); }
  .theme-auto-slot { display: flex; flex-shrink: 0; margin-left: var(--space-2); }
  .theme-auto { flex-shrink: 0; min-width: 2.75rem; padding: var(--space-2); font-size: var(--text-caption); }
</style>
