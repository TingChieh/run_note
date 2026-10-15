<script lang="ts">
  import { onMount } from 'svelte';
  import type { User } from '#lib/api/auth.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { comparisonWindow, goalTotals, readRange, readStreaks, type Streaks } from '#lib/api/milestones.ts';
  import { validGoal, readGoals, saveGoal, type GoalPeriod } from '#lib/api/running-goal.ts';
  import type { Summary } from '#lib/api/statistics.ts';
  import FeedbackState from './FeedbackState.svelte';
  let { user }: { user: User } = $props();
  type Card = { period: GoalPeriod; title: string; icon: string; current: Summary | null; previous: Summary | null; target: number | null; input: string; editing: boolean; loading: boolean; error: string; feedback: string; token: number; saving?: boolean };
  let cards = $state<Card[]>([
    {period:'year',title:'年度目标',icon:'↗',current:null,previous:null,target:null,input:'',editing:false,loading:true,error:'',feedback:'',token:0},
    {period:'month',title:'月度目标',icon:'▦',current:null,previous:null,target:null,input:'',editing:false,loading:true,error:'',feedback:'',token:0},
    {period:'week',title:'周目标',icon:'◷',current:null,previous:null,target:null,input:'',editing:false,loading:true,error:'',feedback:'',token:0}
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
      window.location.replace('/login?reason=expired&next=%2Fdashboard'); return '';
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
  async function save(card: Card, event: SubmitEvent) {
    event.preventDefault(); const target = validGoal(card.input);
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

<section aria-label="运动目标" class="goal-overview">
  {#if goalError}<FeedbackState kind="error" title={goalError}><button class="button-secondary" onclick={()=>void readTargets()}>重试目标设置</button></FeedbackState>{/if}
  {#each cards as card (card.period)}
    {@const totals = card.current ? goalTotals(card.current,card.target) : null}
    {@const delta = card.current && card.previous ? (Number(card.current.distance_m)-Number(card.previous.distance_m))/1000 : null}
    <article class="goal-card" aria-busy={card.loading || goalLoading || !!card.saving}>
      <div class="goal-heading"><h2><span aria-hidden="true">{card.icon}</span>{card.title}</h2><button class="goal-edit" type="button" disabled={goalLoading || !!goalError || card.saving} aria-label={`${card.editing?'取消':card.target===null?'设置':'调整'}${card.title}`} aria-expanded={card.editing} onclick={()=>{card.editing=!card.editing;card.input=card.target?.toString()??'';card.feedback='';}}>{card.editing?'取消':card.target===null?'设置':'调整'}</button></div>
      {#if card.editing}<form onsubmit={(event)=>save(card,event)} class="goal-form"><label for={`overview-${card.period}`}>{card.title}距离（km）</label><div><input id={`overview-${card.period}`} inputmode="decimal" bind:value={card.input} disabled={card.saving} aria-describedby={card.feedback?`overview-feedback-${card.period}`:undefined} /><button type="submit" class="button-secondary" disabled={card.saving} aria-label={`保存${card.title}`}>{card.saving?'保存中…':'保存'}</button></div></form>{/if}
      {#if card.loading}<FeedbackState kind="loading" title="正在读取目标进度…" />{:else if card.current && totals}
        <p class="goal-value"><strong data-testid={`${card.period}-km`}>{number(totals.km)}</strong><span>/ {card.target===null?'未设置':`${number(card.target)} km`}</span></p>
        <progress value={totals.percent??0} max="100" aria-label={`${card.title}进度`}>{totals.percent===null?'未设置':`${Math.round(totals.percent)}%`}</progress>
        <div class="goal-facts"><span><span aria-hidden="true">ϟ</span> {totals.count} 次活动</span><span>{totals.hours===null?'耗时未知':`${number(totals.hours)}h`}{card.current.missing_duration_count>0 && totals.hours!==null?' 已知':''}</span></div>
        {#if delta!==null}<p class="goal-comparison" class:down={delta<0}><span aria-hidden="true">{delta<0?'↘':delta>0?'↗':'→'}</span> {number(Math.abs(delta))} km <span>vs {comparisons[card.period]}</span></p>{/if}
      {/if}
      {#if card.error}<FeedbackState kind="error" title={card.error}><button class="button-secondary" onclick={()=>void load(card)} aria-label={`重试${card.title}`}>重试</button></FeedbackState>{/if}
      {#if card.feedback}<p class="goal-feedback" id={`overview-feedback-${card.period}`} role="alert">{card.feedback}</p>{/if}
    </article>
  {/each}
  <section class="goal-card streak-card" aria-label="连续记录" aria-busy={streakLoading}>
    <h2><span aria-hidden="true">♨</span>连续记录</h2>
    {#if streakLoading}<FeedbackState kind="loading" title="正在读取连续记录…" />{:else if streakError}<FeedbackState kind="error" title={streakError}><button class="button-secondary" onclick={()=>void loadStreaks()}>重试连续记录</button></FeedbackState>{:else if streaks}
      <p class="goal-value"><strong>{streaks.current_days}</strong><span>天</span></p>
      <div class="week-strip"><div class="week-flame"><span aria-hidden="true">♨</span><strong>{streaks.current_weeks}</strong><span>周</span></div><ol aria-label="本周活动记录">{#each streaks.week as day,i}<li><span>{['一','二','三','四','五','六','日'][i]}</span><span class="week-day" class:active={day.active} class:today={day.date===streaks.today} aria-label={`${day.date}，${day.active?'有活动':'无活动'}${day.date===streaks.today?'，今天':''}`}>{Number(day.date.slice(-2))}</span></li>{/each}</ol></div>
      <p class="streak-best"><span aria-hidden="true">✦</span> 最长 {streaks.longest_days} 天 / {streaks.longest_weeks} 周</p>
    {/if}
  </section>
</section>

<style>
  .goal-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--dashboard-card-gap,1rem);min-width:0;}
  .goal-card{min-width:0;border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);padding:1.5rem;}
  .goal-heading{display:flex;align-items:center;justify-content:space-between;gap:.5rem;}
  h2{display:flex;align-items:center;gap:.6rem;color:var(--muted-foreground);font-size:1rem;font-weight:600;}
  h2>span{font-size:1.35rem;color:var(--primary);}
  .goal-edit{min-height:44px;color:var(--primary);font-size:.8rem;font-weight:650;padding:.35rem .65rem;border-radius:var(--radius-control);}
  .goal-edit:hover{background:var(--primary-soft);}
  .goal-value{display:flex;align-items:baseline;flex-wrap:wrap;gap:.5rem;margin:.8rem 0 1rem;font-variant-numeric:tabular-nums;}
  .goal-value strong{font-size:clamp(2.2rem,4vw,3rem);font-weight:750;line-height:1.15;letter-spacing:-.04em;}
  .goal-value>span{font-size:1rem;color:var(--muted-foreground);}
  progress{appearance:none;display:block;width:100%;height:.55rem;border:0;border-radius:99px;overflow:hidden;background:var(--muted);color:var(--sport-green);}
  progress::-webkit-progress-bar{background:var(--muted);border-radius:99px;}progress::-webkit-progress-value{background:var(--sport-green);border-radius:99px;}progress::-moz-progress-bar{background:var(--sport-green);border-radius:99px;}
  .goal-facts{display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-top:1rem;color:var(--muted-foreground);font-size:.875rem;}.goal-facts span[aria-hidden]{color:var(--primary);font-size:1.25rem;}
  .goal-comparison{margin-top:.5rem;color:var(--primary);font-size:.875rem;}.goal-comparison.down{color:#c33e52;}
  .goal-form{margin:.5rem 0;}.goal-form label{font-size:.875rem;}.goal-form>div{display:flex;gap:.5rem;margin-top:.35rem;}.goal-form input{min-width:0;width:100%;}.goal-feedback{font-size:.8rem;margin-top:.5rem;color:var(--primary);}
  .week-strip{display:flex;gap:.5rem;align-items:center;margin:1rem 0;}.week-strip ol{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.2rem;flex:1;min-width:0;}.week-strip li{display:grid;grid-template-columns:minmax(0,1fr);justify-items:center;gap:.35rem;min-width:0;font-size:.75rem;color:var(--muted-foreground);}
  .week-day{display:grid;place-items:center;width:100%;max-width:2rem;aspect-ratio:1;border-radius:50%;font-variant-numeric:tabular-nums;}.week-day.active{background:var(--sport-green);color:var(--sport-ink);font-weight:700;}.week-day.today{outline:2px solid var(--primary);outline-offset:2px;}
  .week-flame{display:grid;justify-items:center;color:var(--muted-foreground);font-size:.75rem;min-width:1.5rem;}.week-flame>span:first-child{color:#f68721;font-size:1.6rem;}.week-flame strong{color:var(--foreground);}
  .streak-best{color:var(--muted-foreground);font-size:.875rem;}.streak-best span{color:var(--primary);}
  @media(max-width:639px){.goal-overview{grid-template-columns:1fr;}.goal-card{padding:1.15rem;}.week-strip{gap:.5rem;}.week-day{max-width:1.8rem;}}
</style>
