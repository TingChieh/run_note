import { expect, test, type Page } from '@playwright/test';
import { loginRunner, installActivities, sampleActivity, incompleteActivity } from '../fixtures/activities';
import { installAI } from '../fixtures/p2';
import { installBasemaps } from '../fixtures/basemaps';
import type { FootprintCollection } from '../../src/lib/api/footprints.ts';
async function fixture(page: Page) {
  const state={multipleCities:false,heatCells:1,status:'ready' as 'ready'|'pending'|'failed',refreshing:false,refreshFailed:false,scenario:'multi' as 'multi'|'single'|'point'|'empty',failures:0,expired:false,requests:[] as URL[]};
  await installActivities(page);
  await page.route('**/api/v1/showcase/footprints/all?**',route=>{
    const url=new URL(route.request().url());state.requests.push(url);
    if(state.expired)return route.fulfill({status:401,json:{error:{message:'会话已过期'}}});
    if(state.failures-->0)return route.fulfill({status:503,json:{error:{message:'足迹暂不可用，请重试'}}});
    const mode=url.searchParams.get('mode'),empty=state.scenario==='empty';
    if(state.status!=='ready')return route.fulfill({json:{data:{status:state.status,generated_at:null,refreshing:false,result:null},error:null}});
    const records=state.scenario==='multi'?[sampleActivity,{...incompleteActivity,activity_date:'2024-01-02'}]:[sampleActivity];
    const routeCoordinates=[[121.48,31.23],[121.485,31.2335],[121.49,31.237]];
    const features:FootprintCollection['features']=empty?[]:mode==='heatmap'?[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[121.484,31.233],[121.485,31.233],[121.485,31.234],[121.484,31.234],[121.484,31.233]]]},properties:{i:135236,j:36621,count:2}}]:records.map(record=>({type:'Feature',geometry:state.scenario==='point'?{type:'Point',coordinates:[121.485,31.235]}:{type:'LineString',coordinates:state.multipleCities && record.id!==sampleActivity.id?[[116.397,39.908],[116.402,39.913]]:routeCoordinates},properties:{activity_id:record.id,title:record.title,activity_date:record.activity_date,segment_index:0}}));
    if(state.multipleCities && mode==='heatmap')features.push({...features[0],geometry:{type:'Polygon',coordinates:[[[116.397,39.908],[116.398,39.908],[116.398,39.909],[116.397,39.909],[116.397,39.908]]]},properties:{i:129574,j:48500,count:2}} as typeof features[number]);
    return route.fulfill({json:{data:{status:'ready',generated_at:'2026-10-15T00:00:00Z',refreshing:state.refreshing,refresh_failed:state.refreshFailed,result:{scope:'all',type:'FeatureCollection',features:mode==='heatmap'?features.flatMap(feature=>Array.from({length:state.heatCells},(_,index)=>({...feature,properties:{...feature.properties,i:135236+index}}))):features,mode,activity_count:empty?0:records.length,visible_activity_count:empty?0:records.length,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:empty?0:mode==='heatmap'?2:0}},error:null}});
  });
  return state;
}
async function ready(page:Page){await expect(page.getByTestId('footprint-map-ready')).toBeVisible();}
test('keeps main-thread tasks bounded with a maximum-size synthetic track',async({page})=>{
  await fixture(page);await loginRunner(page);
  await page.addInitScript(()=>{
    const state=window as Window & {__footprintLongTasks?:{start:number;duration:number}[]};
    state.__footprintLongTasks=[];
    if(PerformanceObserver.supportedEntryTypes?.includes('longtask'))new PerformanceObserver(list=>{
      state.__footprintLongTasks?.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})));
    }).observe({type:'longtask',buffered:true});
  });
  const coordinates=Array.from({length:250_000},(_,index)=>[121.48+(index%500)*0.000001,31.23+(index%500)*0.000001]);
  await page.route('**/api/v1/showcase/footprints/all?**',route=>route.fulfill({json:{data:{status:'ready',generated_at:'2026-10-15T00:00:00Z',refreshing:false,result:{scope:'all',type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates},properties:{activity_id:sampleActivity.id,title:'合成性能路线',activity_date:'2026-10-15',segment_index:0}}],mode:'tracks',activity_count:1,visible_activity_count:1,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0}},error:null}}));
  await page.goto('/footprints');await ready(page);
  await page.waitForTimeout(100);
  const longTasks=await page.evaluate(()=>((window as Window & {__footprintLongTasks?:{start:number;duration:number}[]}).__footprintLongTasks??[]).map(entry=>entry.duration));
  expect(Math.max(0,...longTasks)).toBeLessThan(500);
});
test('page loading skeleton follows the real request and respects reduced motion',async({page})=>{
  await fixture(page);await loginRunner(page);await page.emulateMedia({reducedMotion:'reduce'});
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/showcase/footprints/all?**',async route=>{await held;await route.fallback();});
  try {
    await page.goto('/footprints');
    const skeleton=page.getByTestId('page-skeleton');await expect(skeleton).toBeVisible();
    await page.screenshot({path:'test-results/footprints-page-skeleton.png'});
    expect(await skeleton.locator('.skeleton-block').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
    release();await ready(page);await expect(skeleton).toHaveCount(0);
    expect(await page.locator('.page-reveal').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  } finally {release();}
});
for(const mode of ['tracks','heatmap'])test(`city locator moves and restores the real map without filtering ${mode}`,async({page})=>{
  const state=await fixture(page);state.multipleCities=true;await loginRunner(page);
  await page.emulateMedia({reducedMotion:mode==='tracks'?'reduce':'no-preference',colorScheme:'dark'});
  await page.setViewportSize({width:390,height:1000});
  await page.goto(`/footprints?mode=${mode}`);await ready(page);
  await page.getByRole('button',{name:'关闭底图',exact:true}).click();
  await page.getByRole('button',{name:'回到全部足迹',exact:true}).click();
  const canvas=page.locator('.maplibregl-canvas');
  // Element screenshots also capture fixed overlays; exclude the development-only tuner.
  const screenshotStyle='.glass-tuner { visibility: hidden !important; }';
  async function mapScreenshot(name:string) {
    await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!;
    // Crop inside the canvas: fractional page positions can include a row of rounded frame pixels.
    return page.screenshot({path:`test-results/city-${mode}-${name}.png`,style:screenshotStyle,clip:{x:box.x+4,y:box.y+4,width:box.width-8,height:box.height-8}});
  }
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const before=await mapScreenshot('before');const requestCount=state.requests.length;
  const original=await canvas.elementHandle();
  await expect(page.getByRole('button',{name:'城市',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'城市',exact:true}).focus();await page.keyboard.press('Enter');
  const select=page.getByLabel('选择城市',{exact:true});
  await expect(select).toHaveAttribute('aria-controls',/^rn-select-/);
  await select.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox',{name:'选择城市选项',exact:true})).toBeVisible();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(select).toHaveValue('310000');
  await page.keyboard.press('Enter');await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await expect(select).toHaveValue('110000');
  await page.getByRole('button',{name:'定位城市',exact:true}).focus();await page.keyboard.press('Enter');
  await expect.poll(async()=>(await mapScreenshot('beijing')).equals(before)).toBe(false);
  expect(await original!.evaluate(el=>el===document.querySelector('.maplibregl-canvas'))).toBe(true);
  await expect(page.getByTestId('footprint-summary')).toContainText('全部 2 条运动记录，地图显示 2 条');
  if(mode==='tracks'){
    await page.getByText('全部可显示记录',{exact:false}).click();
    await expect(page.locator('.record-list').getByRole('link')).toHaveCount(2);
  }else{
    await page.getByText('查看热区数据',{exact:false}).click();
    await expect(page.getByRole('button',{name:'定位热区 1',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'定位热区 2',exact:true})).toBeVisible();
    await expect(page.getByTestId('heat-legend')).toContainText('当前最高 2 次');
  }
  expect(state.requests).toHaveLength(requestCount);
  await page.getByRole('button',{name:'回到全部足迹',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'已定位'})).toHaveCount(0);
  // Closing panels restores the same canvas size and viewport before comparing the camera.
  if(mode==='tracks')await page.getByText('全部可显示记录',{exact:false}).click();
  else await page.getByText('查看热区数据',{exact:false}).click();
  await page.getByRole('button',{name:'城市',exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect.poll(async()=>(await mapScreenshot('restored')).equals(before)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});
    const cityButtons=page.getByRole('group',{name:'有记录的城市',exact:true});
    if(width>=1024){
      await expect(page.getByRole('button',{name:'城市',exact:true})).toBeHidden();
      await expect(cityButtons.getByRole('button')).toHaveCount(2);
      const beijing=cityButtons.getByRole('button',{name:'北京市',exact:true});
      await beijing.click();await expect(beijing).toHaveAttribute('aria-pressed','true');
      const shanghai=cityButtons.getByRole('button',{name:'上海市',exact:true});
      await shanghai.click();await expect(shanghai).toHaveAttribute('aria-pressed','true');
      await expect(cityButtons.getByRole('button',{name:'广州市',exact:true})).toHaveCount(0);
    }else{
      await expect(cityButtons).toBeHidden();
      await page.getByRole('button',{name:'城市',exact:true}).click();
      await expect(select).toBeVisible();await expect(select.locator('option')).toHaveCount(2);
    }
    for(const colorScheme of ['light','dark'] as const){
      await page.emulateMedia({colorScheme});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(width===390 || width===1440)await page.locator('.map-section').screenshot({path:`test-results/city-panel-${mode}-${width}-${colorScheme}.png`,style:screenshotStyle});
    }
    if(width<1024)await page.getByRole('button',{name:'城市',exact:true}).click();
  }
});
async function capture(page:Page,name:string){await page.evaluate(async()=>{(document.activeElement as HTMLElement)?.blur();scrollTo(0,0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.screenshot({path:`test-results/footprints-${name}.png`,fullPage:false});}
test('city lookup failure retries without reloading footprints and uncovered areas remain accessible',async({page})=>{
  const state=await fixture(page);await loginRunner(page);
  const workerRequest=(url:URL)=>url.pathname.endsWith('/footprint-cities.worker.ts');
  await page.route(workerRequest,route=>route.abort());
  await page.goto('/footprints');await ready(page);
  await expect(page.getByRole('status').filter({hasText:'城市识别暂不可用'})).toBeVisible();
  const requests=state.requests.length;const canvas=await page.locator('.maplibregl-canvas').elementHandle();
  await page.unroute(workerRequest);await page.getByRole('button',{name:'重试识别城市',exact:true}).click();
  const group=page.getByRole('group',{name:'有记录的城市',exact:true});
  await expect(group.getByRole('button',{name:'上海市',exact:true})).toBeVisible();
  expect(state.requests).toHaveLength(requests);
  expect(await canvas!.evaluate(el=>el===document.querySelector('.maplibregl-canvas'))).toBe(true);
  await page.route('**/api/v1/showcase/footprints/all?**',route=>route.fulfill({json:{data:{status:'ready',generated_at:'2026-10-15T00:00:00Z',refreshing:false,result:{scope:'all',type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[-74,40.7]},properties:{activity_id:sampleActivity.id,title:'合成范围外记录',activity_date:'2026-10-13',segment_index:0}}],mode:'tracks',activity_count:1,visible_activity_count:1,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0}},error:null}}));
  await page.getByRole('button',{name:'重新读取足迹',exact:true}).click();await ready(page);
  await expect(group.getByRole('button')).toHaveCount(1);
  const unlocated=group.getByRole('button',{name:'未识别区域',exact:true});
  await unlocated.click();await expect(unlocated).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('footprint-summary')).toContainText('地图显示 1 条');
});
test('all records ignore old date URLs and both modes preserve map, legend and keyboard access',async({page})=>{
  const state=await fixture(page);await loginRunner(page);await page.goto('/footprints?year=2024&filter=range&from=2024-01-01&to=2024-12-31');await ready(page);
  await expect(page).toHaveURL(/\/footprints\?mode=tracks$/);
  await expect(page.getByLabel('时间筛选',{exact:true})).toHaveCount(0);
  await expect(page.getByTestId('footprint-summary')).toContainText('全部 2 条运动记录');
  await expect(page.getByTestId('footprint-generated')).toContainText('更新于');
  expect(state.requests[0].search).toBe('?mode=tracks');
  await expect(page.getByRole('button',{name:'轨迹叠加',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'运动热力图',exact:true}).click();await ready(page);
  expect(state.requests.at(-1)?.search).toBe('?mode=heatmap');
  await expect(page.getByTestId('heat-legend')).toContainText('不同运动记录');
  await expect(page.getByTestId('heat-legend')).toContainText('GPS 点');
  await page.getByText('查看热区数据',{exact:false}).click();
  await page.getByRole('button',{name:'定位热区 1'}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({hasText:'所选网格：2 条不同运动记录'})).toBeVisible();
  await page.reload();await ready(page);await expect(page).toHaveURL(/mode=heatmap$/);
  await page.setViewportSize({width:1440,height:1400});await capture(page,'desktop-heatmap');
  await page.setViewportSize({width:390,height:1000});await page.reload();await ready(page);await capture(page,'mobile-heatmap');
  await page.locator('.map-toolbar').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'test-results/footprints-mobile-heatmap-map.png',fullPage:false});
});
test('overlapping routes expose every hit and keyboard record selection links to existing details',async({page})=>{
  await fixture(page);await loginRunner(page);await page.goto('/footprints?year=2026');await ready(page);
  const canvas=page.locator('.maplibregl-canvas');const box=(await canvas.boundingBox())!;
  // This segment midpoint is at the fitted viewport centre for these symmetric test routes.
  await canvas.click({position:{x:box.width/2,y:box.height/2}});
  await expect(page.getByTestId('route-choices')).toContainText('2');
  await expect(page.getByTestId('route-choices').getByRole('link')).toHaveCount(2);
  await page.getByText('全部可显示记录',{exact:false}).click();
  await page.getByRole('button',{name:`定位 ${sampleActivity.title}`,exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByTestId('route-choices')).toContainText(sampleActivity.title);
  await page.setViewportSize({width:1440,height:1400});await capture(page,'desktop-tracks');
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.getByTestId('footprint-map-ready').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(420);}
  await page.setViewportSize({width:390,height:1000});await capture(page,'mobile-tracks');
  await page.locator('.map-toolbar').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'test-results/footprints-mobile-tracks-map.png',fullPage:false});
  await page.getByTestId('route-choices').getByRole('link').click();await expect(page).toHaveURL(new RegExp(`/activities/${sampleActivity.id}$`));await expect(page.getByRole('heading',{name:sampleActivity.title,exact:true,level:1})).toBeVisible();
});
test('single line and point render; empty filters, data and tile failures offer distinct retries',async({page})=>{
  const state=await fixture(page);state.scenario='single';await loginRunner(page);await page.goto('/footprints?year=2026');await ready(page);
  await expect(page.getByTestId('footprint-summary')).toContainText('地图显示 1 条');
  await expect(page.getByRole('button',{name:'重试底图'})).toBeVisible();
  await page.getByRole('button',{name:'重试底图'}).click();await expect(page.getByRole('button',{name:'重试底图'})).toBeVisible();
  await page.getByRole('button',{name:'关闭底图'}).click();await expect(page.getByRole('button',{name:'开启底图'})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'回到全部足迹'}).click();await ready(page);
  state.scenario='point';await page.getByRole('button',{name:'重新读取足迹'}).click();await ready(page);
  state.failures=1;await page.getByRole('button',{name:'重新读取足迹'}).click();await expect(page.getByRole('alert')).toContainText('足迹暂不可用');
  await expect(page.getByTestId('footprint-map-ready')).toHaveCount(0);await page.getByRole('button',{name:'重新读取足迹'}).click();await ready(page);
  state.scenario='empty';await page.getByRole('button',{name:'重新读取足迹'}).click();await expect(page.getByRole('status').filter({hasText:'还没有可显示的足迹'})).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);await capture(page,'desktop-empty');
  await page.setViewportSize({width:390,height:844});await capture(page,'mobile-empty');
  state.expired=true;await page.getByRole('button',{name:'运动热力图',exact:true}).click();await expect(page).toHaveURL(/admin\?reason=changed/);
});

test('WebGL initialisation failure retries the same data; successful tiles and map controls work',async({page})=>{
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    (window as unknown as {blockFootprintGL:boolean}).blockFootprintGL=true;
    HTMLCanvasElement.prototype.getContext=function(this: HTMLCanvasElement,...args:Parameters<typeof original>){
      if((window as unknown as {blockFootprintGL:boolean}).blockFootprintGL && String(args[0]).includes('webgl'))return null;
      return original.apply(this,args);
    } as typeof original;
  });
  await fixture(page);await loginRunner(page);await page.goto('/footprints?year=2026');
  await expect(page.getByRole('alert')).toContainText('无法初始化地图');
  await page.getByText('全部可显示记录',{exact:false}).click();
  await expect(page.locator('.record-list').getByRole('link')).toHaveCount(2);
  await page.evaluate(()=>{(window as unknown as {blockFootprintGL:boolean}).blockFootprintGL=false;});
  await installBasemaps(page);
  await page.getByRole('button',{name:'重新绘制地图'}).click();await ready(page);
  await expect(page.getByRole('status').filter({hasText:'正在加载底图'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重试底图'})).toHaveCount(0);
  await page.getByRole('button',{name:'放大地图',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'缩小地图',exact:true}).click();
  const canvas=page.locator('.maplibregl-canvas');await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('+');
  const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+20,{steps:5});await page.mouse.up();
  await page.getByRole('button',{name:'回到全部足迹'}).click();await ready(page);
});
test('late mode responses cannot replace the current map',async({page})=>{
  await fixture(page);await loginRunner(page);await page.goto('/footprints');await ready(page);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  await page.route('**/api/v1/showcase/footprints/all?mode=heatmap',async route=>{entered();await held;try{await route.fallback();}catch{/* superseded by the current mode */}});
  await page.getByRole('button',{name:'运动热力图',exact:true}).click();await started;
  await expect(page.getByRole('status').filter({hasText:'正在读取个人足迹'})).toBeVisible();
  await page.getByRole('button',{name:'轨迹叠加',exact:true}).click();await ready(page);release();
  await expect(page.getByTestId('footprint-summary')).toContainText('地图显示 2 条');
  await expect(page.getByTestId('heat-legend')).toHaveCount(0);
});
test('pending polls until ready, then stops; failures and refresh-in-progress remain readable',async({page})=>{
  const state=await fixture(page);state.status='pending';await loginRunner(page);await page.clock.install();await page.goto('/footprints');
  await expect(page.getByRole('status').filter({hasText:'正在生成全部足迹'})).toBeVisible();
  state.status='ready';await page.clock.fastForward(5100);await ready(page);
  const count=state.requests.length;await page.clock.fastForward(15000);expect(state.requests).toHaveLength(count);
  state.status='failed';await page.getByRole('button',{name:'运动热力图',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('足迹生成暂未完成');
  const failedCount=state.requests.length;await page.clock.fastForward(15000);expect(state.requests).toHaveLength(failedCount);
  state.status='ready';state.refreshing=true;await page.getByRole('button',{name:'重新读取足迹'}).click();await ready(page);
  await expect(page.getByTestId('footprint-generated')).toContainText('后台更新中');
  state.refreshFailed=true;await page.getByRole('button',{name:'重新读取足迹'}).click();await ready(page);
  await expect(page.getByTestId('footprint-refresh-failed')).toContainText('上次生成的足迹');
});
test('pending polling stops after leaving the page and expired polling clears private data',async({page})=>{
  const state=await fixture(page);state.status='pending';await loginRunner(page);await page.clock.install();await page.goto('/footprints');
  await expect(page.getByRole('status').filter({hasText:'正在生成全部足迹'})).toBeVisible();
  await page.getByRole('link',{name:'设置',exact:true}).click();await expect(page).toHaveURL(/\/settings$/);const count=state.requests.length;await page.clock.fastForward(15000);expect(state.requests).toHaveLength(count);
  await page.getByRole('link',{name:'个人足迹',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'正在生成全部足迹'})).toBeVisible();
  state.expired=true;await page.clock.fastForward(5100);await expect(page).toHaveURL(/admin\?reason=changed/);
  await expect(page.getByTestId('footprint-summary')).toHaveCount(0);
});

test('heat region data is lazy and paginated without changing counts',async({page})=>{
  const state=await fixture(page);state.heatCells=201;await loginRunner(page);await page.goto('/footprints?year=2026&mode=heatmap');await ready(page);
  await expect(page.locator('.heat-data tbody tr')).toHaveCount(0);
  await page.getByText('查看热区数据',{exact:false}).click();
  await expect(page.locator('.heat-data tbody tr')).toHaveCount(50);
  await page.getByRole('button',{name:'下一页热区'}).click();
  await expect(page.getByRole('button',{name:'定位热区 51',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'定位热区 51',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'所选网格：2 条不同运动记录'})).toBeVisible();
  await page.getByRole('button',{name:'上一页热区'}).click();await expect(page.getByRole('button',{name:'定位热区 1',exact:true})).toBeVisible();
  await page.getByText('查看热区数据',{exact:false}).click();await expect(page.locator('.heat-data tbody tr')).toHaveCount(0);
});
test('a live WebGL context loss shows a retry and redraws existing footprints',async({page})=>{
  await fixture(page);await loginRunner(page);await page.goto('/footprints?year=2026');await ready(page);
  const lost=await page.locator('.maplibregl-canvas').evaluate(el=>{
    const gl=(el as HTMLCanvasElement).getContext('webgl2');const extension=gl?.getExtension('WEBGL_lose_context');extension?.loseContext();return !!extension;
  });
  expect(lost).toBe(true);await expect(page.getByRole('alert')).toContainText('绘图上下文');
  await page.getByRole('button',{name:'重新绘制地图'}).click();await ready(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// Keep the existing shared calendar regressions on the AI page now that
// personal footprints always includes all records.
async function dateFixture(page: Page) {
  await installAI(page);await loginRunner(page);
  const state={requests:[] as URL[]};
  page.on('request',request=>{if(request.url().includes('/ai-reports/context'))state.requests.push(new URL(request.url()));});
  await page.goto('/ai');
  await expect(page.getByLabel('开始日期（周一）',{exact:true})).toHaveValue('2026-09-14');
  await page.getByLabel('开始日期（周一）',{exact:true}).fill('2026-10-01');
  await page.getByLabel('结束日期（周一，不含）',{exact:true}).fill('2026-12-31');
  return state;
}
test('nested month and year menus stay anchored inside the open calendar', async ({ page }) => {
  await dateFixture(page);
  await page.getByRole('button', { name: '选择开始日期（周一）', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: '选择开始日期（周一）', exact: true });
  for (const [label, name, value] of [['月份', '11月', '10'], ['年份', '2025年', '2025']]) {
    const select = calendar.getByLabel(label, { exact: true });
    await expect(select).toHaveClass(/rn-liquid-select/);
    await select.click();
    const menu = page.getByRole('listbox', { name: `${label}选项`, exact: true });
    await expect(menu).toBeVisible(); await expect(calendar).toBeVisible();
    const anchor = (await select.boundingBox())!, box = (await menu.boundingBox())!;
    expect(Math.abs(box.x - anchor.x)).toBeLessThan(100);
    if (label === '年份') {
      await expect.poll(() => menu.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
      const selectedBox = (await menu.getByRole('option', { selected: true }).boundingBox())!;
      const glassBox = (await menu.locator('.rn-moving-copy').boundingBox())!;
      expect(glassBox.y + glassBox.height).toBeGreaterThan(selectedBox.y + selectedBox.height / 2);
      await page.screenshot({ path: 'test-results/nested-year-menu.png' });
    }
    await menu.getByRole('option', { name, exact: true }).click();
    await expect(select).toHaveValue(value); await expect(calendar).toBeVisible();
    await expect(menu).toBeHidden();
  }
  await expect(calendar.locator('.month-announcement')).toHaveText('2025年11月');
  await calendar.getByLabel('月份', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: '月份选项' })).toBeHidden();
  await expect(calendar).toBeVisible();
  await page.keyboard.press('Escape'); await expect(calendar).toBeHidden();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: '选择开始日期（周一）', exact: true }).click();
    // The popover expands from its trigger; measure only once the scale transform has settled.
    await expect.poll(async () => Math.abs((await calendar.boundingBox())!.width - await calendar.evaluate(el => (el as HTMLElement).offsetWidth))).toBeLessThan(1);
    const monthSelect = calendar.getByLabel('月份', { exact: true });
    const yearSelect = calendar.getByLabel('年份', { exact: true });
    await monthSelect.focus();
    const ring = await monthSelect.evaluate(el => {
      const s = getComputedStyle(el); return Math.max(0, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
    });
    expect((await monthSelect.boundingBox())!.x - ring).toBeGreaterThanOrEqual((await yearSelect.boundingBox())!.x + (await yearSelect.boundingBox())!.width);
    await monthSelect.click({ position: { x: 12, y: 20 } });
    const menu = page.getByRole('listbox', { name: '月份选项' });
    await expect.poll(() => menu.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320) await page.screenshot({ path: 'test-results/nested-month-320.png' });
    if (width === 390) {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); });
      await page.screenshot({ path: 'test-results/nested-month-dark-mobile.png' });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await expect(calendar).toBeHidden();
  }
});
test('themed date picker supports keyboard selection, required inputs and narrow screens',async({page})=>{
  const state=await dateFixture(page);
  const start=page.getByRole('button',{name:'选择开始日期（周一）',exact:true});
  await start.focus();await page.keyboard.press('Enter');
  const calendar=page.getByRole('dialog',{name:'选择开始日期（周一）',exact:true});
  const selected=calendar.getByRole('button',{name:'2026年10月1日',exact:true});
  await expect(selected).toBeFocused();await expect(selected).toHaveAttribute('aria-pressed','true');
  expect(await selected.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(23, 116, 92)');
  await calendar.getByRole('button',{name:'下个月',exact:true}).click();await page.keyboard.press('Tab');
  await expect(calendar.getByRole('button',{name:'2026年11月1日',exact:true})).toBeFocused();
  await page.keyboard.press('PageUp');await expect(selected).toBeFocused();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await expect(page.getByLabel('开始日期（周一）',{exact:true})).toHaveValue('2026-10-02');await expect(start).toBeFocused();
  await page.getByRole('button',{name:'选择结束日期（周一，不含）',exact:true}).click();
  const endCalendar=page.getByRole('dialog',{name:'选择结束日期（周一，不含）',exact:true});
  await endCalendar.getByLabel('月份',{exact:true}).selectOption('9');
  await endCalendar.getByRole('button',{name:'2026年10月13日',exact:true}).click();
  await page.getByLabel('开始日期（周一）',{exact:true}).fill('2026-09-07');
  await page.getByLabel('结束日期（周一，不含）',{exact:true}).fill('2026-10-05');
  await page.getByRole('button',{name:'读取统计依据',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1)?.searchParams.get('date_to')).toBe('2026-10-05');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:844});
    await start.click();await expect(calendar).toBeVisible();
    const box=(await calendar.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/date-picker-${width}.png`});
    await page.keyboard.press('Escape');await expect(calendar).toBeHidden();await expect(start).toBeFocused();
  }
  await start.click();await calendar.getByRole('button',{name:'清除',exact:true}).click();
  await expect(page.getByLabel('开始日期（周一）',{exact:true})).toHaveValue('');
  const requestCount=state.requests.length;await page.getByRole('button',{name:'读取统计依据',exact:true}).click();expect(state.requests).toHaveLength(requestCount);
  await start.click();await calendar.getByRole('button',{name:'今天',exact:true}).click();
  await expect(page.getByLabel('开始日期（周一）',{exact:true})).not.toHaveValue('');
});

test('generation taking more than five minutes still completes automatically',async({page})=>{
  const state=await fixture(page);state.status='pending';await loginRunner(page);await page.clock.install();await page.goto('/footprints');
  const pending=page.getByRole('status').filter({hasText:'正在生成全部足迹'});
  await expect(pending).toBeVisible();
  for(let count=2;count<=61;count++){
    await page.clock.fastForward(5000);
    await expect.poll(()=>state.requests.length).toBe(count);
    await expect(pending).toBeVisible();
  }
  state.status='ready';await page.clock.fastForward(5000);await ready(page);
  expect(state.requests).toHaveLength(62);
  expect(state.requests.at(-1)?.search).toBe('?mode=tracks');
});
test('route-less manual records remain counted in the all-record summary',async({page})=>{
  await fixture(page);await loginRunner(page);
  await page.route('**/api/v1/showcase/footprints/all?**',route=>route.fulfill({json:{data:{status:'ready',generated_at:'2026-10-15T00:00:00Z',refreshing:false,result:{scope:'all',type:'FeatureCollection',features:[],mode:'tracks',activity_count:3,visible_activity_count:0,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0}},error:null}}));
  await page.goto('/footprints');
  await expect(page.getByTestId('footprint-summary')).toContainText('全部 3 条运动记录，地图显示 0 条');
  await expect(page.getByRole('status').filter({hasText:'还没有可显示的足迹'})).toContainText('带路线的运动记录');
});
