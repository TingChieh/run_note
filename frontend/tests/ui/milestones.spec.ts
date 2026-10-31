import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity, incompleteActivity } from '../fixtures/activities';
import { openAccountMenu, openGoalPanel } from '../fixtures/top-navigation';

async function installMilestones(page: import('@playwright/test').Page) {
  const state = { provinceFailures: 0, streakFailures: 0, year: null as number | null };
  await installActivities(page);
  await page.clock.setFixedTime(new Date('2026-10-14T06:00:00Z'));
  await page.route('**/api/v1/showcase/statistics/summary**', route => {
    const from = new URL(route.request().url()).searchParams.get('date_from') ?? '';
    const to = new URL(route.request().url()).searchParams.get('date_to') ?? '';
    const futureIncluded = to > '2026-10-15';
    const current = from.startsWith('2026');
    const count = current ? 2 : 1, distance = current ? '10246.912' : '5000';
    return route.fulfill({ json:{ data:{ activity_count:count, distance_m:futureIncluded?'20246.912':distance, duration_sum_seconds:1800, known_duration_count:1, missing_duration_count:count-1, activity_days:count, pace_eligible_count:1, pace_eligible_distance_m:'5123.456', avg_pace_seconds_per_km:'351.3', quality_warning_count:1, date_assignment:'activity_local_date' }, error:null } });
  });
  await page.route('**/api/v1/showcase/statistics/streaks', route => state.streakFailures-- > 0 ? route.fulfill({status:503,json:{error:{message:'连续记录读取失败'}}}) : route.fulfill({json:{data:{today:'2026-10-14',current_days:2,longest_days:5,current_weeks:2,longest_weeks:7,week:Array.from({length:7},(_,i)=>({date:`2026-10-${12+i}`,active:i<2}))},error:null}}));
  await page.route('**/api/v1/showcase/footprints/provinces**', route => {
    const year = new URL(route.request().url()).searchParams.get('year');
    state.year = year === null ? null : Number(year);
    return state.provinceFailures-- > 0 ? route.fulfill({status:503,json:{error:{message:'省份足迹读取失败'}}}) : route.fulfill({json:{data:{year:state.year,total:34,activity_count:state.year===null?3:state.year===2026?2:0,located_activity_count:state.year===null?2:state.year===2026?1:0,provinces:state.year===null?[{code:310000,name:'上海市',activity_count:1},{code:510000,name:'四川省',activity_count:1}]:state.year===2026?[{code:310000,name:'上海市',activity_count:1}]:[]},error:null}});
  });
  return state;
}

test('goal save actions pop from the edit button and fold back with reduced-motion support', async ({page}) => {
  await installMilestones(page); await loginRunner(page); await page.goto('/dashboard');
  await expect(page.getByTestId('year-km')).toHaveText('10.2');
  for (const overview of [true, false]) {
    const widget = overview ? page.getByRole('region', {name:'运动目标'}) : await openGoalPanel(page);
    const actions = overview ? widget.locator('.goal-card').first().locator('.goal-actions') : widget.locator('.goal-actions');
    const reveal = actions.locator('.goal-save-reveal');
    await expect(reveal).toHaveCount(1);
    // Restoring motion preferences also transitions hidden controls; let that reset finish.
    await expect.poll(() => reveal.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(.08, 3);
    const record = () => reveal.evaluate(el => {
      const samples: number[] = [];
      const scales: number[] = [];
      (el as HTMLElement & {opacitySamples: number[]; scaleSamples: number[]}).opacitySamples = samples;
      (el as HTMLElement & {scaleSamples: number[]}).scaleSamples = scales;
      const observed = new Set<string>();
      const recordTransition = (event: Event) => {
        const property = (event as TransitionEvent).propertyName;
        if (property !== 'opacity' && property !== 'transform') return;
        const animation = el.getAnimations().find(item => item instanceof CSSTransition && item.transitionProperty === property);
        if (!animation?.effect) return;
        // Inspect an actual interpolated frame without depending on the renderer's frame rate.
        animation.pause();
        const duration = Number(animation.effect.getComputedTiming().duration);
        if (property === 'opacity') {
          animation.currentTime = duration / 2;
          samples.push(Number(getComputedStyle(el).opacity));
        } else {
          animation.currentTime = 0;
          scales.push(new DOMMatrix(getComputedStyle(el).transform).a);
          animation.currentTime = duration * .7;
          scales.push(new DOMMatrix(getComputedStyle(el).transform).a);
        }
        observed.add(property);
        if (observed.size === 2) el.removeEventListener('transitionrun',recordTransition);
        requestAnimationFrame(() => animation.play());
      };
      el.addEventListener('transitionrun',recordTransition);
    });
    const hasIntermediateFrame = () => reveal.evaluate(el => (el as HTMLElement & {opacitySamples: number[]}).opacitySamples.some(value => value > .02 && value < .98));
    await record();
    await actions.getByRole('button', {name:overview?'设置年度目标':'设置',exact:true}).click();
    await expect(reveal).toHaveCSS('opacity','1');
    expect(await hasIntermediateFrame()).toBe(true);
    const scales = await reveal.evaluate(el => (el as HTMLElement & {scaleSamples:number[]}).scaleSamples);
    expect(scales[0]).toBeLessThan(.2);
    expect(scales[1]).toBeGreaterThan(1);
    const input = widget.getByLabel(overview?'年度目标距离（km）':'目标距离（km）',{exact:true});
    await expect(input).toBeFocused();
    await record();
    await actions.getByRole('button', {name:overview?'取消年度目标':'取消',exact:true}).click();
    await expect(reveal).toHaveCSS('opacity','0');
    expect(await hasIntermediateFrame()).toBe(true);
    await expect(reveal).toHaveAttribute('inert','');
    await expect(input).toHaveCount(0);
    await page.emulateMedia({reducedMotion:'reduce'});
    await actions.getByRole('button', {name:overview?'设置年度目标':'设置',exact:true}).click();
    await expect(reveal).toHaveCSS('transition-duration','0s');
    await expect(reveal).toHaveCSS('opacity','1');
    await input.press('Escape');
    await expect(reveal).toHaveCSS('opacity','0');
    await page.emulateMedia({reducedMotion:'no-preference'});
  }
});

test('goal editors replace the target in place without growing cards and Escape cancels drafts', async ({ page }) => {
  await installMilestones(page); await loginRunner(page); await page.goto('/dashboard');
  const goals = page.getByRole('region', { name: '运动目标' });
  await expect(goals.getByTestId('year-km')).toHaveText('10.2');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'PUT' && request.url().includes('/running-goals/')) writes.push(request.url()); });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [period, title] of [['year', '年度目标'], ['month', '月度目标'], ['week', '周目标']]) {
      const card = goals.locator('.goal-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      const before = (await card.boundingBox())!;
      const valueBefore = (await card.locator('.goal-value').boundingBox())!;
      await card.getByRole('button', { name: `设置${title}`, exact: true }).click();
      const input = card.getByLabel(`${title}距离（km）`, { exact: true });
      await expect(input).toBeFocused(); await input.fill('100000');
      expect((await card.boundingBox())!.height).toBeCloseTo(before.height, 0);
      // Sample both rectangles in one frame; focus/scroll anchoring can move the viewport.
      const { inputBox, valueNow } = await input.evaluate(element => ({
        inputBox: element.getBoundingClientRect().toJSON(),
        valueNow: element.closest('.goal-value')!.getBoundingClientRect().toJSON()
      }));
      expect(inputBox.y).toBeGreaterThanOrEqual(valueNow.y - 1);
      expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(valueNow.y + valueNow.height + 1);
      expect(valueNow.height).toBeCloseTo(valueBefore.height, 0);
      if (width === 1440 || width === 390) {
        await input.press('Tab');
        await card.screenshot({path:`test-results/inline-${period}-${width}.png`});
        if (period === 'year') {
          await page.emulateMedia({colorScheme:'dark'});
          await card.screenshot({path:`test-results/inline-year-blurred-dark-${width}.png`});
          await page.emulateMedia({colorScheme:'light'});
        }
        await input.focus();
      }
      await input.press('Escape'); await expect(input).toHaveCount(0);
      await expect(card.getByRole('button', { name: `设置${title}`, exact: true })).toBeFocused();
      await expect(goals.getByTestId(`${period}-km`)).toHaveText('10.2');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(writes).toHaveLength(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sidebar = await openGoalPanel(page);
  await expect(sidebar.locator('.goal-distance')).toBeVisible();
  const before = (await sidebar.boundingBox())!;
  await sidebar.getByRole('button', { name: '设置', exact: true }).click();
  const input = sidebar.getByLabel('目标距离（km）', { exact: true });
  await expect(input).toBeFocused(); await input.fill('35');
  expect((await sidebar.boundingBox())!.height).toBeCloseTo(before.height, 0);
  await input.press('Tab');
  await sidebar.screenshot({path:'test-results/inline-sidebar.png'});
  await page.emulateMedia({colorScheme:'dark'});
  await sidebar.screenshot({path:'test-results/inline-sidebar-blurred-dark.png'});
  await page.emulateMedia({colorScheme:'light'});
  await input.focus();
  await input.press('Enter'); await expect(input).toHaveCount(0);
  await expect(sidebar).toContainText('/ 35 km'); await expect(goals).toContainText('/ 35 km');
  await sidebar.getByRole('button', { name: '调整', exact: true }).click();
  await input.fill('55'); await input.press('Escape');
  await expect(sidebar).toContainText('/ 35 km'); expect(writes).toHaveLength(1);
});

for (const area of ['overview', 'sidebar'] as const) {
  test(`${area} goal editor keeps focus and draft when pending statistics arrive`, async ({page}) => {
    await installMilestones(page);
    let finish!: () => void;
    const pending = new Promise<void>(resolve => {finish = resolve;});
    await page.route('**/api/v1/showcase/statistics/summary**', async route => {await pending; await route.fallback();});
    try {
      await loginRunner(page); await page.goto('/dashboard');
      const overview = area === 'overview';
      const widget = overview ? page.getByRole('region', {name:'运动目标'}) : await openGoalPanel(page);
      await widget.getByRole('button', {name:overview?'设置年度目标':'设置',exact:true}).click();
      const input = widget.getByLabel(overview?'年度目标距离（km）':'目标距离（km）', {exact:true});
      await expect(input).toBeFocused(); await input.fill('22');
      finish();
      if (overview) await expect(widget.getByTestId('year-km')).toHaveText('10.2');
      else await expect(widget.locator('.goal-distance strong')).toHaveText('10.2 km');
      await expect(input).toBeFocused(); await expect(input).toHaveValue('22');
      await input.press('Enter'); await expect(input).toHaveCount(0);
      await expect(widget).toContainText('/ 22 km');
    } finally {finish();}
  });
}

test('home has real period goals, streaks, province lighting and a private wall preview', async ({page}) => {
  await installMilestones(page); await loginRunner(page); await page.goto('/');
  const goals = page.getByRole('region',{name:'运动目标'});
  await expect(goals.getByRole('heading',{name:'年度目标'})).toBeVisible();
  await expect(goals.getByTestId('year-km')).toHaveText('10.2');
  await goals.getByRole('button',{name:'设置年度目标'}).click();
  await goals.getByLabel('年度目标距离（km）').fill('20');
  await goals.getByRole('button',{name:'保存年度目标'}).click();
  await expect(goals.getByRole('progressbar',{name:'年度目标进度'})).toHaveAttribute('value',/^51\.2/);
  await expect(page.getByRole('region',{name:'连续记录'})).toContainText('最长 5 天 / 7 周');
  const map = page.getByRole('region',{name:'足迹地图'});
  await expect(map.getByTestId('province-count')).toHaveText('2 / 34');
  const provinces = map.getByRole('list',{name:'已点亮省级区域'});
  await expect(provinces).toContainText('上海');
  await expect(provinces.getByRole('button')).toHaveCount(0);
  await expect(map.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'运动足迹',exact:true}).getByRole('button',{name:'选择运动 河畔晨跑',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/导入/})).toHaveCount(0);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width===390||width===1440) {
      await page.evaluate(async()=>{(document.activeElement as HTMLElement)?.blur();scrollTo(0,0);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
      await page.screenshot({path:`test-results/milestones-home-${width}.png`,fullPage:false});
      await goals.screenshot({path:`test-results/milestones-goals-${width}.png`});
      await map.screenshot({path:`test-results/milestones-provinces-${width}.png`});
      const wall=page.getByRole('region',{name:'运动足迹',exact:true});await wall.getByRole('button',{name:'选择运动 河畔晨跑',exact:true}).scrollIntoViewIfNeeded();
      await expect(wall.getByRole('img',{name:/河畔晨跑的路线轮廓/})).toBeVisible();
      await wall.screenshot({path:`test-results/milestones-wall-${width}.png`});
    }
  }
  await page.reload(); await expect(goals).toContainText('/ 20 km');
  await page.getByRole('button',{name:'上一年',exact:true}).click();
  await expect(map.getByTestId('province-count')).toHaveText('2 / 34');
  await expect(map).toContainText('四川');
  await expect(map).toContainText('全部时间');
  await expect(map.getByRole('link',{name:'探索详细路线'})).toHaveAttribute('href','/footprints');
});

test('the four goal cards share one size on desktop and the page carries no footnote under them', async ({page}) => {
  await installMilestones(page); await loginRunner(page);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/dashboard');
  const goals = page.getByRole('region',{name:'运动目标'});
  await expect(goals.getByRole('progressbar')).toHaveCount(3);
  await expect(goals.getByRole('region',{name:'连续记录'})).toContainText('最长 5 天 / 7 周');
  const sizes = await goals.locator('.goal-card').evaluateAll(cards => cards.map(card => { const box = card.getBoundingClientRect(); return [Math.round(box.width), Math.round(box.height)]; }));
  expect(sizes).toHaveLength(4);
  expect(new Set(sizes.map(size => size[0])).size).toBe(1);
  expect(new Set(sizes.map(size => size[1])).size).toBe(1);
  await expect(page.locator('.milestone-section')).not.toContainText('当前周期截至今天');
});

test('goals sync with sidebar and province/streak failures can retry independently', async ({page}) => {
  const state=await installMilestones(page); state.provinceFailures=1;state.streakFailures=1;
  await loginRunner(page);await page.goto('/dashboard');
  await page.getByRole('button',{name:'重试足迹地图'}).click();
  await expect(page.getByTestId('province-count')).toHaveText('2 / 34');
  await page.getByRole('button',{name:'重试连续记录'}).click();
  await expect(page.getByRole('region',{name:'连续记录'})).toContainText('最长 5 天 / 7 周');
  const sidebar=await openGoalPanel(page);
  await sidebar.getByRole('button',{name:'设置',exact:true}).click();
  await sidebar.getByLabel('目标距离（km）').fill('35');
  await sidebar.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('region',{name:'运动目标'})).toContainText('/ 35 km');
  await expect(sidebar.locator('#goal-feedback')).toHaveCount(0);
  await expect(page.getByText(/目标已保存|仅保存在此浏览器/)).toHaveCount(0);
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await openGoalPanel(page);
  await expect(sidebar).toContainText('/ 35 km');
  await expect(page.getByRole('region',{name:'运动目标'})).toContainText('/ 35 km');
});

test('failed goal saves preserve the confirmed target and input until a successful retry', async ({page}) => {
  await installMilestones(page); await loginRunner(page); await page.goto('/dashboard');
  const sidebar=await openGoalPanel(page);
  await sidebar.getByRole('button',{name:'设置',exact:true}).click();
  await sidebar.getByLabel('目标距离（km）').fill('5');
  await sidebar.getByRole('button',{name:'保存',exact:true}).click();
  await expect(sidebar).toContainText('/ 5 km');
  await page.route('**/api/v1/me/running-goals/week',route=>route.fulfill({status:503,json:{error:{message:'目标暂时无法保存'}}}));
  await sidebar.getByRole('button',{name:'调整',exact:true}).click();
  await sidebar.getByLabel('目标距离（km）').fill('15');
  await sidebar.getByRole('button',{name:'保存',exact:true}).click();
  await expect(sidebar.getByRole('alert')).toHaveText('目标暂时无法保存');
  await expect(sidebar.getByLabel('目标距离（km）')).toHaveValue('15');
  await expect(sidebar).toContainText('/ 5 km');
  await page.unroute('**/api/v1/me/running-goals/week');
  await sidebar.getByRole('button',{name:'保存',exact:true}).click();
  await expect(sidebar.getByLabel('目标距离（km）')).toHaveCount(0);
  await expect(sidebar.locator('#goal-feedback')).toHaveCount(0);
  await expect(sidebar).toContainText('/ 15 km');
  const goals=page.getByRole('region',{name:'运动目标'});
  await expect(goals).toContainText('/ 15 km');
  await goals.getByRole('button',{name:'调整周目标'}).click();
  await goals.getByLabel('周目标距离（km）').fill('20');
  await goals.getByRole('button',{name:'保存周目标'}).click();
  await openGoalPanel(page);
  await expect(sidebar).toContainText('/ 20 km');
  await expect(goals.locator('.goal-feedback')).toHaveCount(0);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await openGoalPanel(page);
  await sidebar.screenshot({path:'test-results/running-goals-backend.png'});
});

test('statistics retry cannot discard a goal draft while saving', async ({page}) => {
  await installMilestones(page);
  await page.route('**/api/v1/showcase/statistics/summary**',route=>route.fulfill({status:503,json:{error:{message:'统计暂不可用'}}}));
  let finish!:()=>void;
  const pending=new Promise<void>(resolve=>{finish=resolve;});
  await page.route('**/api/v1/me/running-goals/week',async route=>{
    await pending;
    await route.fulfill({status:503,json:{error:{message:'目标暂时无法保存'}}});
  });
  await loginRunner(page); await page.goto('/dashboard');
  const sidebar=await openGoalPanel(page);
  await sidebar.getByRole('button',{name:'设置',exact:true}).click();
  await sidebar.getByLabel('目标距离（km）').fill('15');
  await sidebar.getByRole('button',{name:'保存',exact:true}).click();
  await expect(sidebar.getByRole('button',{name:'保存中…'})).toBeDisabled();
  const retry=sidebar.getByRole('button',{name:'重试跑量'});
  try { await expect(retry).toBeDisabled(); } finally { finish(); }
  await expect(sidebar.getByRole('alert').filter({hasText:'目标暂时无法保存'})).toBeVisible();
  await expect(sidebar.getByLabel('目标距离（km）')).toHaveValue('15');
  await expect(retry).toBeEnabled();
});

test('wall fills every row, keeps missing routes honest and paginates all history', async ({page,request},testInfo) => {
  const redirected=await request.get('/activities/wall',{maxRedirects:0});expect(redirected.status()).toBe(200);
  const records=Array.from({length:50},(_,i)=>({...sampleActivity,id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,title:`晨跑 ${i+1}`}));
  records[0]={...incompleteActivity,id:records[0].id,title:'没有路线的跑步'};
  await installMilestones(page);
  await page.route(/\/api\/v1\/showcase\/activities\?/,route=>{const params=new URL(route.request().url()).searchParams;const offset=Number(params.get('offset')??0),limit=Number(params.get('limit')??20);return route.fulfill({json:{data:{items:records.slice(offset,offset+limit),total:records.length,limit,offset},error:null}});});
  await loginRunner(page);await page.goto('/activities/wall');
  await expect(page.getByRole('heading',{name:'足迹墙',exact:true})).toBeVisible();
  await expect(page.locator('.wall-card')).toHaveCount(24);
  await expect(page.getByText('没有路线',{exact:true})).toBeVisible();
  for(const [width,columns] of [[320,1],[390,1],[480,2],[640,3],[768,3],[1024,4],[1440,6],[1920,6]]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const lastRow=await page.locator('.wall-grid > li').evaluateAll(items=>{
      const bottom=items.at(-1)!.getBoundingClientRect().top;
      return items.filter(item=>Math.abs(item.getBoundingClientRect().top-bottom)<1).length;
    });
    expect(lastRow).toBe(columns);
    if(width>=1440){
      await page.evaluate(()=>window.scrollTo(0,0));
      const visibleCards=await page.locator('.wall-card').evaluateAll(cards=>cards.filter(card=>{
        const rect=card.getBoundingClientRect();return rect.top>=0 && rect.bottom<=innerHeight;
      }).length);
      expect(visibleCards).toBeGreaterThanOrEqual(width===1440?8:12);
      expect(await page.locator('.wall-card').first().evaluate(card=>card.getBoundingClientRect().height)).toBeLessThan(300);
      await page.screenshot({path:testInfo.outputPath(`wall-compact-${width}.png`)});
    }
    if(width===390){await expect(page.locator('#app-navigation')).toBeHidden();await page.screenshot({path:testInfo.outputPath('wall-compact-mobile.png')});}
  }
  await expect(page.locator('.wall-pagination')).toContainText('第 1 / 3 页 · 50 次跑步');
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.wall-card')).toHaveCount(24);await expect(page.getByRole('link',{name:/晨跑 25 /})).toBeVisible();
  await expect(page).toHaveURL(/offset=24$/);
  await expect(page.locator('.wall-pagination')).toContainText('第 2 / 3 页');
  await page.reload();await expect(page.locator('.wall-card')).toHaveCount(24);
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.wall-card')).toHaveCount(2);
  await expect(page.getByRole('link',{name:/晨跑 49 /})).toBeVisible();
  await expect(page.getByRole('link',{name:/晨跑 50 /})).toBeVisible();
  await expect(page.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'上一页',exact:true}).click();await expect(page.locator('.wall-card')).toHaveCount(24);
  await (await openAccountMenu(page)).getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'退出登录',exact:true})).toHaveCount(0);
  await expect(page).toHaveURL(/\/activities\/wall$/);
  await page.goto('/activities/wall');await expect(page).toHaveURL(/\/activities\/wall$/);await expect(page.getByRole('button',{name:'退出登录',exact:true})).toHaveCount(0);
});


test('sidebar and home goals exclude future records consistently', async ({page}) => {
  await installMilestones(page);await loginRunner(page);await page.goto('/dashboard');
  const sidebar=await openGoalPanel(page);
  for(const period of ['week','month','year']) {
    await sidebar.getByLabel('目标周期').selectOption(period);
    await expect(sidebar.locator('.goal-distance strong')).toHaveText('10.2 km');
    await expect(page.getByTestId(`${period}-km`)).toHaveText('10.2');
  }
});

test('detail route retry also refreshes the footprint card without duplicate reads', async ({page}) => {
  await installMilestones(page);let reads=0;
  await page.route('**/api/v1/showcase/activities/*/route', async route=>{
    reads++;
    if(reads<=2)return route.fulfill({status:503,json:{error:{message:'路线暂不可用'}}});
    return route.fallback();
  });
  await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);
  const card=page.getByRole('region',{name:'本次足迹卡片'});
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('img',{name:/路线轮廓/})).toHaveCount(0);
  expect(reads).toBe(1);
  await page.getByRole('button',{name:'重新读取路线'}).click();
  if(reads===2)await page.getByRole('button',{name:'重新读取路线'}).click();
  await expect(card.getByRole('img',{name:/路线轮廓/})).toBeVisible();
  expect(reads).toBe(3);
});

test('an offset beyond the wall history restores a valid page', async ({page}) => {
  await installMilestones(page);await loginRunner(page);await page.goto('/activities/wall?offset=240');
  await expect(page.locator('.wall-card')).toHaveCount(2);
  await expect(page).toHaveURL(/\/activities\/wall$/);
});
