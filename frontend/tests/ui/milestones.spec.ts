import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity, incompleteActivity } from '../fixtures/activities';

async function installMilestones(page: import('@playwright/test').Page) {
  const state = { provinceFailures: 0, streakFailures: 0, year: 2026 };
  await installActivities(page);
  await page.clock.setFixedTime(new Date('2026-10-14T06:00:00Z'));
  await page.route('**/api/v1/statistics/summary**', route => {
    const from = new URL(route.request().url()).searchParams.get('date_from') ?? '';
    const to = new URL(route.request().url()).searchParams.get('date_to') ?? '';
    const futureIncluded = to > '2026-10-15';
    const current = from.startsWith('2026');
    const count = current ? 2 : 1, distance = current ? '10246.912' : '5000';
    return route.fulfill({ json:{ data:{ activity_count:count, distance_m:futureIncluded?'20246.912':distance, duration_sum_seconds:1800, known_duration_count:1, missing_duration_count:count-1, activity_days:count, pace_eligible_count:1, pace_eligible_distance_m:'5123.456', avg_pace_seconds_per_km:'351.3', quality_warning_count:1, date_assignment:'activity_local_date' }, error:null } });
  });
  await page.route('**/api/v1/statistics/streaks', route => state.streakFailures-- > 0 ? route.fulfill({status:503,json:{error:{message:'连续记录读取失败'}}}) : route.fulfill({json:{data:{today:'2026-10-14',current_days:2,longest_days:5,current_weeks:2,longest_weeks:7,week:Array.from({length:7},(_,i)=>({date:`2026-10-${12+i}`,active:i<2}))},error:null}}));
  await page.route('**/api/v1/footprints/provinces?**', route => {
    state.year = Number(new URL(route.request().url()).searchParams.get('year'));
    return state.provinceFailures-- > 0 ? route.fulfill({status:503,json:{error:{message:'省份足迹读取失败'}}}) : route.fulfill({json:{data:{year:state.year,total:34,activity_count:state.year===2026?2:0,located_activity_count:state.year===2026?1:0,provinces:state.year===2026?[{code:310000,name:'上海市',activity_count:1}]:[]},error:null}});
  });
  return state;
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
  await expect(map.getByTestId('province-count')).toHaveText('1 / 34');
  await map.getByRole('button',{name:'上海市，已点亮，1 次活动'}).click();
  await expect(map.getByRole('status')).toContainText('上海市');
  await expect(page.getByRole('region',{name:'近期足迹墙'}).getByRole('link',{name:/河畔晨跑/})).toBeVisible();
  await expect(page.getByText(/GPX|导入/)).toHaveCount(0);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width===390||width===1440) {
      await page.evaluate(async()=>{(document.activeElement as HTMLElement)?.blur();scrollTo(0,0);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
      await page.screenshot({path:`test-results/milestones-home-${width}.png`,fullPage:false});
      await goals.screenshot({path:`test-results/milestones-goals-${width}.png`});
      await map.screenshot({path:`test-results/milestones-provinces-${width}.png`});
      const wall=page.getByRole('region',{name:'近期足迹墙'});await wall.scrollIntoViewIfNeeded();
      await expect(wall.getByRole('img',{name:/河畔晨跑的路线轮廓/})).toBeVisible();
      await wall.screenshot({path:`test-results/milestones-wall-${width}.png`});
    }
  }
  await page.reload(); await expect(goals).toContainText('/ 20 km');
  await page.getByRole('button',{name:'上一年',exact:true}).click();
  await expect(map.getByTestId('province-count')).toHaveText('0 / 34');
});

test('goals sync with sidebar and province/streak failures can retry independently', async ({page}) => {
  const state=await installMilestones(page); state.provinceFailures=1;state.streakFailures=1;
  await loginRunner(page);await page.goto('/dashboard');
  await page.getByRole('button',{name:'重试足迹地图'}).click();
  await expect(page.getByTestId('province-count')).toHaveText('1 / 34');
  await page.getByRole('button',{name:'重试连续记录'}).click();
  await expect(page.getByRole('region',{name:'连续记录'})).toContainText('最长 5 天 / 7 周');
  const sidebar=page.getByRole('region',{name:'跑量目标'});
  await sidebar.getByRole('button',{name:'设置',exact:true}).click();
  await sidebar.getByLabel('目标距离（km）').fill('35');
  await sidebar.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('region',{name:'运动目标'})).toContainText('/ 35 km');
  await expect(sidebar.locator('#goal-feedback')).toHaveCount(0);
  await expect(page.getByText(/目标已保存|仅保存在此浏览器/)).toHaveCount(0);
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await expect(sidebar).toContainText('/ 35 km');
  await expect(page.getByRole('region',{name:'运动目标'})).toContainText('/ 35 km');
});

test('failed goal saves preserve the confirmed target and input until a successful retry', async ({page}) => {
  await installMilestones(page); await loginRunner(page); await page.goto('/dashboard');
  const sidebar=page.getByRole('region',{name:'跑量目标'});
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
  await expect(sidebar).toContainText('/ 20 km');
  await expect(goals.locator('.goal-feedback')).toHaveCount(0);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await sidebar.screenshot({path:'test-results/running-goals-backend.png'});
});

test('statistics retry cannot discard a goal draft while saving', async ({page}) => {
  await installMilestones(page);
  await page.route('**/api/v1/statistics/summary**',route=>route.fulfill({status:503,json:{error:{message:'统计暂不可用'}}}));
  let finish!:()=>void;
  const pending=new Promise<void>(resolve=>{finish=resolve;});
  await page.route('**/api/v1/me/running-goals/week',async route=>{
    await pending;
    await route.fulfill({status:503,json:{error:{message:'目标暂时无法保存'}}});
  });
  await loginRunner(page); await page.goto('/dashboard');
  const sidebar=page.getByRole('region',{name:'跑量目标'});
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

test('wall automatically covers records, keeps missing routes honest and paginates all history', async ({page,request}) => {
  const redirected=await request.get('/activities/wall',{maxRedirects:0});expect(redirected.status()).toBe(303);
  const records=Array.from({length:21},(_,i)=>({...sampleActivity,id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,title:`晨跑 ${i+1}`}));
  records[0]={...incompleteActivity,id:records[0].id,title:'没有路线的跑步'};
  await installMilestones(page);
  await page.route(/\/api\/v1\/activities\?/,route=>{const offset=Number(new URL(route.request().url()).searchParams.get('offset')??0);return route.fulfill({json:{data:{items:records.slice(offset,offset+20),total:21,limit:20,offset},error:null}});});
  await loginRunner(page);await page.goto('/activities/wall');
  await expect(page.getByRole('heading',{name:'足迹墙',exact:true})).toBeVisible();
  await expect(page.locator('.wall-card')).toHaveCount(20);
  await expect(page.getByText('没有路线',{exact:true})).toBeVisible();
  for(const width of [320,390,768,1440]) {await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.wall-card')).toHaveCount(1);await expect(page.getByRole('link',{name:/晨跑 21/})).toBeVisible();
  await page.reload();await expect(page.locator('.wall-card')).toHaveCount(1);
  await page.getByRole('button',{name:'上一页',exact:true}).click();await expect(page.locator('.wall-card')).toHaveCount(20);
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page).toHaveURL(/\/login\?reason=logout$/);
  await page.goto('/activities/wall');await expect(page).toHaveURL(/\/login\?next=/);
});


test('sidebar and home goals exclude future records consistently', async ({page}) => {
  await installMilestones(page);await loginRunner(page);await page.goto('/dashboard');
  const sidebar=page.getByRole('region',{name:'跑量目标'});
  for(const period of ['week','month','year']) {
    await sidebar.getByLabel('目标周期').selectOption(period);
    await expect(sidebar.locator('.goal-distance strong')).toHaveText('10.2 km');
    await expect(page.getByTestId(`${period}-km`)).toHaveText('10.2');
  }
});

test('detail route retry also refreshes the footprint card without duplicate reads', async ({page}) => {
  await installMilestones(page);let reads=0;
  await page.route('**/api/v1/activities/*/route', async route=>{
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
  await installMilestones(page);await loginRunner(page);await page.goto('/activities/wall?offset=20');
  await expect(page.locator('.wall-card')).toHaveCount(2);
  await expect(page).toHaveURL(/\/activities\/wall$/);
});
