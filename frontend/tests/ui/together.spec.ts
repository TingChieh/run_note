import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

const runners = [
  { username:'runner_one',display_name:'合成甲',distance_m:3000,count:1,week_m:3000,month_m:3000 },
  { username:'runner_two',display_name:'合成乙',distance_m:4000,count:1,week_m:1000,month_m:4000 },
];
test('访客可切换排行和地图参与者', async ({page}) => {
  await page.route('**/api/v1/together', route=>route.fulfill({json:{data:{distance_m:7000,count:2,participants:runners,recent:[],tracks:[{username:'runner_one',activity_id:'00000000-0000-4000-8000-000000000001',title:'合成路线',activity_date:'2026-10-01',segment_index:0,geometry:{type:'LineString',coordinates:[[10,10],[10.01,10.01]]}}]},error:null,meta:{request_id:'test'}}}));
  await page.goto('/together');
  await expect(page.getByRole('heading',{name:'一起跑步'})).toBeVisible();
  await expect(page.getByText('7.00 km')).toBeVisible();
  const ranking=page.locator('section').filter({has:page.getByRole('heading',{name:'里程排行榜'})});
  await expect(ranking.locator('li').first()).toContainText('合成甲');
  await page.getByRole('button',{name:'本月'}).click();
  await expect(ranking.locator('li').first()).toContainText('合成乙');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'合成乙'}).click();
  await expect(page.getByRole('button',{name:'合成乙'})).toHaveAttribute('aria-pressed','true');
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
