<script lang="ts">
  import { onMount } from 'svelte';
  import { request, ActivityError } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { validGoal, readGoals, saveGoal, type GoalPeriod, type RunningGoals } from '#lib/api/running-goal.ts';
  import { comparisonWindow } from '#lib/api/milestones.ts';
  import type { User } from '#lib/api/auth.ts';
  let { user }: { user: User } = $props();
  let period = $state<GoalPeriod>('week'), input = $state('');
  let goals = $state<RunningGoals>({week:null,month:null,year:null});
  let target = $derived(goals[period]);
  let goalLoading = $state(true), goalError = $state(''), saving = $state(false);
  let active = false, goalToken = 0;
  let editing = $state(false), distance = $state<number | null>(null), loading = $state(true), error = $state(''), feedback = $state('');
  let range = $state({ from: '', to: '' });
  let refresh = $state(0);
  const labels = { week: '本周', month: '本月', year: '今年' };
  let progress = $derived(target && distance !== null ? Math.min(100, distance / 1000 / target * 100) : 0);
  $effect(() => {
    const selected = period; refresh;
    let active = true;
    const requested = comparisonWindow(selected, user.timezone).current;
    range = requested;
    input = ''; distance = null; loading = true; error = ''; feedback = ''; editing = false;
    void request(`/api/v1/statistics/summary?date_from=${requested.from}&date_to=${requested.to}`, {}, fetch).then(data => {
      if (!active) return;
      const amount = (data as { distance_m?: unknown })?.distance_m;
      if ((typeof amount !== 'number' && typeof amount !== 'string') || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) throw new Error('跑量数据无效');
      distance = Number(amount);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ActivityError && cause.status === 401) { distance = null; window.location.replace('/login?reason=expired'); return; }
      error = '暂时无法读取跑量';
    }).finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });
  function failure(cause: unknown) {
    if (cause instanceof ActivityError && cause.status === 401) { active = false; goals = {week:null,month:null,year:null}; window.location.replace('/login?reason=expired'); return ''; }
    return cause instanceof Error ? cause.message : '暂时无法保存目标，请重试';
  }
  async function loadGoals() {
    const token = ++goalToken;
    try { const data = await readGoals(); if (active && token === goalToken) { goals = data; goalError = ''; } }
    catch (cause) { if (active && token === goalToken) goalError = failure(cause); }
    finally { if (active && token === goalToken) goalLoading = false; }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); const parsed = validGoal(input);
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
    window.addEventListener('runnote-goals-changed',loadGoals);window.addEventListener('focus',sync);
    return()=>{active=false;++goalToken;window.removeEventListener('runnote-goals-changed',loadGoals);window.removeEventListener('focus',sync);};
  });
</script>
<section class="running-goal" aria-label="跑量目标" aria-busy={loading || goalLoading || saving}>
  <div class="goal-heading"><strong>跑量目标</strong><button type="button" disabled={goalLoading || !!goalError || saving} onclick={() => { editing = !editing; input = target?.toString() || ''; feedback = ''; }} aria-expanded={editing}>{editing ? '取消' : target ? '调整' : '设置'}</button></div>
  <label class="sr-only" for="goal-period">目标周期</label>
  <select id="goal-period" aria-label="目标周期" bind:value={period} disabled={saving}><option value="week">每周</option><option value="month">每月</option><option value="year">年度</option></select>
  {#if editing}<form onsubmit={save}><label for="goal-km">目标距离（km）</label><div class="goal-input"><input id="goal-km" inputmode="decimal" type="text" bind:value={input} disabled={saving} aria-describedby={feedback ? 'goal-feedback' : undefined} /><button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div></form>{/if}
  {#if goalError}<p role="alert" class="goal-note">{goalError}</p><button type="button" onclick={() => void loadGoals()}>重试目标</button>{/if}
  {#if loading}<p role="status">正在读取跑量…</p>{:else if error}<p role="alert">{error}</p><button type="button" disabled={saving} onclick={() => refresh++}>重试跑量</button>{:else}
    <p class="goal-distance"><strong>{dashboardDistance(distance)}</strong><span> / {target === null ? '未设目标' : `${target} km`}</span></p>
    {#if target !== null}<progress max="100" value={progress} aria-label={`${labels[period]}跑量目标进度`}>{Math.round(progress)}%</progress><p class="goal-note">{progress >= 100 ? '目标已达成' : `已完成 ${Math.round(progress)}%`}</p>{/if}
  {/if}
  <details><summary>{labels[period]} · 统计范围</summary><p class="goal-note">{range.from} 至 {range.to}（不含结束日），截至今天。按活动当地日期归属；周一开始。目标仅供个人参考。</p></details>
  {#if feedback}<p id="goal-feedback" role="alert" class="goal-note">{feedback}</p>{/if}
</section>
<style>
  .running-goal { margin-top:1rem; padding:1rem; border-radius:1rem; background:#ffffff; color:#20332b; }
  .goal-heading { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
  button { min-height:44px; padding:.4rem .5rem; color:#17745c; font-weight:650; border-radius:.5rem; }
  button:hover { background:#e8f6df; }
  select { margin:.3rem 0 .5rem; width:100%; min-height:44px; font-size:.875rem; color:#20332b; }
  .goal-distance { margin:.3rem 0; line-height:1.6; } .goal-distance strong { font-size:1.4rem; font-variant-numeric:tabular-nums; } .goal-distance span { font-size:.75rem; color:#5c695e; }
  progress { display:block; width:100%; height:.5rem; accent-color:#218538; border:0; border-radius:1rem; overflow:hidden; }
  progress::-webkit-progress-bar { background:#e8f6df; } progress::-webkit-progress-value { background:#218538; }
  .goal-note, details { font-size:.75rem; line-height:1.6; margin-top:.4rem; } .goal-note { color:#5c695e; } summary { cursor:pointer; }
  label { font-size:.8rem; } .goal-input { display:flex; gap:.25rem; } input { min-width:0; width:100%; } form { margin:.5rem 0; }
</style>
