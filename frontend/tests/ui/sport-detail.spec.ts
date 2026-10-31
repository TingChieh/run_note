import { test, expect, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity, incompleteActivity } from '../fixtures/activities';
import { openGoalPanel } from '../fixtures/top-navigation';
test.beforeEach(async ({page}) => {
  await page.route('**/api/v1/showcase/statistics/summary?**', route => route.fulfill({json:{data:{distance_m:12500},error:null}}));
});
async function ready(page: Page) { await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}); await expect(page.getByTestId('route-map-ready')).toBeVisible({timeout:20000}); }
async function capture(page: Page, name: string, scrollTo?: string) {
  if(scrollTo)await page.locator(scrollTo).scrollIntoViewIfNeeded();else await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(async()=>{(document.activeElement as HTMLElement)?.blur();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await page.screenshot({path:`test-results/sport-detail-${name}.png`});
}
test('detail keeps a compact overview beside a spacious route and stays consistent on other routes',async({page})=>{
  await installActivities(page);await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);await ready(page);
  await expect(page.getByTestId('sport-hero')).toContainText('河畔晨跑');await expect(page.getByTestId('sport-hero')).toContainText('2026-10-13');
  await expect(page.getByTestId('activity-distance')).toHaveText('5.1 km');
  const metrics=await page.getByRole('region',{name:'运动指标'}).boundingBox(),map=await page.getByRole('region',{name:'路线',exact:true}).boundingBox();
  expect(map!.x).toBeGreaterThan(metrics!.x+metrics!.width);expect(Math.abs(map!.y-metrics!.y)).toBeLessThan(2);expect(metrics!.width).toBeLessThanOrEqual(320);expect(map!.width).toBeGreaterThan(metrics!.width*2);expect(metrics!.height).toBeLessThanOrEqual(map!.height);
  const cards = page.locator('.metric-panel .metrics'), routeCanvas = page.locator('.route-map');
  const cardBounds = await cards.boundingBox(), canvasBounds = await routeCanvas.boundingBox();
  expect(Math.abs(cardBounds!.y-canvasBounds!.y)).toBeLessThan(2);expect(cardBounds!.height).toBeLessThanOrEqual(canvasBounds!.height);
  const sidebar=page.locator('.app-sidebar');expect(await sidebar.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
  // The bar's material depends on what is under it: compare like with like. Docked (scrolled to the top) it is a plain card; floating over the content it is the glass surface (the backdrop filter).
  await page.evaluate(()=>window.scrollTo(0,0));await expect(sidebar).not.toHaveAttribute('data-floating');const color=await sidebar.evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.evaluate(()=>window.scrollTo(0,400));await expect(sidebar).toHaveAttribute('data-floating','');await expect.poll(()=>sidebar.evaluate(el=>getComputedStyle(el).backdropFilter)).not.toBe('none');await page.evaluate(()=>window.scrollTo(0,0));await expect(sidebar).not.toHaveAttribute('data-floating');
  const active=page.getByRole('navigation',{name:'主要导航'}).getByRole('link',{name:'跑步记录',exact:true});await expect(active).toHaveAttribute('aria-current','page');await active.focus();expect(await active.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  await capture(page,'desktop');await page.getByText('数据质量与指标说明',{exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByText('有效轨迹点',{exact:true})).toBeVisible();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'关闭底图',exact:true}).click();await page.getByRole('button',{name:'开启底图',exact:true}).click();await ready(page);
  await active.click();await expect(page).toHaveURL(/\/activities$/);await expect(page.locator('.sport-theme')).toHaveCount(1);await page.evaluate(()=>window.scrollTo(0,0));await expect(sidebar).not.toHaveAttribute('data-floating');await expect.poll(()=>sidebar.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(color);
});
test('sports detail fits phones with usable map, navigation and existing privacy controls',async({page})=>{
  await installActivities(page);await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);await ready(page);
  for(const width of [320,390,768,1024]) {
    await page.setViewportSize({width,height:900});await ready(page);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const map=await page.locator('.route-map').boundingBox();expect(map!.height).toBeGreaterThanOrEqual(280);expect(map!.height).toBeLessThanOrEqual(352);
  }
  await page.setViewportSize({width:390,height:900});await ready(page);await capture(page,'mobile');await capture(page,'mobile-map','.route-panel');
  await page.getByRole('button',{name:'打开导航'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'关闭导航'})).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'打开导航'})).toBeFocused();
  const canvas=page.locator('.maplibregl-canvas');await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('+');
  await expect(page.getByRole('button',{name:'创建分享链接'})).toBeDisabled();await page.getByLabel('记录可见性').selectOption('unlisted');await page.getByRole('button',{name:'保存可见性'}).click();await expect(page.getByRole('button',{name:'创建分享链接'})).toBeEnabled();await capture(page,'mobile-sharing','.share-card');
});
test('full device metrics and route stay compact on short desktops and narrow phones', async ({ page }, testInfo) => {
  const state = await installActivities(page);
  Object.assign(state.records[0], { timer_seconds: '1740', avg_heart_rate_bpm: 178, calories_kcal: 320, steps: 5734 });
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await ready(page);
  const metrics = page.locator('.metric-panel .metrics');
  await expect(metrics.locator(':scope > div')).toHaveCount(7);
  await expect(metrics).toContainText('178 bpm');
  for (const height of [900, 720]) {
    await page.setViewportSize({ width: 1440, height });
    await expect(page.getByRole('status').filter({ hasText: '正在加载底图' })).toHaveCount(0);
    await ready(page);
    await expect.poll(async () => (await page.locator('.detail-workspace').boundingBox())!.height).toBeLessThanOrEqual(560);
    const map = await page.locator('.route-map').boundingBox();
    const cards = await metrics.boundingBox();
    expect(map!.height).toBeGreaterThanOrEqual(320);
    expect(map!.height).toBeLessThanOrEqual(384);
    expect(cards!.height).toBeLessThanOrEqual(map!.height + 32);
  }
  await page.locator('.detail-workspace').scrollIntoViewIfNeeded();
  await page.locator('.detail-workspace').screenshot({ path: testInfo.outputPath('compact-detail-desktop.png'), animations: 'disabled' });
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    // The viewport change reflows asynchronously: wait for the first two cards to share a row.
    await expect.poll(async () => {
      const first = await metrics.locator(':scope > div').nth(0).boundingBox();
      const second = await metrics.locator(':scope > div').nth(1).boundingBox();
      return Math.abs(first!.y - second!.y);
    }).toBeLessThan(2);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await ready(page);
  await page.locator('.detail-workspace').screenshot({ path: testInfo.outputPath('compact-detail-mobile-dark.png'), animations: 'disabled' });
});
test('long titles, missing values, empty route and errors stay usable in the sample',async({page})=>{
  const state=await installActivities(page);state.records[1].title='清晨出发沿着河岸的一次轻松跑步，长标题完整展示，不隐藏个人记录名称';await loginRunner(page);await page.setViewportSize({width:320,height:900});await page.goto(`/activities/${incompleteActivity.id}`);
  await expect(page.getByRole('heading',{level:1})).toHaveText(state.records[1].title);await expect(page.getByRole('status').filter({hasText:'此活动没有路线。'})).toBeVisible();await expect(page.getByRole('region',{name:'运动指标'})).toContainText('—');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'mobile-missing');
  await page.getByText('数据质量与指标说明',{exact:true}).click();await expect(page.getByText('缺失时间点',{exact:true})).toBeVisible();
  state.detailFailures=1;await page.goto(`/activities/${sampleActivity.id}`);await expect(page.getByRole('alert')).toContainText('暂时无法读取');await page.getByRole('button',{name:'重新读取活动详情'}).click();await ready(page);
  await page.route(`**/api/v1/activities/${sampleActivity.id}`,route=>route.fulfill({status:401,json:{error:{message:'登录已过期'}}}));await page.reload();await expect(page).toHaveURL(/admin\?reason=expired/);await expect(page.getByTestId('sport-hero')).toHaveCount(0);await expect(page.locator('.app-sidebar')).toHaveCount(0); await expect(page.getByRole('region',{name:'跑量目标'})).toHaveCount(0);
});

test('capture sample with OpenFreeMap basemap or its visible fallback',async({page})=>{
  await installActivities(page);await page.unroute('**/*tile.openstreetmap.org/**');await page.unroute('https://tiles.openfreemap.org/**');
  // Synthetic exercise route only; the normal map tile mechanism remains unchanged.
  const points=[ [121.548,31.216],[121.550,31.217],[121.553,31.2175],[121.556,31.218],[121.559,31.2175],[121.562,31.2155],[121.564,31.213],[121.565,31.210],[121.564,31.207],[121.561,31.205],[121.557,31.2045],[121.553,31.205],[121.550,31.207],[121.548,31.210],[121.547,31.213],[121.548,31.216] ];
  await page.route(`**/api/v1/showcase/activities/${sampleActivity.id}/route`,route=>route.fulfill({json:{data:{type:'FeatureCollection',start:points[0],end:points[points.length-1],features:[{type:'Feature',geometry:{type:'LineString',coordinates:points},properties:{segment_index:0,point_count:points.length}}]},error:null}}));
  await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);await ready(page);
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await expect(page.getByRole('status').filter({hasText:'正在加载底图'})).toHaveCount(0,{timeout:15000});
  const goal = await openGoalPanel(page);
  await goal.getByRole('button',{name:'设置',exact:true}).click(); await goal.getByLabel('目标距离（km）').fill('50'); await goal.getByRole('button',{name:'保存',exact:true}).click();
  await expect(goal).toContainText('已完成 25%');
  await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{});await page.waitForTimeout(700);await capture(page,'desktop-basemap');
  await page.setViewportSize({width:390,height:900});await ready(page);await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{});await page.waitForTimeout(700);await capture(page,'mobile-basemap');await capture(page,'mobile-basemap-map','.route-panel');
});


test('sidebar goals save separate periods, survive reload, reject invalid input and retry statistics', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-14T03:00:00Z')});
  await installActivities(page); await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`); await ready(page);
  const widget = await openGoalPanel(page);
  await expect(widget).toContainText('12.5 km');
  await widget.getByRole('button',{name:'设置',exact:true}).click();
  await widget.getByLabel('目标距离（km）').fill('0'); await widget.getByRole('button',{name:'保存',exact:true}).click();
  await expect(widget).toContainText('请输入大于0');
  await widget.getByLabel('目标距离（km）').fill('50');
  const verified = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/session'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await verified;
  await expect(widget.getByLabel('目标距离（km）')).toHaveValue('50');
  await widget.getByRole('button',{name:'保存',exact:true}).click();
  await expect(widget).toContainText('已完成 25%');
  await widget.getByLabel('目标周期').selectOption('month'); await expect(widget).toContainText('未设目标');
  await widget.getByRole('button',{name:'设置',exact:true}).click(); await widget.getByLabel('目标距离（km）').fill('100'); await widget.getByRole('button',{name:'保存',exact:true}).click();
  await widget.getByLabel('目标周期').selectOption('year'); await expect(widget).toContainText('未设目标');
  await widget.getByText('今年 · 统计范围').click(); await expect(widget).toContainText('2026-01-01 至 2026-10-15');
  await page.reload(); await ready(page); await openGoalPanel(page); await expect(widget).toContainText('已完成 25%');
  await widget.getByLabel('目标周期').selectOption('month'); await expect(widget).toContainText('已完成 13%');
  await page.route('**/api/v1/showcase/statistics/summary?**',route=>route.fulfill({status:503,json:{error:{message:'统计失败'}}}));
  await widget.getByLabel('目标周期').selectOption('year'); await expect(widget.getByRole('alert')).toContainText('暂时无法读取');
  await page.unroute('**/api/v1/showcase/statistics/summary?**');
  await page.route('**/api/v1/showcase/statistics/summary?**',route=>route.fulfill({json:{data:{distance_m:0},error:null}}));
  await widget.getByRole('button',{name:'重试跑量'}).click(); await expect(widget).toContainText('0 km');
  await page.setViewportSize({width:390,height:900}); await page.getByRole('button',{name:'打开导航'}).click();
  await widget.scrollIntoViewIfNeeded(); await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await capture(page,'mobile-goal');
});
