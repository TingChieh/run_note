<script lang="ts">
  import { onMount } from 'svelte';
  import { listShoes, readBinding, saveBinding, ShoeError, type ShoeRef } from '#lib/api/shoes.ts';
  import { useViewContext } from '#lib/view-context.ts';

  let { id, onauthrequired }: { id: string; onauthrequired: (cause: ShoeError) => void } = $props();
  const view = useViewContext();
  let current = $state<ShoeRef | null>(null);
  let options = $state<ShoeRef[]>([]);
  let choice = $state('');
  let ready = $state(false);
  let busy = $state(false);
  let fault = $state('');
  let message = $state('');
  let disposed = false;
  let request = 0;
  const selectId = $props.id();

  function showError(error: unknown, fallback: string) {
    if (error instanceof ShoeError && error.status === 401) {
      current = null;
      options = [];
      choice = '';
      ready = false;
      onauthrequired(error);
      return;
    }
    fault = error instanceof Error ? error.message : fallback;
  }

  async function load() {
    const token = ++request;
    busy = true;
    fault = '';
    try {
      const [binding, first] = await Promise.all([readBinding(id), listShoes('active', 0, 'name', 100)]);
      const available = first.items;
      for (let offset = first.limit; offset < first.total; offset += first.limit) {
        if (disposed || token !== request) return;
        available.push(...(await listShoes('active', offset, 'name', first.limit)).items);
      }
      if (disposed || token !== request) return;
      current = binding.shoe;
      options = [...new Map(available.map((shoe) => [shoe.id, shoe])).values()];
      choice = current?.id ?? '';
      ready = true;
    } catch (error) {
      if (!disposed && token === request) showError(error, '无法读取跑鞋');
    } finally {
      if (!disposed && token === request) busy = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy || choice === (current?.id ?? '')) return;
    const token = ++request;
    busy = true;
    fault = '';
    message = '';
    try {
      const result = await saveBinding(id, choice || null);
      if (disposed || token !== request) return;
      current = result.shoe;
      choice = current?.id ?? '';
      message = current ? '已保存跑鞋' : '已解绑跑鞋';
    } catch (error) {
      if (!disposed && token === request) showError(error, '无法保存跑鞋');
    } finally {
      if (!disposed && token === request) busy = false;
    }
  }

  onMount(() => {
    void load();
    return () => {
      disposed = true;
      request++;
    };
  });
</script>

<section class="shoe-binding mt-4 border-t border-border pt-4" aria-label="活动的跑鞋">
  {#if ready}
    <form class="flex flex-wrap items-end gap-3" onsubmit={save} aria-busy={busy}>
      <label class="min-w-0 flex-1 basis-48" for={selectId}>
        <span class="block font-medium">跑鞋</span>
        <span class="mb-2 block break-all text-sm text-muted-foreground">
          {current?.name ?? '未绑定'}{current?.retired_on ? '（已退役）' : ''}
        </span>
        <select
          id={selectId}
          class="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
          bind:value={choice}
          disabled={busy}
        >
          <option value="">不绑定</option>
          {#if current && !options.some((shoe) => shoe.id === current?.id)}
            <option value={current.id}>{current.name}{current.retired_on ? '（已退役）' : ''}</option>
          {/if}
          {#each options as shoe (shoe.id)}
            <option value={shoe.id}>{shoe.name}</option>
          {/each}
        </select>
      </label>
      <button class="button-secondary min-h-11" type="submit" disabled={busy || choice === (current?.id ?? '')}>
        {busy ? '保存中…' : '保存跑鞋'}
      </button>
    </form>
    {#if !options.length}
      <a class="button-secondary mt-3 min-h-11" href={view.href('/activities/shoes?add=1')}>添加跑鞋</a>
    {/if}
    {#if message}<p class="mt-2 text-sm text-muted-foreground" role="status">{message}</p>{/if}
  {:else if busy}
    <p role="status" class="text-sm text-muted-foreground">正在读取跑鞋…</p>
  {/if}
  {#if fault}
    <p role="alert" class="mt-2 text-sm" style:color="var(--error)">{fault}</p>
    {#if !ready}
      <button class="button-secondary mt-2 min-h-11" type="button" onclick={load}>重试读取跑鞋</button>
    {/if}
  {/if}
</section>
