import { test, expect, type Page } from '@playwright/test';
import { loginRunner, installActivities, sampleActivity } from '../fixtures/activities';
import { installAI, installPublic, report } from '../fixtures/p2';
async function responsive(page: Page, name: string) {
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width===390 || width===1440) { await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);}); await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))); await page.screenshot({path:`test-results/p2-${name}-${width}.png`});
      if(name==='ai-report' || name==='share') await page.getByRole('region',{name:name==='ai-report'?'当前报告':'公开与分享'}).screenshot({path:`test-results/p2-${name}-panel-${width}.png`}); }
  }
}
test('register native validation, password visibility, busy and failure retry, safe redirect',async({page})=>{
  await page.goto('/register?next=https://example.com');
  await page.getByRole('button',{name:'注册',exact:true}).click();
  expect(await page.locator('input[name=email]').evaluate(el=>(el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await page.getByLabel('邮箱',{exact:true}).fill('runner@example.com');
  await page.getByLabel('用户名',{exact:true}).fill('new_runner');
  await page.getByLabel('密码',{exact:true}).fill('Synthetic-ui-password-2026');
  await page.getByRole('button',{name:'显示密码',exact:true}).click();
  await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');
  await responsive(page,'register');
  let release!:()=>void;const hold=new Promise<void>(r=>release=r);
  await page.route('**/api/v1/auth/register',async route=>{await hold;await route.fulfill({status:503,json:{error:{message:'注册失败，请重试'}}});});
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await expect(page.getByLabel('邮箱',{exact:true})).toBeDisabled();release();
  await expect(page.getByRole('alert')).toContainText('注册失败');
  await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
  await page.unroute('**/api/v1/auth/register');
  await page.getByLabel('密码',{exact:true}).fill('Synthetic-ui-password-2026');
  await page.getByRole('button',{name:'注册',exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/);
});
test('settings separates draft from saved public state and saves with retry',async({page})=>{
  await loginRunner(page);await responsive(page,'settings');
  await page.getByLabel('昵称',{exact:true}).fill('新的跑者');
  await page.getByLabel('开启公开个人主页',{exact:true}).check();
  await expect(page.getByText('有未保存的更改',{exact:true})).toBeVisible();
  await page.route('**/api/v1/me',route=>route.fulfill({status:503,json:{error:{message:'保存暂时失败'}}}));
  await page.getByRole('button',{name:'保存公开设置',exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存暂时失败');
  await page.unroute('**/api/v1/me');await page.getByRole('button',{name:'保存公开设置',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'主页已开启'})).toBeVisible();
  await expect(page.getByText('有未保存的更改',{exact:true})).toHaveCount(0);
  await page.getByLabel('开启公开个人主页',{exact:true}).uncheck();await page.getByRole('button',{name:'保存公开设置',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'独立记录分享仍需单独撤销'})).toBeVisible();
});
test('AI mock report needs explicit consent, aggregate-only payload, history and delete',async({page})=>{
  const state=await installAI(page);await loginRunner(page);await page.goto('/ai');
  const generate=page.getByRole('button',{name:'生成近期总结与下周建议'});await expect(generate).toBeDisabled();expect(state.calls).toHaveLength(0);
  await responsive(page,'ai-entry');await page.getByRole('checkbox').check();await generate.click();
  await expect(page.getByRole('region',{name:'当前报告'})).toContainText('近期保持稳定');
  expect(state.calls[0].body).toEqual({date_from:'2026-09-14',date_to:'2026-10-12',consent_to_send_summary:true});
  await expect(page.getByRole('table')).toBeHidden();await page.getByText('每周明细与统计口径',{exact:true}).click();await expect(page.getByRole('table')).toBeVisible();
  await responsive(page,'ai-report');await page.getByRole('button',{name:'查看报告'}).click();await expect(page.getByRole('region',{name:'当前报告'})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除报告'}).click();await expect(page.getByText('尚无分析报告。',{exact:true})).toBeVisible();
});
test('AI unknown failure retries same request; read failures recover without generation',async({page})=>{
  const state=await installAI(page);state.failContext=true;state.failHistory=true;
  await loginRunner(page);await page.goto('/ai');await expect(page.getByRole('alert').first()).toBeVisible();state.failContext=false;state.failHistory=false;
  await page.getByRole('button',{name:'重试读取统计依据'}).click();await page.getByRole('button',{name:'读取历史'}).click();
  await page.getByRole('checkbox').check();state.failGenerate=true;await page.getByRole('button',{name:'生成近期总结与下周建议'}).click();
  const retry=page.getByRole('button',{name:'按原请求标识重试（防重复）'});await expect(retry).toBeEnabled();await page.reload();await expect(retry).toBeDisabled();expect(state.calls).toHaveLength(1);await page.getByRole('checkbox').check();state.failGenerate=false;await retry.click();await expect(page.getByRole('region',{name:'当前报告'})).toBeVisible();expect(state.calls).toHaveLength(2);expect(state.calls[1]).toEqual(state.calls[0]);
  state.failDetail=true;await page.getByRole('button',{name:'查看报告'}).click();await expect(page.getByRole('button',{name:'重试读取报告'})).toBeVisible();state.failDetail=false;await page.getByRole('button',{name:'重试读取报告'}).click();await expect(page.getByRole('region',{name:'当前报告'})).toBeVisible();
});
test('AI no data, unavailable and quota block generation',async({page})=>{
  const state=await installAI(page);await loginRunner(page);state.empty=true;await page.goto('/ai');await expect(page.getByRole('link',{name:'导入 GPX / TCX'})).toBeVisible();await page.getByRole('checkbox').check();await expect(page.getByRole('button',{name:'生成近期总结与下周建议'})).toBeDisabled();
  state.empty=false;state.configured=false;await page.reload();await expect(page.getByText(/AI服务尚未配置/)).toBeVisible();state.configured=true;state.quota=0;await page.reload();await page.getByRole('checkbox').check();await expect(page.getByRole('button',{name:'生成近期总结与下周建议'})).toBeDisabled();expect(state.calls).toHaveLength(0);
});
test('anonymous public profile calendar, whitelist detail and revocation',async({page})=>{
  const state=await installPublic(page);const privateReads:string[]=[];page.on('request',req=>{if(/\/api\/v1\/(activities|statistics|ai-reports)(\/|\?|$)/.test(req.url()))privateReads.push(req.url());});
  await page.goto('/u/runner?year=2026');await expect(page.getByRole('heading',{name:'晨跑者',exact:true})).toBeVisible();await responsive(page,'public');
  await page.getByRole('button',{name:'上一年',exact:true}).click();await expect(page.getByLabel('年份',{exact:true})).toHaveValue('2025');await page.getByRole('button',{name:'下一年',exact:true}).click();
  const date=page.locator('[data-date="2026-10-13"]');await date.focus();await page.keyboard.press('ArrowUp');await expect(page.locator('[data-date="2026-10-12"]')).toBeFocused();await page.keyboard.press('ArrowDown');await expect(date).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'2026-10-13 的公开记录'})).toBeVisible();
  await page.getByRole('link',{name:'河畔晨跑 →',exact:true}).click();await expect(page.getByRole('heading',{name:'河畔晨跑'})).toBeVisible();await responsive(page,'public-detail');
  expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_.*SENTINEL/);expect(privateReads).toEqual([]);await expect(page.locator('canvas')).toHaveCount(0);
  state.closed=true;await page.reload();await expect(page.getByRole('heading',{name:'分享不可用'})).toBeVisible();await expect(page.getByText('5.1 km',{exact:true})).toHaveCount(0);
  state.closed=false;await page.getByRole('button',{name:'重新读取分享'}).click();await expect(page.getByRole('heading',{name:'河畔晨跑'})).toBeVisible();
  await page.goto('/shared/synthetic-token');await expect(page.getByRole('heading',{name:'河畔晨跑'})).toBeVisible();state.closed=true;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('heading',{name:'河畔晨跑'})).toHaveCount(0);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('heading',{name:'分享不可用'})).toBeVisible();
});
test('public empty and closed states remain compact and retryable',async({page})=>{
  const state=await installPublic(page);state.empty=true;await page.goto('/u/runner?year=2026');await expect(page.getByText('尚无公开跑步记录。',{exact:true})).toBeVisible();await responsive(page,'public-empty');state.closed=true;await page.reload();await expect(page.getByRole('heading',{name:'主页不可用'})).toBeVisible();state.closed=false;await page.getByRole('button',{name:'重新读取主页'}).click();await expect(page.getByRole('heading',{name:'晨跑者',exact:true})).toBeVisible();expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_.*SENTINEL/);
});
test('sharing keeps saved permissions, copies and revokes links',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await installActivities(page);await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);
  const panel=page.getByRole('region',{name:'公开与分享'});await panel.getByLabel('记录可见性').selectOption('unlisted');await expect(panel.getByText('选择尚未保存',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'创建分享链接'})).toBeDisabled();
  await panel.getByRole('button',{name:'保存可见性'}).click();await panel.getByRole('button',{name:'创建分享链接'}).click();await panel.getByRole('button',{name:'复制分享链接'}).click();await expect(panel.getByRole('status')).toContainText('链接已复制');expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('synthetic-token');
  await responsive(page,'share');await panel.getByRole('button',{name:'撤销链接'}).click();await expect(panel.getByText(/已撤销/).first()).toBeVisible();
});
test('login error receives keyboard focus and supports retry on mobile',async({page})=>{
  await page.goto('/login');await responsive(page,'login');
  await page.getByLabel('邮箱',{exact:true}).fill('runner@example.com');await page.getByLabel('密码',{exact:true}).fill('Synthetic-ui-password-2026');
  await page.route('**/api/v1/auth/login',route=>route.fulfill({status:401,json:{error:{message:'邮箱或密码不正确'}}}));
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('#auth-error')).toBeFocused();await expect(page.getByRole('alert')).toContainText('邮箱或密码不正确');
  await page.unroute('**/api/v1/auth/login');await page.getByLabel('密码',{exact:true}).fill('Synthetic-ui-password-2026');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/);
});
test('historical AI failed, pending and stale snapshots remain accessible without calls',async({page})=>{
  const state=await installAI(page);state.reports=[{...report,status:'failed',analysis:null,error_code:'PROVIDER_ERROR',is_stale:true}];
  await loginRunner(page);await page.goto('/ai');await page.getByRole('button',{name:'查看报告'}).click();await expect(page.getByRole('region',{name:'当前报告'})).toContainText('新的调用会计入额度');await expect(page.getByText(/运动数据已变化；/)).toBeVisible();
  state.reports=[{...report,status:'pending',analysis:null}];await page.getByRole('button',{name:'读取历史'}).click();await page.getByRole('button',{name:'查看报告'}).click();await expect(page.getByRole('region',{name:'当前报告'})).toContainText('报告正在生成');await expect(page.getByRole('button',{name:'删除报告'})).toBeDisabled();expect(state.calls).toHaveLength(0);
});
test('sharing read and clipboard failures offer recovery',async({page})=>{
  await installActivities(page);await loginRunner(page);
  await page.route(`**/api/v1/activities/${sampleActivity.id}/shares`,route=>route.fulfill({status:503,json:{error:{message:'分享链接读取失败'}}}));
  await page.goto(`/activities/${sampleActivity.id}`);const panel=page.getByRole('region',{name:'公开与分享'});await expect(panel.getByRole('button',{name:'重试读取分享链接'})).toBeVisible();
  await page.unroute(`**/api/v1/activities/${sampleActivity.id}/shares`);await panel.getByRole('button',{name:'重试读取分享链接'}).click();await expect(panel.getByText('尚无分享链接。')).toBeVisible();
  await panel.getByLabel('记录可见性').selectOption('unlisted');await panel.getByRole('button',{name:'保存可见性'}).click();await panel.getByRole('button',{name:'创建分享链接'}).click();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));await panel.getByRole('button',{name:'复制分享链接'}).click();await expect(panel.getByRole('alert')).toContainText('手动选择并复制');await expect(panel.getByLabel('新分享链接')).toHaveValue(/synthetic-token/);
});
