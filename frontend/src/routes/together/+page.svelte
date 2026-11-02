<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import FootprintMap from '#lib/components/FootprintMap.svelte';
  import { readTogether, TogetherError, type Together } from '#lib/api/together.ts';
  let data=$state<Together | null>(null), error=$state(''), loading=$state(true), period=$state<'week'|'month'>('week'), selected=$state('');
  let disposed=false, token=0, controller:AbortController;
  const colors=$derived(Object.fromEntries((data?.participants ?? []).map((runner,index,all)=>[runner.username,`hsl(${index*360/Math.max(1,all.length)} 70% 42%)`])));
  const ranking=$derived([...(data?.participants ?? [])].sort((a,b)=>(period==='week'?b.week_m-a.week_m:b.month_m-a.month_m) || a.username.localeCompare(b.username)));
  const footprints=$derived(data ? {...data.footprints,features:data.footprints.features.filter(f=>!selected || f.properties?.username===selected)} : null);
  const km=(meters:number)=>(meters/1000).toFixed(2);
  async function load() {
    const current=++token; controller?.abort(); controller=new AbortController(); loading=true; error='';
    try { const result=await readTogether(controller.signal); if (!disposed && current===token) data=result; }
    catch(cause) { if(disposed || current!==token)return; data=null; if(cause instanceof TogetherError && cause.status===401) { window.location.replace('/admin?reason=expired'); return; } error=cause instanceof Error?cause.message:'读取失败'; }
    finally { if(!disposed && current===token) loading=false; }
  }
  onMount(()=>{void load(); return ()=>{disposed=true;token++;controller?.abort();};});
</script>
<svelte:head><title>{pageTitle('一起跑步',page.data.site)}</title></svelte:head>
<div class="together-stack">
  <PageHeader title="一起跑步" description="汇聚每一段脚步，一起探索跑过的地方。" />
  {#if loading && !data}<FeedbackState kind="loading" title="正在读取一起跑步…" />{:else if error}<FeedbackState kind="error" title={error}><button class="button-secondary" onclick={load}>重试</button></FeedbackState>{:else if data}
    <MetricSummary items={[{label:'总里程',value:`${km(data.distance_m)} km`,icon:'distance'},{label:'跑步次数',value:`${data.count} 次`,icon:'count'},{label:'参与人数',value:`${data.participants.length} 人`,icon:'days'}]} />
    <section class="aux-panel section"><h2>里程排行榜</h2><div class="compact-switch" role="group" aria-label="排行榜时间"><button type="button" aria-pressed={period==='week'} onclick={()=>period='week'}>本周</button><button type="button" aria-pressed={period==='month'} onclick={()=>period='month'}>本月</button></div>
      {#if ranking.length}<ol>{#each ranking as runner, i}<li class="row"><span>{i+1}. <a href={`/p/${encodeURIComponent(runner.username)}`}>{runner.display_name}</a></span><strong>{km(period==='week'?runner.week_m:runner.month_m)} km</strong></li>{/each}</ol>{:else}<p>还没有参与者。</p>{/if}
    </section>
    <section class="aux-panel section"><h2>一起跑过的地方</h2><p class="hint">展示最近最多 500 段经过简化的路线。</p><div class="legend" role="group" aria-label="选择参与者"><button class="button-secondary" aria-pressed={!selected} onclick={()=>selected=''}>全部</button>{#each data.participants as runner}<button class="button-secondary" aria-pressed={selected===runner.username} onclick={()=>selected=runner.username}><span class="dot" style:background={colors[runner.username]}></span>{runner.display_name}</button>{/each}</div>
      {#if footprints && data.footprints.features.length}<FootprintMap data={footprints} mapLabel="一起跑步足迹地图" participantColors={colors} onretry={load} />{:else}<p>暂无可显示的路线。</p>{/if}
    </section>
    <section class="aux-panel section"><h2>最近动态</h2>{#if data.recent.length}<ul>{#each data.recent as activity}<li class="row"><div><a href={`/p/${encodeURIComponent(activity.username)}/activities/${activity.id}`}>{activity.display_name} · {activity.title || '跑步'}</a><p class="hint">{activity.activity_date}</p></div><strong>{km(activity.distance_m)} km</strong></li>{/each}</ul>{:else}<p>暂无动态。</p>{/if}</section>
  {/if}
</div>
<style>
  .together-stack,.section { display:grid; gap:var(--space-4); min-width:0; }
  h2 { font-size:var(--text-section); font-weight:var(--weight-semibold); }
  .row { display:flex; justify-content:space-between; align-items:center; gap:var(--space-3); padding:var(--space-3) 0; border-bottom:1px solid var(--border); }
  .row a { color:var(--primary); overflow-wrap:anywhere; }
  .hint { color:var(--muted-foreground); font-size:var(--text-small); }
  .legend { display:flex; flex-wrap:wrap; gap:var(--space-2); }
  .legend button[aria-pressed='true'] { outline:2px solid var(--primary); outline-offset:2px; }
  .dot { display:inline-block; width:.75rem; height:.75rem; border-radius:50%; margin-right:var(--space-2); }
</style>
