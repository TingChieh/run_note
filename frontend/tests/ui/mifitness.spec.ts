import {expect,test,type Page} from '@playwright/test';
import {installActivities,loginRunner,sampleActivity} from '../fixtures/activities';
const source = (time=1791763200,track=false) => ({source_time:time,has_downloaded_track:track,source_metrics:{distance:3000,duration:1200,start_time:time,end_time:time+1200,max_cadence:5730,train_effect:0,account_id:'secret',download_url:'https://private.invalid'}});
const preview = {activity_date:'2026-10-12',timezone:'Asia/Shanghai',started_at:'2026-10-12T00:00:00Z',ended_at:'2026-10-12T00:20:00Z',distance_m:'3000',timer_seconds:'1200',elapsed_seconds:'1200',calories_kcal:null,steps:null,avg_heart_rate_bpm:null,max_heart_rate_bpm:180,min_heart_rate_bpm:null,avg_cadence_spm:'170',max_cadence_spm:null,vo2_max_ml_kg_min:'45',training_load:null,aerobic_training_effect:'0',anaerobic_training_effect:null,has_route:false,point_count:0,segment_count:0,warnings:['MIFITNESS_MAX_CADENCE_INVALID'],suspected_activity_ids:[]};
const jsonFile=(records:unknown[])=>({name:'running_summaries.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({records}))});
const region=(page:Page)=>page.getByRole('region',{name:'Mi Fitness 跑步导入',exact:true});
async function setup(page:Page){await installActivities(page);await loginRunner(page);await page.goto('/activities');}
test('preview precedes serial summary-only saves and shows server device warnings on desktop and mobile',async({page})=>{
  const events:string[]=[];let active=0,max=0;
  await page.route('**/api/v1/mifitness-imports**',async route=>{
    active++;max=Math.max(active,max);const body=route.request().postData()??'';expect(body).not.toContain('secret');expect(body).not.toContain('download_url');
    const isPreview=route.request().url().includes('preview=true');events.push(isPreview?'preview':'save');await new Promise(resolve=>setTimeout(resolve,30));active--;
    await route.fulfill({status:isPreview?200:201,json:{data:isPreview?preview:{activity:{...sampleActivity,...preview},warnings:[]}}});
  });
  await setup(page);const box=region(page);await box.getByLabel('跑步汇总 JSON').setInputFiles(jsonFile([source(),source(1791849600)]));
  await box.getByRole('button',{name:'预览所选记录'}).click();await expect(box.getByText('最大步频异常，已留空')).toHaveCount(2);expect(events).toEqual(['preview','preview']);
  await expect(box.getByText('设备估计')).toHaveCount(2);await expect(box.getByText('仅汇总（无轨迹）',{exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'导入预览成功的记录'}).focus();
  await page.screenshot({path:'test-results/mifitness-desktop-preview.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mifitness-mobile-preview.png',fullPage:true});
  await box.getByRole('button',{name:'导入预览成功的记录'}).click();await expect(box.getByText('成功 · 仅汇总')).toHaveCount(2);expect(max).toBe(1);expect(events).toEqual(['preview','preview','save','save']);
});
test('matching failure is visible and duplicate enrichment requires an explicit single-record action',async({page})=>{
  const writes:string[]=[];
  await page.route('**/api/v1/mifitness-imports**',async route=>{
    writes.push(route.request().postData()??'');if(writes.at(-1)?.includes('enrich_activity_id'))return route.fulfill({status:201,json:{data:{activity:{...sampleActivity,...preview},warnings:[]}}});
    return route.fulfill({status:409,json:{error:{code:'MIFITNESS_DUPLICATE',message:'记录已存在',details:[{existing_activity_id:sampleActivity.id,duplicate_kind:'record'}]}}});
  });
  await setup(page);const box=region(page);await box.getByLabel('跑步汇总 JSON').setInputFiles(jsonFile([source(undefined,true)]));await box.getByRole('button',{name:'预览所选记录'}).click();await expect(box.getByRole('alert')).toContainText('缺少');expect(writes).toHaveLength(0);
  await box.getByLabel('跑步汇总 JSON').setInputFiles(jsonFile([source()]));await box.getByRole('button',{name:'预览所选记录'}).click();await expect(box.getByRole('link',{name:'查看已有活动'})).toHaveAttribute('href',`/activities/${sampleActivity.id}`);expect(writes).toHaveLength(1);
  await box.getByRole('button',{name:'仅补充已有记录缺失指标'}).click();await expect(box.getByText('成功 · 仅汇总')).toBeVisible();expect(writes).toHaveLength(2);
});
test('similar records need individual confirmation and only failed records are retried',async({page})=>{
 let previews=0,saves=0;
 await page.route('**/api/v1/mifitness-imports**',async route=>{
   const body=route.request().postData()??'';
   if(route.request().url().includes('preview=true')){previews++;return route.fulfill({json:{data:{...preview,suspected_activity_ids:[sampleActivity.id]}}});}
   saves++;if(saves===1)return route.fulfill({status:503,json:{error:{message:'暂时无法保存'}}});
   expect(body).toContain('confirm_similar');return route.fulfill({status:201,json:{data:{activity:{...sampleActivity,...preview},warnings:[]}}});
 });
 await setup(page);const box=region(page);await box.getByLabel('跑步汇总 JSON').setInputFiles(jsonFile([source()]));await box.getByRole('button',{name:'预览所选记录'}).click();await expect(box.getByText('疑似重复，请逐条确认')).toBeVisible();expect(saves).toBe(0);
 await box.getByRole('button',{name:'仍要导入此条记录'}).click();await expect(box.getByText('暂时无法保存')).toBeVisible();await box.getByRole('button',{name:'仅重试失败记录'}).click();await expect(box.getByText('成功 · 仅汇总')).toBeVisible();expect(previews).toBe(1);expect(saves).toBe(2);
});
test('401 clears selected private summaries and returns to login',async({page})=>{
 await page.route('**/api/v1/mifitness-imports**',route=>route.fulfill({status:401,json:{error:{message:'expired'}}}));await setup(page);const box=region(page);await box.getByLabel('跑步汇总 JSON').setInputFiles(jsonFile([source()]));await box.getByRole('button',{name:'预览所选记录'}).click();await expect(page).toHaveURL(/\/login\?reason=expired/);await expect(page.getByText('1791763200')).toHaveCount(0);
});
test('exact track uploads retain the filename; failed enrichment retry keeps its explicit target',async({page})=>{
 const bodies:string[]=[];
 await page.route('**/api/v1/mifitness-imports**',async route=>{
  const body=route.request().postData()??'';bodies.push(body);
  expect(body).toContain('running_1791763200.gpx');
  if(bodies.length===1)return route.fulfill({status:409,json:{error:{code:'DUPLICATE',message:'已有此记录',details:[{existing_activity_id:sampleActivity.id,duplicate_kind:'canonical'}]}}});
  expect(body).toContain('enrich_activity_id');expect(body).toContain(sampleActivity.id);
  if(bodies.length===2)return route.fulfill({status:503,json:{error:{message:'补充暂时失败'}}});
  return route.fulfill({status:201,json:{data:{activity:{...sampleActivity,...preview,has_route:true},warnings:[]}}});
 });
 await setup(page);const box=region(page);await box.getByLabel('跑步汇总 JSON').setInputFiles(jsonFile([source(undefined,true)]));
 await box.getByLabel('匹配的 GPX 文件').setInputFiles({name:'running_1791763200.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from('<gpx version="1.1" creator="synthetic"/>')});
 await box.getByRole('button',{name:'预览所选记录'}).click();await box.getByRole('button',{name:'仅补充已有记录缺失指标'}).click();await expect(box.getByText('补充暂时失败')).toBeVisible();
 await box.getByRole('button',{name:'仅重试失败记录'}).click();await expect(box.getByText('成功',{exact:true})).toBeVisible();expect(bodies).toHaveLength(3);
});
test('private detail retains device metrics and zero ratings when opened from the compact dashboard',async({page})=>{
 const state=await installActivities(page);state.records[0]={...sampleActivity,...preview};await loginRunner(page);
 await page.goto(`/activities/${sampleActivity.id}`);const detail=page.getByRole('region',{name:'设备指标',exact:true});await expect(detail).toContainText('180');await expect(detail).toContainText('设备估计');await expect(detail).toContainText('有氧训练效果0');await expect(page.getByText('此活动没有路线。',{exact:true})).toBeVisible();
 await page.goto('/dashboard');const explorer=page.getByRole('region',{name:'运动足迹',exact:true});
 await expect(explorer.getByRole('region',{name:'设备指标',exact:true})).toHaveCount(0);
 const link=explorer.getByRole('link',{name:/活动详情/});await expect(link).toHaveAttribute('href',`/activities/${sampleActivity.id}`);await link.click();
 await expect(detail).toContainText('最大摄氧量');await expect(detail).toContainText('小米评分（0–5）');await expect(detail).toContainText('有氧训练效果0');
});
test('busy controls prevent another submission and leaving the page discards the pending batch',async({page})=>{
 let release!:()=>void,entered!:()=>void,calls=0;
 const held=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
 await page.route('**/api/v1/mifitness-imports**',async route=>{calls++;entered();await held;await route.fulfill({json:{data:preview}}).catch(()=>{});});
 await setup(page);const box=region(page);await box.getByLabel('跑步汇总 JSON').setInputFiles(jsonFile([source(),source(1791849600)]));await box.getByRole('button',{name:'预览所选记录'}).click();await started;
 await expect(box.getByRole('button',{name:'预览所选记录'})).toBeDisabled();await expect(box.getByLabel('跑步汇总 JSON')).toBeDisabled();await expect(box.getByLabel('匹配的 GPX 文件')).toBeDisabled();await expect(page.getByRole('button',{name:'导入 GPX',exact:true})).toBeDisabled();
 await page.goto('/settings');release();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();expect(calls).toBe(1);await expect(page.getByText('2026-10-12',{exact:true})).toHaveCount(0);
});
