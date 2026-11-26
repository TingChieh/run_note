<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { installCapacitorBackHandler } from '#lib/capacitor-back.ts';
  import { installCapacitorThemeSync } from '#lib/capacitor-theme.ts';

  let { children } = $props();

  onMount(() => {
    const stopTheme = installCapacitorThemeSync();
    const stopBack = installCapacitorBackHandler();
    return () => {
      stopBack();
      stopTheme();
    };
  });
</script>

<div class="mobile-shell" data-testid="mobile-local-shell">
  {@render children()}
</div>

<style>
  .mobile-shell {
    min-height: 100dvh;
    background: var(--background);
    color: var(--foreground);
    padding: max(1rem, env(safe-area-inset-top)) 1rem max(1.5rem, env(safe-area-inset-bottom));
  }
</style>
