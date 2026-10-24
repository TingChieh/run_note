<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readGoals = view.bind(scoped_readGoals, 0);
  const saveGoal = view.bind(scoped_saveGoal, 2);

  import { onMount, tick, untrack } from 'svelte';
  import { request, ActivityError } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { validGoal, readGoals as scoped_readGoals, saveGoal as scoped_saveGoal, type GoalPeriod, type RunningGoals } from '#lib/api/running-goal.ts';
  import { comparisonWindow } from '#lib/api/milestones.ts';
  import type { ShowcaseProfile } from '#lib/api/showcase.ts';
  import { goalInputPop } from '#lib/styles/goal-input-transition.ts';
  let { user, readonly = false }: { user: ShowcaseProfile; readonly?: boolean } = $props();
  let period = $state<GoalPeriod>('week'), input = $state('');
  let goals = $state<RunningGoals>({week:null,month:null,year:null});
  let target = $derived(goals[period]);
  let goalLoading = $state(true), goalError = $state(''), saving = $state(false);
  let active = false, goalToken = 0, distanceToken = 0, disposed = false;
  let editing = $state(false), distance = $state<number | null>(null), loading = $state(true), error = $state(''), feedback = $state('');
  let detailsOpen = $state(false);
  let range = $state({ from: '', to: '' });
  let refresh = $state(0);
  const timezone = $derived(user.timezone); // value-deduped: a refreshed profile object with the same timezone must not refetch
  const labels = { week: '本周', month: '本月', year: '今年' };
  let progress = $derived(target && distance !== null ? Math.min(100, distance / 1000 / target * 100) : 0);
  $effect(() => {
    const selected = period, zone = timezone; refresh;
    // Only period, refresh and timezone may refetch; view.fetch reads the route reactively, so navigation must not be tracked.
    untrack(() => {
      const requested = comparisonWindow(selected, zone).current;
      range = requested;
      input = ''; distance = null; error = ''; feedback = ''; editing = false;
      void loadDistance(requested);
    });
    return () => { ++distanceToken; };
  });
  async function loadDistance(requested: { from: string; to: string }, retain = false) {
    const token = ++distanceToken;
    if (!retain) loading = true;
    error = '';
    try {
      const data = await request(`/api/v1/showcase/statistics/summary?date_from=${requested.from}&date_to=${requested.to}`, {}, fetch);
      if (disposed || token !== distanceToken) return;
      const amount = (data as { distance_m?: unknown })?.distance_m;
      if ((typeof amount !== 'number' && typeof amount !== 'string') || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) throw new Error('跑量数据无效');
      distance = Number(amount);
    } catch (cause) {
      if (disposed) return;
      if (cause instanceof ActivityError && cause.status === 401) {
        distance = null; goals = {week:null,month:null,year:null}; input = ''; editing = false;
        window.location.replace('/admin?reason=expired'); return;
      }
      if (token !== distanceToken) return;
      error = '暂时无法读取跑量';
    } finally { if (!disposed && token === distanceToken) loading = false; }
  }
  function failure(cause: unknown) {
    if (cause instanceof ActivityError && cause.status === 401) { active = false; goals = {week:null,month:null,year:null}; window.location.replace('/admin?reason=expired'); return ''; }
    return cause instanceof Error ? cause.message : '暂时无法保存目标，请重试';
  }
  async function loadGoals() {
    const token = ++goalToken;
    try { const data = await readGoals(); if (active && token === goalToken) { goals = data; goalError = ''; } }
    catch (cause) { if (active && token === goalToken) goalError = failure(cause); }
    finally { if (active && token === goalToken) goalLoading = false; }
  }
  async function edit(next: boolean) {
    if (readonly || saving) return;
    editing = next; input = target?.toString() ?? ''; feedback = '';
    await tick();
    if (!active || editing !== next) return;
    const control = document.getElementById(next ? 'goal-km' : 'goal-edit');
    control?.focus();
    if (control instanceof HTMLInputElement) control.select();
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (readonly || !editing) return; const parsed = validGoal(input);
    if (parsed === null) { feedback = '请输入大于0、最多1位小数的公里数（上限100000）'; return; }
    if (saving) return;
    const selected = period; saving = true; feedback = ''; ++goalToken;
    try {
      const saved = await saveGoal(selected, parsed);
      if (!active) return;
      goals[selected] = saved; editing = false; feedback = '';
      window.dispatchEvent(new CustomEvent('runnote-goals-changed'));
    } catch (cause) { if (active) feedback = failure(cause); }
    finally { if (active) saving = false; }
  }
  onMount(()=>{
    active = true; void loadGoals();
    const sync = () => { if (!saving) void loadGoals(); };
    const syncDistance = () => { void loadDistance(range, true); };
    window.addEventListener('runnote-activities-changed', syncDistance);
    window.addEventListener('runnote-goals-changed',loadGoals);window.addEventListener('focus',sync);
    return()=>{active=false;disposed=true;++goalToken;++distanceToken;window.removeEventListener('runnote-activities-changed',syncDistance);window.removeEventListener('runnote-goals-changed',loadGoals);window.removeEventListener('focus',sync);};
  });
</script>
<section class="running-goal" class:is-expanded={detailsOpen} aria-label="跑量目标" aria-busy={loading || goalLoading || saving}>
  <form onsubmit={save}>
  <div class="goal-heading"><strong>跑量目标</strong>{#if !readonly}<div class="goal-actions rn-goal-actions">
    <div class="goal-save-reveal" class:is-open={editing} inert={!editing} aria-hidden={!editing}>
      <div class="goal-save-clip"><button class="button-secondary" type="submit" disabled={!editing || saving} aria-label={saving ? '保存中…' : '保存'}>{saving ? '…' : '保存'}</button></div>
    </div>
    <button id="goal-edit" class="button-secondary" type="button" disabled={goalLoading || !!goalError || saving} onclick={() => void edit(!editing)} aria-expanded={editing}>{editing ? '取消' : target ? '调整' : '设置'}</button>
  </div>{/if}<button type="button" class="goal-fold" aria-expanded={detailsOpen} onclick={() => { detailsOpen = !detailsOpen; }}>{detailsOpen ? '收起' : '详情'}</button></div>
  {#snippet distanceValue()}
    <p class="goal-distance"><strong>{dashboardDistance(distance)}</strong>
      {#if editing}<span class="goal-target"> / <label class="sr-only" for="goal-km">目标距离（km）</label><input transition:goalInputPop id="goal-km" inputmode="decimal" type="text" bind:value={input} disabled={saving} aria-describedby={`goal-confirmed${feedback ? ' goal-feedback' : ''}`} onkeydown={(event)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void edit(false);}}} /> km</span><span id="goal-confirmed" class="sr-only">已保存目标：/ {target === null ? '未设目标' : `${target} km`}</span>
      {:else}<span class="goal-readonly"> / {target === null ? '未设目标' : `${target} km`}</span>{/if}
    </p>
  {/snippet}
  {#if editing || (!loading && !error)}{@render distanceValue()}{/if}
  <div class="goal-extra">
  <label class="sr-only" for="goal-period">目标周期</label>
  <select id="goal-period" aria-label="目标周期" bind:value={period} disabled={saving}><option value="week">每周</option><option value="month">每月</option><option value="year">年度</option></select>
  {#if goalError}<p role="alert" class="goal-note">{goalError}</p><button type="button" onclick={() => void loadGoals()}>重试目标</button>{/if}
  {#if loading}<p role="status">正在读取跑量…</p>{:else if error}<p role="alert">{error}</p><button type="button" disabled={saving} onclick={() => refresh++}>重试跑量</button>{:else}
    {#if target !== null}<progress max="100" value={progress} aria-label={`${labels[period]}跑量目标进度`}>{Math.round(progress)}%</progress><p class="goal-note">{progress >= 100 ? '目标已达成' : `已完成 ${Math.round(progress)}%`}</p>{/if}
  {/if}
  <details><summary>{labels[period]} · 统计范围</summary><p class="goal-note">{range.from} 至 {range.to}（不含结束日），截至今天。按活动当地日期归属；周一开始。目标仅供个人参考。</p></details>
  </div>
  {#if feedback}<p id="goal-feedback" role="alert" class="goal-note">{feedback}</p>{/if}
  </form>
</section>
<style>
  .running-goal { margin:0; padding:var(--space-2); border-radius:var(--radius-control); background:var(--surface); color:var(--foreground); }
  .goal-fold { display:none; }
  @media (min-width:1024px) and (max-height:900px) {
    .goal-fold { display:inline-flex; min-height:2rem; padding:.2rem .45rem; font-size:.75rem; }
    .running-goal:not(.is-expanded) form { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-2); }
    .running-goal:not(.is-expanded) .goal-heading { flex:1 1 auto; }
    .running-goal:not(.is-expanded) .goal-distance { min-height:0; margin:0; }
    .running-goal:not(.is-expanded) .goal-extra { display:none; }
  }
  .goal-heading { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
  button { min-height:44px; padding:.4rem .5rem; color:var(--primary); font-weight:650; border-radius:.5rem; }
  button:hover { background:var(--primary-soft); }
  select { margin:0 0 var(--space-1); width:100%; min-height:44px; font-size:.875rem; color:var(--foreground); }
  .goal-distance { display:flex;align-items:baseline;gap:.25rem; margin:0; min-height:var(--space-8); line-height:1.4; } .goal-distance strong { font-size:1.25rem; font-variant-numeric:tabular-nums; } .goal-distance span { font-size:.75rem; color:var(--muted-foreground); }
  progress { display:block; width:100%; height:var(--space-1); accent-color:var(--primary); border:0; border-radius:1rem; overflow:hidden; }
  progress::-webkit-progress-bar { background:var(--primary-soft); } progress::-webkit-progress-value { background:var(--primary); }
  .goal-note, details { font-size:.75rem; line-height:1.4; margin-top:var(--space-1); } .goal-note { color:var(--muted-foreground); } summary { cursor:pointer; }
  .goal-heading>strong,.goal-distance strong{flex-shrink:0;}
  .goal-actions{display:flex;align-items:center;gap:0;--goal-launch-distance:var(--space-4);}.goal-actions button{font-size:.75rem;padding:.4rem .25rem;white-space:nowrap;}
  .goal-save-clip button{min-width:2rem;}
  .goal-distance>.goal-target{display:flex;align-items:baseline;gap:.2rem;min-width:0;white-space:nowrap;}
  .goal-target input{width:6ch;min-width:0;min-height:0;height:1.65rem;padding:.1rem .25rem;font:inherit;line-height:1.3;border:1px solid var(--control-hover-border);border-radius:var(--radius-control);background:color-mix(in srgb,var(--primary-soft) 55%,var(--surface));color:var(--foreground);}
  .goal-target input:focus-visible{border-color:var(--ring);background:var(--primary-soft);}
  form{margin:0;min-width:0;}
</style>
