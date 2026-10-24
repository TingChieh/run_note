<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { Map as LibreMap, GeoJSONSource } from 'maplibre-gl';
  import type { FootprintCollection } from '#lib/api/footprints.ts';
  import { geometryBounds, displayFootprints } from '#lib/api/footprints.ts';
  import { dominantCity, type CityLocations, type FootprintCity } from '#lib/map/footprint-cities.ts';
  import { colorFootprintFeatures } from '#lib/map/footprint-colors.ts';
  import { createRouteMapStyle, applyMapTheme, type BasemapPreference, type BasemapStyle } from '#lib/api/map-style.ts';
  import BasemapPicker from './BasemapPicker.svelte';
  import { createBasemapController } from '#lib/map/basemap-controller.ts';
  import { watchSystemTheme } from './system-theme';
  import 'maplibre-gl/dist/maplibre-gl.css';
  let { data, onretry }: {data: FootprintCollection; onretry: () => void} = $props();
  let container: HTMLDivElement, frameEl: HTMLDivElement, map: LibreMap | undefined, disposed=false;
  let framing: 'auto' | 'all' | 'picked' | 'free' = 'auto';
  let ready=$state(false), error=$state(''), basemap=$state<'loading'|'ready'|'failed'|'off'>('loading');
  let choices=$state<{id:string;title:string;date:string}[]>([]), heat=$state<number|null>(null);
  let observer: ResizeObserver|undefined;
  let basemapPreference=$state<BasemapPreference>('auto'), basemapStyle=$state<BasemapStyle>('positron');
  let basemapController: ReturnType<typeof createBasemapController>|undefined;
  let heatDataOpen=$state(false), heatPage=$state(0), recordsOpen=$state(false);
  let dark=false, stopTheme: (() => void) | undefined;
  const heatPageSize=50;
  let selectedIds=$state<string[]>([]);
  let cityOpen=$state(false), cityName=$state('');
  let cities=$state<FootprintCity[]>([]), unlocatedBounds=$state<CityLocations['unlocatedBounds']>(null);
  let cityLookup=$state<'loading'|'ready'|'failed'>('loading'), selectedCity=$state('');
  let cityWorker:Worker|undefined, appliedData:FootprintCollection|undefined;
  const displayData=$derived(displayFootprints(data));
  const allBounds=$derived(geometryBounds(displayData.features.map(f=>f.geometry)));
  const records=$derived(data.mode==='tracks'?[...new Map(data.features.map(f=>[String(f.properties!.activity_id),{id:String(f.properties!.activity_id),title:String(f.properties!.title),date:String(f.properties!.activity_date)}])).values()]:[]);
  // Equal insets keep a symmetric route's midpoint on the canvas centre.
  // 72px clears the top-right zoom control and the layer button.
  const cameraPadding = 72;
  function fit(bounds: [[number,number],[number,number]] | null, animate = false) {
    if (!map || !bounds) return;
    const motion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(bounds, { padding: cameraPadding, maxZoom: map.getMaxZoom(), bearing: 0, pitch: 0, duration: motion ? 350 : 0 });
  }
  function frame(bounds: [[number,number],[number,number]] | null) {
    framing = 'free'; selectedCity = ''; fit(bounds);
  }
  function preferredBounds() {
    if (data.mode !== 'tracks' || !cities.length) return allBounds;
    return dominantCity(displayData.features.map(feature => ({
      geometry: feature.geometry,
      activityId: typeof feature.properties?.activity_id === 'string' ? feature.properties.activity_id : undefined,
      activityDate: typeof feature.properties?.activity_date === 'string' ? feature.properties.activity_date : undefined,
    })), cities)?.bounds ?? allBounds;
  }
  function frameInitial() {
    if (!map || framing === 'free') return;
    if (framing === 'all') { fit(allBounds); return; }
    if (framing === 'picked' && selectedCity) { locateCity(selectedCity, false); return; }
    if (data.mode === 'tracks' && cityLookup === 'loading') return;
    fit(preferredBounds());
  }
  function sizeCanvas() {
    if (!frameEl) return;
    const available = window.innerHeight - frameEl.getBoundingClientRect().top - 16;
    frameEl.style.height = `${Math.min(720, Math.max(424, Math.floor(available)))}px`;
  }
  function cityMarkerData() {
    return { type: 'FeatureCollection' as const, features: data.mode === 'tracks' ? cities.map(city => ({
      type: 'Feature' as const,
      properties: { code: city.code, name: city.name },
      geometry: { type: 'Point' as const, coordinates: [(city.bounds[0][0] + city.bounds[1][0]) / 2, (city.bounds[0][1] + city.bounds[1][1]) / 2] as [number, number] },
    })) : [] };
  }
  function syncCityMarkers() { (map?.getSource('footprint-cities') as GeoJSONSource | undefined)?.setData(cityMarkerData()); }
  function highlight(ids:string[]) {
    selectedIds=ids;
    if(!map?.getLayer('footprint-lines'))return;
    map.setPaintProperty('footprint-lines','line-width',['case',['in',['get','activity_id'],['literal',ids]],5,3]);
    map.setPaintProperty('footprint-points','circle-radius',['case',['in',['get','activity_id'],['literal',ids]],7,5]);
  }
  function selectRecord(record: {id:string;title:string;date:string}) {
    choices=[record];heat=null;highlight([record.id]);
    frame(geometryBounds(displayData.features.filter(f=>f.properties?.activity_id===record.id).map(f=>f.geometry)));
  }
  function selectHeat(index:number) { const feature=displayData.features[index]; heat=Number(feature.properties?.count);choices=[];frame(geometryBounds([feature.geometry])); }
  function overview() { map?.stop();choices=[];heat=null;highlight([]);framing='all';selectedCity='';fit(allBounds); }
  function locateCity(code=cityName, animate=true) {
    const city=code==='unlocated' && unlocatedBounds ? {name:'未识别区域',bounds:unlocatedBounds} : cities.find(city=>city.code===code);
    if(!map || !ready || error || !city)return;
    map.stop();framing='picked';selectedCity=code;cityName=code;fit(city.bounds, animate);
  }
  function loadCities() {
    cityWorker?.terminate();cityLookup='loading';
    try {
      const worker=new Worker(new URL('../map/footprint-cities.worker.ts',import.meta.url),{type:'module'});cityWorker=worker;
      worker.onmessage=(event:MessageEvent<CityLocations>)=>{
        if(disposed || cityWorker!==worker)return;
        cities=event.data.cities;unlocatedBounds=event.data.unlocatedBounds;
        cityName=cities[0]?.code??(unlocatedBounds?'unlocated':'');cityLookup='ready';
        syncCityMarkers();
        requestAnimationFrame(() => { if (!disposed && framing === 'auto') { sizeCanvas(); map?.resize(); frameInitial(); } });
        worker.terminate();cityWorker=undefined;
      };
      worker.onerror=()=>{if(disposed || cityWorker!==worker)return;cityLookup='failed';frameInitial();worker.terminate();cityWorker=undefined;};
      worker.postMessage(data.features.map(feature=>feature.geometry));
    }catch{cityLookup='failed';frameInitial();cityWorker?.terminate();cityWorker=undefined;}
  }
  // The page swaps `data` in place (mode switch, background refresh): update the live source instead of rebuilding the map.
  function applyData() {
    const source=map?.getSource('footprints') as GeoJSONSource|undefined;
    if(!map || !source || appliedData===data)return;
    appliedData=data;
    source.setData({type:'FeatureCollection',features:colorFootprintFeatures(displayData.features,palette)});
    framing='auto';choices=[];heat=null;heatPage=0;highlight([]);loadCities();frameInitial();
  }
  $effect(()=>{data;untrack(applyData);});
  const palette=['#14785b','#315caf','#b4552c','#854caa','#397d87','#ba3970'];
  function loadBasemap() { basemapController?.retry(); }
  function toggleBasemap() { basemapController?.toggle(); }
  const onWindowResize = () => { sizeCanvas(); map?.resize(); if (framing === 'all') fit(allBounds); else if (framing === 'picked') locateCity(selectedCity, false); else if (framing === 'auto') frameInitial(); };
  onMount(()=>{loadCities();sizeCanvas();window.addEventListener('resize', onWindowResize);stopTheme=watchSystemTheme(value=>{dark=value;if(map && !disposed && !basemapController)applyMapTheme(map,dark);});void(async()=>{
    try {
      const lib=await import('maplibre-gl'); if(disposed)return;
      const center: [number, number] = allBounds ? [(allBounds[0][0] + allBounds[1][0]) / 2, (allBounds[0][1] + allBounds[1][1]) / 2] : [0, 0];
      map=new lib.Map({container,fadeDuration:0,locale:{'NavigationControl.ZoomIn':'放大地图','NavigationControl.ZoomOut':'缩小地图','Map.Title':'足迹地图'},style:createRouteMapStyle(dark),center,zoom:data.mode==='tracks'?12:4,maxZoom:19,attributionControl:false});
      map.addControl(new lib.AttributionControl({compact:true}),'bottom-right');
      map.addControl(new lib.NavigationControl({showCompass:false}),'top-right');
      map.on('dragstart',()=>{selectedCity='';framing='free';});
      observer=new ResizeObserver(()=>{sizeCanvas();map?.resize();}); observer.observe(frameEl ?? container);
      map.on('webglcontextlost',()=>{basemapController?.destroy();ready=false;error='地图绘图上下文已丢失，请重新绘制地图。下方数据入口仍可使用。';});
      map.on('error',e=>{if('sourceId' in e && e.sourceId==='footprints')error='地图绘制失败，请重试。下方记录入口仍可使用。';});
      map.on('load',()=>{
        if(!map || disposed)return;
        appliedData=data;
        const features=colorFootprintFeatures(displayData.features,palette);
        map.addSource('footprints',{type:'geojson',data:{type:'FeatureCollection',features}});
        map.addLayer({id:'footprint-fill',type:'fill',source:'footprints',filter:['==','$type','Polygon'],paint:{'fill-color':['step',['get','count'],'#c0dfac',2,'#72b78a',4,'#2d9474',8,'#e69338',16,'#bd432c'],'fill-opacity':0.8}});
        map.addLayer({id:'footprint-lines',type:'line',source:'footprints',filter:['==','$type','LineString'],paint:{'line-color':['get','color'],'line-width':3,'line-opacity':0.8},layout:{'line-join':'round','line-cap':'round'}});
        map.addLayer({id:'footprint-points',type:'circle',source:'footprints',filter:['==','$type','Point'],paint:{'circle-color':['get','color'],'circle-radius':5}});
        map.addSource('footprint-cities',{type:'geojson',data:cityMarkerData()});
        map.addLayer({id:'footprint-city-markers',type:'circle',source:'footprint-cities',maxzoom:8,paint:{'circle-radius':7,'circle-color':'#14785b','circle-stroke-width':2,'circle-stroke-color':'#ffffff','circle-opacity':0.95}});
        map.on('click','footprint-city-markers',event=>{const code=event.features?.[0]?.properties?.code;if(typeof code==='string')locateCity(code);});
        applyMapTheme(map,dark);
        map.on('click',e=>{
          if(!map)return;
          const hits=map.queryRenderedFeatures([[e.point.x-5,e.point.y-5],[e.point.x+5,e.point.y+5]],{layers:['footprint-lines','footprint-points','footprint-fill']});
          const unique=new Map<string,{id:string;title:string;date:string}>(); heat=null;
          for(const hit of hits){const p=hit.properties;if(p?.activity_id)unique.set(p.activity_id,{id:p.activity_id,title:p.title,date:p.activity_date});else if(p?.count)heat=p.count;}
          choices=[...unique.values()];highlight(choices.map(record=>record.id));
        });
        sizeCanvas();frameInitial();
        const markReady=()=>{if(!error && map?.isSourceLoaded('footprints')){ready=true;map.off('render',markReady);}};
        map.on('render',markReady);
        basemapController=createBasemapController(map,'footprint-fill',state=>{basemap=state.status;basemapPreference=state.preference;basemapStyle=state.style;});
      });
    }catch{if(!disposed)error='无法初始化地图，请使用支持 WebGL 的浏览器。';}
  })();});
  onDestroy(()=>{disposed=true;window.removeEventListener('resize', onWindowResize);cityWorker?.terminate();stopTheme?.();basemapController?.destroy();observer?.disconnect();map?.remove();map=undefined;});
</script>
<div class="map-section content-reveal">
  <div class="map-toolbar"><div class="toolbar-actions"><button type="button" onclick={overview} disabled={!ready || !!error} class="button-secondary">回到全部足迹</button><button type="button" onclick={()=>{cityOpen=!cityOpen;}} disabled={!ready || !!error || cityLookup!=='ready' || !cityName} aria-expanded={cityOpen} aria-controls="footprint-cities" class="button-secondary city-menu-toggle">城市</button><button type="button" onclick={toggleBasemap} disabled={!ready || !!error} aria-pressed={basemap!=='off'} class="button-secondary">{basemap==='off'?'开启底图':'关闭底图'}</button></div><p class="map-hint" id="footprint-map-help">拖动或缩放探索 · 方向键移动 · + / − 缩放</p></div>
  {#if cityLookup==='loading'}<p role="status" class="city-hint">正在识别有记录的城市…</p>
  {:else if cityLookup==='failed'}<div class="city-actions"><p role="status" class="city-hint">城市识别暂不可用，全部足迹仍可查看。</p><button type="button" onclick={loadCities} class="button-secondary">重试识别城市</button></div>
  {:else}
    <div class="city-buttons" role="group" aria-label="有记录的城市">{#each cities as city}<button type="button" onclick={()=>locateCity(city.code)} disabled={!ready || !!error} aria-pressed={selectedCity===city.code} class="button-secondary">{city.name}</button>{/each}{#if unlocatedBounds}<button type="button" onclick={()=>locateCity('unlocated')} disabled={!ready || !!error} aria-pressed={selectedCity==='unlocated'} class="button-secondary">未识别区域</button>{/if}</div>
  {/if}
  {#if cityOpen}<div id="footprint-cities" class="city-panel">
    <div class="city-actions"><label>选择城市<select aria-label="选择城市" bind:value={cityName} disabled={!ready || !!error || cityLookup!=='ready'}>{#each cities as city}<option value={city.code}>{city.name}</option>{/each}{#if unlocatedBounds}<option value="unlocated">未识别区域</option>{/if}</select></label><button type="button" onclick={()=>locateCity()} disabled={!ready || !!error || cityLookup!=='ready'} class="button-secondary">定位城市</button></div>
    <p class="city-hint">按当前足迹估算城市，仅移动地图；全部路线和热区仍保留。</p>
  </div>{/if}
  {#if basemap==='failed' && !error}<div class="basemap-feedback" role="status"><span>底图暂不可用，足迹仍可查看。</span><button type="button" onclick={loadBasemap} class="button-secondary">重试底图</button></div>{:else if basemap==='loading' && ready && !error}<p role="status" class="basemap-status">正在加载底图，足迹可先查看…</p>{/if}
  {#if error}<FeedbackState kind="error" title={error}><button type="button" class="button-secondary" onclick={onretry}>重新绘制地图</button></FeedbackState>{:else if !ready}<p role="status" class="basemap-status">正在绘制足迹…</p>{/if}
  <div class="map-frame" bind:this={frameEl}><div bind:this={container} class="map-canvas" role="region" aria-label={data.mode==='heatmap'?'个人运动热力图':'个人多轨迹叠加地图'} aria-describedby="footprint-map-help" data-testid={ready?'footprint-map-ready':'footprint-map-loading'}></div>
    <BasemapPicker preference={basemapPreference} style={basemapStyle} status={basemap} />
  </div>
  {#if choices.length}<div class="route-choices" data-testid="route-choices"><p class="font-semibold" role="status">此处经过的记录（{choices.length}）</p><ul>{#each choices as record}<li><div><span class="record-date">{record.date}</span><a href={view.href(`/activities/${record.id}`)}>{record.title || '未命名活动'} · 查看详情</a></div><button type="button" class="button-secondary" onclick={()=>selectRecord(record)} aria-pressed={selectedIds.length===1 && selectedIds[0]===record.id}>定位路线</button></li>{/each}</ul></div>{/if}
  {#if heat!==null}<p role="status" class="heat-selection">所选网格：{heat} 条不同运动记录经过。</p>{/if}
  {#if records.length}<details class="record-list" bind:open={recordsOpen}><summary>全部可显示记录（{records.length}）· 详情入口</summary>{#if recordsOpen}<ul>{#each records as record}<li><div><span class="record-date">{record.date}</span><a href={view.href(`/activities/${record.id}`)}>{record.title || '未命名活动'}</a></div><button type="button" disabled={!ready || !!error} onclick={()=>selectRecord(record)} aria-label={`定位 ${record.title || '未命名活动'}`} aria-pressed={selectedIds.length===1 && selectedIds[0]===record.id} class="button-secondary">定位</button></li>{/each}</ul>{/if}</details>
  {:else if data.mode==='heatmap'}<details class="heat-data" bind:open={heatDataOpen}><summary>查看热区数据（{data.features.length} 格）</summary>{#if heatDataOpen}<div class="heat-table"><table><caption class="sr-only">不同运动记录经过各网格的次数，可定位到地图</caption><thead><tr><th>区域</th><th>不同记录数</th><th>地图定位</th></tr></thead><tbody>{#each data.features.slice(heatPage*heatPageSize,(heatPage+1)*heatPageSize) as feature,index}<tr><td>热区 {heatPage*heatPageSize+index+1}</td><td>{feature.properties?.count} 次</td><td><button type="button" class="button-secondary" disabled={!ready || !!error} aria-label={`定位热区 ${heatPage*heatPageSize+index+1}`} onclick={()=>selectHeat(heatPage*heatPageSize+index)}>定位</button></td></tr>{/each}</tbody></table></div>{#if data.features.length>heatPageSize}<div class="heat-pagination"><button type="button" class="button-secondary" disabled={heatPage===0} onclick={()=>{heatPage--;}}>上一页热区</button><p role="status">第 {heatPage+1} / {Math.ceil(data.features.length/heatPageSize)} 页 · 共 {data.features.length} 格</p><button type="button" class="button-secondary" disabled={(heatPage+1)*heatPageSize>=data.features.length} onclick={()=>{heatPage++;}}>下一页热区</button></div>{/if}{/if}</details>{/if}
</div>
<style>
  .map-section { display:grid; gap:.75rem; min-width:0; }
  .map-toolbar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:.5rem; }
  .toolbar-actions { display:flex; flex-wrap:wrap; gap:.5rem; }
  .city-panel { display:grid; gap:var(--space-2); padding:var(--space-3); border:1px solid var(--border); border-radius:var(--radius-control); background:var(--surface); }
  .city-actions { display:flex; align-items:end; flex-wrap:wrap; gap:var(--space-3); }
  .city-actions label { display:grid; gap:var(--space-1); font-size:var(--text-small); min-width:0; }
  .city-actions select { min-width:9rem; max-width:100%; }
  .city-hint { color:var(--muted-foreground); font-size:var(--text-small); }
  .city-buttons { display:flex; flex-wrap:wrap; gap:var(--space-2); }
  .city-buttons button[aria-pressed='true'] { outline:2px solid var(--primary); outline-offset:2px; }
  .city-menu-toggle,.city-panel { display:none; }
  .map-hint { font-size:.75rem; color:var(--muted-foreground); }
  .basemap-feedback { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:.5rem; padding:.5rem .75rem; border:1px solid var(--border); border-radius:var(--radius-control); background:var(--surface); color:var(--muted-foreground); font-size:.8125rem; }
  .basemap-status { font-size:.8125rem; margin:0; }
  .map-frame { position:relative; overflow:hidden; height:min(720px, max(424px, calc(100dvh - 26rem))); border:1px solid var(--border); border-radius:var(--radius-card); background:var(--muted); }
  .map-canvas { height:100%; width:100%; }
  .route-choices { border-left:3px solid var(--primary); padding:.75rem 1rem; background:var(--primary-soft); border-radius:var(--radius-control); }
  .route-choices ul,.record-list ul { display:grid; gap:.5rem; margin-top:.75rem; max-height:20rem; overflow:auto; }
  li { display:flex; justify-content:space-between; align-items:center; gap:.75rem; min-width:0; padding:.5rem 0; }
  li > div { min-width:0; }
  li a { color:var(--primary); text-decoration:underline; font-size:.875rem; overflow-wrap:anywhere; }
  li button { flex-shrink:0; }
  .record-date { display:block; font-size:.75rem; color:var(--muted-foreground); }
  .heat-selection { padding:.75rem 1rem; color:var(--primary); border-radius:var(--radius-control); background:var(--primary-soft); }
  summary { cursor:pointer; color:var(--primary); font-weight:550; font-size:.875rem; }
  .record-list,.heat-data { padding-top:.5rem; }
  .heat-pagination { display:flex; align-items:center; flex-wrap:wrap; gap:.75rem; margin-top:.75rem; font-size:.8125rem; }
  .heat-table { max-height:20rem; overflow:auto; margin-top:.75rem; }
  table { width:100%; font-size:.8125rem; text-align:left; }
  th,td { padding:.5rem; border-bottom:1px solid var(--border); }
  @media(max-width:767px) { .map-frame { height:min(600px, max(424px, calc(100dvh - 22rem))); } .map-hint { display:none; } .route-choices { padding:.75rem; } }
  @media(max-width:1023px) { .city-buttons { display:none; } .city-menu-toggle { display:inline-flex; } .city-panel { display:grid; } }
</style>
