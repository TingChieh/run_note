import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';
const file = { name:'synthetic-mi-fitness.tcx', mimeType:'application/xml', buffer:Buffer.from('<TrainingCenterDatabase/>') };
const activity = { ...sampleActivity, title:'TCX 下午跑步', activity_date:'2026-10-04', started_at:'2026-10-04T08:15:20Z', ended_at:'2026-10-04T08:37:22Z', distance_m:'2999', elapsed_seconds:'1322', timer_seconds:'1166', avg_pace_seconds_per_km:'388.796', avg_heart_rate_bpm:156, steps:3262, calories_kcal:144, metrics_version:'tcx-v1' };

test('TCX selection exposes explicit time repair, retains failed draft, then shows private device metrics', async ({page}) => {
  const state = await installActivities(page); state.records = [activity];
  let attempts=0, body='';
  await page.route('**/api/v1/tcx-imports', async route => {
    body = route.request().postData() ?? '';
    expect(route.request().headers()['x-csrf-token']).toBe('ui-csrf');
    if (++attempts===1) return route.fulfill({status:503,json:{error:{message:'保存暂时失败，请重试'}}});
    return route.fulfill({status:201,json:{data:{activity,warnings:['LOCAL_TIME_INTERPRETED']},error:null}});
  });
  await loginRunner(page); await page.goto('/activities');
  await expect(page.getByRole('button',{name:'导入 GPX',exact:true})).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByLabel('文件格式',{exact:true})).toHaveValue('tcx');
  await expect(page.getByLabel('时间解释',{exact:true})).toHaveValue('absolute');
  await page.getByLabel('时间解释',{exact:true}).selectOption('local');
  await page.getByText('补充导入信息',{exact:true}).click();
  await page.getByLabel('时区（可选）').fill('Asia/Shanghai');
  await page.getByLabel('标题（可选）').fill('TCX 下午跑步');
  await page.getByRole('button',{name:'导入 TCX',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('保存暂时失败');
  expect(await page.locator('input[type=file]').evaluate((el:HTMLInputElement)=>el.files?.[0]?.name)).toBe(file.name);
  await expect(page.getByLabel('时间解释',{exact:true})).toHaveValue('local');
  await expect(page.getByLabel('标题（可选）')).toHaveValue('TCX 下午跑步');
  expect(body).toContain('name="time_mode"\r\n\r\nlocal');
  expect(body).toContain('Asia/Shanghai');
  await page.getByRole('button',{name:'导入 TCX',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'导入成功'})).toBeVisible();
  await expect(page.getByText('已按所选时区的当地时间解释文件时间',{exact:true})).toBeVisible();
  // Each new file must explicitly opt in; repair cannot leak to a later upload.
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByLabel('时间解释',{exact:true})).toHaveValue('absolute');
  await page.goto(`/activities/${activity.id}`);
  await expect(page.getByText('156 bpm',{exact:true})).toBeVisible();
  await expect(page.getByText('144 kcal',{exact:true})).toBeVisible();
  await expect(page.getByText('3262 步',{exact:true})).toBeVisible();
  await expect(page.getByText('22:02',{exact:true})).toBeVisible();
  await expect(page.getByText('19:26',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('16:15:20 · Asia/Shanghai',{exact:true})).toBeVisible();
  await expect(page.getByText('6:29 /km',{exact:true}).first()).toBeVisible();
  await expect(page.getByTestId('route-map-ready')).toBeVisible({timeout:20000});
  await page.screenshot({path:'test-results/tcx-desktop.png',fullPage:true});
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.getByText('156 bpm',{exact:true})).toBeVisible();
  }
  await page.screenshot({path:'test-results/tcx-mobile.png',fullPage:true});
  await page.goto('/dashboard?year=2026&day=2026-10-04');
  await expect(page.getByRole('region',{name:'2026-10-04 的活动（1）',exact:true})).toContainText('用时 19:26');
  expect(attempts).toBe(2);
});

test('TCX keyboard controls and mobile upload have no overflow, and GPX remains the default', async ({page}) => {
  await installActivities(page); await loginRunner(page); await page.goto('/activities');
  await expect(page.getByRole('button',{name:'导入 GPX',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'导入 GPX',exact:true})).toBeVisible();
  await page.getByLabel('文件格式',{exact:true}).focus();
  await page.keyboard.press('t'); await page.keyboard.press('Enter');
  await expect(page.getByLabel('文件格式',{exact:true})).toHaveValue('tcx');
  await page.getByLabel('时间解释',{exact:true}).focus();
  await expect(page.getByLabel('时间解释',{exact:true})).toBeFocused();
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.screenshot({path:'test-results/tcx-mobile-upload.png',fullPage:true});
});
