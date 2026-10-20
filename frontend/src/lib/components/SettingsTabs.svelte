<script lang="ts">
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  let { current }: { current: 'account' | 'site' | 'users' } = $props();
  const view = useViewContext();
</script>
<nav aria-label="设置分区" class="settings-tabs">
  <a href={view.href('/settings')} aria-current={current === 'account' ? 'page' : undefined}>账户设置</a>
  {#if page.data.user?.is_admin}<a href="/settings/site" aria-current={current === 'site' ? 'page' : undefined}>站点设置</a>{/if}
  {#if page.data.user?.is_admin}<a href="/admin/users" aria-current={current === 'users' ? 'page' : undefined}>用户管理</a>{/if}
</nav>
