<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import {
    deleteShoe,
    editShoe,
    getShoe,
    kmLabel,
    listShoes,
    remainingLabel,
    reminderLabel,
    ShoeError,
    shoeActivities,
    type ShoeActivities,
    type ShoeList,
    type ShoeStatus,
    type ShoeView,
  } from '#lib/api/shoes.ts';
  import ShoeEditor from './ShoeEditor.svelte';
  import ShoeProgress from './ShoeProgress.svelte';

  const view = useViewContext();
  const listUrl = $derived(view.href('/activities/shoes'));
  const status = $derived<ShoeStatus>(page.url.searchParams.get('status') === 'retired' ? 'retired' : 'active');
  const id = $derived(page.url.searchParams.get('id'));
  let shoes = $state.raw<ShoeList | null>(null);
  let lastStatus: ShoeStatus | null = null;
  let shoe = $state.raw<ShoeView | null>(null);
  let runs = $state.raw<ShoeActivities | null>(null);
  let listBusy = $state(true);
  let detailBusy = $state(false);
  let runsBusy = $state(false);
  let busy = $state(false);
  let listError = $state('');
  let detailError = $state('');
  let runsError = $state('');
  let actionError = $state('');
  let message = $state('');
  let editing = $state<ShoeView | null | undefined>(undefined);
  let mounted = $state(false);
  let disposed = false;
  let listRequest = 0;
  let detailRequest = 0;
  let runsRequest = 0;
  let actionRequest = 0;
  let deleteDialog = $state<HTMLDialogElement>(null!);
  let detailHeading = $state<HTMLHeadingElement>();
  let addButton: HTMLButtonElement;
  let restoreFocus: HTMLElement | null = null;
  let focusNextDetail = false;
  let listPosition: { element: HTMLAnchorElement; top: number } | null = null;
  const selected = $derived(id ?? shoes?.items[0]?.id ?? null);
  const freshShoe = $derived(shoe?.id === selected ? shoe : null);
  const details = (record: ShoeView) => [record.brand, record.model].filter(Boolean).join(' · ');

  function href(group: ShoeStatus, identifier?: string) {
    const query = new URLSearchParams();
    if (group === 'retired') query.set('status', group);
    if (identifier) query.set('id', identifier);
    return listUrl + (query.size ? '?' + query : '');
  }

  function expire() {
    listRequest++;
    detailRequest++;
    runsRequest++;
    actionRequest++;
    shoes = shoe = runs = null;
    editing = undefined;
    if (deleteDialog?.open) deleteDialog.close();
    window.location.replace('/admin?reason=expired');
  }

  function errorMessage(cause: unknown, fallback: string): string {
    if (cause instanceof ShoeError && cause.status === 401) {
      expire();
      return '';
    }
    return cause instanceof Error ? cause.message : fallback;
  }

  async function loadList(group: ShoeStatus, offset = 0) {
    if (disposed || group !== status) return;
    const token = ++listRequest;
    const isCurrent = () => !disposed && token === listRequest && group === status;
    listBusy = true;
    listError = '';
    try {
      const result = await listShoes(group, offset);
      if (isCurrent()) {
        lastStatus = group;
        shoes = result;
      }
    } catch (cause) {
      if (isCurrent()) listError = errorMessage(cause, '无法读取跑鞋列表');
    } finally {
      if (isCurrent()) listBusy = false;
    }
  }

  async function loadRuns(identifier: string, offset = 0) {
    const token = ++runsRequest;
    runsBusy = true;
    runsError = '';
    try {
      const result = await shoeActivities(identifier, offset);
      if (!disposed && token === runsRequest && identifier === selected) runs = result;
    } catch (cause) {
      if (!disposed && token === runsRequest) runsError = errorMessage(cause, '无法读取关联活动');
    } finally {
      if (!disposed && token === runsRequest) runsBusy = false;
    }
  }

  async function loadDetail(identifier: string | null) {
    const token = ++detailRequest;
    runsRequest++;
    runs = null;
    runsBusy = false;
    runsError = detailError = actionError = '';
    detailBusy = identifier !== null;
    if (!identifier) {
      shoe = null;
      return;
    }
    try {
      const result = await getShoe(identifier);
      if (disposed || token !== detailRequest) return;
      shoe = result;
      if (focusNextDetail) {
        focusNextDetail = false;
        void tick().then(() => detailHeading?.focus({ preventScroll: true }));
      }
      void loadRuns(identifier);
    } catch (cause) {
      if (!disposed && token === detailRequest) detailError = errorMessage(cause, '无法读取跑鞋详情');
    } finally {
      if (!disposed && token === detailRequest) detailBusy = false;
    }
  }

  function filter(group: ShoeStatus) {
    if (group !== status) listRequest++;
    if (group !== status || id) void goto(href(group), { reset: false });
  }

  async function openDetail(event: MouseEvent, record: ShoeView) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (event.currentTarget instanceof HTMLAnchorElement) {
      listPosition = { element: event.currentTarget, top: window.scrollY };
    }
    focusNextDetail = true;
    await goto(href(record.retired_on ? 'retired' : 'active', record.id), { reset: false });
    if (!disposed && shoe?.id === record.id) {
      await tick();
      focusNextDetail = false;
      detailHeading?.focus();
    }
  }

  async function backToList(event: MouseEvent) {
    if (!listPosition || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const position = listPosition;
    listPosition = null;
    await goto(href(status), { reset: false });
    if (disposed) return;
    await tick();
    window.scrollTo({ top: position.top, behavior: 'instant' });
    position.element.focus({ preventScroll: true });
  }

  function openEditor(value: ShoeView | null, opener: HTMLElement) {
    restoreFocus = opener;
    editing = value;
  }

  function closeEditor() {
    editing = undefined;
    void tick().then(() => restoreFocus?.focus());
  }

  async function saved(value: ShoeView) {
    const group = value.retired_on ? 'retired' : 'active';
    const creating = editing === null;
    closeEditor();
    message = creating ? '已添加跑鞋' : '已保存跑鞋';
    const target = href(group, value.id);
    const unchanged = target === page.url.pathname + page.url.search;
    focusNextDetail = creating;
    await goto(target, { reset: creating, replace: page.url.searchParams.has('add') });
    if (disposed) return;
    await loadList(group, group === lastStatus && !creating ? shoes?.offset : 0);
    if (unchanged) void loadDetail(value.id);
  }

  async function change(record: ShoeView, operation: 'status' | 'delete') {
    if (busy) return;
    busy = true;
    const token = ++actionRequest;
    actionError = '';
    message = '';
    try {
      if (operation === 'delete') {
        await deleteShoe(record.id);
        if (disposed || token !== actionRequest) return;
        deleteDialog.close();
        message = '已删除跑鞋';
        await goto(href(status), { replace: true, reset: false });
        if (!disposed) addButton?.focus();
      } else {
        const result = await editShoe(record.id, { retired: !record.retired_on });
        if (disposed || token !== actionRequest) return;
        message = result.retired_on ? '跑鞋已退役' : '跑鞋已恢复使用';
        focusNextDetail = true;
        await goto(href(result.retired_on ? 'retired' : 'active', record.id), { reset: false });
        if (!disposed) void loadDetail(record.id);
      }
      if (!disposed) void loadList(status);
    } catch (cause) {
      if (!disposed && token === actionRequest) actionError = errorMessage(cause, '无法更新跑鞋');
    } finally {
      if (!disposed && token === actionRequest) busy = false;
    }
  }

  onMount(() => {
    mounted = true;
    if (page.url.searchParams.get('add') === '1') openEditor(null, addButton);
    return () => {
      disposed = true;
      listRequest++;
      detailRequest++;
      runsRequest++;
      actionRequest++;
    };
  });

  $effect(() => {
    const group = status;
    if (mounted) untrack(() => void loadList(group));
  });
  $effect(() => {
    const identifier = selected;
    if (mounted) untrack(() => void loadDetail(identifier));
  });
</script>

<svelte:head><title>{pageTitle('跑鞋', page.data.site)}</title></svelte:head>
<nav aria-label="当前位置" class="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
  <a href={view.href('/activities')} class="inline-flex min-h-11 items-center underline underline-offset-4">跑步记录</a>
  <span aria-hidden="true">›</span>
  <span aria-current="page">跑鞋</span>
</nav>
<div class="shoe-heading" class:detail-open={id !== null}>
  <PageHeader title="跑鞋">
    {#snippet actions()}
      <button
        bind:this={addButton}
        class="button-primary min-h-11"
        type="button"
        onclick={(event) => openEditor(null, event.currentTarget)}><span aria-hidden="true">＋</span> 添加跑鞋</button
      >
    {/snippet}
  </PageHeader>
</div>
{#if message}<p role="status" class="mt-3 text-sm text-muted-foreground">{message}</p>{/if}

{#if !shoes && listBusy && !id}
  <PageSkeleton title="正在读取跑鞋…" />
{:else}
  <div class="shoe-layout mt-5" class:show-detail={id !== null}>
    <section class="inventory min-w-0" aria-label="跑鞋列表" aria-busy={listBusy}>
      <div class="filter-row mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="settings-tabs" role="group" aria-label="跑鞋状态">
          <button type="button" aria-pressed={status === 'active'} onclick={() => filter('active')}>使用中</button>
          <button type="button" aria-pressed={status === 'retired'} onclick={() => filter('retired')}>已退役</button>
        </div>
        {#if shoes && !listBusy}<span class="text-sm text-muted-foreground">{shoes.total} 双</span>{/if}
      </div>
      {#if listError}
        <FeedbackState kind="error" title={listError}>
          <button class="button-secondary min-h-11" onclick={() => loadList(status, shoes?.offset)}>重试</button>
        </FeedbackState>
      {/if}
      {#if shoes?.items.length}
        <ul class="grid gap-2">
          {#each shoes.items as record (record.id)}
            <li>
              <a
                class="shoe-card"
                href={href(record.retired_on ? 'retired' : 'active', record.id)}
                aria-current={selected === record.id ? 'true' : undefined}
                data-shoe-id={record.id}
                onclick={(event) => void openDetail(event, record)}
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <strong class="block">{record.name}</strong>
                    {#if details(record)}<p class="text-sm text-muted-foreground">{details(record)}</p>{/if}
                  </div>
                  <span aria-hidden="true" class="text-muted-foreground">›</span>
                </div>
                <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <strong class="text-lg tabular-nums">{kmLabel(record.total_distance_m)}</strong>
                  {#if record.reminder}
                    <span class="text-sm text-warning">{reminderLabel(record.reminder)}</span>
                  {:else if record.retired_on}
                    <span class="text-sm text-muted-foreground">已退役</span>
                  {:else if record.replacement_distance_m}
                    <span class="text-sm text-muted-foreground">阈值 {kmLabel(record.replacement_distance_m)}</span>
                  {/if}
                </div>
                <ShoeProgress shoe={record} />
              </a>
            </li>
          {/each}
        </ul>
        {#if shoes.total > shoes.limit}
          <div class="pagination" aria-label="跑鞋列表分页">
            <button
              class="button-secondary min-h-11"
              disabled={listBusy || shoes.offset === 0}
              onclick={() => loadList(status, shoes!.offset - shoes!.limit)}>上一页</button
            >
            <span class="text-sm text-muted-foreground">第 {Math.floor(shoes.offset / shoes.limit) + 1} 页</span>
            <button
              class="button-secondary min-h-11"
              disabled={listBusy || shoes.offset + shoes.limit >= shoes.total}
              onclick={() => loadList(status, shoes!.offset + shoes!.limit)}>下一页</button
            >
          </div>
        {/if}
      {:else if !listBusy && !listError}
        <FeedbackState title={status === 'active' ? '没有使用中的跑鞋' : '没有已退役的跑鞋'} />
      {/if}
    </section>

    {#if selected}
      <section class="detail min-w-0" aria-label="跑鞋详情" aria-busy={detailBusy}>
        {#if id}
          <a class="detail-back button-secondary min-h-11" href={href(status)} onclick={backToList}>← 跑鞋列表</a>
        {/if}
        {#if detailError}
          <FeedbackState kind="error" title={detailError}>
            <button class="button-secondary min-h-11" onclick={() => loadDetail(selected)}>重试</button>
          </FeedbackState>
        {/if}
        {#if freshShoe}
          {@const record = freshShoe}
          <div class="detail-card">
            <header class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 bind:this={detailHeading} tabindex="-1" class="text-xl font-semibold">{record.name}</h2>
                {#if details(record)}<p class="text-sm text-muted-foreground">{details(record)}</p>{/if}
              </div>
              <button
                class="button-secondary min-h-11"
                disabled={busy}
                type="button"
                onclick={(event) => openEditor(record, event.currentTarget)}>编辑</button
              >
            </header>
            <section class="totals" aria-label="里程">
              <p class="text-sm text-muted-foreground">累计里程</p>
              <p class="metric text-3xl font-semibold tabular-nums">{kmLabel(record.total_distance_m)}</p>
              {#if record.replacement_distance_m && !record.retired_on}
                <div class="flex flex-wrap justify-between gap-2 text-sm">
                  <span class:text-warning={record.reminder}
                    >{record.reminder ? reminderLabel(record.reminder) : '替换里程'}</span
                  >
                  <span class="text-muted-foreground">阈值 {kmLabel(record.replacement_distance_m)}</span>
                </div>
                <ShoeProgress shoe={record} />
                {#if record.remaining_distance_m}
                  <p class="text-sm text-muted-foreground">{remainingLabel(record.remaining_distance_m)}</p>
                {/if}
              {/if}
              <dl class="breakdown">
                <div>
                  <dt>初始里程</dt>
                  <dd>{kmLabel(record.initial_distance_m)}</dd>
                </div>
                <div>
                  <dt>已绑活动里程</dt>
                  <dd>{kmLabel(record.activity_distance_m)}</dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="shoe-activity-title" aria-busy={runsBusy}>
              <header class="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h3 id="shoe-activity-title" class="font-semibold">关联活动</h3>
                <span class="text-sm text-muted-foreground">{record.activity_count} 次</span>
              </header>
              {#if runsError}
                <FeedbackState kind="error" title={runsError}>
                  <button class="button-secondary min-h-11" onclick={() => loadRuns(record.id, runs?.offset)}
                    >重试</button
                  >
                </FeedbackState>
              {/if}
              {#if runs?.items.length}
                <ul>
                  {#each runs.items as activity (activity.id)}
                    <li>
                      <a class="activity-link" href={view.href('/activities/' + activity.id)}>
                        <time datetime={activity.activity_date}>{activity.activity_date}</time>
                        <span>{activity.title}</span>
                        <strong>{kmLabel(activity.distance_m)}</strong>
                      </a>
                    </li>
                  {/each}
                </ul>
                {#if runs.total > runs.limit}
                  <div class="pagination" aria-label="关联活动分页">
                    <button
                      class="button-secondary min-h-11"
                      disabled={runsBusy || runs.offset === 0}
                      onclick={() => loadRuns(record.id, runs!.offset - runs!.limit)}>上一页</button
                    >
                    <span class="text-sm text-muted-foreground">第 {Math.floor(runs.offset / runs.limit) + 1} 页</span>
                    <button
                      class="button-secondary min-h-11"
                      disabled={runsBusy || runs.offset + runs.limit >= runs.total}
                      onclick={() => loadRuns(record.id, runs!.offset + runs!.limit)}>下一页</button
                    >
                  </div>
                {/if}
              {:else if runsBusy}
                <p role="status" class="text-sm text-muted-foreground">正在读取关联活动…</p>
              {:else if !runsError}
                <FeedbackState title="暂无关联活动">
                  <a class="button-secondary min-h-11" href={view.href('/activities')}>查看跑步记录</a>
                </FeedbackState>
              {/if}
            </section>
            <details class="border-t border-border">
              <summary class="cursor-pointer py-3 font-medium">跑鞋资料</summary>
              <dl class="grid gap-2 text-sm">
                <div class="flex flex-wrap gap-2">
                  <dt class="text-muted-foreground">购入日期</dt>
                  <dd>{record.purchased_on ?? '—'}</dd>
                </div>
                {#if record.retired_on}<div class="flex flex-wrap gap-2">
                    <dt class="text-muted-foreground">退役日期</dt>
                    <dd>{record.retired_on}</dd>
                  </div>{/if}
                {#if record.notes}<div>
                    <dt class="text-muted-foreground">备注</dt>
                    <dd class="whitespace-pre-wrap">{record.notes}</dd>
                  </div>{/if}
              </dl>
            </details>
            <div class="flex flex-wrap gap-2">
              <button
                class="button-secondary min-h-11"
                type="button"
                disabled={busy}
                onclick={() => change(record, 'status')}>{record.retired_on ? '恢复使用' : '退役跑鞋'}</button
              >
              <button
                class="button-secondary min-h-11 shoe-danger"
                type="button"
                disabled={busy}
                onclick={() => {
                  actionError = '';
                  deleteDialog.showModal();
                }}>删除跑鞋</button
              >
            </div>
            {#if actionError && !deleteDialog?.open}<p role="alert" class="shoe-danger text-sm">{actionError}</p>{/if}
          </div>
        {:else if detailBusy}
          <PageSkeleton title="正在读取跑鞋详情…" />
        {/if}
      </section>
    {/if}
  </div>
{/if}

<dialog
  bind:this={deleteDialog}
  aria-labelledby="shoe-delete-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
  onclose={() => {
    actionError = '';
  }}
>
  <h2 class="text-xl font-semibold" id="shoe-delete-title">删除跑鞋？</h2>
  <p class="mt-2 text-muted-foreground">删除后无法恢复。仍有关联活动的跑鞋可保留或退役。</p>
  {#if actionError}<p role="alert" class="shoe-danger mt-2 text-sm">{actionError}</p>{/if}
  <div class="mt-4 flex flex-wrap justify-end gap-2">
    <button class="button-secondary min-h-11" type="button" disabled={busy} onclick={() => deleteDialog.close()}
      >取消</button
    >
    <button
      class="button-primary min-h-11"
      type="button"
      disabled={busy || !freshShoe}
      onclick={() => {
        if (freshShoe) void change(freshShoe, 'delete');
      }}>{busy ? '删除中…' : '确认删除'}</button
    >
  </div>
</dialog>

{#if editing !== undefined}
  <ShoeEditor shoe={editing} onclose={closeEditor} onsave={(value) => void saved(value)} onexpired={expire} />
{/if}

<style>
  .shoe-layout {
    display: grid;
    align-items: start;
    gap: var(--space-6);
  }
  .shoe-card,
  .detail-card {
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    display: grid;
    gap: var(--space-3);
    overflow-wrap: anywhere;
  }
  .shoe-card:hover,
  .shoe-card[aria-current='true'] {
    border-color: var(--primary);
  }
  .detail-card {
    gap: var(--space-4);
  }
  .detail-back {
    margin-bottom: var(--space-3);
  }
  .totals {
    display: grid;
    gap: var(--space-2);
    border-block: 1px solid var(--border);
    padding-block: var(--space-3);
  }
  .breakdown {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    border-top: 1px solid var(--border);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
  }
  .breakdown dt {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .breakdown dd {
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-medium);
  }
  .activity-link {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    border-top: 1px solid var(--border);
    padding-block: var(--space-2);
    font-size: var(--text-small);
  }
  .activity-link:hover {
    text-decoration: underline;
  }
  .activity-link time {
    color: var(--muted-foreground);
  }
  .activity-link strong {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .pagination {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .inventory .settings-tabs button {
    min-height: 2.75rem;
  }
  .filter-row .settings-tabs {
    width: auto;
  }
  .shoe-danger {
    color: var(--error);
  }
  dialog {
    width: min(28rem, calc(100% - 2rem));
    overflow-wrap: anywhere;
  }
  @media (min-width: 1024px) {
    .shoe-layout {
      grid-template-columns: minmax(0, 3fr) minmax(0, 7fr);
    }
    .detail-back {
      display: none;
    }
    .detail-card {
      padding: var(--space-6);
    }
  }
  @media (max-width: 1023px) {
    .shoe-layout:not(.show-detail) .detail,
    .shoe-layout.show-detail .inventory {
      display: none;
    }
    .shoe-heading.detail-open {
      display: none;
    }
  }
  @media (max-width: 639px) {
    .shoe-heading :global(.button-primary) {
      width: 100%;
    }
    .shoe-heading :global(.page-header) {
      gap: var(--space-2);
    }
  }
  @media (max-width: 390px) {
    .activity-link {
      grid-template-columns: minmax(0, 1fr) minmax(0, auto);
    }
    .activity-link time {
      grid-column: 1 / -1;
    }
  }
</style>
