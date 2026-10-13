<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Map as LibreMap } from 'maplibre-gl';
  import type { Footprints } from '#lib/api/footprints.ts';
  import { coordinates, displayFootprints } from '#lib/api/footprints.ts';
  import { BASEMAP_SOURCE, BASEMAP_LAYER, BASEMAP_TIMEOUT_MS, createRouteMapStyle, createBasemapSource, isBasemapError } from '#lib/api/map-style.ts';
  import 'maplibre-gl/dist/maplibre-gl.css';
  let { data }: {data: Footprints} = $props();
  let container: HTMLDivElement, map: LibreMap | undefined, disposed=false;
  let ready=$state(false), error=$state(''), basemap=$state<'loading'|'ready'|'failed'|'off'>('loading');
  let choices=$state<{id:string;title:string;date:string}[]>([]), heat=$state<number|null>(null);
  let timer: ReturnType<typeof setTimeout>|undefined, observer: ResizeObserver|undefined;
  const palette=['#14785b','#315caf','#b4552c','#854caa','#397d87','#ba3970'];
  function removeBasemap() { clearTimeout(timer); if(map?.getLayer(BASEMAP_LAYER))map.removeLayer(BASEMAP_LAYER); if(map?.getSource(BASEMAP_SOURCE))map.removeSource(BASEMAP_SOURCE); }
  function failBasemap() { if(disposed || basemap==='off')return; removeBasemap(); basemap='failed'; }
  function loadBasemap() { if(!map || disposed)return; removeBasemap(); basemap='loading'; map.addSource(BASEMAP_SOURCE,createBasemapSource()); map.addLayer({id:BASEMAP_LAYER,type:'raster',source:BASEMAP_SOURCE},'footprint-fill'); timer=setTimeout(failBasemap,BASEMAP_TIMEOUT_MS); }
  function toggleBasemap() { if(basemap==='off')loadBasemap(); else {removeBasemap();basemap='off';} }
  onMount(()=>{void(async()=>{
    try {
      const lib=await import('maplibre-gl'); if(disposed)return;
      const display=displayFootprints(data);
      const all=display.features.flatMap(f=>coordinates(f.geometry));
      map=new lib.Map({container,style:createRouteMapStyle(),center:all[0]??[0,0],zoom:13,maxZoom:19,attributionControl:false});
      map.addControl(new lib.NavigationControl({showCompass:false}),'top-right');
      observer=new ResizeObserver(()=>map?.resize()); observer.observe(container);
      map.on('error',e=>{if(isBasemapError(e))failBasemap();else error='地图绘制失败，请刷新重试。下方记录入口仍可使用。';});
      map.on('sourcedata',e=>{if(e.sourceId===BASEMAP_SOURCE && e.sourceDataType!=='metadata' && e.isSourceLoaded && basemap==='loading'){clearTimeout(timer);basemap='ready';}});
      map.on('load',()=>{
        if(!map || disposed)return;
        const ids=[...new Set(data.features.map(f=>f.properties?.activity_id))];
        const features=display.features.map(f=>({...f,properties:{...f.properties,color:palette[ids.indexOf(f.properties?.activity_id)%palette.length]}}));
        map.addSource('footprints',{type:'geojson',data:{type:'FeatureCollection',features}});
        map.addLayer({id:'footprint-fill',type:'fill',source:'footprints',filter:['==','$type','Polygon'],paint:{'fill-color':['step',['get','count'],'#c0dfac',2,'#72b78a',4,'#2d9474',8,'#e69338',16,'#bd432c'],'fill-opacity':0.8}});
        map.addLayer({id:'footprint-lines',type:'line',source:'footprints',filter:['==','$type','LineString'],paint:{'line-color':['get','color'],'line-width':3,'line-opacity':0.8},layout:{'line-join':'round','line-cap':'round'}});
        map.addLayer({id:'footprint-points',type:'circle',source:'footprints',filter:['==','$type','Point'],paint:{'circle-color':['get','color'],'circle-radius':5}});
        map.on('click',e=>{
          if(!map)return;
          const hits=map.queryRenderedFeatures([[e.point.x-5,e.point.y-5],[e.point.x+5,e.point.y+5]],{layers:['footprint-lines','footprint-points','footprint-fill']});
          const unique=new Map<string,{id:string;title:string;date:string}>(); heat=null;
          for(const hit of hits){const p=hit.properties;if(p?.activity_id)unique.set(p.activity_id,{id:p.activity_id,title:p.title,date:p.activity_date});else if(p?.count)heat=p.count;}
          choices=[...unique.values()];
        });
        const bounds=new lib.LngLatBounds(all[0],all[0]);for(const c of all)bounds.extend(c);
        map.fitBounds(bounds,{padding:45,maxZoom:16,duration:0});
        map.on('render',()=>{if(map?.isSourceLoaded('footprints'))ready=true;});
        loadBasemap();
      });
    }catch{if(!disposed)error='无法初始化地图，请使用支持 WebGL 的浏览器。';}
  })();});
  onDestroy(()=>{disposed=true;clearTimeout(timer);observer?.disconnect();map?.remove();map=undefined;});
</script>
<div class="relative mt-5 overflow-hidden rounded-xl border border-border">
  <div bind:this={container} class="h-[500px] w-full" role="img" aria-label={data.mode==='heatmap'?'个人运动热力图':'个人多轨迹叠加地图'} data-testid={ready?'footprint-map-ready':'footprint-map-loading'}></div>
  <div class="absolute left-3 top-3 rounded bg-white/95 p-2 text-sm shadow">
    <button onclick={toggleBasemap} aria-pressed={basemap!=='off'} class="rounded border border-border px-2 py-1">{basemap==='off'?'开启底图':'关闭底图'}</button>
    {#if basemap==='failed'}<p role="status" class="mt-1">底图暂不可用，足迹仍可查看。</p><button onclick={loadBasemap} class="mt-1 underline">重试底图</button>{:else if basemap==='loading'}<p role="status" class="mt-1">正在加载底图…</p>{/if}
  </div>
  {#if basemap!=='off'}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" class="absolute bottom-0 right-0 bg-white/95 px-2 py-1 text-xs underline">© OpenStreetMap contributors</a>{/if}
  {#if error}<p role="alert" class="absolute bottom-8 left-3 right-3 rounded bg-white p-3 text-red-700">{error}</p>{:else if !ready}<p role="status" class="absolute bottom-8 left-3 rounded bg-white p-2">正在绘制足迹…</p>{/if}
</div>
{#if choices.length}<div class="mt-3 rounded-xl border border-border bg-white p-4"><p class="font-medium">此处经过的记录（{choices.length}）</p><ul class="mt-2 space-y-2">{#each choices as record}<li><a href={`/activities/${record.id}`} data-sveltekit-reload class="text-primary underline">{record.date} · {record.title || '未命名活动'} · 查看详情</a></li>{/each}</ul></div>{/if}
{#if heat!==null}<p role="status" class="mt-3">所选网格：{heat} 条不同运动记录经过。</p>{/if}
