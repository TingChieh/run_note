<script lang="ts">
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  let { current }: { current: 'account' | 'site' } = $props();
  const view = useViewContext();
</script>
<nav aria-label="设置分区" class="settings-tabs">
  <a href={view.href('/settings')} class="button-secondary" aria-current={current === 'account' ? 'page' : undefined}>账户设置</a>
  {#if page.data.user?.is_admin}<a href="/settings/site" class="button-secondary" aria-current={current === 'site' ? 'page' : undefined}>站点设置</a>{/if}
</nav>
<style>
  .settings-tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
  .settings-tabs [aria-current='page'] { background: var(--sport-nav-active); color: var(--sport-nav-active-ink); }
</style>
