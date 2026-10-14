import { expect, test, type Page } from '@playwright/test';
import { loginRunner, installActivities, sampleActivity, incompleteActivity } from '../fixtures/activities';
async function fixture(page: Page) {
  const state={heatCells:1,scenario:'multi' as 'multi'|'single'|'point'|'empty',failures:0,expired:false,requests:[] as URL[]};
  await installActivities(page);
  await page.route('**/api/v1/footprints?**',route=>{
    const url=new URL(route.request().url());state.requests.push(url);
    if(state.expired)return route.fulfill({status:401,json:{error:{message:'会话已过期'}}});
    if(state.failures-->0)return route.fulfill({status:503,json:{error:{message:'足迹暂不可用，请重试'}}});
    const mode=url.searchParams.get('mode'),empty=state.scenario==='empty'||url.searchParams.get('date_from')==='2025-01-01';
    const records=state.scenario==='multi'?[sampleActivity,incompleteActivity]:[sampleActivity];
    const routeCoordinates=[[121.48,31.23],[121.485,31.2335],[121.49,31.237]];
    const features=empty?[]:mode==='heatmap'?[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[121.484,31.233],[121.485,31.233],[121.485,31.234],[121.484,31.234],[121.484,31.233]]]},properties:{i:135236,j:36621,count:2}}]:records.map(record=>({type:'Feature',geometry:state.scenario==='point'?{type:'Point',coordinates:[121.485,31.235]}:{type:'LineString',coordinates:routeCoordinates},properties:{activity_id:record.id,title:record.title,activity_date:record.activity_date,segment_index:0}}));
    return route.fulfill({json:{data:{type:'FeatureCollection',features:mode==='heatmap'?features.flatMap(feature=>Array.from({length:state.heatCells},(_,index)=>({...feature,properties:{...feature.properties,i:135236+index}}))):features,mode,date_from:url.searchParams.get('date_from'),date_to:url.searchParams.get('date_to'),activity_count:empty?0:records.length,visible_activity_count:empty?0:records.length,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:empty?0:mode==='heatmap'?2:0},error:null}});
  });
  return state;
}
async function ready(page:Page){await expect(page.getByTestId('footprint-map-ready')).toBeVisible();}
async function capture(page:Page,name:string){await page.evaluate(async()=>{(document.activeElement as HTMLElement)?.blur();scrollTo(0,0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.screenshot({path:`test-results/footprints-${name}.png`,fullPage:false});}
test('themed date picker supports keyboard selection, range limits and narrow screens',async({page})=>{
  const state=await fixture(page);await loginRunner(page);await page.goto('/footprints?filter=range&from=2026-10-01&to=2026-12-31');await ready(page);
  const start=page.getByRole('button',{name:'选择开始日期',exact:true});
  await start.focus();await page.keyboard.press('Enter');
  const calendar=page.getByRole('dialog',{name:'选择开始日期',exact:true});
  const selected=calendar.getByRole('button',{name:'2026年10月1日',exact:true});
  await expect(selected).toBeFocused();await expect(selected).toHaveAttribute('aria-pressed','true');
  expect(await selected.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(23, 116, 92)');
  await calendar.getByRole('button',{name:'下个月',exact:true}).click();await page.keyboard.press('Tab');
  await expect(calendar.getByRole('button',{name:'2026年11月1日',exact:true})).toBeFocused();
  await page.keyboard.press('PageUp');await expect(selected).toBeFocused();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2026-10-02');await expect(start).toBeFocused();
  await page.getByRole('button',{name:'选择结束日期（含当天）',exact:true}).click();
  const endCalendar=page.getByRole('dialog',{name:'选择结束日期（含当天）',exact:true});
  await endCalendar.getByLabel('月份',{exact:true}).selectOption('9');
  await expect(endCalendar.getByRole('button',{name:'2026年10月1日',exact:true})).toBeDisabled();
  await endCalendar.getByRole('button',{name:'2026年10月13日',exact:true}).click();
  await page.getByRole('button',{name:'应用筛选'}).click();await ready(page);
  expect(state.requests.at(-1)?.searchParams.get('date_to')).toBe('2026-10-14');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:844});
    if(!await start.isVisible())await page.locator('.filter-panel > summary').click();
    await start.click();await expect(calendar).toBeVisible();
    const box=(await calendar.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/date-picker-${width}.png`});
    await page.keyboard.press('Escape');await expect(calendar).toBeHidden();await expect(start).toBeFocused();
  }
  await start.click();await calendar.getByRole('button',{name:'清除',exact:true}).click();
  await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('');
  const requestCount=state.requests.length;await page.getByRole('button',{name:'应用筛选'}).click();expect(state.requests).toHaveLength(requestCount);
  await start.click();await calendar.getByRole('button',{name:'今天',exact:true}).click();
  await expect(page.getByLabel('开始日期',{exact:true})).not.toHaveValue('');
});
test('map-first modes and collapsible filters preserve ranges, legend and keyboard data access',async({page})=>{
  const state=await fixture(page);await loginRunner(page);await page.goto('/footprints?year=2026');await ready(page);
  await expect(page.getByRole('button',{name:'轨迹叠加',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'运动热力图',exact:true}).click();await ready(page);
  await expect(page.getByRole('button',{name:'运动热力图',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('heat-legend')).toContainText('不同运动记录');
  await expect(page.getByTestId('heat-legend')).toContainText('GPS 点');
  await page.getByText('查看热区数据',{exact:false}).click();
  await page.getByRole('button',{name:'定位热区 1'}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({hasText:'所选网格：2 条不同运动记录'})).toBeVisible();
  await page.getByLabel('时间筛选').selectOption('range');await page.getByLabel('开始日期',{exact:true}).fill('2026-10-12');await page.getByLabel('结束日期（含当天）',{exact:true}).fill('2026-10-13');
  await page.getByRole('button',{name:'应用筛选'}).click();await ready(page);
  expect(state.requests.at(-1)?.searchParams.get('date_to')).toBe('2026-10-14');
  await page.reload();await ready(page);await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2026-10-12');
  await page.setViewportSize({width:1440,height:1400});await capture(page,'desktop-heatmap');
  await page.setViewportSize({width:390,height:1000});await page.reload();await ready(page);
  await expect(page.getByLabel('时间筛选')).toBeHidden();
  await page.locator('.filter-panel > summary').focus();await page.keyboard.press('Enter');
  await expect(page.getByLabel('开始日期',{exact:true})).toBeVisible();
  await page.locator('.filter-panel > summary').click();await capture(page,'mobile-heatmap');
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
  await page.setViewportSize({width:390,height:1000});await page.locator('.filter-panel > summary').click();await capture(page,'mobile-tracks');
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
  state.scenario='point';await page.getByRole('button',{name:'应用筛选'}).click();await ready(page);
  state.failures=1;await page.getByRole('button',{name:'应用筛选'}).click();await expect(page.getByRole('alert')).toContainText('足迹暂不可用');
  await expect(page.getByTestId('footprint-map-ready')).toHaveCount(0);await page.getByRole('button',{name:'重新读取足迹'}).click();await ready(page);
  state.scenario='empty';await page.getByRole('button',{name:'应用筛选'}).click();await expect(page.getByRole('status').filter({hasText:'此范围没有可显示的足迹'})).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);await capture(page,'desktop-empty');
  await page.setViewportSize({width:390,height:844});await capture(page,'mobile-empty');
  state.expired=true;await page.getByRole('button',{name:'运动热力图',exact:true}).click();await expect(page).toHaveURL(/login\?reason=changed/);
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
  await page.route('**/*tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')}));
  await page.getByRole('button',{name:'重新绘制地图'}).click();await ready(page);
  await expect(page.getByRole('status').filter({hasText:'正在加载底图'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重试底图'})).toHaveCount(0);
  await page.getByRole('button',{name:'放大地图',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'缩小地图',exact:true}).click();
  const canvas=page.locator('.maplibregl-canvas');await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('+');
  const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+20,{steps:5});await page.mouse.up();
  await page.getByRole('button',{name:'回到全部足迹'}).click();await ready(page);
});
test('late filters cannot replace current map, and manual records without routes explain visibility',async({page})=>{
  await fixture(page);await loginRunner(page);await page.goto('/footprints?year=2026');await ready(page);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  await page.route('**/api/v1/footprints?date_from=2025-01-01&date_to=2026-01-01&mode=tracks',async route=>{entered();await held;try{await route.fallback();}catch{/* request was deliberately aborted by a newer filter */}});
  await page.getByLabel('年份',{exact:true}).fill('2025');await page.getByRole('button',{name:'应用筛选'}).click();await started;
  await expect(page.getByRole('status').filter({hasText:'正在读取个人足迹'})).toBeVisible();
  await page.getByLabel('年份',{exact:true}).fill('2026');await page.getByRole('button',{name:'应用筛选'}).click();await ready(page);release();
  await expect(page.getByTestId('footprint-summary')).toContainText('地图显示 2 条');await expect(page.locator('.range-label')).toHaveText('2026-01-01 — 2026-12-31');
  await page.route('**/api/v1/footprints?**',route=>route.fulfill({json:{data:{type:'FeatureCollection',features:[],mode:'tracks',date_from:'2026-01-01',date_to:'2027-01-01',activity_count:3,visible_activity_count:0,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0},error:null}}));
  await page.getByRole('button',{name:'应用筛选'}).click();await expect(page.getByTestId('footprint-summary')).toContainText('3 条运动记录，地图显示 0 条');
  await expect(page.getByRole('status').filter({hasText:'此范围没有可显示的足迹'})).toContainText('带路线的运动记录');
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
