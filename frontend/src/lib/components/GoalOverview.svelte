<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readRange = view.bind(scoped_readRange, 1);
  const readStreaks = view.bind(scoped_readStreaks, 0);
  const readGoals = view.bind(scoped_readGoals, 0);
  const saveGoal = view.bind(scoped_saveGoal, 2);

  import { onMount, tick } from 'svelte';
  import type { ShowcaseProfile } from '#lib/api/showcase.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { comparisonWindow, goalTotals, periodElapsed, readRange as scoped_readRange, readStreaks as scoped_readStreaks, type Streaks } from '#lib/api/milestones.ts';
  import { validGoal, readGoals as scoped_readGoals, saveGoal as scoped_saveGoal, type GoalPeriod } from '#lib/api/running-goal.ts';
  import type { Summary } from '#lib/api/statistics.ts';
  import { goalInputPop } from '#lib/styles/goal-input-transition.ts';
  import FeedbackState from './FeedbackState.svelte';
  let { user, readonly = false }: { user: ShowcaseProfile; readonly?: boolean } = $props();
  type Card = { period: GoalPeriod; title: string; current: Summary | null; previous: Summary | null; target: number | null; input: string; editing: boolean; loading: boolean; error: string; feedback: string; token: number; saving?: boolean };
  let cards = $state<Card[]>([
    {period:'year',title:'年度目标',current:null,previous:null,target:null,input:'',editing:false,loading:true,error:'',feedback:'',token:0},
    {period:'month',title:'月度目标',current:null,previous:null,target:null,input:'',editing:false,loading:true,error:'',feedback:'',token:0},
    {period:'week',title:'周目标',current:null,previous:null,target:null,input:'',editing:false,loading:true,error:'',feedback:'',token:0}
  ]);
  let streaks = $state<Streaks | null>(null), streakLoading = $state(true), streakError = $state('');
  let active = false;
  let goalLoading = $state(true), goalError = $state('');
  let goalToken = 0;
  const comparisons = {year:'去年同期',month:'上月同期',week:'上周同期'};
  const number = (value: number) => value.toLocaleString('zh-CN',{maximumFractionDigits:1});
  function failed(cause: unknown) {
    if (cause instanceof ActivityError && cause.status === 401) {
      active = false; streaks = null; cards.forEach(card => {card.current = null; card.previous = null;});
      window.location.replace('/admin?reason=expired&next=%2Fdashboard'); return '';
    }
    return cause instanceof Error ? cause.message : '暂时无法读取运动数据';
  }
  async function readTargets() {
    const token = ++goalToken;
    try {
      const goals = await readGoals();
      if (!active || token !== goalToken) return;
      for (const card of cards) { card.target = goals[card.period]; if (!card.editing) card.input = card.target?.toString() ?? ''; }
      goalError = '';
    } catch (cause) { if (active && token === goalToken) goalError = failed(cause); }
    finally { if (active && token === goalToken) goalLoading = false; }
  }
  async function edit(card: Card, editing: boolean) {
    if (readonly || card.saving) return;
    card.editing = editing; card.input = card.target?.toString() ?? ''; card.feedback = '';
    await tick();
    if (!active || card.editing !== editing) return;
    const control = document.getElementById(editing ? `overview-${card.period}` : `overview-edit-${card.period}`);
    control?.focus();
    if (control instanceof HTMLInputElement) control.select();
  }
  async function save(card: Card, event: SubmitEvent) {
    event.preventDefault(); if (readonly || !card.editing) return; const target = validGoal(card.input);
    if (target === null) {card.feedback = '请输入大于 0、最多 1 位小数的公里数（上限 100000）';return;}
    if (card.saving) return;
    card.saving = true; card.feedback = ''; ++goalToken;
    try {
      const saved = await saveGoal(card.period,target);
      if (!active) return;
      card.target = saved; card.editing = false; card.feedback = '';
      window.dispatchEvent(new CustomEvent('runnote-goals-changed'));
    } catch (cause) { if (active) card.feedback = failed(cause); }
    finally { if (active) card.saving = false; }
  }
  async function load(card: Card) {
    const token = ++card.token;card.loading = true;card.error = '';card.current = null;card.previous = null;
    const range = comparisonWindow(card.period,user.timezone);
    const results = await Promise.allSettled([readRange(range.current),readRange(range.previous)]);
    if (!active) return;
    for(const result of results) if(result.status==='rejected' && result.reason instanceof ActivityError && result.reason.status===401) {failed(result.reason);return;}
    if(token!==card.token)return;
    if(results[0].status==='fulfilled') card.current=results[0].value; else card.error=failed(results[0].reason);
    if(results[1].status==='fulfilled') card.previous=results[1].value; else card.error=failed(results[1].reason);
    card.loading=false;
  }
  async function loadStreaks() {
    streakLoading=true;streakError='';
    try {const data=await readStreaks();if(active)streaks=data;}
    catch(cause){if(active)streakError=failed(cause);}
    finally{if(active)streakLoading=false;}
  }
  onMount(() => {
    active=true;void readTargets();cards.forEach(card=>{void load(card);});void loadStreaks();
    const focused=()=>{if(!cards.some(card=>card.saving))void readTargets();};
    window.addEventListener('focus',focused);window.addEventListener('runnote-goals-changed',readTargets);
    return()=>{active=false;++goalToken;window.removeEventListener('focus',focused);window.removeEventListener('runnote-goals-changed',readTargets);};
  });
</script>

<!-- One ledger table (brand.md §6.6): a row per period, then the streak row; hairlines instead of cards. -->
<section aria-label="运动目标" class="goal-overview section-hairline" class:even={!goalError}>
  <div class="section-head goal-head"><h2>运动目标</h2><span class="section-meta">竖线 = 按日期此刻应到的位置</span></div>
  {#if goalError}<FeedbackState kind="error" title={goalError}><button class="button-secondary" onclick={()=>void readTargets()}>重试目标设置</button></FeedbackState>{/if}
  <div class="goal-rows">
  {#each cards as card (card.period)}
    {@const totals = card.current ? goalTotals(card.current,card.target) : null}
    {@const delta = card.current && card.previous ? (Number(card.current.distance_m)-Number(card.previous.distance_m))/1000 : null}
    {@const elapsed = periodElapsed(card.period,user.timezone)}
    <article class="goal-card" aria-busy={card.loading || goalLoading || !!card.saving}>
      <form onsubmit={(event)=>save(card,event)}>
      <div class="goal-heading"><h3>{card.title}</h3>{#if !readonly}<div class="goal-actions rn-goal-actions">
        <div class="goal-save-reveal" class:is-open={card.editing} inert={!card.editing} aria-hidden={!card.editing}>
          <div class="goal-save-clip"><button type="submit" class="button-secondary goal-edit" disabled={!card.editing || card.saving} aria-label={`保存${card.title}`}>{card.saving?'…':'保存'}</button></div>
        </div>
        <button id={`overview-edit-${card.period}`} class="button-secondary goal-edit" type="button" disabled={goalLoading || !!goalError || card.saving} aria-label={`${card.editing?'取消':card.target===null?'设置':'调整'}${card.title}`} aria-expanded={card.editing} onclick={()=>void edit(card,!card.editing)}>{card.editing?'取消':card.target===null?'设置':'调整'}</button>
      </div>{/if}</div>
      {#snippet targetValue()}
        {#if card.editing}
          <span class="goal-target">/<label class="sr-only" for={`overview-${card.period}`}>{card.title}距离（km）</label><input transition:goalInputPop id={`overview-${card.period}`} inputmode="decimal" bind:value={card.input} disabled={card.saving} aria-describedby={`overview-confirmed-${card.period}${card.feedback?` overview-feedback-${card.period}`:''}`} onkeydown={(event)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void edit(card,false);}}} /> km</span>
          <span class="sr-only" id={`overview-confirmed-${card.period}`}>已保存目标：/ {card.target===null?'未设置':`${number(card.target)} km`}</span>
        {:else}<span class="goal-readonly">/ {card.target===null?'未设置':`${number(card.target)} km`}</span>{/if}
      {/snippet}
      {#if card.editing || (!card.loading && card.current && totals)}
        <p class="goal-value"><strong data-testid={`${card.period}-km`}>{totals?number(totals.km):'—'}</strong>{@render targetValue()}</p>
      {/if}
      {#if card.loading}<FeedbackState kind="loading" title="正在读取目标进度…" />{:else if card.current && totals}
        <div class="goal-progress">
          <progress value={totals.percent??0} max="100" aria-label={`${card.title}进度`}>{totals.percent===null?'未设置':`${Math.round(totals.percent)}%`}</progress>
          {#if card.target!==null}<span class="goal-pace" style:left={`${elapsed*100}%`} aria-hidden="true"></span><span class="sr-only">按日期此刻应完成 {Math.round(elapsed*100)}%</span>{/if}
        </div>
        <div class="goal-facts"><span>{totals.count} 次 · {totals.hours===null?'耗时未知':`${number(totals.hours)}h`}{card.current.missing_duration_count>0 && totals.hours!==null?' 已知':''}</span>
        {#if delta!==null}<span class="goal-comparison" class:down={delta<0}>{delta<0?'−':delta>0?'+':'±'}{number(Math.abs(delta))} km <span>比{comparisons[card.period]}</span></span>{/if}</div>
      {/if}
      {#if card.error}<FeedbackState kind="error" title={card.error}><button type="button" class="button-secondary" disabled={card.saving} onclick={()=>void load(card)} aria-label={`重试${card.title}`}>重试</button></FeedbackState>{/if}
      {#if card.feedback}<p class="goal-feedback" id={`overview-feedback-${card.period}`} role="alert">{card.feedback}</p>{/if}
      </form>
    </article>
  {/each}
  <section class="goal-card streak-card" aria-label="连续记录" aria-busy={streakLoading}>
    <div class="goal-heading"><h3>连续记录</h3></div>
    {#if streakLoading}<FeedbackState kind="loading" title="正在读取连续记录…" />{:else if streakError}<FeedbackState kind="error" title={streakError}><button class="button-secondary" onclick={()=>void loadStreaks()}>重试连续记录</button></FeedbackState>{:else if streaks}
      <p class="goal-value"><strong>{streaks.current_days}</strong><span>天 · {streaks.current_weeks} 周</span></p>
      <ol class="week-strip" aria-label="本周活动记录">{#each streaks.week as day,i}<li><span>{['一','二','三','四','五','六','日'][i]}</span><span class="week-day" class:active={day.active} class:today={day.date===streaks.today} aria-label={`${day.date}，${day.active?'有活动':'无活动'}${day.date===streaks.today?'，今天':''}`}>{Number(day.date.slice(-2))}</span></li>{/each}</ol>
      <p class="goal-facts streak-best">最长 {streaks.longest_days} 天 / {streaks.longest_weeks} 周</p>
    {/if}
  </section>
  </div>
</section>

<style>
  /* Each row: title | figure / target | actions, then the progress rule and its facts. Rows share one height on
     wide screens so the table reads as a grid of equal lines (the streak row included). */
  .goal-head{margin-bottom:var(--space-2);}
  .goal-rows{display:grid;min-width:0;}
  .goal-overview.even .goal-rows{grid-auto-rows:1fr;}
  .goal-card{display:flex;flex-direction:column;justify-content:center;min-width:0;padding:var(--space-3) 0;}
  .goal-card + .goal-card{border-top:1px solid var(--border);}
  form{display:grid;grid-template-columns:5.5rem minmax(0,1fr) auto;grid-template-areas:"title value actions" "title progress progress" "title facts facts";column-gap:var(--space-4);align-items:center;margin:0;min-width:0;}
  .goal-heading{display:contents;}
  h3{grid-area:title;align-self:start;padding-top:.45rem;font-size:var(--text-body);font-weight:var(--weight-semibold);white-space:nowrap;}
  .goal-actions{grid-area:actions;display:flex;align-items:center;gap:0;flex-shrink:0;}
  .goal-edit{min-height:44px;min-width:44px;padding:.35rem .5rem;border:0;background:none;color:var(--primary);font-size:var(--text-small);font-weight:var(--weight-semibold);}
  @media (hover: hover) { .goal-edit:not(:disabled):hover {background:none;color:var(--primary-hover);text-decoration:underline;text-underline-offset:.2em;} }
  .goal-value{grid-area:value;display:flex;align-items:baseline;flex-wrap:nowrap;gap:.5rem;min-width:0;min-height:2.5rem;margin:0;font-variant-numeric:tabular-nums;}
  .goal-value strong{white-space:nowrap;font-size:var(--text-stat);font-weight:var(--weight-bold);line-height:var(--line-height-tight);letter-spacing:var(--tracking-tight);}
  .goal-value>span{font-family:var(--font-mono);font-size:var(--text-small);color:var(--muted-foreground);}
  .goal-card :global(.feedback){grid-column:2 / -1;}
  .goal-progress{grid-area:progress;position:relative;margin-top:var(--space-2);}
  progress{appearance:none;display:block;width:100%;height:4px;border:0;border-radius:0;overflow:hidden;background:var(--border);color:var(--primary);}
  progress::-webkit-progress-bar{background:var(--border);border-radius:0;}progress::-webkit-progress-value{background:var(--primary);border-radius:0;}progress::-moz-progress-bar{background:var(--primary);border-radius:0;}
  .goal-pace{position:absolute;top:-4px;width:2px;height:12px;margin-left:-1px;background:var(--rule);}
  .goal-facts{grid-area:facts;display:flex;justify-content:space-between;flex-wrap:wrap;gap:.25rem var(--space-3);margin-top:var(--space-2);color:var(--muted-foreground);font-size:var(--text-small);font-variant-numeric:tabular-nums;}
  .goal-comparison{color:var(--success);font-weight:var(--weight-semibold);}.goal-comparison.down{color:var(--comparison-down);}.goal-comparison span{color:var(--muted-foreground);font-weight:var(--weight-regular);}
  .goal-save-clip .goal-edit{min-width:3rem;white-space:nowrap;}
  .goal-value>.goal-target{display:flex;align-items:baseline;gap:.35rem;min-width:0;white-space:nowrap;}
  .goal-target input{width:7ch;min-width:0;min-height:0;height:1.65rem;padding:.1rem .35rem;font:inherit;line-height: var(--line-height-heading);border:1px solid var(--control-border);border-radius:var(--radius-control);background:var(--surface);color:var(--foreground);}
  .goal-target input:focus-visible{border-color:var(--ring);background:var(--primary-soft);}
  .goal-feedback{grid-column:2 / -1;font-size: var(--text-caption);margin-top:.5rem;color:var(--primary);}
  .streak-card{display:grid;grid-template-columns:5.5rem minmax(0,1fr) auto;grid-template-areas:"title value strip" "title facts facts";column-gap:var(--space-4);align-items:center;}
  .streak-card .goal-heading{display:contents;}
  .streak-card :global(.feedback){grid-column:2 / -1;}
  .week-strip{grid-area:strip;display:grid;grid-template-columns:repeat(7,1.75rem);gap:.25rem;}
  .week-strip li{display:grid;justify-items:center;gap:.125rem;font-size:var(--text-caption);color:var(--muted-foreground);}
  .week-day{display:grid;place-items:center;width:1.5rem;height:1.5rem;font-family:var(--font-mono);font-size:var(--text-caption);font-variant-numeric:tabular-nums;border:1px solid var(--border);}
  .week-day.active{border-color:var(--primary);background:var(--primary);color:var(--primary-foreground);font-weight:var(--weight-bold);}
  .week-day.today{outline:2px solid var(--rule);outline-offset:1px;}
  .streak-best{grid-area:facts;}
  /* Wide screens: one strip of four equal columns (year, month, week, streak) split by vertical hairlines. */
  @media(min-width:1024px){
    .goal-overview.even .goal-rows{grid-auto-rows:auto;}
    .goal-rows{grid-template-columns:repeat(4,minmax(0,1fr));}
    .goal-card{justify-content:flex-start;padding:var(--space-2) var(--space-6);}
    .goal-card:first-child{padding-left:0;}
    .goal-card:last-child{padding-right:0;}
    .goal-card + .goal-card{border-top:0;border-left:1px solid var(--border);}
    form{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title actions" "value value" "progress progress" "facts facts";}
    .streak-card{grid-template-columns:minmax(0,1fr);grid-template-areas:"title" "value" "strip" "facts";}
    h3{padding-top:0;align-self:center;}
    .goal-heading h3{min-height:2.75rem;display:flex;align-items:center;}
    .goal-value{margin-top:var(--space-1);}
    .week-strip{margin-top:var(--space-2);grid-template-columns:repeat(7,minmax(0,1.75rem));}
    .goal-card :global(.feedback),.goal-feedback{grid-column:1 / -1;}
  }
  /* Phones: title and its edit/save actions on one line, the figure (and the inline editor) gets the full width under
     it, so opening the editor never squeezes the number; the streak strip gets its own line. */
  @media(max-width:639px){
    .goal-overview.even .goal-rows{grid-auto-rows:auto;}
    form{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title actions" "value value" "progress progress" "facts facts";}
    .streak-card{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title value" "strip strip" "facts facts";}
    h3{padding-top:0;align-self:center;}
    .goal-progress{margin-top:var(--space-1);}
    .week-strip{margin-top:var(--space-2);}
    .streak-best{margin-top:var(--space-2);}
    .goal-card :global(.feedback),.goal-feedback{grid-column:1 / -1;}
  }
</style>
