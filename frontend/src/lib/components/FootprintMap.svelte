<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { onMount, onDestroy, untrack, type Snippet } from 'svelte';
  import type { Map as LibreMap, GeoJSONSource } from 'maplibre-gl';
  import type { FootprintCollection } from '#lib/api/footprints.ts';
  import { geometryBounds, displayFootprints } from '#lib/api/footprints.ts';
  import type { CityLocations, FootprintCity } from '#lib/map/footprint-cities.ts';
  import { colorFootprintFeatures } from '#lib/map/footprint-colors.ts';
  import { createRouteMapStyle, applyMapTheme, type BasemapPreference, type BasemapStyle } from '#lib/api/map-style.ts';
  import BasemapPicker from './BasemapPicker.svelte';
  import { createBasemapController } from '#lib/map/basemap-controller.ts';
  import { watchSystemTheme } from './system-theme';
  import 'maplibre-gl/dist/maplibre-gl.css';
  let { data, onretry, participantColors = {}, mapLabel = "", quietCityFailure = false, animateDataChanges = false, selectedRunner = "", selectedActivity = "", compact = false, detailHref = undefined, children, onclearRunner }: {data: FootprintCollection; onretry: () => void; participantColors?: Record<string, string>; mapLabel?: string; quietCityFailure?: boolean; animateDataChanges?: boolean; selectedRunner?: string; selectedActivity?: string; compact?: boolean; detailHref?: string; children?: Snippet; onclearRunner?: () => void} = $props();
  let container: HTMLDivElement, frameEl: HTMLDivElement, map: LibreMap | undefined, disposed=false;
  let framing: 'auto' | 'all' | 'picked' | 'free' = 'auto';
  let ready=$state(false), error=$state(''), basemap=$state<'loading'|'ready'|'failed'>('loading');
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
  const fitPadding = () => onclearRunner && frameEl ? Math.min(cameraPadding, frameEl.clientWidth / 4, frameEl.clientHeight / 4) : cameraPadding;
  function fit(bounds: [[number,number],[number,number]] | null, animate = false) {
    if (!map || !bounds) return;
    const motion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(bounds, { padding: fitPadding(), maxZoom: map.getMaxZoom(), bearing: 0, pitch: 0, duration: motion ? 350 : 0 });
  }
  function frame(bounds: [[number,number],[number,number]] | null) {
    framing = 'free'; selectedCity = ''; fit(bounds);
  }
  // Opens on every footprint; city lookup only adds shortcuts and never moves the initial camera.
  function frameInitial() {
    if (!map || framing === 'free') return;
    if (framing === 'picked' && selectedCity) { locateCity(selectedCity, false); return; }
    fit(allBounds);
  }
  function sizeCanvas() {
    if (!frameEl) return;
    // Compact maps are sized by CSS alone: measuring the frame's offset made the height depend on the scroll position.
    if (compact) { frameEl.style.height = ''; return; }
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
  function overview() { onclearRunner?.(); map?.stop();choices=[];heat=null;highlight([]);framing='all';selectedCity='';fit(allBounds); }
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
    source.setData({type:'FeatureCollection',features:colored(displayData.features)});
    framing='auto';choices=[];heat=null;heatPage=0;highlight([]);loadCities();
    if (onclearRunner && (selectedRunner || selectedActivity)) focusRunner(selectedRunner, selectedActivity); else fit(allBounds, animateDataChanges);
  }
  $effect(()=>{data;untrack(applyData);});
  function focusRunner(runner: string, activity = "") {
    if (!map?.getLayer('footprint-lines') || !onclearRunner) return;
    const match = ['==', ['get', activity ? 'activity_id' : 'username'], activity || runner] as ['==', ['get', 'username'], string];
    for (const layer of ['footprint-selected-glow', 'footprint-selected-casing', 'footprint-selected']) {
      if (map.getLayer(layer)) map.setFilter(layer, ['all', ['==', ['geometry-type'], 'LineString'], match]);
    }
    const bounds = activity ? geometryBounds(displayData.features.filter(f => f.properties?.activity_id === activity).map(f => f.geometry)) : runner ? geometryBounds(displayData.features.filter(f => f.properties?.username === runner).map(f => f.geometry)) : allBounds;
    if (!runner && !activity) { framing = 'all'; fit(allBounds, animateDataChanges); return; }
    if (!bounds) return;
    framing = 'free';
    // Measure the selected record's overlay after it has been laid out.
    requestAnimationFrame(() => {
      if (!map || disposed || selectedRunner !== runner || selectedActivity !== activity) return;
      const card = activity ? frameEl.querySelector<HTMLElement>('.map-info') : null;
      const cardRect = card?.getBoundingClientRect(), frameRect = frameEl.getBoundingClientRect();
      const inset = 20;
      const padding = {top:inset, right:inset, bottom:inset, left:inset};
      const a=map.project(bounds[0]), b=map.project(bounds[1]);
      const left=Math.min(a.x,b.x), right=Math.max(a.x,b.x), top=Math.min(a.y,b.y), bottom=Math.max(a.y,b.y);
      if (cardRect) {
        const cardRight=cardRect.right-frameRect.left+inset, cardTop=cardRect.top-frameRect.top-inset;
        if (left < cardRight && right > cardRect.left-frameRect.left-inset && bottom > cardTop && top < cardRect.bottom-frameRect.top+inset) {
          const shiftRight=cardRight-left, shiftUp=bottom-cardTop;
          if (shiftRight <= shiftUp && cardRight < frameRect.width-inset) padding.left=Math.ceil(cardRight);
          else padding.bottom=Math.ceil(frameRect.height-cardTop);
        }
      }
      const availableWidth=frameRect.width-padding.left-padding.right, availableHeight=frameRect.height-padding.top-padding.bottom;
      const overlapX=Math.max(0,Math.min(right,frameRect.width-padding.right)-Math.max(left,padding.left));
      const overlapY=Math.max(0,Math.min(bottom,frameRect.height-padding.bottom)-Math.max(top,padding.top));
      const visibleX = right-left < 1 ? (left>=padding.left && left<=frameRect.width-padding.right ? 1 : 0) : overlapX/(right-left);
      const visibleY = bottom-top < 1 ? (top>=padding.top && top<=frameRect.height-padding.bottom ? 1 : 0) : overlapY/(bottom-top);
      // A route that is in view but only a few pixels wide cannot be told apart: go to it instead of staying put.
      const tiny = Math.max((right-left)/availableWidth, (bottom-top)/availableHeight) < .15;
      if (!tiny && visibleX >= .8 && visibleY >= .8) return;
      const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350;
      if (tiny) { map.fitBounds(bounds, {padding, maxZoom:16, duration}); return; }
      if (right-left > availableWidth || bottom-top > availableHeight) {
        map.fitBounds(bounds, {padding, maxZoom:map.getZoom(), duration});
        return;
      }
      const dx=left<padding.left ? left-padding.left : right>frameRect.width-padding.right ? right-(frameRect.width-padding.right) : 0;
      const dy=top<padding.top ? top-padding.top : bottom>frameRect.height-padding.bottom ? bottom-(frameRect.height-padding.bottom) : 0;
      const center=map.project(map.getCenter());
      map.easeTo({center:map.unproject([center.x+dx,center.y+dy]), duration});
    });
  }
  $effect(()=>{const runner=selectedRunner, activity=selectedActivity; if (ready) untrack(()=>focusRunner(runner, activity));});
  function colored(features: typeof displayData.features) {
    return colorFootprintFeatures(features, palette).map(feature => ({...feature, properties: {...feature.properties, color: participantColors[String(feature.properties?.username)] ?? feature.properties.color}}));
  }
  const palette=['#14785b','#315caf','#b4552c','#854caa','#397d87','#ba3970'];
  function loadBasemap() { basemapController?.retry(); }
  const onWindowResize = () => { sizeCanvas(); map?.resize(); if (framing === 'all') fit(allBounds); else if (framing === 'picked') locateCity(selectedCity, false); else if (framing === 'auto') frameInitial(); };
  // Overlays dock above the attribution, whose height changes with its expanded text.
  let attributionObserver: ResizeObserver | undefined;
  function trackAttribution() {
    const attribution = frameEl?.querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
    if (!attribution) return;
    const clearance = () => { const rect = attribution.getBoundingClientRect(); frameEl.style.setProperty('--map-attribution-clearance', rect.height ? `${Math.ceil(frameEl.getBoundingClientRect().bottom - rect.top)}px` : '0px'); };
    attributionObserver = new ResizeObserver(clearance); attributionObserver.observe(attribution); clearance();
  }
  onMount(()=>{loadCities();sizeCanvas();window.addEventListener('resize', onWindowResize);stopTheme=watchSystemTheme(value=>{dark=value;if(map && !disposed) { if (!basemapController) applyMapTheme(map,dark); if (map.getLayer('footprint-casing')) map.setPaintProperty('footprint-casing','line-color',dark?'#302e2c':'#ffffff'); if (map.getLayer('footprint-selected-casing')) map.setPaintProperty('footprint-selected-casing','line-color',dark?'#302e2c':'#ffffff'); }});void(async()=>{
    try {
      const lib=await import('maplibre-gl'); if(disposed)return;
      // Start on the overview so no high-zoom tiles load before the first fit.
      const camera = allBounds ? { bounds: allBounds, fitBoundsOptions: { padding: cameraPadding } } : { center: [0, 0] as [number, number], zoom: 4 };
      map=new lib.Map({container,fadeDuration:0,locale:{'NavigationControl.ZoomIn':'放大地图','NavigationControl.ZoomOut':'缩小地图','Map.Title':'足迹地图'},style:createRouteMapStyle(dark),...camera,maxZoom:19,attributionControl:false});
      map.addControl(new lib.AttributionControl({compact:true}),'bottom-right');
      trackAttribution();
      map.addControl(new lib.NavigationControl({showCompass:false}),'top-right');
      map.on('dragstart',()=>{selectedCity='';framing='free';});
      observer=new ResizeObserver(()=>{sizeCanvas();map?.resize();}); observer.observe(frameEl ?? container);
      map.on('webglcontextlost',()=>{basemapController?.destroy();ready=false;error='地图绘图上下文已丢失，请重新绘制地图。下方数据入口仍可使用。';});
      map.on('error',e=>{if('sourceId' in e && e.sourceId==='footprints')error='地图绘制失败，请重试。下方记录入口仍可使用。';});
      map.on('load',()=>{
        if(!map || disposed)return;
        appliedData=data;
        const features=colored(displayData.features);
        map.addSource('footprints',{type:'geojson',data:{type:'FeatureCollection',features}});
        map.addLayer({id:'footprint-fill',type:'fill',source:'footprints',filter:['==','$type','Polygon'],paint:{'fill-color':['step',['get','count'],'#c0dfac',2,'#72b78a',4,'#2d9474',8,'#e69338',16,'#bd432c'],'fill-opacity':0.8}});
        if (onclearRunner) map.addLayer({id:'footprint-casing',type:'line',source:'footprints',filter:['==','$type','LineString'],paint:{'line-color':dark?'#302e2c':'#ffffff','line-width':5,'line-opacity':0.65},layout:{'line-join':'round','line-cap':'round'}});
        map.addLayer({id:'footprint-lines',type:'line',source:'footprints',filter:['==','$type','LineString'],paint:{'line-color':['get','color'],'line-width':3,'line-opacity':0.8},layout:{'line-join':'round','line-cap':'round'}});
        map.addLayer({id:'footprint-points',type:'circle',source:'footprints',filter:['==','$type','Point'],paint:{'circle-color':['get','color'],'circle-radius':5}});
        if (onclearRunner) map.addLayer({id:'footprint-selected-glow',type:'line',source:'footprints',filter:['all',['==',['geometry-type'],'LineString'],['==',['get','username'],'']],paint:{'line-color':['get','color'],'line-width':15,'line-blur':6,'line-opacity':0.5},layout:{'line-join':'round','line-cap':'round'}});
        if (onclearRunner) map.addLayer({id:'footprint-selected-casing',type:'line',source:'footprints',filter:['all',['==',['geometry-type'],'LineString'],['==',['get','username'],'']],paint:{'line-color':dark?'#302e2c':'#ffffff','line-width':9,'line-opacity':0.95},layout:{'line-join':'round','line-cap':'round'}});
        if (onclearRunner) map.addLayer({id:'footprint-selected',type:'line',source:'footprints',filter:['all',['==',['geometry-type'],'LineString'],['==',['get','username'],'']],paint:{'line-color':['get','color'],'line-width':5,'line-opacity':1},layout:{'line-join':'round','line-cap':'round'}});
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
  onDestroy(()=>{disposed=true;attributionObserver?.disconnect();window.removeEventListener('resize', onWindowResize);cityWorker?.terminate();stopTheme?.();basemapController?.destroy();observer?.disconnect();map?.remove();map=undefined;});
</script>
<div class="map-section content-reveal">
  <div class="map-toolbar"><div class="toolbar-actions"><button type="button" onclick={overview} disabled={!ready || !!error} class="button-secondary">回到全部足迹</button><button type="button" onclick={()=>{cityOpen=!cityOpen;}} disabled={!ready || !!error || cityLookup!=='ready' || !cityName} aria-expanded={cityOpen} aria-controls="footprint-cities" class="button-secondary city-menu-toggle">城市</button></div><p class="sr-only" id="footprint-map-help">拖动或缩放探索 · 方向键移动 · + / − 缩放</p>{#if detailHref}<a class="button-secondary map-detail-link" href={detailHref} data-testid="map-detail-link">查看完整详情 →</a>{/if}</div>
  {#if cityLookup==='loading'}<p role="status" class="city-hint">正在识别有记录的城市…</p>
  {:else if cityLookup==='failed' && !quietCityFailure}<div class="city-actions"><p role="status" class="city-hint">城市识别暂不可用，全部足迹仍可查看。</p><button type="button" onclick={loadCities} class="button-secondary">重试识别城市</button></div>
  {:else}
    <div class="city-buttons" role="group" aria-label="有记录的城市">{#each cities as city}<button type="button" onclick={()=>locateCity(city.code)} disabled={!ready || !!error} aria-pressed={selectedCity===city.code} class="button-secondary">{city.name}</button>{/each}{#if unlocatedBounds}<button type="button" onclick={()=>locateCity('unlocated')} disabled={!ready || !!error} aria-pressed={selectedCity==='unlocated'} class="button-secondary">未识别区域</button>{/if}</div>
  {/if}
  {#if cityOpen}<div id="footprint-cities" class="city-panel">
    <div class="city-actions"><label>选择城市<select aria-label="选择城市" bind:value={cityName} disabled={!ready || !!error || cityLookup!=='ready'}>{#each cities as city}<option value={city.code}>{city.name}</option>{/each}{#if unlocatedBounds}<option value="unlocated">未识别区域</option>{/if}</select></label><button type="button" onclick={()=>locateCity()} disabled={!ready || !!error || cityLookup!=='ready'} class="button-secondary">定位城市</button></div>
    <p class="city-hint">按当前足迹估算城市，仅移动地图；全部路线和热区仍保留。</p>
  </div>{/if}
  {#if basemap==='failed' && !error}<div class="basemap-feedback" role="status"><span>底图暂不可用，足迹仍可查看。</span><button type="button" onclick={loadBasemap} class="button-secondary">重试底图</button></div>{:else if basemap==='loading' && ready && !error}<p role="status" class="basemap-status">正在加载底图，足迹可先查看…</p>{/if}
  {#if error}<FeedbackState kind="error" title={error}><button type="button" class="button-secondary" onclick={onretry}>重新绘制地图</button></FeedbackState>{:else if !ready}<p role="status" class="basemap-status">正在绘制足迹…</p>{/if}
  <div class="map-frame" class:compact bind:this={frameEl}><div bind:this={container} class="map-canvas" role="region" aria-label={mapLabel || (data.mode==='heatmap'?'个人运动热力图':'个人多轨迹叠加地图')} aria-describedby="footprint-map-help" data-testid={ready?'footprint-map-ready':'footprint-map-loading'}></div>
    {@render children?.()}
    <div class="map-layers"><BasemapPicker preference={basemapPreference} style={basemapStyle} status={basemap} /></div>
  </div>
  {#if choices.length}<div class="route-choices" data-testid="route-choices"><p class="font-semibold" role="status">此处经过的记录（{choices.length}）</p><ul>{#each choices as record}<li><div><span class="record-date">{record.date}</span><a href={data.features.find(f => f.properties?.activity_id === record.id)?.properties?.username ? `/p/${encodeURIComponent(String(data.features.find(f => f.properties?.activity_id === record.id)?.properties?.username))}/activities/${record.id}` : view.href(`/activities/${record.id}`)}>{record.title || '未命名活动'} · 查看详情</a></div><button type="button" class="button-secondary" onclick={()=>selectRecord(record)} aria-pressed={selectedIds.length===1 && selectedIds[0]===record.id}>定位路线</button></li>{/each}</ul></div>{/if}
  {#if heat!==null}<p role="status" class="heat-selection">所选网格：{heat} 条不同运动记录经过。</p>{/if}
  {#if records.length}<details class="record-list" bind:open={recordsOpen}><summary>全部可显示记录（{records.length}）· 详情入口</summary>{#if recordsOpen}<ul>{#each records as record}<li><div><span class="record-date">{record.date}</span><a href={data.features.find(f => f.properties?.activity_id === record.id)?.properties?.username ? `/p/${encodeURIComponent(String(data.features.find(f => f.properties?.activity_id === record.id)?.properties?.username))}/activities/${record.id}` : view.href(`/activities/${record.id}`)}>{record.title || '未命名活动'}</a></div><button type="button" disabled={!ready || !!error} onclick={()=>selectRecord(record)} aria-label={`定位 ${record.title || '未命名活动'}`} aria-pressed={selectedIds.length===1 && selectedIds[0]===record.id} class="button-secondary">定位</button></li>{/each}</ul>{/if}</details>
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
  .map-detail-link { margin-left:auto; }
  .basemap-feedback { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:.5rem; padding:.5rem .75rem; border:1px solid var(--border); border-radius:var(--radius-control); background:var(--surface); color:var(--muted-foreground); font-size: var(--text-small); }
  .basemap-status { font-size: var(--text-small); margin:0; }
  .map-layers { position:absolute; top:var(--space-3); left:var(--space-3); z-index:2; }
  .map-frame { position:relative; overflow:hidden; height:min(720px, max(424px, calc(100dvh - 26rem))); border:1px solid var(--border); border-radius:var(--radius-card); background:var(--muted); }
  .map-canvas { height:100%; width:100%; }
  .route-choices { border-left:3px solid var(--primary); padding:.75rem 1rem; background:var(--primary-soft); border-radius:var(--radius-control); }
  .route-choices ul,.record-list ul { display:grid; gap:.5rem; margin-top:.75rem; max-height:20rem; overflow:auto; }
  li { display:flex; justify-content:space-between; align-items:center; gap:.75rem; min-width:0; padding:.5rem 0; }
  li > div { min-width:0; }
  li a { color:var(--primary); text-decoration:underline; font-size: var(--text-small); overflow-wrap:anywhere; }
  li button { flex-shrink:0; }
  .record-date { display:block; font-size: var(--text-caption); color:var(--muted-foreground); }
  .heat-selection { padding:.75rem 1rem; color:var(--primary); border-radius:var(--radius-control); background:var(--primary-soft); }
  summary { cursor:pointer; color:var(--primary); font-weight: var(--weight-semibold); font-size: var(--text-small); }
  .record-list,.heat-data { padding-top:.5rem; }
  .heat-pagination { display:flex; align-items:center; flex-wrap:wrap; gap:.75rem; margin-top:.75rem; font-size: var(--text-small); }
  .heat-table { max-height:20rem; overflow:auto; margin-top:.75rem; }
  table { width:100%; font-size: var(--text-small); text-align:left; }
  th,td { padding:.5rem; border-bottom:1px solid var(--border); }
  .map-frame.compact { height:clamp(424px, calc(100dvh - 13rem), 720px); }
  @media(max-width:959px) { .map-frame.compact { height:45dvh; } }
  @media(max-width:767px) { .map-frame { height:min(600px, max(424px, calc(100dvh - 22rem))); } .route-choices { padding:.75rem; } }
  @media(max-width:1023px) { .city-buttons { display:none; } .city-menu-toggle { display:inline-flex; } .city-panel { display:grid; } }
</style>
