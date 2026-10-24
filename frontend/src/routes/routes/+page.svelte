<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import RouteGroupCard from '#lib/components/RouteGroupCard.svelte';
  import { readRouteGroups as scoped_readRouteGroups, RouteGroupError, type RouteGroupList, type RouteSort } from '#lib/api/route-groups.ts';
  const view = useViewContext();
  const readRouteGroups = view.bind(scoped_readRouteGroups, 4);
  const SORTS: { value: RouteSort; label: string }[] = [{ value: 'count', label: '跑得最多' }, { value: 'recent', label: '最近跑过' }, { value: 'distance', label: '距离最长' }];
  let sort = $state<RouteSort>('count');
  let data = $state<RouteGroupList | null>(null), loading = $state(false), message = $state('');
  let requestId = 0, disposed = false, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() { timer = setTimeout(() => { void load(true); }, 5000); }
  async function load(silent = false) {
    clearTimeout(timer); timer = undefined;
    const id = ++requestId; controller?.abort(); controller = new AbortController();
    if (!silent) { loading = true; message = ''; }
    try {
      const result = await readRouteGroups(sort, 20, 0, controller.signal);
      if (disposed || id !== requestId) return;
      data = result; message = '';
      if (result.building) schedule();
    } catch (cause) {
      if (disposed || id !== requestId || controller.signal.aborted) return;
      if (cause instanceof RouteGroupError && cause.status === 401) { data = null; window.location.replace('/admin?reason=changed'); return; }
      if (silent && data) { if (data.building) schedule(); return; }
      message = cause instanceof Error ? cause.message : '无法读取常跑路线，请重试';
    } finally { if (!disposed && id === requestId) loading = false; }
  }
  function choose(next: RouteSort) {
    if (next === sort) return;
    sort = next; data = null;
    void goto(view.href(`/routes?${new URLSearchParams({ sort })}`), { state: page.state, shallow: true, replace: true }).catch(() => {});
    void load();
  }
  onMount(() => {
    disposed = false;
    const requested = new URLSearchParams(window.location.search).get('sort');
    sort = SORTS.some(item => item.value === requested) ? (requested as RouteSort) : 'count';
    void load();
    return () => { disposed = true; ++requestId; clearTimeout(timer); controller?.abort(); };
  });
</script>
<svelte:head><title>{pageTitle('常跑路线', page.data.site)}</title></svelte:head>
<PageHeader title="常跑路线" description="形状重合的跑步会自动归为同一条路线。" />
<div class="routes-page">
  <div class="mode-switch compact-switch route-sort" role="group" aria-label="排序方式">
    {#each SORTS as item}<button type="button" aria-pressed={sort === item.value} onclick={() => choose(item.value)}>{item.label}</button>{/each}
  </div>
  {#if loading}<PageSkeleton title="正在读取常跑路线…" />{/if}
  {#if message}<FeedbackState kind="error" title={message}><button class="button-secondary" onclick={() => load()}>重新读取</button></FeedbackState>{/if}
  {#if data}
    {#if data.building}<div data-testid="route-building"><FeedbackState kind="loading" title="正在整理路线…"><p>新导入的记录会在后台自动归类，页面会自动更新。</p></FeedbackState></div>{/if}
    {#if data.items.length === 0 && !data.building}
      <FeedbackState title="还没有跑过两次以上的路线"><p>同一条路线跑过两次以上后会出现在这里。</p></FeedbackState>
    {:else}
      <p class="total" aria-live="polite">共 <strong>{data.total}</strong> 条常跑路线</p>
      <div class="grid" data-testid="route-list">{#each data.items as group (group.id)}<RouteGroupCard {group} href={view.href(`/routes/${group.id}`)} />{/each}</div>
    {/if}
  {/if}
</div>
<style>
  .routes-page { display: grid; gap: var(--space-4); margin-top: var(--space-6); min-width: 0; }
  .route-sort { justify-self: start; max-width: 100%; }
  .total { color: var(--muted-foreground); font-size: var(--text-small); }
  .grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr)); }
</style>
