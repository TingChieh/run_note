<script lang="ts">
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import FootprintMap from '#lib/components/FootprintMap.svelte';
  import { footprintSelection,footprintQuery,readFootprints,FootprintError } from '#lib/api/footprints.ts';
  import type { Selection,Footprints } from '#lib/api/footprints.ts';
  let selection=$state<Selection>({year:2026,from:'2026-01-01',to:'2026-12-31',mode:'tracks',filter:'year'});
  let data=$state<Footprints|null>(null), loading=$state(false), message=$state(''), requestId=0, mounted=$state(false);
  let controller:AbortController|undefined;
  let filtersOpen=$state(true), mapVersion=$state(0);
  let shownRange=$derived(data ? `${data.date_from} — ${new Date(new Date(data.date_to).getTime()-86400000).toISOString().slice(0,10)}` : '');
  function changeMode(mode: Selection['mode']) { if(selection.mode===mode)return; selection.mode=mode; void load(); }
  async function load(save=true) {
    const id=++requestId;controller?.abort();controller=new AbortController();const signal=controller.signal;
    loading=true;data=null;message='';
    try {
      if(save)window.history.replaceState(window.history.state,'',`/footprints?${footprintQuery(selection)}`);
      const result=await readFootprints({...selection},signal);
      if(id===requestId){data=result;if(window.matchMedia('(max-width:767px)').matches)filtersOpen=false;}
    }catch(cause){if(id!==requestId || signal.aborted)return;if(cause instanceof FootprintError && cause.status===401){window.location.replace('/login?reason=changed');return;}message=cause instanceof Error?cause.message:'无法读取足迹，请重试';}
    finally{if(id===requestId)loading=false;}
  }
  onMount(()=>{
    const year=Number(new Intl.DateTimeFormat('en',{timeZone:page.data.user?.timezone??'UTC',year:'numeric'}).format(new Date()));
    filtersOpen=window.matchMedia('(min-width:768px)').matches;selection=footprintSelection(new URLSearchParams(window.location.search),year);mounted=true;void load(false);
    return()=>{++requestId;controller?.abort();};
  });
</script>
<svelte:head><title>个人足迹 · Run Note</title></svelte:head>
<PageHeader title="个人足迹" description="沿着跑过的路，看看你的运动版图。" />
<div class="footprints-page">
  <div class="mode-row"><div class="mode-switch" role="group" aria-label="地图模式"><button type="button" aria-pressed={selection.mode==='tracks'} disabled={!mounted} onclick={()=>changeMode('tracks')}>轨迹叠加</button><button type="button" aria-pressed={selection.mode==='heatmap'} disabled={!mounted} onclick={()=>changeMode('heatmap')}>运动热力图</button></div><p>{selection.mode==='tracks'?'看每次跑步的路线':'看不同记录经过的区域'}</p></div>
  <details class="filter-panel" bind:open={filtersOpen}>
    <summary>时间筛选 <span>{selection.filter==='year'?`${selection.year} 年`:`${selection.from} — ${selection.to}`}</span></summary>
    <form onsubmit={e=>{e.preventDefault();void load();}} class="filter-controls">
      <label>时间筛选<select aria-label="时间筛选" bind:value={selection.filter}><option value="year">按年份</option><option value="range">日期范围</option></select></label>
      {#if selection.filter==='year'}<label>年份<input aria-label="年份" type="number" min="1900" max="2100" step="1" bind:value={selection.year} required /></label>
      {:else}<label>开始日期<input aria-label="开始日期" type="date" min="1900-01-01" max="2100-12-31" bind:value={selection.from} required /></label><label>结束日期（含当天）<input aria-label="结束日期（含当天）" type="date" min={selection.from} max="2100-12-31" bind:value={selection.to} required /></label>{/if}
      <button disabled={!mounted} class="apply-button">应用筛选</button>
    </form>
  </details>
  {#if loading}<FeedbackState kind="loading" title="正在读取个人足迹…" />{/if}
  {#if message}<FeedbackState kind="error" title={message}><button onclick={()=>{void load();}} class="button-secondary">重新读取足迹</button><p class="mt-2">如果记录较多，可以缩小日期范围后重试。</p></FeedbackState>{/if}
  {#if data}
    <div class="result-summary" aria-live="polite"><p data-testid="footprint-summary">筛选范围内 <strong>{data.activity_count}</strong> 条运动记录，地图显示 <strong>{data.visible_activity_count}</strong> 条。</p><p class="range-label">{shownRange}</p></div>
    {#if data.unsupported_segment_count}<FeedbackState title="部分轨迹超出地图支持范围">{data.unsupported_segment_count} 个轨迹段包含超出 ±85.051129° 的极区部分，地图仅显示支持范围。</FeedbackState>{/if}
    {#if data.features.length===0}<FeedbackState title="此范围没有可显示的足迹"><p>可以调整时间筛选，或导入带路线的运动记录。</p><a href="/activities" data-sveltekit-reload class="button-secondary mt-3">导入 GPX 或查看运动记录</a></FeedbackState>
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
  .filter-panel { border-block:1px solid var(--border); padding-block:.75rem; }
  summary { cursor:pointer; font-weight:550; }
  .filter-panel summary span { margin-left:.5rem; color:var(--muted-foreground); font-size:.8125rem; font-weight:400; }
  .filter-controls { display:flex; align-items:end; flex-wrap:wrap; gap:1rem; padding-top:1rem; }
  .filter-controls label { display:grid; gap:.35rem; font-size:.875rem; }
  input,select { border-radius:var(--radius-control); background:var(--surface); border:1px solid var(--border); padding:.5rem .75rem; width:100%; }
  input[type=number] { width:7rem; }
  .apply-button { min-height:2.75rem; background:var(--primary); color:var(--primary-foreground); padding:.5rem 1rem; border-radius:var(--radius-control); font-weight:600; }
  .apply-button:hover { background:var(--primary-hover); }
  .result-summary { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:.5rem; font-size:.875rem; }
  .range-label { color:var(--muted-foreground); font-size:.8125rem; }
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
  @media(max-width:767px) { .mode-row p { display:none; } .filter-controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; } .filter-controls label { min-width:0; } .filter-controls input[type=number] { width:100%; } .apply-button { align-self:end; } .result-summary { display:grid; gap:.15rem; } }
  @media(max-width:359px) { .filter-controls { grid-template-columns:1fr; } .mode-switch button { padding:.5rem .75rem; } }
</style>
