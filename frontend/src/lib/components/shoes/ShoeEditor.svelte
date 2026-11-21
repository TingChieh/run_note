<script lang="ts">
  import { onMount } from 'svelte';
  import SaveBar from '#lib/components/SaveBar.svelte';
  import {
    createShoe,
    editShoe,
    kilometersToMeters,
    metersToKilometers,
    ShoeError,
    type ShoeInput,
    type ShoeView,
  } from '#lib/api/shoes.ts';

  let {
    shoe,
    onclose,
    onsave,
    onexpired,
  }: {
    shoe: ShoeView | null;
    onclose: () => void;
    onsave: (shoe: ShoeView) => void;
    onexpired: () => void;
  } = $props();

  const uid = $props.id();
  let dialog: HTMLDialogElement;
  let nameInput: HTMLInputElement;
  let name = $state('');
  let brand = $state('');
  let model = $state('');
  let purchased = $state('');
  let initial = $state('0');
  let threshold = $state('');
  let notes = $state('');
  let busy = $state(false);
  let error = $state('');
  let field = $state<'initial' | 'threshold' | null>(null);
  let disposed = false;
  let request = 0;

  onMount(() => {
    if (shoe) {
      name = shoe.name;
      brand = shoe.brand ?? '';
      model = shoe.model ?? '';
      purchased = shoe.purchased_on ?? '';
      initial = metersToKilometers(shoe.initial_distance_m);
      threshold = shoe.replacement_distance_m ? metersToKilometers(shoe.replacement_distance_m) : '';
      notes = shoe.notes ?? '';
    }
    dialog.showModal();
    nameInput.focus();
    return () => {
      disposed = true;
      request++;
    };
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    error = '';
    field = null;
    const initialMeters = kilometersToMeters(initial);
    const thresholdMeters = threshold.trim() ? kilometersToMeters(threshold) : null;
    if (initialMeters === null || (threshold.trim() && (!thresholdMeters || thresholdMeters === '0'))) {
      field = initialMeters === null ? 'initial' : 'threshold';
      error =
        field === 'initial'
          ? '请输入小于 1,000,000 km 的初始里程，最多 6 位小数。'
          : '请输入大于 0 且小于 1,000,000 km 的替换阈值，最多 6 位小数。';
      dialog.querySelector<HTMLInputElement>('[name="' + field + '"]')?.focus();
      return;
    }
    const payload: ShoeInput = {
      name,
      brand,
      model,
      purchased_on: purchased || null,
      notes,
      initial_distance_m: initialMeters,
      replacement_distance_m: thresholdMeters,
    };
    const token = ++request;
    busy = true;
    try {
      const result = shoe ? await editShoe(shoe.id, payload) : await createShoe(payload);
      if (!disposed && request === token) onsave(result);
    } catch (cause) {
      if (disposed || request !== token) return;
      if (cause instanceof ShoeError && cause.status === 401) {
        name = brand = model = purchased = notes = threshold = '';
        initial = '0';
        onexpired();
      } else {
        error = cause instanceof Error ? cause.message : '无法保存跑鞋';
      }
    } finally {
      if (!disposed && token === request) busy = false;
    }
  }
</script>

<dialog
  class="w-[min(36rem,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto"
  bind:this={dialog}
  aria-labelledby={uid + '-title'}
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) dialog.close();
  }}
  {onclose}
>
  <h2 class="mb-4 text-xl font-semibold" id={uid + '-title'}>{shoe ? '编辑跑鞋' : '添加跑鞋'}</h2>
  <form id={uid} class="grid gap-4" onsubmit={save}>
    <fieldset class="grid min-w-0 gap-3 sm:grid-cols-2" disabled={busy}>
      <label class="sm:col-span-2"
        >鞋名
        <input bind:this={nameInput} bind:value={name} required maxlength="80" name="name" />
      </label>
      <label>品牌 <input bind:value={brand} name="brand" maxlength="60" /></label>
      <label>型号 <input bind:value={model} name="model" maxlength="60" /></label>
      <label>购入日期 <input bind:value={purchased} name="purchased" type="date" /></label>
      <label
        >替换阈值（km）
        <input
          bind:value={threshold}
          name="threshold"
          inputmode="decimal"
          aria-invalid={field === 'threshold'}
          aria-describedby={field === 'threshold' ? uid + '-error' : undefined}
        />
      </label>
      <label class="sm:col-span-2"
        >初始里程（km）
        <input
          bind:value={initial}
          name="initial"
          inputmode="decimal"
          required
          aria-invalid={field === 'initial'}
          aria-describedby={uid + '-initial' + (field === 'initial' ? ' ' + uid + '-error' : '')}
        />
        <span class="text-sm text-muted-foreground" id={uid + '-initial'}>只填写尚未录入的里程。</span>
      </label>
      <label class="sm:col-span-2"
        >备注 <textarea bind:value={notes} name="notes" maxlength="1000" rows="3"></textarea></label
      >
    </fieldset>
    {#if error}<p role="alert" id={uid + '-error'} class="text-sm" style:color="var(--error)">{error}</p>{/if}
  </form>
  <SaveBar form={uid} dirty={!!name.trim()} {busy} label="保存跑鞋" ondiscard={() => dialog.close()} />
  {#if !name.trim() && !busy}<button class="button-secondary mt-4 min-h-11" type="button" onclick={() => dialog.close()}
      >取消</button
    >{/if}
</dialog>

<style>
  dialog {
    margin: auto;
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--foreground);
  }
  dialog::backdrop {
    background: var(--surface-backdrop);
  }
  label {
    display: grid;
    min-width: 0;
    gap: var(--space-1);
  }
  :is(input, textarea) {
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--foreground);
    padding: var(--space-2) var(--space-3);
  }
</style>
