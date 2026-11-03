import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

const runners = [
  { user_id:'00000000-0000-4000-8000-000000000001',avatar_version:null,username:'runner_one',display_name:'合成甲',distance_m:3000,count:1,week_m:3000,month_m:3000,year_m:5000 },
  { user_id:'00000000-0000-4000-8000-000000000002',avatar_version:null,username:'runner_two',display_name:'合成乙',distance_m:4000,count:1,week_m:1000,month_m:4000,year_m:8000 },
];
test('手机地图筛选紧凑且桌面布局保持原样', async ({page}) => {
  const participants = ['小林','阿杰','美玲','志明'].map((display_name, i) => ({...runners[i % 2], user_id:`00000000-0000-4000-8000-00000000000${i+1}`, username:`runner_${i}`, display_name}));
  const tracks = [{username:participants[0].username,activity_id:participants[0].user_id,title:'合成路线',activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates:[[10,10],[10.01,10.01]]}}];
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:7000,count:1,participants,recent:[],tracks},error:null,meta:{request_id:'test'}}}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/together');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  const legend=page.getByRole('region',{name:'选择参与者'});
  const height=async()=> (await legend.boundingBox())!.height;
  console.log(`390px filter height: ${await height()}px; controls height: ${(await page.locator('.map-toolbar').boundingBox())!.height}px`);
  expect(await height()).toBeLessThanOrEqual(60);
  for (const button of await legend.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await legend.getByRole('button',{name:'小林'}).click();
  await expect(legend.getByRole('button',{name:'小林'})).toHaveAttribute('aria-pressed','true');
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({width:1280,height:844});
  await expect(legend.locator('.runner-avatar').first()).toBeVisible();
  await expect(legend).toHaveCSS('flex-wrap','wrap');
});

test('访客可切换排行和地图参与者', async ({page}) => {
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:7000,count:2,participants:runners,recent:[],tracks:[{username:'runner_one',activity_id:'00000000-0000-4000-8000-000000000001',title:'合成路线',activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates:[[10,10],[10.01,10.01]]}}]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await expect(page.getByRole('heading',{name:'一起跑步'})).toBeVisible();
  await expect(page.getByText('本周我们一起跑了 7.00 公里')).toBeVisible();
  const ranking=page.locator('section').filter({has:page.getByRole('heading',{name:'里程排行榜'})});
  await expect(ranking.locator('li').first()).toContainText('合成甲');
  await expect(ranking.getByRole('link',{name:'合成甲'})).toHaveAttribute('href','/p/runner_one/dashboard');
  await page.getByRole('button',{name:'本月'}).click();
  await expect(ranking.locator('li').first()).toContainText('合成乙');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  const legend=page.getByRole('region',{name:'选择参与者'});
  const map=page.getByTestId('footprint-map-ready');
  expect((await legend.boundingBox())!.y).toBeGreaterThan((await map.boundingBox())!.y);
  await page.getByRole('button',{name:'合成乙'}).click();
  await expect(page.getByText('全部可显示记录（1）', {exact:false})).toBeVisible();
  await expect(page.getByText('该跑者在此时段暂无路线，地图仍显示全部足迹。')).toBeVisible();
  await expect(page.getByRole('button',{name:'合成乙'})).toHaveAttribute('aria-pressed','true');
  await expect(ranking.locator('progress').first()).toHaveAttribute('value','100');
  await page.setViewportSize({width:320,height:700});
  await expect(legend).toHaveCSS('flex-wrap','nowrap');
  await expect(ranking.locator('progress').first()).toHaveCSS('appearance','none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const mapBox=await page.getByTestId('footprint-map-ready').boundingBox();
  expect(mapBox && mapBox.height).toBeGreaterThan(200);
});


test('重叠轨迹选择跑者时突出其颜色并保留其他记录', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const tracks=runners.map(runner=>({username:runner.username,activity_id:runner.user_id,title:runner.display_name,activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates:[[10,10],[10.02,10.02]]}}));
  const recent=runners.map(runner=>({id:runner.user_id,username:runner.username,display_name:runner.display_name,title:runner.display_name,activity_date:'2026-10-01',distance_m:3000,category:'',tags:[],temporal_quality:'complete',avg_pace_seconds_per_km:330,elapsed_seconds:1800,timer_seconds:null,avg_heart_rate_bpm:null,geometry:[]}));
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:7000,count:2,participants:runners,recent,tracks},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  const map=page.getByTestId('footprint-map-ready');
  await expect(map).toBeVisible({timeout:15000});
  const color=await page.getByLabel('合成甲排行进度').evaluate(el=>(el as HTMLElement).style.getPropertyValue('--runner-color'));
  const countColor=async()=>{
    const png=await map.locator('canvas').screenshot();
    return page.evaluate(async ({imageData,color})=>{
      const image=new Image(); image.src=`data:image/png;base64,${imageData}`; await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const context=canvas.getContext('2d')!; context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)); let count=0;
      for(let i=0;i<pixels.length;i+=4) if(rgb.every((value,j)=>Math.abs(pixels[i+j]-value)<12)) count++;
      return count;
    },{imageData:png.toString('base64'),color});
  };
  const before=await countColor();
  await page.getByRole('button',{name:'合成甲'}).click();
  await expect(page.getByText('全部可显示记录（2）', {exact:false})).toBeVisible();
  await expect.poll(countColor).toBeGreaterThan(before+50);
  await page.getByRole('button',{name:'全部',exact:true}).click();
  await expect.poll(countColor).toBeLessThan(before+50);
  await page.locator('#together-feed .card-link').first().click();
  await expect.poll(countColor).toBeGreaterThan(before+50);
  await expect(page.locator('#together-feed .card-link').first()).toHaveAttribute('aria-current','true');
  await page.locator('#together-feed .card-link').first().click();
  await expect.poll(countColor).toBeLessThan(before+50);
});


test('设置只保存改动的开关', async ({page}) => {
  await loginRunner(page);
  const toggle = page.getByRole('switch',{name:'加入一起跑步'});
  await expect(toggle).toBeDisabled();
  await expect(page.getByText('需管理员开启')).toBeVisible();
  await page.goto('/admin/users');
  const permission = page.getByRole('switch',{name:'一起跑步 晨跑者'});
  await permission.click();
  await expect(permission).toHaveAttribute('aria-checked','true');
  await page.goto('/settings');
  await expect(toggle).toBeEnabled();
  await expect(page.getByRole('button',{name:'修改密码',exact:true})).toBeEnabled();
  let patch: unknown;
  page.on('request', request => { if(request.method()==='PATCH' && request.url().endsWith('/api/v1/me')) patch=request.postDataJSON(); });
  await toggle.click();
  await page.getByRole('button',{name:'保存公开设置'}).click();
  await expect.poll(()=>patch).toEqual({together_enabled:true});
});


test('手机深色模式可从导航进入', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(() => localStorage.setItem('runnote-theme','dark'));
  await page.goto('/dashboard');
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready','true');
  await page.getByRole('button',{name:'打开导航'}).click();
  await page.getByRole('link',{name:'一起跑步'}).click();
  await expect(page).toHaveURL(/\/together$/);
  await expect(page.getByRole('heading',{name:'一起跑步'})).toBeVisible();
});


test('分段控件和跳转链接保持正确焦点，目标面板默认收起', async ({page}) => {
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:3000,count:1,participants:runners,recent:[],tracks:[]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await expect(page.getByRole('heading',{name:'一起跑步'})).toBeVisible();
  const skip=page.getByRole('link',{name:'跳转到主要内容'});
  await page.getByRole('button',{name:'本月'}).click();
  await expect(skip).not.toBeInViewport();
  await expect(page.locator('.goal-container .anchored-panel')).toBeHidden();
  await page.setViewportSize({width:390,height:844});
  await page.setViewportSize({width:1280,height:800});
  await expect(page.locator('.goal-container .anchored-panel')).toBeHidden();
  await page.keyboard.press('Tab');
  await page.goto('/settings');
  await expect(skip).not.toBeInViewport();
});

test('手机动态使用时间线且点击后跳转链接保持隐藏', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:3000,count:1,participants:runners,recent:[{id:'00000000-0000-4000-8000-000000000001',username:'runner_one',display_name:'合成甲',title:'跑步',activity_date:'2026-10-01',distance_m:3000,category:'',tags:[],temporal_quality:'complete',avg_pace_seconds_per_km:330,elapsed_seconds:1800,timer_seconds:null,avg_heart_rate_bpm:null,geometry:[]}],tracks:[]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  const recent=page.locator('#together-feed');
  await expect(recent.locator('.activity-card')).toContainText('合成甲');
  await expect(recent.locator('.activity-card')).not.toContainText('未识别城市');
  await expect(recent.locator('.card-link')).toHaveAttribute('href','/p/runner_one/activities/00000000-0000-4000-8000-000000000001');
  await page.getByRole('button',{name:'本月'}).click();
  await expect(page.locator('.skip-link')).toHaveCSS('opacity','0');
  await page.goto('/together');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toHaveCSS('opacity','1');
});


test('访客在无人加入时看到简短空状态', async ({page}) => {
  await page.goto('/together');
  await expect(page.getByText('还没有人加入', {exact:true})).toBeVisible();
  await expect(page.getByText('在设置里打开『一起跑步』就能加入')).toHaveCount(0);
  await expect(page.locator('.together-stack').getByRole('link',{name:'去设置里加入'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'里程排行榜'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'一起跑过的地方'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'最近动态'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'全部',exact:true})).toHaveCount(0);
});

test('已登录用户在无人加入时看到设置指引', async ({page}) => {
  await loginRunner(page);
  await page.goto('/together');
  await expect(page.getByText('还没有人加入一起跑步', {exact:true})).toBeVisible();
  await expect(page.getByText('在设置里打开『一起跑步』就能加入', {exact:true})).toBeVisible();
  await expect(page.locator('.together-stack').getByRole('link',{name:'去设置里加入'})).toHaveAttribute('href','/settings');
});

test('从桌面切到手机时设置页菜单保持关闭', async ({page}) => {
  await loginRunner(page);
  await page.setViewportSize({width:1280,height:800});
  await page.goto('/settings');
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#app-navigation')).toBeHidden();
  await expect(page.getByRole('button',{name:'打开导航'})).toHaveAttribute('aria-expanded','false');
});


test('已登录但未加入时空状态提供设置入口', async ({page}) => {
  await loginRunner(page);
  await page.goto('/together');
  await expect(page.getByRole('link',{name:'去设置里加入'})).toHaveAttribute('href','/settings');
  await expect(page.getByRole('heading',{name:'里程排行榜'})).toHaveCount(0);
});


test('单人单条记录的摘要、排行、地图和动态完整显示', async ({page}) => {
  await page.emulateMedia({ reducedMotion:'reduce' });
  const coordinates = Array.from({length:49}, (_, i) => [10 + Math.sin(i * Math.PI / 24) * .001, 10 + Math.cos(i * Math.PI / 24) * .001]);
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:3000,count:1,participants:[runners[0]],recent:[{id:runners[0].user_id,username:'runner_one',display_name:'合成甲',title:'合成路线',activity_date:'2026-10-01',distance_m:3000,category:'',tags:[],temporal_quality:'complete',avg_pace_seconds_per_km:330,elapsed_seconds:1800,timer_seconds:null,avg_heart_rate_bpm:null,geometry:[]}],tracks:[{username:'runner_one',activity_id:runners[0].user_id,title:'合成路线',activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates}}]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await expect(page.getByText('本周我们一起跑了 3.00 公里')).toBeVisible();
  await expect(page.getByText('1 人 · 1 次')).toBeVisible();
  const ranking=page.locator('section').filter({has:page.getByRole('heading',{name:'里程排行榜'})});
  await expect(ranking.locator('li')).toHaveCount(1);
  await expect(ranking.locator('li')).toContainText('3.00 km');
  await expect(ranking.locator('.runner-avatar')).toHaveText('合');
  await expect(ranking.locator('progress')).toHaveAttribute('value','100');
  const legend=page.getByRole('region',{name:'选择参与者'});
  await expect(legend.getByRole('button',{name:'合成甲'}).locator('.runner-avatar')).toHaveText('合');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  await expect(page.locator('#together-feed .activity-card').getByText('合成甲', {exact:false})).toBeVisible();
  await expect(page.getByText('全部可显示记录（1）', {exact:false})).toBeVisible();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId('footprint-map-ready')).toBeVisible();
    await expect.poll(async () => {
      const color=await ranking.locator('progress').evaluate(el=>el.style.getPropertyValue('--runner-color'));
      const png=await page.locator('.maplibregl-canvas').screenshot();
      return page.evaluate(async ({imageData, color}) => {
        const image=new Image(); image.src=`data:image/png;base64,${imageData}`; await image.decode();
        const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
        const context=canvas.getContext('2d')!; context.drawImage(image,0,0);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
        const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
        const background=[pixels[0],pixels[1],pixels[2]];
        const expected=rgb.map((value,i)=>value*.8+background[i]*.2);
        let left=canvas.width,right=-1,top=canvas.height,bottom=-1;
        for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
          const offset=(y*canvas.width+x)*4;
          if(expected.every((value,i)=>Math.abs(pixels[offset+i]-value)<12)) { left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y); }
        }
        return Math.max((right-left)/canvas.width,(bottom-top)/canvas.height);
      }, {imageData:png.toString('base64'),color});
    }).toBeGreaterThan(.4);
  }
});

test('周期更新摘要和地址，刷新保留年份且动态不变', async ({page}) => {
  await page.route('**/api/v1/together?*', route => {
    const period = new URL(route.request().url()).searchParams.get('period');
    const distance = period === 'year' ? 13000 : period === 'month' ? 7000 : 4000;
    return route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:distance,count:2,participants:runners,recent:[{id:runners[0].user_id,username:'runner_one',display_name:'合成甲',title:'跑步',activity_date:'2026-10-01',distance_m:3000,category:'',tags:[],temporal_quality:'complete',avg_pace_seconds_per_km:330,elapsed_seconds:1800,timer_seconds:null,avg_heart_rate_bpm:null,geometry:[]}],tracks:[]},error:null,meta:{request_id:'test'}}});
  });
  await page.goto('/together');
  const recent = page.locator('#together-feed');
  await expect(page.getByText('本周我们一起跑了 4.00 公里')).toBeVisible();
  await page.getByRole('button',{name:'本月'}).click();
  await expect(page).toHaveURL(/period=month/);
  await expect(page.getByText('本月我们一起跑了 7.00 公里')).toBeVisible();
  await page.getByRole('button',{name:'今年'}).click();
  await expect(page).toHaveURL(/period=year/);
  await expect(page.getByText('今年我们一起跑了 13.00 公里')).toBeVisible();
  await expect(recent.locator('.activity-card')).toContainText('合成甲');
  await page.reload();
  await expect(page.getByText('今年我们一起跑了 13.00 公里')).toBeVisible();
  await expect(recent.locator('.activity-card')).toContainText('合成甲');
});

test('动态分页失败可重试，追加去重并在末页隐藏按钮', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:800});
  const record = {id:runners[0].user_id,username:'runner_one',display_name:'合成甲',title:'跑步',activity_date:'2026-10-01',distance_m:3000,category:'',tags:[],temporal_quality:'complete',avg_pace_seconds_per_km:null,elapsed_seconds:null,timer_seconds:null,avg_heart_rate_bpm:null,geometry:[]};
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{distance_m:3000,count:1,participants:[runners[0]],recent:[record],tracks:[],next_cursor:'cursor',tracks_truncated:true},error:null,meta:{request_id:'test'}}}));
  let attempts=0;
  await page.route('**/api/v1/together/feed?*', route=>{ attempts++; return attempts===1 ? route.fulfill({status:503,json:{error:{code:'FAILED'}}}) : route.fulfill({json:{data:{items:[record,{...record,id:runners[1].user_id,activity_date:'2026-09-30'}],next_cursor:null},error:null,meta:{request_id:'test'}}}); });
  await page.goto('/together');
  await expect(page.getByText('仅显示最近 500 条轨迹')).toBeVisible();
  const recent=page.locator('#together-feed');
  await recent.getByRole('button',{name:'加载更多'}).click();
  await expect(recent.getByRole('alert')).toBeVisible();
  await recent.getByRole('button',{name:'重试'}).click();
  await expect(recent.locator('.activity-card')).toHaveCount(2);
  await expect(recent.locator('.timeline-month')).toHaveCount(2);
  await expect(recent.getByRole('button',{name:'加载更多'})).toHaveCount(0);
  await expect(recent.locator('.activity-card').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('轨迹未截断时不显示截断提示', async ({page}) => {
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{distance_m:0,count:0,participants:[runners[0]],recent:[],tracks:[],next_cursor:null,tracks_truncated:false},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await expect(page.getByRole('heading',{name:'一起跑过的地方'})).toBeVisible();
  await expect(page.getByText('仅显示最近 500 条轨迹')).toHaveCount(0);
});

test('动态选择、地图详情和手机布局', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  const record = {id:runners[0].user_id,username:'runner_one',display_name:'合成甲',title:'晨跑',activity_date:'2026-10-01',distance_m:3000,category:'慢跑',tags:['公园'],temporal_quality:'complete',avg_pace_seconds_per_km:330,elapsed_seconds:990,timer_seconds:null,avg_heart_rate_bpm:120,geometry:[{type:'LineString',coordinates:[[10,10],[10.01,10.01]]}]};
  const second = {...record,id:runners[1].user_id,username:'runner_two',display_name:'合成乙',title:'夜跑'};
  await page.route('**/api/v1/together?*', route => route.fulfill({json:{data:{distance_m:7000,count:2,participants:runners,recent:[record,second],tracks:[],next_cursor:null,tracks_truncated:false},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  const feed=page.locator('#together-feed'), map=page.locator('#together-map');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  expect(Math.abs((await feed.locator('.activity-card').first().boundingBox())!.y - (await map.boundingBox())!.y)).toBeLessThanOrEqual(2);
  await expect(map).toHaveCSS('position','sticky');
  await feed.locator('.card-link').nth(1).click();
  await expect(page.getByTestId('together-map-info')).toContainText('夜跑');
  await expect(page.getByTestId('together-map-info')).toBeVisible();
  await expect(page.getByTestId('together-map-info')).toHaveCSS('opacity','1');
  expect((await page.getByTestId('together-map-info').boundingBox())!.width).toBeGreaterThanOrEqual(200);
  await expect(page.getByTestId('together-map-info').getByRole('link')).toHaveAttribute('href',`/p/runner_two/activities/${second.id}`);
  await expect(feed.getByRole('button',{name:/编辑|删除|分享|导出/})).toHaveCount(0);
  await feed.locator('.card-link').nth(1).click();
  await expect(page.getByTestId('together-map-info')).toHaveCount(0);
  await page.setViewportSize({width:320,height:700});
  expect((await map.boundingBox())!.y).toBeLessThan((await feed.locator('.activity-card').first().boundingBox())!.y);
  await feed.locator('.card-link').first().click();
  await expect(page.getByTestId('together-map-info')).toContainText('晨跑');
  await expect(page.getByTestId('together-map-info')).toBeVisible();
  await expect(page.getByTestId('together-map-info')).toHaveCSS('opacity','1');
  expect((await page.getByTestId('together-map-info').boundingBox())!.height).toBeLessThanOrEqual(64);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('选择动态时在合并地图显示详情并可重置', async ({page}) => {
  const record = {id:runners[0].user_id,username:'runner_one',display_name:'合成甲',title:'晨跑',activity_date:'2026-10-01',distance_m:3000,category:'',tags:[],temporal_quality:'complete',avg_pace_seconds_per_km:330,elapsed_seconds:1800,timer_seconds:null,avg_heart_rate_bpm:null,geometry:[{type:'LineString',coordinates:[[10,10],[10.01,10.01]]}]};
  await page.route('**/api/v1/together?*', route => route.fulfill({json:{data:{distance_m:3000,count:1,participants:runners,recent:[record],tracks:[],next_cursor:null,tracks_truncated:false},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await page.locator('#together-feed .card-link').first().click();
  await expect(page.getByTestId('together-map-info')).toContainText('晨跑');
  await page.getByRole('button',{name:'回到全部足迹'}).click();
  await expect(page.getByTestId('together-map-info')).toHaveCount(0);
});

test('选中记录保留其他轨迹与当前缩放，手机信息卡保持紧凑', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const tracks = runners.map((runner,i)=>({username:runner.username,activity_id:runner.user_id,title:runner.display_name,activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates:i ? [[10,10.02],[10.02,10.02]] : [[10,10],[10.02,10]]}}));
  const recent = runners.map(runner=>({id:runner.user_id,username:runner.username,display_name:runner.display_name,title:runner.display_name,activity_date:'2026-10-01',distance_m:3000,category:'',tags:[],temporal_quality:'complete',avg_pace_seconds_per_km:330,elapsed_seconds:1800,timer_seconds:null,avg_heart_rate_bpm:null,geometry:[]}));
  await page.route('**/api/v1/together?*', route=>route.fulfill({json:{data:{next_cursor:null,tracks_truncated:false,distance_m:7000,count:2,participants:runners,recent,tracks},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  const canvas=page.locator('.maplibregl-canvas');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  await page.getByLabel('缩小地图').click();
  const before=await canvas.screenshot();
  await page.locator('#together-feed .card-link').first().click();
  const after=await canvas.screenshot();
  const difference=await page.evaluate(async ({a,b})=>{
    const pixels=async (src:string)=>{const image=new Image();image.src=`data:image/png;base64,${src}`;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return {data:ctx.getImageData(0,0,c.width,c.height).data,width:c.width,height:c.height};};
    const x=await pixels(a),y=await pixels(b);let changed=0;
    for(let row=Math.floor(x.height*.15);row<Math.floor(x.height*.4);row++) for(let col=Math.floor(x.width*.2);col<Math.floor(x.width*.8);col++){const i=(row*x.width+col)*4;if(Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2])>30)changed++;}
    return changed;
  },{a:before.toString('base64'),b:after.toString('base64')});
  expect(difference).toBeLessThan(100);
  await page.setViewportSize({width:320,height:700});
  const info=page.getByTestId('together-map-info');
  await expect(info).toBeVisible();
  await expect(info).toHaveCSS('opacity','1');
  expect((await info.boundingBox())!.height).toBeLessThanOrEqual(64);
});
