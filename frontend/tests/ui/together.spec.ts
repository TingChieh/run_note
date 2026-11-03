import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

const runners = [
  { user_id:'00000000-0000-4000-8000-000000000001',avatar_version:null,username:'runner_one',display_name:'合成甲',distance_m:3000,count:1,week_m:3000,month_m:3000 },
  { user_id:'00000000-0000-4000-8000-000000000002',avatar_version:null,username:'runner_two',display_name:'合成乙',distance_m:4000,count:1,week_m:1000,month_m:4000 },
];
test('访客可切换排行和地图参与者', async ({page}) => {
  await page.route('**/api/v1/together', route=>route.fulfill({json:{data:{distance_m:7000,count:2,participants:runners,recent:[],tracks:[{username:'runner_one',activity_id:'00000000-0000-4000-8000-000000000001',title:'合成路线',activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates:[[10,10],[10.01,10.01]]}}]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await expect(page.getByRole('heading',{name:'一起跑步'})).toBeVisible();
  await expect(page.getByText('本月我们一起跑了 7.00 公里')).toBeVisible();
  const ranking=page.locator('section').filter({has:page.getByRole('heading',{name:'里程排行榜'})});
  await expect(ranking.locator('li').first()).toContainText('合成甲');
  await expect(ranking.getByRole('link',{name:'合成甲'})).toHaveAttribute('href','/p/runner_one/dashboard');
  await page.getByRole('button',{name:'本月'}).click();
  await expect(ranking.locator('li').first()).toContainText('合成乙');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'合成乙'}).click();
  await expect(page.getByRole('button',{name:'合成乙'})).toHaveAttribute('aria-pressed','true');
  await expect(ranking.locator('progress').first()).toHaveAttribute('value','100');
  await page.setViewportSize({width:320,height:700});
  const legend=page.getByRole('region',{name:'选择参与者'});
  await expect(legend).toHaveCSS('overflow-x','auto');
  await expect(legend.locator('button').first()).toHaveCSS('white-space','nowrap');
  expect(await legend.locator('..').evaluate(el => getComputedStyle(el, '::after').backgroundImage)).toContain('linear-gradient');
  await expect(ranking.locator('progress').first()).toHaveCSS('appearance','none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const mapBox=await page.getByTestId('footprint-map-ready').boundingBox();
  expect(mapBox && mapBox.height).toBeGreaterThan(200);
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
  await page.route('**/api/v1/together', route=>route.fulfill({json:{data:{distance_m:3000,count:1,participants:runners,recent:[],tracks:[]},error:null,meta:{request_id:'test'}}}));
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
  await page.route('**/api/v1/together', route=>route.fulfill({json:{data:{distance_m:3000,count:1,participants:runners,recent:[{id:'00000000-0000-4000-8000-000000000001',username:'runner_one',display_name:'合成甲',title:'跑步',activity_date:'2026-10-01',distance_m:3000,avg_pace_seconds_per_km:330}],tracks:[]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  const recent=page.locator('section').filter({has:page.getByRole('heading',{name:'最近动态'})});
  await expect(recent.locator('.timeline-card')).toContainText('合成甲 跑了 3.00 公里');
  await expect(recent.locator('.timeline-card')).not.toContainText('未识别城市');
  await expect(recent.getByRole('link')).toHaveAttribute('href','/p/runner_one/activities/00000000-0000-4000-8000-000000000001');
  await page.getByRole('button',{name:'本月'}).click();
  await expect(page.locator('.skip-link')).toHaveCSS('opacity','0');
  await page.goto('/together');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toHaveCSS('opacity','1');
});


test('无人加入时只显示一张空状态卡', async ({page}) => {
  await page.goto('/together');
  await expect(page.getByText('还没有人加入一起跑步')).toBeVisible();
  await expect(page.getByRole('heading',{name:'里程排行榜'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'一起跑过的地方'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'最近动态'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'全部',exact:true})).toHaveCount(0);
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
  await page.route('**/api/v1/together', route=>route.fulfill({json:{data:{distance_m:3000,count:1,participants:[runners[0]],recent:[{id:runners[0].user_id,username:'runner_one',display_name:'合成甲',title:'合成路线',activity_date:'2026-10-01',distance_m:3000,avg_pace_seconds_per_km:330}],tracks:[{username:'runner_one',activity_id:runners[0].user_id,title:'合成路线',activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates}}]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await expect(page.getByText('本月我们一起跑了 3.00 公里')).toBeVisible();
  await expect(page.getByText('1 人 · 1 次')).toBeVisible();
  const ranking=page.locator('section').filter({has:page.getByRole('heading',{name:'里程排行榜'})});
  await expect(ranking.locator('li')).toHaveCount(1);
  await expect(ranking.locator('li')).toContainText('3.00 km');
  await expect(ranking.locator('.runner-avatar')).toHaveText('合');
  await expect(ranking.locator('progress')).toHaveAttribute('value','100');
  const legend=page.getByRole('region',{name:'选择参与者'});
  await expect(legend.getByRole('button',{name:'合成甲'}).locator('.runner-avatar')).toHaveText('合');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'关闭底图',exact:true}).click();
  await expect(page.getByText('合成甲 跑了 3.00 公里', {exact:false})).toBeVisible();
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
