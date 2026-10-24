import { expect, test, type Page, type Locator } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

async function captureRegion(page: Page, region: Locator, path: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const {width} = page.viewportSize()!;
  await page.setViewportSize({width,height:Math.ceil(await region.evaluate(el=>el.scrollHeight))+160});
  await region.evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.evaluate(() => new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await region.screenshot({path});
}
async function mapBackground(page: Page, map: Locator) {
  const png=await map.screenshot();
  return page.evaluate(async data=>{
    const image=new Image();image.src=`data:image/png;base64,${data}`;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
    const p=context.getImageData(40,80,1,1).data;return (p[0]+p[1]+p[2])/3;
  },png.toString('base64'));
}

async function explorer(page: Page) {
  const state = await installActivities(page);
  state.records = Array.from({length:23},(_,i)=>({...sampleActivity,
    id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,
    title:`运动 ${i+1}`, category:i===22?'比赛&恢复':'轻松跑',
    activity_date:`2026-10-${String(24-i).padStart(2,'0')}`,
    timer_seconds:1500, elapsed_seconds:1800, calories_kcal:0, steps:3200, avg_heart_rate_bpm:142,
    has_route:i!==1 }));
  await loginRunner(page); await page.goto('/dashboard?year=2026');
  return state;
}

test('explorer omits the extra device section, fits desktop heights and keeps mobile content accessible', async ({page}) => {
  const state = await explorer(page);
  state.records[0] = {...state.records[0], max_heart_rate_bpm:172, min_heart_rate_bpm:107, max_cadence_spm:180};
  await page.reload();
  const region = page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByRole('region',{name:'设备指标'})).toHaveCount(0);
  for (const [width,height] of [[1366,768],[1440,900],[1920,1080],[1024,768]]) {
    await page.setViewportSize({width,height});
    await expect(region.getByTestId('route-map-ready')).toBeVisible();
    await expect.poll(()=>region.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(height-24);
    await region.evaluate(el=>el.scrollIntoView({block:'start'}));
    await expect(region.getByRole('button',{name:'选择运动 运动 1',exact:true})).toBeInViewport();
    await region.screenshot({path:`test-results/compact-explorer-${width}-${height}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(region.getByTestId('explorer-metrics').locator('dd')).toHaveCount(7);
  await region.getByRole('button',{name:'选择运动 运动 1',exact:true}).scrollIntoViewIfNeeded();
  await region.screenshot({path:'test-results/compact-explorer-mobile.png'});
});

test('whole calendar fits every year and valid year input refreshes automatically',async({page})=>{
  await loginRunner(page);await page.goto('/dashboard?year=2026');
  await expect(page.getByRole('button',{name:'查看',exact:true})).toHaveCount(0);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    if(width<768) { await expect(page.getByRole('region',{name:'2026 年运动日历',exact:true})).toBeHidden(); continue; }
    await expect(page.locator('[data-date]')).toHaveCount(365);
    await expect.poll(()=>page.locator('.calendar-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(page.getByRole('button',{name:/2026-12-31，/})).toBeVisible();
    if(width===768 || width===1440) await captureRegion(page,page.getByRole('region',{name:'2026 年运动日历',exact:true}),`.cache/dashboard-explorer/calendar-${width}.png`);
  }
  await page.getByLabel('年份',{exact:true}).fill('2024');
  await expect(page.locator('[data-date]')).toHaveCount(366);
  await expect(page.getByRole('button',{name:/2024-02-29，/})).toHaveCount(1);
  await expect(page).toHaveURL(/year=2024/);
});

test('latest selection, private category history, twenty-record limit, keyboard and compact horizontal cards',async({page})=>{
  const state=await explorer(page);
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByRole('heading',{name:'运动 1',exact:true})).toBeVisible();
  await expect(region.getByTestId('explorer-metrics')).toContainText('142 bpm');
  await expect(region.getByTestId('explorer-metrics')).toContainText('0 kcal');
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  await expect(region.getByRole('button',{name:'上一条运动记录',exact:true})).toBeDisabled();
  await region.getByLabel('足迹分类').selectOption('比赛&恢复');
  await expect(region.getByRole('heading',{name:'运动 23',exact:true})).toBeVisible();
  await expect(region.getByRole('button',{name:'上一条运动记录',exact:true})).toBeDisabled();
  await expect(region.getByRole('button',{name:'下一条运动记录',exact:true})).toBeDisabled();
  await expect(region.getByRole('button',{name:'选择运动 运动 1',exact:true})).toHaveCount(0);
  await region.getByLabel('足迹分类').selectOption('轻松跑');
  await expect(region.getByRole('heading',{name:'运动 1',exact:true})).toBeVisible();
  await region.getByRole('button',{name:'下一条运动记录',exact:true}).click();
  await expect(region.getByRole('heading',{name:'运动 2',exact:true})).toBeVisible();
  await expect(region.getByText('此活动没有路线。',{exact:true})).toBeVisible();
  await region.getByRole('button',{name:'上一条运动记录',exact:true}).click();
  await expect(region.getByRole('heading',{name:'运动 1',exact:true})).toBeVisible();
  const twentieth=region.getByRole('button',{name:'选择运动 运动 20',exact:true});
  await twentieth.focus();await page.keyboard.press('Enter');
  await expect(region.getByRole('heading',{name:'运动 20',exact:true})).toBeVisible();
  await expect(region.getByRole('button',{name:'下一条运动记录',exact:true})).toBeDisabled();
  await expect(region.locator('.history-card')).toHaveCount(20);
  await expect(region.getByRole('button',{name:/加载.*更多记录/})).toHaveCount(0);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await region.locator('.activity-strip').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    await expect.poll(()=>region.locator('.history-card[aria-pressed=true]').evaluate(el=>{const card=el.getBoundingClientRect(),strip=el.closest('ul')!.getBoundingClientRect();return card.left>=strip.left-2 && card.right<=strip.right+2;})).toBe(true);
  }
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.setViewportSize({width:1440,height:1000});await captureRegion(page,region,'.cache/dashboard-explorer/desktop.png');
  await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:390,height:1000});
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(()=>mapBackground(page,region.locator('.maplibregl-canvas'))).toBeLessThan(60);
  await captureRegion(page,region,'.cache/dashboard-explorer/mobile-dark.png');
});

test('late activity and route responses cannot overwrite newer selection; errors retry and expiry clears',async({page})=>{
  const state=await explorer(page);
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  await page.route(`**/api/v1/showcase/activities/${state.records[2].id}/route`,async route=>{entered();await held;await route.fallback();});
  await region.getByRole('button',{name:'选择运动 运动 3',exact:true}).click();await started;
  await region.getByRole('button',{name:'选择运动 运动 2',exact:true}).click();
  await expect(region.getByText('此活动没有路线。',{exact:true})).toBeVisible();release();
  await expect(region.getByRole('heading',{name:'运动 2',exact:true})).toBeVisible();
  await expect(region.getByTestId('route-map-ready')).toHaveCount(0);
  state.detailFailures=1;
  await region.getByRole('button',{name:'选择运动 运动 1',exact:true}).click();
  await region.getByRole('button',{name:'重试运动详情',exact:true}).click();
  await expect(region.getByRole('heading',{name:'运动 1',exact:true})).toBeVisible();
  await page.route(`**/api/v1/showcase/activities/${state.records[2].id}`,route=>route.fulfill({status:401,body:'expired'}));
  await region.getByRole('button',{name:'选择运动 运动 3',exact:true}).click();
  await expect(page).toHaveURL(/admin\?reason=expired/);
});

test('wall has its own active navigation entry',async({page})=>{
  await loginRunner(page);await page.goto('/activities/wall');
  const nav=page.getByRole('navigation',{name:'主要导航'});
  await expect(nav.getByRole('link',{name:'足迹墙',exact:true})).toHaveAttribute('aria-current','page');
  await expect(nav.getByRole('link',{name:'跑步记录',exact:true})).not.toHaveAttribute('aria-current','page');
});

test('classification and route failures retry independently and a stale category cannot replace the current one',async({page})=>{
  const state=await installActivities(page);
  state.records[0].category='轻松跑';state.records[1].category='比赛';
  let categoryFailed=true, routeFailed=true;
  await page.route('**/api/v1/showcase/activities/categories',route=>categoryFailed ? route.fulfill({status:503,json:{error:{message:'分类读取失败'}}}) : route.fallback());
  await page.route(`**/api/v1/showcase/activities/${sampleActivity.id}/route`,route=>routeFailed ? route.fulfill({status:503,json:{error:{message:'路线读取失败'}}}) : route.fallback());
  state.listFailures=1;
  await loginRunner(page);await page.goto('/dashboard');
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await region.getByRole('button',{name:'重试足迹记录',exact:true}).click();
  await expect(region.getByRole('heading',{name:sampleActivity.title,exact:true})).toBeVisible();
  await expect(region.getByRole('button',{name:'重试运动路线',exact:true})).toBeVisible();
  categoryFailed=false;await region.getByRole('button',{name:'重试足迹分类',exact:true}).click();
  routeFailed=false;await region.getByRole('button',{name:'重试运动路线',exact:true}).click();
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  await page.route(/\/api\/v1\/showcase\/activities\?.*category=/,async route=>{
    if(new URL(route.request().url()).searchParams.get('category')==='轻松跑'){entered();await held;}
    await route.fallback();
  });
  await region.getByLabel('足迹分类').selectOption('轻松跑');await started;
  await region.getByLabel('足迹分类').selectOption('比赛');
  await expect(region.getByRole('heading',{name:state.records[1].title,exact:true})).toBeVisible();release();
  await expect(region.getByRole('button',{name:`选择运动 ${sampleActivity.title}`,exact:true})).toHaveCount(0);
  await expect(region.getByRole('heading',{name:state.records[1].title,exact:true})).toBeVisible();
});

test('late detail results cannot restore a previous record',async({page})=>{
  await explorer(page);
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByRole('heading',{name:'运动 1',exact:true})).toBeVisible();
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  await page.route('**/api/v1/showcase/activities/11111111-1111-4111-8111-000000000003',async route=>{entered();await held;await route.fallback();});
  await region.getByRole('button',{name:'选择运动 运动 3',exact:true}).click();await started;
  await region.getByRole('button',{name:'选择运动 运动 2',exact:true}).click();
  await expect(region.getByRole('heading',{name:'运动 2',exact:true})).toBeVisible();release();
  await expect(region.getByText('此活动没有路线。',{exact:true})).toBeVisible();
  await expect(region.getByRole('heading',{name:'运动 3',exact:true})).toHaveCount(0);
});

test('thumbnail expiry clears the selected private map and metrics before login navigation completes',async({page})=>{
  let exiting: {metrics:number;map:number;cards:number} | undefined;
  page.on('console',message=>{if(message.text().startsWith('private-content-at-exit:')) exiting=JSON.parse(message.text().slice(24));});
  await page.addInitScript(()=>window.addEventListener('beforeunload',()=>console.debug('private-content-at-exit:'+JSON.stringify({metrics:document.querySelectorAll('[data-testid=explorer-metrics]').length,map:document.querySelectorAll('[data-testid=route-map-ready]').length,cards:document.querySelectorAll('.history-card').length}))));
  const state=await explorer(page);
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  await page.route('**/admin?reason=expired*',async route=>{entered();await held;await route.continue();});
  await page.route(`**/api/v1/showcase/activities/${state.records[9].id}/route`,route=>route.fulfill({status:401,body:'expired'}));
  exiting=undefined;
  await region.getByRole('button',{name:'选择运动 运动 10',exact:true}).scrollIntoViewIfNeeded();
  await started;
  try {
    await expect.poll(() => exiting).toEqual({metrics:0,map:0,cards:0});
  } finally { release(); }
  await expect(page).toHaveURL(/admin\?reason=expired/);
});

for (const width of [390,1440]) test(`switching a record keeps the map, metrics and history in place during slow reads at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const state=await explorer(page);
  Object.assign(state.records[2],{title:'长距离训练与恢复记录，检验长名称换行后的布局稳定性',timer_seconds:null,elapsed_seconds:null,calories_kcal:null,steps:null});
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  await region.locator('.activity-strip').scrollIntoViewIfNeeded();
  const geometry=()=>region.evaluate(el=>Object.fromEntries(['.selected-heading','.explorer-workspace','.activity-strip'].map(selector=>{const box=el.querySelector(selector)?.getBoundingClientRect();return [selector,box ? {top:box.top,height:box.height} : null];})));
  const before=await geometry();
  const marker=region.getByLabel('路线起点',{exact:true});
  const markerBefore=await marker.getAttribute('style');
  await page.route('**/api/v1/showcase/activities/11111111-1111-4111-8111-000000000003/route',route=>route.fulfill({json:{data:{type:'FeatureCollection',start:[121.48,31.23],end:[121.48,31.237],features:[{type:'Feature',geometry:{type:'LineString',coordinates:[[121.48,31.23],[121.48,31.237]]},properties:{segment_index:0,point_count:2}}]},error:null}}));
  await region.locator('.maplibregl-canvas').evaluate(el=>el.setAttribute('data-original-map','yes'));
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  await page.route('**/api/v1/showcase/activities/11111111-1111-4111-8111-000000000003',async route=>{entered();await held;await route.fallback();});
  await region.locator('[data-id="11111111-1111-4111-8111-000000000003"]').click();await started;
  expect(await geometry()).toEqual(before);
  await expect(region.locator('[data-original-map=yes]')).toHaveCount(1);
  release();await expect(region.getByRole('heading',{name:state.records[2].title,exact:true})).toBeVisible();
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  await expect.poll(()=>marker.getAttribute('style')).not.toBe(markerBefore);
  expect(await geometry()).toEqual(before);
  await expect(region.locator('[data-original-map=yes]')).toHaveCount(1);
  await region.getByRole('button',{name:'选择运动 运动 2',exact:true}).click();
  await expect(region.getByText('此活动没有路线。',{exact:true})).toBeVisible();
  expect(await geometry()).toEqual(before);
});

test('recent records span months, stop at twenty and retain record dates with category filtering',async({page})=>{
  const state=await installActivities(page);
  state.records=Array.from({length:25},(_,i)=>({...sampleActivity,
    id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,
    title:`跨月记录 ${i+1}`,category:i===24?'比赛':'轻松跑',
    activity_date:`2026-${String(10-Math.floor(i/10)).padStart(2,'0')}-${String(24-i%10).padStart(2,'0')}`}));
  const queries:URLSearchParams[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/v1/showcase/activities')queries.push(url.searchParams);});
  await loginRunner(page);await page.goto('/dashboard');
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByRole('heading',{name:'跨月记录 1',exact:true})).toBeVisible();
  await expect(region.locator('.history-card')).toHaveCount(20);
  await expect(region.getByLabel('足迹月份')).toHaveCount(0);
  await expect(region.locator('input[type=month]')).toHaveCount(0);
  await expect(region.getByRole('button',{name:/加载.*更多记录/})).toHaveCount(0);
  await expect(region.locator('.history-card time')).toHaveCount(20);
  await expect(region.locator('.history-card').last()).toContainText('2026-09-15');
  expect(queries).toHaveLength(1);
  expect(queries[0].get('limit')).toBe('20');expect(queries[0].get('offset')).toBe('0');
  expect(queries[0].has('activity_month')).toBe(false);expect(queries[0].has('activity_date')).toBe(false);
  await region.getByLabel('足迹分类').selectOption('比赛');
  await expect(region.getByRole('heading',{name:'跨月记录 25',exact:true})).toBeVisible();
  await expect(region.locator('.history-card')).toHaveCount(1);
  state.records=[];
  await region.getByLabel('足迹分类').selectOption('轻松跑');
  await expect(region.getByText('此分类下没有运动记录',{exact:true})).toBeVisible();
  await expect(region.locator('.history-card')).toHaveCount(0);
  await expect(region.getByTestId('route-map-ready')).toHaveCount(0);
});

test('slow category reads retain the previous map, metrics and cards until data is ready',async({page})=>{
  await explorer(page);
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  await region.locator('.maplibregl-canvas').evaluate(el=>el.setAttribute('data-original-map','yes'));
  const metrics=await region.getByTestId('explorer-metrics').textContent();
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  await page.route(/\/api\/v1\/showcase\/activities\?.*category=/,async route=>{entered();await held;await route.fallback();});
  await region.getByLabel('足迹分类').selectOption('比赛&恢复');await started;
  try {
    await expect(region.getByRole('heading',{name:'运动 1',exact:true})).toBeVisible();
    expect(await region.getByTestId('explorer-metrics').textContent()).toBe(metrics);
    await expect(region.locator('.history-card')).toHaveCount(20);
    await expect(region.locator('[data-original-map=yes]')).toHaveCount(1);
  } finally { release(); }
  await expect(region.getByRole('heading',{name:'运动 23',exact:true})).toBeVisible();
  await expect(region.locator('.history-card')).toHaveCount(1);
  await expect(region.locator('[data-original-map=yes]')).toHaveCount(1);
});

test('record details fade in without replacing the map and respect reduced motion',async({page})=>{
  await explorer(page);
  const region=page.getByRole('region',{name:'运动足迹',exact:true});
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  await page.evaluate(()=>{
    const original=Element.prototype.animate;
    (window as unknown as {detailFades:number}).detailFades=0;
    (window as unknown as {valueFades:number; redrawHints:number}).valueFades=0;
    (window as unknown as {redrawHints:number}).redrawHints=0;
    const region=document.querySelector('.activity-explorer')!;
    new MutationObserver(()=>{if(region.querySelector('.map-status .feedback'))(window as unknown as {redrawHints:number}).redrawHints++;}).observe(region,{childList:true,subtree:true});
    Element.prototype.animate=function(...args:Parameters<Element['animate']>){
      if(this.matches('.selected-heading,.explorer-metrics')) (window as unknown as {detailFades:number}).detailFades++;
      if(this.matches('.explorer-metrics dd')) (window as unknown as {valueFades:number}).valueFades++;
      return original.apply(this,args);
    };
  });
  await region.getByRole('button',{name:'选择运动 运动 3',exact:true}).click();
  await expect(region.getByRole('heading',{name:'运动 3',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {detailFades:number}).detailFades)).toBeGreaterThan(0);
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {valueFades:number}).valueFades)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as unknown as {redrawHints:number}).redrawHints)).toBe(0);
  const fades=await page.evaluate(()=>(window as unknown as {detailFades:number}).detailFades);
  await page.emulateMedia({reducedMotion:'reduce'});
  await region.getByRole('button',{name:'选择运动 运动 1',exact:true}).click();
  await expect(region.getByRole('heading',{name:'运动 1',exact:true})).toBeVisible();
  await expect(region.getByTestId('route-map-ready')).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {detailFades:number}).detailFades)).toBe(fades);
});

test('history strip starts flush left and parks paging arrows beside the cards', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await explorer(page);
  const region = page.getByRole('region', { name: '运动足迹', exact: true });
  const strip = region.locator('.activity-strip');
  const prev = region.getByRole('button', { name: '向左查看更早的记录', exact: true });
  const next = region.getByRole('button', { name: '向右查看更多记录', exact: true });
  await expect(region.getByRole('button', { name: '选择运动 运动 1', exact: true })).toBeVisible();
  const measure = () => region.evaluate(root => {
    const scroller = root.querySelector('.activity-strip') as HTMLElement;
    const stripBox = scroller.getBoundingClientRect();
    const cards = [...root.querySelectorAll('.history-card')].map(el => el.getBoundingClientRect());
    const buttons = [...root.querySelectorAll('.strip-page')].map(el => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        name: el.getAttribute('aria-label') ?? '',
        hidden: style.display === 'none' || style.visibility === 'hidden',
        box,
      };
    });
    const visibleCards = cards.flatMap(card => {
      const left = Math.max(card.left, stripBox.left);
      const right = Math.min(card.right, stripBox.right);
      const top = Math.max(card.top, stripBox.top);
      const bottom = Math.min(card.bottom, stripBox.bottom);
      return right - left > 1 && bottom - top > 1 ? [{ left, right, top, bottom }] : [];
    });
    const overlaps = (box: DOMRect, card: { left: number; right: number; top: number; bottom: number }) => box.left < card.right - 0.5 && box.right > card.left + 0.5 && box.top < card.bottom - 0.5 && box.bottom > card.top + 0.5;
    const visible = buttons.filter(button => !button.hidden);
    return {
      scrollLeft: scroller.scrollLeft,
      inset: cards[0].left - stripBox.left,
      covered: visible.some(button => visibleCards.some(card => overlaps(button.box, card))),
      prevHidden: buttons.find(button => button.name.includes('向左'))?.hidden ?? true,
      nextHidden: buttons.find(button => button.name.includes('向右'))?.hidden ?? true,
      prevOutside: visible.filter(button => button.name.includes('向左')).every(button => button.box.right <= stripBox.left + 1),
      nextOutside: visible.filter(button => button.name.includes('向右')).every(button => button.box.left >= stripBox.right - 1),
      lastFits: cards.at(-1)!.right <= stripBox.right + 2,
    };
  });
  for (const [width, height] of [[1710, 1112], [1440, 1000]] as const) {
    await page.setViewportSize({ width, height });
    await strip.evaluate(el => { el.scrollLeft = 0; });
    await expect.poll(async () => (await measure()).scrollLeft).toBeLessThan(8);
    const start = await measure();
    expect(start.inset, `${width} first card inset`).toBeLessThan(8);
    expect(start.prevHidden, `${width} left arrow at start`).toBe(true);
    expect(start.nextHidden, `${width} right arrow at start`).toBe(false);
    expect(start.covered, `${width} arrow covers a card`).toBe(false);
    expect(start.nextOutside, `${width} right arrow beside the strip`).toBe(true);
    await region.locator('.strip-frame').screenshot({ path: testInfo.outputPath(`history-strip-${width}-start.png`) });
    await next.click();
    await expect.poll(async () => (await measure()).prevHidden).toBe(false);
    const paged = await measure();
    expect(paged.covered, `${width} arrow covers a card after paging`).toBe(false);
    expect(paged.prevOutside, `${width} left arrow beside the strip`).toBe(true);
    expect(paged.nextOutside, `${width} right arrow beside the strip`).toBe(true);
    await region.locator('.strip-frame').screenshot({ path: testInfo.outputPath(`history-strip-${width}-paged.png`) });
    await strip.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await expect.poll(async () => (await measure()).nextHidden).toBe(true);
    const end = await measure();
    expect(end.scrollLeft, `${width} scrolled`).toBeGreaterThan(8);
    await expect.poll(async () => (await measure()).prevHidden).toBe(false);
    expect(end.covered, `${width} arrow covers a card at end`).toBe(false);
    expect(end.prevOutside, `${width} left arrow beside the strip at end`).toBe(true);
    expect(end.lastFits, `${width} last card inside the strip`).toBe(true);
    await region.locator('.strip-frame').screenshot({ path: testInfo.outputPath(`history-strip-${width}-end.png`) });
    await strip.evaluate(el => { el.scrollLeft = 0; });
    await expect.poll(async () => (await measure()).prevHidden).toBe(true);
    expect((await measure()).scrollLeft, `${width} restored`).toBeLessThan(8);
  }
});

test('history strip pages to the end and back without reduced motion', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await explorer(page);
  const region = page.getByRole('region', { name: '运动足迹', exact: true });
  const strip = region.locator('.activity-strip');
  const prev = region.locator('.strip-prev');
  const next = region.locator('.strip-next');
  await expect(region.getByRole('button', { name: '选择运动 运动 1', exact: true })).toBeVisible();
  const left = () => strip.evaluate(el => el.scrollLeft);
  const settled = async () => {
    await expect.poll(async () => {
      const first = await left();
      await page.waitForTimeout(80);
      return Math.abs(first - await left()) < 1 ? first : -1;
    }, { timeout: 4000 }).toBeGreaterThanOrEqual(0);
    return left();
  };
  for (const [width, height] of [[1280, 800], [1710, 1112]] as const) {
    await page.setViewportSize({ width, height });
    await strip.evaluate(el => { el.scrollLeft = 0; });
    expect(await settled(), `${width} start`).toBeLessThan(8);
    const widths = [await strip.evaluate(el => el.clientWidth)];
    await next.click();
    for (let sample = 0; sample < 15; sample += 1) {
      widths.push(await strip.evaluate(el => el.clientWidth));
      await page.waitForTimeout(40);
    }
    expect(Math.max(...widths) - Math.min(...widths), `${width} strip width changed while scrolling`).toBeLessThanOrEqual(1);
    expect(await settled(), `${width} first page`).toBeGreaterThan(200);
    await region.locator('.strip-frame').screenshot({ path: testInfo.outputPath(`smooth-strip-${width}-paged.png`) });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const before = await left();
      const room = await strip.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft);
      if (room <= 8) break;
      await next.click();
      expect(await settled(), `${width} page ${attempt}`).toBeGreaterThan(before + 40);
    }
    expect(await strip.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft), `${width} reached the end`).toBeLessThanOrEqual(8);
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();
    await region.locator('.strip-frame').screenshot({ path: testInfo.outputPath(`smooth-strip-${width}-end.png`) });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const before = await left();
      if (before <= 8) break;
      await prev.click();
      expect(await settled(), `${width} back ${attempt}`).toBeLessThan(before - 40);
    }
    expect(await left(), `${width} returned`).toBeLessThan(8);
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    const room = () => strip.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft);
    await pageWhile(next, async () => await room() <= 8);
    expect(await settled(), `${width} rapid clicks leave the start`).toBeGreaterThan(200);
    expect(await room(), `${width} rapid clicks reach the end`).toBeLessThanOrEqual(8);
    await expect(next).toBeDisabled();
    await pageWhile(prev, async () => await left() <= 8);
    expect(await settled(), `${width} rapid clicks return`).toBeLessThan(8);
    await expect(prev).toBeDisabled();
  }
});

async function pageWhile(button: Locator, done: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await done()) return;
    try {
      await button.click({ timeout: 500 });
    } catch (error) {
      if (await done()) return;
      throw error;
    }
  }
  await expect.poll(done, { timeout: 4000 }).toBe(true);
}

test('clicking a partly visible history card reveals the whole card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await explorer(page);
  await page.setViewportSize({ width: 1710, height: 1000 });
  const region = page.getByRole('region', { name: '运动足迹', exact: true });
  const strip = region.locator('.activity-strip');
  await expect(region.getByRole('button', { name: '选择运动 运动 1', exact: true })).toBeVisible();
  await region.locator('.strip-frame').evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const partial = await strip.evaluate(el => {
    const port = el.getBoundingClientRect();
    const card = [...el.querySelectorAll('.history-card')].find(item => {
      const box = item.getBoundingClientRect();
      return box.left < port.right - 8 && box.right > port.right + 8;
    });
    if (!card) return null;
    const box = card.getBoundingClientRect();
    const visibleRight = Math.min(box.right, port.right);
    return { label: card.getAttribute('aria-label') ?? '', x: box.left + Math.min(24, (visibleRight - box.left) / 2), y: box.top + box.height / 2 };
  });
  if (!partial?.label) throw new Error('expected a partly visible history card');
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('button')?.getAttribute('aria-label') ?? el?.tagName ?? 'none';
  }, partial);
  expect(hit, `click point ${partial.x},${partial.y}`).toBe(partial.label);
  const before = await leftOf(strip);
  await page.mouse.click(partial.x, partial.y);
  await expect.poll(() => strip.evaluate((el, label) => {
    const card = [...el.querySelectorAll('.history-card')].find(item => item.getAttribute('aria-label') === label);
    if (!card) return false;
    const box = card.getBoundingClientRect();
    const port = el.getBoundingClientRect();
    return box.left >= port.left - 2 && box.right <= port.right + 2;
  }, partial.label)).toBe(true);
  expect(await leftOf(strip)).toBeGreaterThan(before + 40);
});

function leftOf(strip: Locator) {
  return strip.evaluate(el => el.scrollLeft);
}
