<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import FootprintMap from '#lib/components/FootprintMap.svelte';
  import { footprintSelection,footprintQuery,readFootprints,FootprintError } from '#lib/api/footprints.ts';
  import type { Selection,Footprints } from '#lib/api/footprints.ts';
  let selection=$state<Selection>({year:2026,from:'2026-01-01',to:'2026-12-31',mode:'tracks',filter:'year'});
  let data=$state<Footprints|null>(null), loading=$state(false), message=$state(''), requestId=0, mounted=$state(false);
  let controller:AbortController|undefined;
  const records=$derived(data?.mode==='tracks'?[...new Map(data.features.map(f=>[f.properties!.activity_id,{id:String(f.properties!.activity_id),title:String(f.properties!.title),date:String(f.properties!.activity_date)}])).values()]:[]);
  async function load(save=true) {
    const id=++requestId;controller?.abort();controller=new AbortController();const signal=controller.signal;
    loading=true;data=null;message='';
    try {
      if(save)window.history.replaceState(window.history.state,'',`/footprints?${footprintQuery(selection)}`);
      const result=await readFootprints({...selection},signal);
      if(id===requestId)data=result;
    }catch(cause){if(id!==requestId || signal.aborted)return;if(cause instanceof FootprintError && cause.status===401){window.location.replace('/login?reason=changed');return;}message=cause instanceof Error?cause.message:'无法读取足迹，请重试';}
    finally{if(id===requestId)loading=false;}
  }
  onMount(()=>{
    const year=Number(new Intl.DateTimeFormat('en',{timeZone:page.data.user?.timezone??'UTC',year:'numeric'}).format(new Date()));
    selection=footprintSelection(new URLSearchParams(window.location.search),year);mounted=true;void load(false);
    return()=>{++requestId;controller?.abort();};
  });
</script>
<svelte:head><title>个人足迹 · Run Note</title></svelte:head>
<h1 class="text-3xl font-semibold tracking-tight">个人足迹</h1>
<p class="mt-3 text-muted-foreground">查看自己的跑步路线与常跑区域。点击路线选择记录，拖动或缩放地图探索足迹。</p>
<form onsubmit={e=>{e.preventDefault();void load();}} class="mt-6 flex flex-wrap items-end gap-4 rounded-xl border border-border bg-white p-5">
  <label class="text-sm">时间筛选<select aria-label="时间筛选" bind:value={selection.filter} class="mt-2 block rounded border border-border p-2"><option value="year">按年份</option><option value="range">日期范围</option></select></label>
  {#if selection.filter==='year'}<label class="text-sm">年份<input aria-label="年份" type="number" min="1900" max="2100" bind:value={selection.year} class="mt-2 block w-28 rounded border border-border p-2" required /></label>
  {:else}<label class="text-sm">开始日期<input aria-label="开始日期" type="date" min="1900-01-01" max="2100-12-31" bind:value={selection.from} class="mt-2 block rounded border border-border p-2" required /></label><label class="text-sm">结束日期（含当天）<input aria-label="结束日期" type="date" min={selection.from} max="2100-12-31" bind:value={selection.to} class="mt-2 block rounded border border-border p-2" required /></label>{/if}
  <button disabled={!mounted} class="rounded bg-primary px-4 py-2 text-white disabled:opacity-50">应用筛选</button>
  <label class="text-sm">地图模式<select aria-label="地图模式" bind:value={selection.mode} onchange={()=>{void load();}} disabled={!mounted} class="mt-2 block rounded border border-border p-2"><option value="tracks">轨迹叠加</option><option value="heatmap">运动热力图</option></select></label>
</form>
{#if loading}<p role="status" class="mt-5">正在读取个人足迹…</p>{/if}
{#if message}<p role="alert" class="mt-5 text-red-700">{message}</p><button onclick={()=>{void load();}} class="mt-2 text-primary underline">重新读取足迹</button>{/if}
{#if data}
  <p class="mt-5" data-testid="footprint-summary">筛选范围内 {data.activity_count} 条运动记录，地图显示 {data.visible_activity_count} 条。</p>
  {#if data.unsupported_segment_count}<p role="status" class="mt-2 text-muted-foreground">{data.unsupported_segment_count} 个轨迹段包含超出 ±85.051129° 的极区部分，地图仅显示支持范围。</p>{/if}
  {#if data.features.length===0}<div class="mt-5 rounded-xl border border-border bg-white p-8"><p>此范围没有可显示的足迹。</p><a href="/activities" data-sveltekit-reload class="mt-3 inline-block text-primary underline">导入 GPX 或查看运动记录</a></div>
  {:else}
    {#if data.mode==='heatmap'}<div class="mt-4 rounded-xl border border-border bg-white p-4"><p class="font-medium">每格经过的不同运动记录数（最多 {data.max_count} 次）</p><div class="mt-3 flex flex-wrap gap-4 text-sm">{#each [{color:'#c0dfac',label:'1 次'},{color:'#72b78a',label:'2–3 次'},{color:'#2d9474',label:'4–7 次'},{color:'#e69338',label:'8–15 次'},{color:'#bd432c',label:'16 次及以上'}] as level}<span class="flex items-center gap-2"><span class="h-3 w-3 rounded" style:background={level.color}></span>{level.label}</span>{/each}</div><p class="mt-3 text-sm text-muted-foreground">固定 100 × 100 投影米网格（EPSG:3857）；实际地面尺度随纬度变化。同次运动的采样、绕圈和多个段只计一次。点击热区查看经过次数。</p></div>{/if}
    {#key data}<FootprintMap {data}/>{/key}
  {/if}
  {#if records.length}<details class="mt-5 rounded-xl border border-border bg-white p-4"><summary class="cursor-pointer font-medium">全部可显示记录（{records.length}）· 详情入口</summary><ul class="mt-3 max-h-80 space-y-2 overflow-y-auto">{#each records as record}<li><a href={`/activities/${record.id}`} data-sveltekit-reload class="text-primary underline">{record.date} · {record.title || '未命名活动'}</a></li>{/each}</ul></details>{/if}
{/if}
<p class="mt-4 text-sm leading-6 text-muted-foreground">不同 GPX 轨迹段保持独立，不跨断点连线。底图向 OpenStreetMap 请求当前视口瓦片，完整 GPX 不发送给底图服务。底图不可用时仍可查看足迹；关闭底图可停止后续瓦片请求。</p>
