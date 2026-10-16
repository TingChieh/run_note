<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readAllFootprints = view.bind(scoped_readAllFootprints, 2);

  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import FootprintMap from '#lib/components/FootprintMap.svelte';
  import { readAllFootprints as scoped_readAllFootprints,FootprintError } from '#lib/api/footprints.ts';
  import type { Selection,FootprintsAll,FootprintSnapshot } from '#lib/api/footprints.ts';
  let mode=$state<Selection['mode']>('tracks');
  let data=$state<FootprintsAll|null>(null), loading=$state(false), message=$state(''), requestId=0, mounted=$state(false);
  let status=$state<FootprintSnapshot['status']|null>(null), generatedAt=$state<string|null>(null), refreshing=$state(false), refreshFailed=$state(false);
  let controller:AbortController|undefined, timer:ReturnType<typeof setTimeout>|undefined, disposed=false;
  let mapVersion=$state(0);
  const generatedLabel=$derived(generatedAt ? new Intl.DateTimeFormat('zh-CN',{timeZone:page.data.showcase?.timezone??'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(generatedAt)) : '');
  function changeMode(next: Selection['mode']) { if(mode===next)return; mode=next; void load(); }
  async function load() {
    clearTimeout(timer);timer=undefined;
    const id=++requestId;controller?.abort();controller=new AbortController();const signal=controller.signal;
    loading=true;data=null;message='';status=null;generatedAt=null;refreshing=false;refreshFailed=false;
    try {
      await goto(view.href(`/footprints?${new URLSearchParams({mode})}`),{state:page.state,shallow:true,replace:true});
      if(disposed || id!==requestId)return;
      const result=await readAllFootprints(mode,signal);
      if(disposed || id!==requestId)return;
      status=result.status;data=result.result;generatedAt=result.generated_at;refreshing=result.refreshing;refreshFailed=result.refresh_failed;
      if(result.status==='failed')message='足迹生成暂未完成，请稍后重新读取';
      if(result.status==='pending')timer=setTimeout(()=>{void load();},5000);
    }catch(cause){
      if(disposed || id!==requestId || signal.aborted)return;
      if(cause instanceof FootprintError && cause.status===401){data=null;status=null;generatedAt=null;refreshing=false;refreshFailed=false;window.location.replace('/admin?reason=changed');return;}
      message=cause instanceof Error?cause.message:'无法读取足迹，请重试';
    }finally{if(!disposed && id===requestId)loading=false;}
  }
  onMount(()=>{
    disposed=false;mode=new URLSearchParams(window.location.search).get('mode')==='heatmap'?'heatmap':'tracks';mounted=true;void load();
    return()=>{disposed=true;++requestId;clearTimeout(timer);controller?.abort();};
  });
</script>
<svelte:head><title>个人足迹 · Run Note</title></svelte:head>
<PageHeader title="个人足迹" description="沿着跑过的路，看看你的运动版图。" />
<div class="footprints-page">
  <div class="mode-row"><div class="mode-switch" role="group" aria-label="地图模式"><button type="button" aria-pressed={mode==='tracks'} disabled={!mounted} onclick={()=>changeMode('tracks')}>轨迹叠加</button><button type="button" aria-pressed={mode==='heatmap'} disabled={!mounted} onclick={()=>changeMode('heatmap')}>运动热力图</button></div><p>{mode==='tracks'?'看每次跑步的路线':'看不同记录经过的区域'}</p></div>
  {#if loading}<PageSkeleton title="正在读取个人足迹…" />{/if}
  {#if status==='pending'}<FeedbackState kind="loading" title="正在生成全部足迹…"><p>导入后会自动更新，完成后即可查看全部记录。页面会自动检查进度。</p><button onclick={()=>{void load();}} class="button-secondary mt-3">重新读取足迹</button></FeedbackState>{/if}
  {#if message}<FeedbackState kind="error" title={message}><button onclick={()=>{void load();}} class="button-secondary">重新读取足迹</button></FeedbackState>{/if}
  {#if data}
    {#if refreshFailed}<div data-testid="footprint-refresh-failed"><FeedbackState title="自动更新暂未完成，当前显示上次生成的足迹。"><p>后台会继续尝试更新，也可稍后重新读取。</p></FeedbackState></div>{/if}
    <div class="result-summary" aria-live="polite"><p data-testid="footprint-summary">全部 <strong>{data.activity_count}</strong> 条运动记录，地图显示 <strong>{data.visible_activity_count}</strong> 条。</p><div class="snapshot-status"><p class="generated-label" data-testid="footprint-generated">更新于 {generatedLabel}{refreshing?' · 后台更新中':''}</p><button class="button-secondary" onclick={()=>{void load();}}>重新读取足迹</button></div></div>
    {#if data.unsupported_segment_count}<FeedbackState title="部分轨迹超出地图支持范围">{data.unsupported_segment_count} 个轨迹段包含超出 ±85.051129° 的极区部分，地图仅显示支持范围。</FeedbackState>{/if}
    {#if data.features.length===0}<FeedbackState title="还没有可显示的足迹"><p>导入带路线的运动记录后，足迹会自动生成。</p><a href={view.href("/activities")}  class="button-secondary mt-3">导入 GPX 或查看运动记录</a></FeedbackState>
    {:else}
      {#key data}{#key mapVersion}<FootprintMap {data} onretry={()=>{mapVersion++;}} />{/key}{/key}
      {#if data.mode==='heatmap'}<section class="heat-legend" data-testid="heat-legend" aria-label="热度图例"><div class="legend-heading"><h2>每格经过的不同运动记录数</h2><span>当前最高 {data.max_count} 次</span></div><div class="legend-levels">{#each [{color:'#c0dfac',label:'1 次'},{color:'#72b78a',label:'2–3 次'},{color:'#2d9474',label:'4–7 次'},{color:'#e69338',label:'8–15 次'},{color:'#bd432c',label:'16 次及以上'}] as level}<span><i style:background={level.color} aria-hidden="true"></i>{level.label}</span>{/each}</div><p>热度按不同运动记录计数，不按 GPS 点数量。同一记录在同一格内只计一次。</p></section>{/if}
    {/if}
  {/if}
  <details class="map-notes"><summary>地图说明与统计口径</summary><div class="notes-content"><p>拖动地图探索，使用缩放按钮或键盘方向键移动；聚焦地图后按 + / − 缩放。轨迹模式可点击重叠路线选择记录，也可从下方记录列表定位并进入详情；热图可点击热区，或展开热区数据查看计数。</p><p>热图使用固定 100 × 100 投影米网格（EPSG:3857）；实际地面尺度随纬度变化。同次运动的采样、绕圈和多个段只计一次，不同记录再次经过才增加热度。网格及色阶不随地图缩放或年份变化。</p><p>历史日期按活动保存时的当地日期归属。不同 GPX 轨迹段保持独立，不跨断点连线。底图向 OpenStreetMap 请求当前视口瓦片，完整 GPX 不发送给底图服务。底图不可用时仍可查看足迹；关闭底图可停止后续瓦片请求。</p></div></details>
</div>
<style>
  .footprints-page { display: grid; gap: var(--space-4); margin-top: var(--space-6); min-width: 0; }
  .mode-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.75rem; }
  .mode-row p { color:var(--muted-foreground); font-size:.875rem; }
  .mode-switch { display:inline-flex; gap:.25rem; background:var(--muted); padding:.25rem; border-radius:var(--radius-control); }
  .mode-switch button { min-height:2.75rem; padding:.5rem 1rem; font-weight:600; border-radius:.45rem; color:var(--muted-foreground); }
  .mode-switch button[aria-pressed='true'] { color:var(--primary-foreground); background:var(--primary); }
  .mode-switch button:not([aria-pressed='true']):hover { color:var(--primary); background:var(--surface); }
  summary { cursor:pointer; font-weight:550; }
  .snapshot-status { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem; }
  .result-summary { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:.5rem; font-size:.875rem; }
  .generated-label { color:var(--muted-foreground); font-size:.8125rem; }
  .heat-legend { padding:.25rem .25rem .75rem; }
  .legend-heading { display:flex; flex-wrap:wrap; justify-content:space-between; gap:.5rem; font-size:.875rem; }
  .legend-heading h2 { font-weight:600; }
  .legend-heading span { color:var(--muted-foreground); }
  .legend-levels { display:flex; flex-wrap:wrap; gap:.5rem 1.25rem; margin-block:.75rem; font-size:.8125rem; }
  .legend-levels span { display:flex; align-items:center; gap:.5rem; }
  .legend-levels i { width:1rem; height:1rem; border-radius:.2rem; }
  .heat-legend p { color:var(--muted-foreground); font-size:.8125rem; }
  .map-notes { border-top:1px solid var(--border); padding-top:1rem; font-size:.875rem; }
  .map-notes summary { color:var(--primary); }
  .notes-content { display:grid; gap:.75rem; color:var(--muted-foreground); margin-top:.75rem; line-height:1.8; }
  @media(max-width:767px) { .mode-row p { display:none; } .result-summary { display:grid; gap:.5rem; } }
  @media(max-width:359px) { .mode-switch button { padding:.5rem .75rem; } }
</style>
