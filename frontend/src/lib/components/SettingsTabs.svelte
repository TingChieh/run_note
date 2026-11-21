<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  import { useSettingsHeader } from '#lib/settings-header.svelte.ts';
  import { listShoes } from '#lib/api/shoes.ts';

  export type SettingsTab = 'account' | 'shoes' | 'preferences' | 'site' | 'users';
  let { current }: { current: SettingsTab } = $props();
  const view = useViewContext();
  const header = useSettingsHeader();
  const reminderCount = $derived(header.shoeReminderCount ?? 0);

  onMount(() => {
    let disposed = false;
    let request = 0;
    async function refreshReminderCount() {
      if (!view.manage || !page.data.user) return;
      const token = ++request;
      try {
        const result = await listShoes('active', 0, 'reminder', 20);
        if (!disposed && token === request) {
          header.shoeReminderCount = result.items.filter((item) => item.reminder !== null).length;
        }
      } catch {
        // The reminder badge is non-blocking; a failed read leaves the tabs intact.
      }
    }
    if (header.shoeReminderCount === null) void refreshReminderCount();
    const onShoesChanged = () => {
      void refreshReminderCount();
    };
    window.addEventListener('runnote-shoes-changed', onShoesChanged);
    return () => {
      disposed = true;
      request++;
      window.removeEventListener('runnote-shoes-changed', onShoesChanged);
    };
  });
</script>

<nav aria-label="设置分区" class="settings-tabs">
  <a href={view.href('/settings')} aria-current={current === 'account' ? 'page' : undefined}>账户总览</a>
  <a href={view.href('/settings/shoes')} aria-current={current === 'shoes' ? 'page' : undefined}>
    跑鞋{#if reminderCount > 0}<span class="settings-tab-badge" aria-label={`${reminderCount} 双需要替换关注`}>{reminderCount}</span>{/if}
  </a>
  <a href={view.href('/settings/preferences')} aria-current={current === 'preferences' ? 'page' : undefined}>目标与隐私</a>
  {#if page.data.user?.is_admin}<a href="/settings/site" class="settings-tab-admin-start" aria-current={current === 'site' ? 'page' : undefined}>站点设置</a>{/if}
  {#if page.data.user?.is_admin}<a href="/admin/users" aria-current={current === 'users' ? 'page' : undefined}>用户管理</a>{/if}
</nav>
