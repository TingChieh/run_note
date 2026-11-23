import { test, expect, type Page } from '@playwright/test';
import { loginRunner, installActivities, sampleActivity } from '../fixtures/activities';
import { installPublic } from '../fixtures/p2';
async function responsive(page: Page, name: string) {
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width===390 || width===1440) { await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);}); await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))); await page.screenshot({path:`test-results/p2-${name}-${width}.png`});
      if(name==='share') await page.getByRole('region',{name:'旧版分享链接'}).screenshot({path:`test-results/p2-${name}-panel-${width}.png`}); }
  }
}
test('admin login native validation, password visibility, busy and failure retry, safe redirect',async({page})=>{
  await page.goto('/admin?next=https://example.com');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  expect(await page.locator('input[name=email]').evaluate(el=>(el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await page.getByLabel('邮箱',{exact:true}).fill('runner@example.com');
  await page.getByLabel('密码',{exact:true}).fill('Synthetic-ui-password-2026');
  await page.getByRole('button',{name:'显示密码',exact:true}).click();
  await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');
  await responsive(page,'admin');
  let release!:()=>void;const hold=new Promise<void>(r=>release=r);
  await page.route('**/api/v1/auth/login',async route=>{await hold;await route.fulfill({status:503,json:{error:{message:'登录失败，请重试'}}});});
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByLabel('邮箱',{exact:true})).toBeDisabled();release();
  await expect(page.getByRole('alert')).toContainText('登录失败');
  await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
  await page.unroute('**/api/v1/auth/login');
  await page.getByLabel('密码',{exact:true}).fill('Synthetic-ui-password-2026');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/$/);
});
test('settings separates draft from saved public state and saves with retry',async({page})=>{
  await loginRunner(page);await responsive(page,'settings');
  await page.getByLabel('昵称',{exact:true}).fill('新的跑者');
  await expect(page.getByText('有未保存的更改',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'保存个人资料',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'资料已保存'})).toBeVisible();
  await page.getByRole('navigation',{name:'设置分区'}).getByRole('link',{name:'目标与隐私',exact:true}).click();
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await page.getByRole('switch',{name:/公开个人主页/}).click();
  await expect(page.getByText('有未保存的更改',{exact:true})).toBeVisible();
  await page.route('**/api/v1/me',route=>route.fulfill({status:503,json:{error:{message:'保存暂时失败'}}}));
  await page.getByRole('button',{name:'保存隐私与功能设置',exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存暂时失败');
  await page.unroute('**/api/v1/me');await page.getByRole('button',{name:'保存隐私与功能设置',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'主页已开启'})).toBeVisible();
  await expect(page.getByText('有未保存的更改',{exact:true})).toHaveCount(0);
  await page.getByRole('switch',{name:/公开个人主页/}).click();await page.getByRole('button',{name:'保存隐私与功能设置',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'独立记录分享仍需单独撤销'})).toBeVisible();
});
test('AI assistant requires explicit first-use consent and streams reply',async({page})=>{
  await loginRunner(page);await page.goto('/ai');
  await expect(page.getByRole('heading',{level:1,name:'AI 助手',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'生成近期总结与下周建议'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/历史分析归档/})).toHaveCount(0);
  await expect(page.getByTestId('ai-consent-card')).toBeVisible();
  await expect(page.getByRole('button',{name:'同意并启用 AI 助手',exact:true})).toBeDisabled();
  await responsive(page,'ai-entry');
  await page.getByTestId('ai-consent-card').getByRole('checkbox').check();
  await page.getByRole('button',{name:'同意并启用 AI 助手',exact:true}).click();
  await expect(page.getByTestId('ai-consent-card')).toHaveCount(0);
  await page.getByRole('button',{name:/近 4 周趋势与建议/}).click();
  await expect(page.getByTestId('block-metrics-card')).toBeVisible();
  await expect(page.getByTestId('block-trend-chart')).toBeVisible();
  await expect(page.getByText(/42\.12 km/)).toBeVisible();
  await expect(page).toHaveURL(/\/ai$/);
});
test('AI assistant read failure recovers without calling provider',async({page})=>{
  await loginRunner(page);
  let failContext = true;
  await page.route('**/api/v1/ai-assistant/context', async route => {
    if (failContext) return route.fulfill({ status: 503, json: { data: null, error: { code: 'UNKNOWN_FAILURE', message: '模拟状态读取失败' } } });
    return route.fallback();
  });
  await page.goto('/ai');
  await expect(page.getByRole('alert').first()).toContainText('模拟状态读取失败');
  failContext = false;
  await page.getByRole('button',{name:'重试读取',exact:true}).click();
  await expect(page.getByTestId('ai-assistant-workbench')).toBeVisible();
});
test('AI assistant unavailable and quota exhaustion block sending cleanly',async({page})=>{
  await loginRunner(page);
  let configured = false;
  let remaining = 0;
  await page.route('**/api/v1/ai-assistant/context', route => route.fulfill({
    json: {
      data: {
        configured,
        enabled: true,
        model: configured ? 'deepseek-chat' : null,
        consent: { consented: true, consent_version: 'ai-assistant-v1', required_version: 'ai-assistant-v1', consented_at: '2026-11-22T00:00:00Z', revoked_at: null },
        quota: { daily_message_limit: 30, messages_today: 30 - remaining, remaining_messages_today: remaining, daily_token_budget: 150000, tokens_today: 0, remaining_tokens_today: 150000, site_daily_token_budget: 1000000, site_tokens_today: 0, site_budget_exhausted: false },
      },
      error: null,
    },
  }));
  await page.goto('/ai');
  await expect(page.getByTestId('ai-unavailable-banner')).toContainText('AI 助手尚未配置');
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
  configured = true;
  await page.reload();
  await expect(page.getByTestId('ai-unavailable-banner')).toContainText('今日个人提问次数已达上限');
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
});
test('removed public profile addresses are not found and share summaries stay coordinate-free',async({page})=>{
  const state=await installPublic(page);const privateReads:string[]=[];page.on('request',req=>{if(/\/api\/v1\/(activities|statistics|ai-assistant)(\/|\?|$)/.test(req.url()))privateReads.push(req.url());});
  const missing=await page.goto('/u/runner?year=2026');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading',{name:'页面不存在',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'数据汇总',exact:true})).toHaveAttribute('href','/');
  await expect(page.getByRole('button',{name:'重新读取主页'})).toHaveCount(0);
  await page.goto(`/public/activities/${sampleActivity.id}`);await expect(page.getByRole('heading',{name:'河畔晨跑'})).toBeVisible();await responsive(page,'public-detail');
  expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_.*SENTINEL/);expect(privateReads).toEqual([]);await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'查看作者公开主页'})).toHaveCount(0);
  state.closed=true;await page.reload();await expect(page.getByRole('heading',{name:'分享不可用'})).toBeVisible();await expect(page.getByText('5.1 km',{exact:true})).toHaveCount(0);
  state.closed=false;await page.goto('/shared/synthetic-token');await expect(page.getByRole('heading',{name:'河畔晨跑'})).toBeVisible();state.closed=true;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('heading',{name:'河畔晨跑'})).toHaveCount(0);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('heading',{name:'分享不可用'})).toBeVisible();
});
test('invalid share links are real 404 pages without a retry',async({page})=>{
  const response=await page.goto('/shared/invalidtoken');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading',{name:'页面不存在',exact:true})).toBeVisible();
  await expect(page.getByText('分享不存在或已停止',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'重新读取分享'})).toHaveCount(0);
  const activity=await page.goto('/public/activities/999999999');
  expect(activity?.status()).toBe(404);
  await expect(page.getByRole('button',{name:'重新读取分享'})).toHaveCount(0);
});
test('legacy share links can only be revoked',async({page})=>{
  const state=await installActivities(page);state.links=[{link_id:'33333333-3333-4333-8333-333333333333',created_at:'2026-10-13T02:00:00Z',expires_at:null,revoked_at:null,status:'active' as const}];await loginRunner(page);await page.goto(`/activities/${sampleActivity.id}`);
  const panel=page.getByRole('region',{name:'旧版分享链接'});await expect(panel.getByLabel('记录可见性')).toHaveCount(0);await expect(panel.getByRole('button',{name:'创建分享链接'})).toHaveCount(0);
  await responsive(page,'share');await panel.getByRole('button',{name:'撤销链接'}).click();await expect(panel.getByText(/已撤销/).first()).toBeVisible();
});
test('sharing read failure offers recovery',async({page})=>{
  await installActivities(page);await loginRunner(page);
  await page.route(`**/api/v1/activities/${sampleActivity.id}/shares`,route=>route.fulfill({status:503,json:{error:{message:'分享链接读取失败'}}}));
  await page.goto(`/activities/${sampleActivity.id}`);const panel=page.getByRole('region',{name:'旧版分享链接'});await expect(panel.getByRole('button',{name:'重试读取分享链接'})).toBeVisible();
  await page.unroute(`**/api/v1/activities/${sampleActivity.id}/shares`);await panel.getByRole('button',{name:'重试读取分享链接'}).click();await expect(panel).toHaveCount(0);
});
