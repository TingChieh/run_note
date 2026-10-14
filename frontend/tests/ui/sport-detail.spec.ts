import { test, expect, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity, incompleteActivity } from '../fixtures/activities';
test.beforeEach(async ({page}) => {
  await page.route('**/api/v1/statistics/summary?**', route => route.fulfill({json:{data:{distance_m:12500},error:null}}));
});
async function ready(page: Page) { await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}); await expect(page.getByTestId('route-map-ready')).toBeVisible({timeout:20000}); }
async function capture(page: Page, name: string, scrollTo?: string) {
  if(scrollTo)await page.locator(scrollTo).scrollIntoViewIfNeeded();else await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(async()=>{(document.activeElement as HTMLElement)?.blur();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await page.screenshot({path:`test-results/sport-detail-${name}.png`});
}
test('detail sports sample gives map a desktop column and preserves other route themes',async({page})=>{
  await installActivities(page);await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);await ready(page);
  await expect(page.getByTestId('sport-hero')).toContainText('河畔晨跑');await expect(page.getByTestId('sport-hero')).toContainText('2026-10-13');
  await expect(page.getByTestId('activity-distance')).toHaveText('5.123 km');
  const metrics=await page.getByRole('region',{name:'运动指标'}).boundingBox(),map=await page.getByRole('region',{name:'路线',exact:true}).boundingBox();
  expect(map!.x).toBeGreaterThan(metrics!.x+metrics!.width);expect(Math.abs(map!.y-metrics!.y)).toBeLessThan(5);expect(map!.width).toBeGreaterThan(metrics!.width);
  const sidebar=page.locator('.app-sidebar'),color=await sidebar.evaluate(el=>getComputedStyle(el).backgroundColor);expect(color).toBe('rgb(33, 133, 56)');
  const active=page.getByRole('navigation',{name:'主要导航'}).getByRole('link',{name:'跑步记录',exact:true});await expect(active).toHaveAttribute('aria-current','page');await active.focus();expect(await active.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  await capture(page,'desktop');await page.getByText('数据质量与指标说明',{exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByText('有效轨迹点',{exact:true})).toBeVisible();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'关闭底图',exact:true}).click();await page.getByRole('button',{name:'开启底图',exact:true}).click();await ready(page);
  await active.click();await expect(page).toHaveURL(/\/activities$/);await expect(page.locator('.sport-sample')).toHaveCount(0);expect(await sidebar.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
});
test('sports detail fits phones with usable map, navigation and existing privacy controls',async({page})=>{
  await installActivities(page);await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);await ready(page);
  for(const width of [320,390,768,1024]) {
    await page.setViewportSize({width,height:900});await ready(page);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const map=await page.locator('.route-map').boundingBox();expect(map!.height).toBeGreaterThanOrEqual(360);
  }
  await page.setViewportSize({width:390,height:900});await ready(page);await capture(page,'mobile');await capture(page,'mobile-map','.route-panel');
  await page.getByRole('button',{name:'打开导航'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'关闭导航'})).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'打开导航'})).toBeFocused();
  const canvas=page.locator('.maplibregl-canvas');await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('+');
  await expect(page.getByRole('button',{name:'创建分享链接'})).toBeDisabled();await page.getByLabel('记录可见性').selectOption('unlisted');await page.getByRole('button',{name:'保存可见性'}).click();await expect(page.getByRole('button',{name:'创建分享链接'})).toBeEnabled();await capture(page,'mobile-sharing','.share-card');
});
test('long titles, missing values, empty route and errors stay usable in the sample',async({page})=>{
  const state=await installActivities(page);state.records[1].title='清晨出发沿着河岸的一次轻松跑步，长标题完整展示，不隐藏个人记录名称';await loginRunner(page);await page.setViewportSize({width:320,height:900});await page.goto(`/activities/${incompleteActivity.id}`);
  await expect(page.getByRole('heading',{level:1})).toHaveText(state.records[1].title);await expect(page.getByRole('status').filter({hasText:'此活动没有路线。'})).toBeVisible();await expect(page.getByRole('region',{name:'运动指标'})).toContainText('—');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'mobile-missing');
  await page.getByText('数据质量与指标说明',{exact:true}).click();await expect(page.getByText('缺失时间点',{exact:true})).toBeVisible();
  state.detailFailures=1;await page.goto(`/activities/${sampleActivity.id}`);await expect(page.getByRole('alert')).toContainText('暂时无法读取');await page.getByRole('button',{name:'重新读取活动详情'}).click();await ready(page);
  await page.route(`**/api/v1/activities/${sampleActivity.id}`,route=>route.fulfill({status:401,json:{error:{message:'登录已过期'}}}));await page.reload();await expect(page).toHaveURL(/login\?reason=expired/);await expect(page.getByTestId('sport-hero')).toHaveCount(0);await expect(page.locator('.sport-sample')).toHaveCount(0);
});

test('capture sample with standard OSM basemap or its visible fallback',async({page})=>{
  await installActivities(page);await page.unroute('**/*tile.openstreetmap.org/**');
  // Synthetic exercise route only; the normal map tile mechanism remains unchanged.
  const points=[ [121.548,31.216],[121.550,31.217],[121.553,31.2175],[121.556,31.218],[121.559,31.2175],[121.562,31.2155],[121.564,31.213],[121.565,31.210],[121.564,31.207],[121.561,31.205],[121.557,31.2045],[121.553,31.205],[121.550,31.207],[121.548,31.210],[121.547,31.213],[121.548,31.216] ];
  await page.route(`**/api/v1/activities/${sampleActivity.id}/route`,route=>route.fulfill({json:{data:{type:'FeatureCollection',start:points[0],end:points[points.length-1],features:[{type:'Feature',geometry:{type:'LineString',coordinates:points},properties:{segment_index:0,point_count:points.length}}]},error:null}}));
  await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);await ready(page);
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await expect(page.getByRole('status').filter({hasText:'正在加载底图'})).toHaveCount(0,{timeout:15000});
  const goal = page.getByRole('region',{name:'跑量目标'});
  await goal.getByRole('button',{name:'设置',exact:true}).click(); await goal.getByLabel('目标距离（km）').fill('50'); await goal.getByRole('button',{name:'保存',exact:true}).click();
  await expect(goal).toContainText('已完成 25%');
  await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{});await page.waitForTimeout(700);await capture(page,'desktop-basemap');
  await page.setViewportSize({width:390,height:900});await ready(page);await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{});await page.waitForTimeout(700);await capture(page,'mobile-basemap');await capture(page,'mobile-basemap-map','.route-panel');
});


test('sidebar goals save separate periods, survive reload, reject invalid input and retry statistics', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-14T03:00:00Z')});
  await installActivities(page); await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`); await ready(page);
  const widget = page.getByRole('region',{name:'跑量目标'});
  await expect(widget).toContainText('12.5 km');
  await widget.getByRole('button',{name:'设置',exact:true}).click();
  await widget.getByLabel('目标距离（km）').fill('0'); await widget.getByRole('button',{name:'保存',exact:true}).click();
  await expect(widget).toContainText('请输入大于0');
  await widget.getByLabel('目标距离（km）').fill('50'); await widget.getByRole('button',{name:'保存',exact:true}).click();
  await expect(widget).toContainText('已完成 25%');
  await widget.getByLabel('目标周期').selectOption('month'); await expect(widget).toContainText('未设目标');
  await widget.getByRole('button',{name:'设置',exact:true}).click(); await widget.getByLabel('目标距离（km）').fill('100'); await widget.getByRole('button',{name:'保存',exact:true}).click();
  await widget.getByLabel('目标周期').selectOption('year'); await expect(widget).toContainText('未设目标');
  await widget.getByText('今年 · 统计范围').click(); await expect(widget).toContainText('2026-01-01 至 2027-01-01');
  await page.reload(); await ready(page); await expect(widget).toContainText('已完成 25%');
  await widget.getByLabel('目标周期').selectOption('month'); await expect(widget).toContainText('已完成 13%');
  await page.route('**/api/v1/statistics/summary?**',route=>route.fulfill({status:503,json:{error:{message:'统计失败'}}}));
  await widget.getByLabel('目标周期').selectOption('year'); await expect(widget.getByRole('alert')).toContainText('暂时无法读取');
  await page.unroute('**/api/v1/statistics/summary?**');
  await page.route('**/api/v1/statistics/summary?**',route=>route.fulfill({json:{data:{distance_m:0},error:null}}));
  await widget.getByRole('button',{name:'重试跑量'}).click(); await expect(widget).toContainText('0 km');
  await page.setViewportSize({width:390,height:900}); await page.getByRole('button',{name:'打开导航'}).click();
  await widget.scrollIntoViewIfNeeded(); await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await capture(page,'mobile-goal');
});
