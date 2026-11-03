<script lang="ts">
  import '#lib/styles/activity-timeline.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import FootprintMap from '#lib/components/FootprintMap.svelte';
  import { participantColors } from '#lib/map/together-colors.ts';
  import { readTogether, TogetherError, type Together } from '#lib/api/together.ts';
  let data=$state<Together | null>(null), error=$state(''), loading=$state(true), period=$state<'week'|'month'>('week'), selected=$state('');
  let disposed=false, token=0, controller:AbortController, cityWorker:Worker | undefined;
  let cityNames=$state<Record<string,string>>({});
  const colors=$derived(participantColors(data?.participants ?? []));
  const ranking=$derived([...(data?.participants ?? [])].sort((a,b)=>(period==='week'?b.week_m-a.week_m:b.month_m-a.month_m) || a.username.localeCompare(b.username)));
  const footprints=$derived(data ? {...data.footprints,features:data.footprints.features.filter(f=>!selected || f.properties?.username===selected)} : null);
  const groups=$derived.by(() => { const result: {key:string; items:Together['recent']}[]=[]; for (const item of data?.recent ?? []) { const key=item.activity_date.slice(0,7); const last=result.at(-1); if(last?.key===key) last.items.push(item); else result.push({key,items:[item]}); } return result; });
  const weekday=(date:string)=>`周${'日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
  const km=(meters:number)=>(meters/1000).toFixed(2);
  const pace=(seconds:number|null)=>seconds === null ? '—' : `${Math.floor(Math.round(seconds)/60)}'${String(Math.round(seconds)%60).padStart(2,'0')}"`;
  const amount=(runner:Together['participants'][number])=>period==='week'?runner.week_m:runner.month_m;
  async function load() {
    const current=++token; controller?.abort(); controller=new AbortController(); loading=true; error='';
    try { const result=await readTogether(controller.signal); if (!disposed && current===token) {
      data=result; cityNames={}; cityWorker?.terminate();
      try { cityWorker=new Worker(new URL('../../lib/map/together-cities.worker.ts', import.meta.url), {type:'module'}); cityWorker.onmessage=(event:MessageEvent<Record<string,string>>)=>{ if (!disposed && current===token) cityNames=event.data; }; cityWorker.postMessage(result.footprints.features); } catch { cityWorker=undefined; }
    } }
    catch(cause) { if(disposed || current!==token)return; data=null; if(cause instanceof TogetherError && cause.status===401) { window.location.replace('/admin?reason=expired'); return; } error=cause instanceof Error?cause.message:'读取失败'; }
    finally { if(!disposed && current===token) loading=false; }
  }
  onMount(()=>{void load(); return ()=>{disposed=true;token++;controller?.abort();cityWorker?.terminate();};});
</script>
<svelte:head><title>{pageTitle('一起跑步',page.data.site)}</title></svelte:head>
{#snippet avatar(runner: Together['participants'][number])}
  <span class="runner-avatar" aria-hidden="true">{#if runner.avatar_version}<img src={`/api/v1/showcase/users/${encodeURIComponent(runner.username)}/avatar?v=${runner.avatar_version}`} alt="" />{:else}{Array.from(runner.display_name)[0]}{/if}</span>
{/snippet}
<div class="together-stack">
  <PageHeader title="一起跑步" description="汇聚每一段脚步，一起探索跑过的地方。" />
  {#if loading && !data}<FeedbackState kind="loading" title="正在读取一起跑步…" />{:else if error}<FeedbackState kind="error" title={error}><button class="button-secondary" onclick={load}>重试</button></FeedbackState>{:else if data}
    {#if !data.participants.length}<section class="aux-panel section">{#if page.data.user}<p>还没有人加入一起跑步</p><p>在设置里打开『一起跑步』就能加入</p><a href="/settings">去设置里加入</a>{:else}<p>还没有人加入</p>{/if}</section>{:else}
    <section class="aux-panel section"><h2>本月我们一起跑了 <strong class="overview-distance">{km(data.distance_m)}</strong> 公里</h2><p class="overview-detail">{data.participants.length} 人 · {data.count} 次</p></section>
    <section class="aux-panel section"><h2>里程排行榜</h2><div class="mode-switch compact-switch" role="group" aria-label="排行榜时间"><button type="button" aria-pressed={period==='week'} onclick={()=>period='week'}>本周</button><button type="button" aria-pressed={period==='month'} onclick={()=>period='month'}>本月</button></div>
      {#if ranking.length}<ol>{#each ranking as runner, i}<li class="rank-row">{@render avatar(runner)}<div class="rank-content"><div class="row"><span>{i+1}. <a href={`/p/${encodeURIComponent(runner.username)}/dashboard`}>{runner.display_name}</a></span><strong>{km(amount(runner))} km</strong></div><progress style:--runner-color={colors[runner.username]} max="100" value={i===0 ? 100 : amount(ranking[0]) ? amount(runner)/amount(ranking[0])*100 : 0} aria-label={`${runner.display_name}排行进度`}></progress></div></li>{/each}</ol>{:else}<p>暂无排行。</p>{/if}
    </section>
    <section class="aux-panel section"><h2>一起跑过的地方</h2><p class="hint">展示最近最多 500 段经过简化的路线。</p>{#if footprints && data.footprints.features.length}<FootprintMap data={footprints} mapLabel="一起跑步足迹地图" participantColors={colors} quietCityFailure onretry={load} />{:else}<p>暂无可显示的路线。</p>{/if}
      <div class="legend-wrap"><div class="legend" role="region" aria-label="选择参与者"><button class="button-secondary" aria-pressed={!selected} onclick={()=>selected=''}>全部</button>{#each data.participants as runner}<button class="button-secondary" aria-pressed={selected===runner.username} onclick={()=>selected=runner.username}><span class="dot" style:background={colors[runner.username]}></span>{@render avatar(runner)}{runner.display_name}</button>{/each}</div></div>
    </section>
    <section class="aux-panel section"><h2>最近动态</h2>{#if data.recent.length}<div class="activity-timeline">{#each groups as group}<div class="timeline-month"><header class="timeline-header"><span class="timeline-month-pill">{group.key.slice(0,4)} 年 {Number(group.key.slice(5))} 月</span></header><ul class="timeline-list">{#each group.items as activity}<li><div class="timeline-gutter" aria-hidden="true"><b>{activity.activity_date.slice(8,10)}</b><span>{weekday(activity.activity_date)}</span></div><a class="timeline-card" href={`/p/${encodeURIComponent(activity.username)}/activities/${activity.id}`}>{activity.display_name}{#if cityNames[activity.id]} 在 {cityNames[activity.id]}{/if} 跑了 {km(activity.distance_m)} 公里 · 配速 {pace(activity.avg_pace_seconds_per_km)}</a></li>{/each}</ul></div>{/each}</div>{:else}<p>暂无动态。</p>{/if}</section>
    {/if}
  {/if}
</div>
<style>
  .together-stack,.section { display:grid; gap:var(--space-4); min-width:0; }
  h2 { font-size:var(--text-section); font-weight:var(--weight-semibold); }
  .overview-distance { color:var(--primary); font-size:var(--text-stat); font-weight:var(--weight-bold); font-variant-numeric:tabular-nums; }
  .overview-detail { color:var(--muted-foreground); }
  .row { display:flex; justify-content:space-between; align-items:center; gap:var(--space-3); padding:var(--space-3) 0; border-bottom:1px solid var(--border); }
  .row a { color:var(--primary); overflow-wrap:anywhere; }
  .mode-switch.compact-switch { justify-self:start; display:inline-flex; gap:var(--space-1); padding:var(--space-1); border-radius:var(--radius-pill); background:var(--segment-track); }
  .mode-switch.compact-switch button { min-height:2.75rem; padding:0 var(--space-4); border-radius:var(--radius-pill); color:var(--muted-foreground); font-weight:var(--weight-semibold); }
  .mode-switch.compact-switch button[aria-pressed='true'] { color:var(--segment-lens-ink); background:var(--segment-lens); }
  .timeline-card { display:block; min-width:0; padding:var(--space-3); border:1px solid var(--border); border-radius:var(--radius-card); background:var(--surface); color:var(--foreground); overflow-wrap:anywhere; }
  .timeline-card:focus-visible { outline-offset:-3px; }
  .hint { color:var(--muted-foreground); font-size:var(--text-small); }
  .legend-wrap { position:relative; min-width:0; }
  @media (max-width: 799px) { .legend-wrap::after { content:""; position:absolute; inset:0 0 0 auto; width:2rem; pointer-events:none; background:linear-gradient(to right, transparent, var(--surface)); } }
  .legend { display:flex; overflow-x:auto; gap:var(--space-2); padding:var(--space-2); }
  .legend button { flex:none; white-space:nowrap; }
  .legend .runner-avatar { width:1.75rem; height:1.75rem; font-size:var(--text-small); margin-right:var(--space-2); }
  .rank-row { display:flex; align-items:center; gap:var(--space-3); padding:var(--space-2) 0; }
  .rank-content { flex:1; min-width:0; }
  .rank-content .row { padding:0; border:0; }
  .rank-content progress { appearance:none; width:100%; height:.625rem; border:0; border-radius:var(--radius-pill); overflow:hidden; background:color-mix(in srgb, var(--foreground) 12%, transparent); color:var(--runner-color, var(--primary)); }
  .rank-content progress::-webkit-progress-bar { border-radius:var(--radius-pill); background:color-mix(in srgb, var(--foreground) 12%, transparent); box-shadow:inset 0 1px 2px color-mix(in srgb, var(--foreground) 12%, transparent); }
  .rank-content progress::-webkit-progress-value { border-radius:var(--radius-pill); background:var(--runner-color, var(--primary)); box-shadow:inset 0 1px color-mix(in srgb, var(--surface) 35%, transparent); }
  .rank-content progress::-moz-progress-bar { border-radius:var(--radius-pill); background:var(--runner-color, var(--primary)); box-shadow:inset 0 1px color-mix(in srgb, var(--surface) 35%, transparent); }
  .runner-avatar img { width:100%; height:100%; border-radius:50%; object-fit:cover; }
  .legend button[aria-pressed='true'] { outline:2px solid var(--primary); outline-offset:2px; }
  .dot { display:inline-block; width:.75rem; height:.75rem; border-radius:50%; margin-right:var(--space-2); }
</style>
