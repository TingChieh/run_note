<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readProvinces = view.bind(scoped_readProvinces, 1);

  import { ActivityError } from '#lib/api/activities.ts';
  import { readProvinces as scoped_readProvinces, type Provinces } from '#lib/api/milestones.ts';
  import shapes from '#lib/data/china-provinces.json';
  import FeedbackState from './FeedbackState.svelte';
  let data = $state<Provinces | null>(null), loading = $state(true), error = $state(''), refresh = $state(0);
  let lit = $derived(new Map(data?.provinces.map(p=>[p.code,p]) ?? []));
  $effect(() => {
    refresh;let active=true;
    loading=true;data=null;error='';
    void readProvinces().then(result=>{if(active)data=result;}).catch(cause=>{
      if(!active)return;
      if(cause instanceof ActivityError && cause.status===401){data=null;window.location.replace('/admin?reason=expired&next=%2Fdashboard');return;}
      error=cause instanceof Error?cause.message:'暂时无法读取足迹地图';
    }).finally(()=>{if(active)loading=false;});
    return()=>{active=false;};
  });
  const label=(code: number|string,name: string)=>`${name}，${lit.has(Number(code))?'已点亮':'未点亮'}${lit.has(Number(code))?`，${lit.get(Number(code))!.activity_count} 次活动`:''}`;
</script>
<section class="province-map-card" aria-label="足迹地图" aria-busy={loading}>
  <div class="map-heading"><div><p class="eyebrow">用脚步点亮地图</p><h2>足迹地图</h2></div><p class="province-count" data-testid="province-count">{data?`${data.provinces.length} / ${data.total}`:'— / 34'}</p></div>
  <p class="map-year">全部时间 · 累计省级区域</p>
  {#if loading}<FeedbackState kind="loading" title="正在读取省份足迹…" />{:else if error}<FeedbackState kind="error" title={error}><button class="button-secondary" onclick={()=>refresh++}>重试足迹地图</button></FeedbackState>{/if}
  <svg viewBox="0 0 660 420" role="img" aria-label={`全部时间中国省级足迹地图，${data?.provinces.length??0} 个省级区域已点亮`}>
    {#each shapes as shape}<path d={shape.path} class:lit={lit.has(Number(shape.code))} class:sea={shape.code==='100000_JD'} fill-rule="evenodd"><title>{label(shape.code,shape.name)}</title></path>{/each}
    <rect x="529" y="310" width="76" height="85" rx="4" fill="none" stroke="currentColor" stroke-width=".6" opacity=".5" /><text x="533" y="405">南海诸岛</text>
  </svg>
  {#if data}
    {#if data.provinces.length}<ul class="visited-provinces" aria-label="已点亮省级区域">{#each data.provinces as province}<li><span class="province-badge" title={label(province.code,province.name)}>{province.name.replace(/省$|市$|壮族自治区$|回族自治区$|维吾尔自治区$|自治区$|特别行政区$/,'')}<span class="sr-only">，已点亮，{province.activity_count} 次活动</span></span></li>{/each}</ul>{:else}<p class="empty-map">还没有点亮省份，新的跑步路线会留下你的足迹。</p>{/if}
    <p class="map-note">根据本人全部历史轨迹与地图边界估算，近边界可能存在误差。无路线与境外记录不会点亮省份。</p>
  {/if}
  <a href={view.href("/footprints")}  class="map-link">探索详细路线 <span aria-hidden="true">→</span></a>
</section>
<style>
  .province-map-card{min-width:0;border:1px solid var(--border);border-radius:var(--radius-card);padding:var(--space-4);background:var(--surface);}
  .map-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;}h2{font-size: var(--text-section);font-weight: var(--weight-semibold);}.eyebrow{font-size: var(--text-caption);color:var(--muted-foreground);margin-bottom:.25rem;}
  .province-count{font-size: var(--text-stat);font-weight: var(--weight-bold);color:var(--primary);font-variant-numeric:tabular-nums;}.map-year{font-size: var(--text-caption);color:var(--muted-foreground);margin:.5rem 0;}
  svg{display:block;width:100%;height:auto;max-height:18rem;margin:var(--space-2) 0;color:var(--muted-foreground);}path{fill:var(--province-unvisited);stroke:var(--surface);stroke-width:.8;}path.lit{fill:var(--sport-green);}path.sea{fill:var(--province-sea);stroke:var(--province-sea);stroke-width:.65;}svg text{font-size: var(--text-caption);fill:currentColor;}
  .visited-provinces{display:flex;flex-wrap:wrap;gap:.4rem;}.visited-provinces .province-badge{display:inline-flex;align-items:center;min-height:44px;padding:.4rem .8rem;border-radius:99px;background:var(--primary-soft);color:var(--primary);font-size: var(--text-caption);font-weight: var(--weight-semibold);}
  .map-note,.empty-map{font-size: var(--text-caption);line-height: var(--line-height-body);color:var(--muted-foreground);margin-top:.75rem;}.map-link{display:flex;align-items:center;justify-content:space-between;font-size: var(--text-small);font-weight: var(--weight-semibold);color:var(--primary);margin-top:1rem;min-height:44px;}
  @media(max-width:639px){.province-map-card{padding:1.15rem;}}
</style>
