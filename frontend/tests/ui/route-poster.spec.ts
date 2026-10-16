import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sampleActivity, loginRunner } from '../fixtures/activities';

async function installPoster(page: Page, count = 251) {
  const state = { count, routeFailures: 0, hold: null as Promise<void> | null, summary401: false, emptyMonth: false,
    urls: [] as string[], active: 0, peak: 0 };
  await page.clock.setFixedTime(new Date('2026-10-16T01:00:00Z'));
  await page.route(/\/api\/v1\/(?:showcase\/(?:users\/[a-z0-9_]+\/)?)?(activities|statistics\/summary)(?:\?|\/|$)/, async route => {
    const url = new URL(route.request().url()); state.urls.push(url.pathname + url.search);
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: { data, error: status >= 400 ? { message: '路线读取失败' } : null } });
    const month = url.searchParams.get('activity_month') ?? url.searchParams.get('date_from')?.slice(0,7);
    const total = state.emptyMonth && month ? 0 : state.count;
    if (url.pathname.endsWith('/summary')) return send({ activity_count: total, distance_m: total ? 583200 : 0,
      duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: total, activity_days: Math.min(28,total),
      pace_eligible_count: 0, pace_eligible_distance_m: 0, avg_pace_seconds_per_km: null,
      quality_warning_count: 0, date_assignment: 'activity_local_date' }, state.summary401 ? 401 : 200);
    if (url.pathname.endsWith('/route')) {
      state.active++; state.peak = Math.max(state.peak, state.active);
      if (state.hold) await state.hold;
      state.active--;
      if (state.routeFailures-- > 0) return send(null, 503);
      const id = Number(url.pathname.split('/').at(-2)!.slice(-12));
      const shapes = [ [[0,0],[1,0],[1,1],[0,1],[0,0]], [[0,0],[.2,.8],[.6,1],[1,.8],[.8,.1],[0,0]],
        [[0,0],[.8,.3],[1,.8],[.4,1]], [[0,0],[.5,0],[.5,.5],[1,.5],[1,1]], [[0,.5],[.5,.8],[1,.5]] ];
      const coordinates = shapes[id % shapes.length].map(([x,y]) => [10+x*.01,20+y*.01]);
      return send({ type: 'FeatureCollection', start: coordinates[0], end: coordinates.at(-1), features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { segment_index: 0, point_count: coordinates.length } },
      ] });
    }
    if (url.pathname.endsWith('/activities')) {
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 20);
      return send({ items: Array.from({ length: Math.max(0, Math.min(limit, total-offset)) }, (_, i) => ({ ...sampleActivity,
        id: `11111111-1111-4111-8111-${String(offset+i).padStart(12,'0')}`, title: '不应导出的私人标题',
        activity_date: `${month ?? '2026-10'}-01`, has_route: offset+i !== 1 })), total, offset, limit });
    }
    return route.fallback();
  });
  return state;
}
const dialog = (page: Page) => page.getByRole('dialog', { name: '生成分享图' });
async function open(page: Page, path = '/activities/wall') {
  await page.goto(path);
  await page.getByRole('button', { name: '生成分享图', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
const generate = (page: Page) => dialog(page).getByRole('button', { name: '生成预览', exact: true }).click();
const preview = (page: Page) => dialog(page).getByRole('img', { name: '跑步足迹分享图预览' });

test('exports one PNG from random real routes across the whole range without missing-track placeholders', async ({page}, info) => {
  const state = await installPoster(page); await open(page); await generate(page);
  await expect(preview(page)).toBeVisible();
  await expect(dialog(page)).toContainText('583.2'); await expect(dialog(page)).toContainText('随机展示 120 / 250 条轨迹');
  await expect(dialog(page)).not.toContainText('无轨迹');
  await expect(dialog(page).getByRole('button',{name:'下一张',exact:true})).toHaveCount(0);
  const download = page.waitForEvent('download');
  await dialog(page).getByRole('button', {name:'保存 PNG',exact:true}).click();
  const result = await download, path = info.outputPath('route-poster.png'); await result.saveAs(path);
  const bytes = await readFile(path);
  expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  expect(bytes.readUInt32BE(16)).toBe(1080); expect(bytes.readUInt32BE(20)).toBe(1920);
  const colors = await preview(page).evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const context = canvas.getContext('2d')!; context.drawImage(image,0,0);
    const pixels = context.getImageData(0,450,1080,1050).data; let green = 0;
    for(let i=0;i<pixels.length;i+=4) if(pixels[i+1]>100 && pixels[i+1]>pixels[i]*1.5 && pixels[i+1]>pixels[i+2]*1.1) green++;
    return green;
  });
  expect(colors).toBeGreaterThan(20000);
  await dialog(page).screenshot({path:info.outputPath('dialog-desktop.png')});
  const prior = state.urls.length;
  const first = new Set(state.urls.filter(url=>url.endsWith('/route')));
  await dialog(page).getByRole('button',{name:'换一组轨迹',exact:true}).click();
  await expect(preview(page)).toBeVisible();
  const refreshed = state.urls.slice(prior);
  expect(refreshed.some(url=>url.includes('offset=200'))).toBe(true);
  expect(refreshed.filter(url=>url.endsWith('/route')).some(url=>!first.has(url))).toBe(true);
});

test('month changes invalidate old images and keyboard dismissal restores focus on mobile in both themes', async ({page}, info) => {
  await installPoster(page,12); await page.setViewportSize({width:390,height:844}); await open(page);
  for(const scheme of ['light','dark'] as const) {
    await page.emulateMedia({colorScheme:scheme}); await generate(page); await expect(preview(page)).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await dialog(page).screenshot({path:info.outputPath(`dialog-mobile-${scheme}.png`)});
  }
  await dialog(page).getByLabel('统计范围',{exact:true}).selectOption('month');
  await expect(preview(page)).toHaveCount(0);
  await expect(dialog(page).getByRole('button',{name:'保存 PNG',exact:true})).toBeDisabled();
  await dialog(page).getByLabel('选择月份',{exact:true}).fill('2024-02'); await generate(page);
  await expect(preview(page)).toBeVisible(); await expect(dialog(page)).toContainText('2024 年 2 月');
  await page.keyboard.press('Escape'); await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole('button',{name:'生成分享图',exact:true})).toBeFocused();
  await page.keyboard.press('Enter'); await expect(preview(page)).toHaveCount(0);
});

test('route failures block export, retry succeeds, and empty months remain honest', async ({page}) => {
  const state = await installPoster(page,5); await open(page); state.routeFailures = 1; await generate(page);
  await expect(dialog(page).getByRole('alert')).toContainText('路线读取失败');
  await expect(dialog(page).getByRole('button',{name:'保存 PNG',exact:true})).toBeDisabled();
  await generate(page); await expect(preview(page)).toBeVisible();
  state.emptyMonth = true; await dialog(page).getByLabel('统计范围',{exact:true}).selectOption('month'); await generate(page);
  await expect(dialog(page).getByRole('alert')).toContainText('没有跑步记录'); await expect(preview(page)).toHaveCount(0);
});

test('cancel discards pending responses and a new generation remains independent', async ({page}) => {
  const state = await installPoster(page,20); await open(page);
  let finish!:()=>void; state.hold = new Promise(resolve=>{finish=resolve;});
  await generate(page); await expect(dialog(page).getByRole('button',{name:'取消生成',exact:true})).toBeVisible();
  await dialog(page).getByRole('button',{name:'取消生成',exact:true}).click();
  state.hold = null;
  try { await generate(page); await expect(preview(page)).toBeVisible(); } finally { finish(); }
  await expect(preview(page)).toBeVisible();
  expect(state.peak).toBeLessThanOrEqual(8); // Old cancelled requests may still be in flight.
});

for(const path of ['/p/runner/activities/wall','/workspace/activities/wall']) {
  test(`uses the correct view context for ${path}`, async ({page}) => {
    const state = await installPoster(page,3);
    if(path.startsWith('/workspace')) await loginRunner(page);
    await open(page,path); const prior = state.urls.length; await generate(page); await expect(preview(page)).toBeVisible();
    const prefix = path.startsWith('/workspace')?'/api/v1/':'/api/v1/showcase/users/runner/';
    for(const url of state.urls.slice(prior)) expect(url.startsWith(prefix)).toBe(true);
    if(path.startsWith('/workspace')) expect(state.urls.slice(prior).every(url=>!url.includes('/showcase/'))).toBe(true);
  });
}

test('expired sessions clear the preview and return to the login entry', async ({page}) => {
  const state = await installPoster(page,3); await open(page); await generate(page); await expect(preview(page)).toBeVisible();
  state.summary401 = true; await generate(page); await expect(page).toHaveURL(/\/admin\?reason=expired/);
  await expect(preview(page)).toHaveCount(0);
});

test('shares the generated PNG from a user click and keeps the preview after cancellation', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async (data: ShareData)=>{
      const file = data.files![0];
      sessionStorage.setItem('poster-shared',JSON.stringify({ name:file.name, type:file.type, size:file.size, active:navigator.userActivation.isActive }));
      throw new DOMException('Cancelled','AbortError');
    }});
  });
  await installPoster(page,3); await open(page); await generate(page); await expect(preview(page)).toBeVisible();
  await dialog(page).getByRole('button',{name:'分享图片',exact:true}).click();
  const shared = JSON.parse(await page.evaluate(()=>sessionStorage.getItem('poster-shared')) ?? '{}');
  expect(shared).toMatchObject({name:'runnote-all.png',type:'image/png',active:true}); expect(shared.size).toBeGreaterThan(10000);
  await expect(preview(page)).toBeVisible(); await expect(dialog(page).getByRole('alert')).toHaveCount(0);
});

test('unavailable capability checks preserve a usable download fallback', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'share',{configurable:true,value:async ()=>{}});
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>{throw new Error('Unavailable');}});
  });
  await installPoster(page,3); await open(page); await generate(page);
  await expect(preview(page)).toBeVisible();
  await expect(dialog(page).getByRole('button',{name:'保存 PNG',exact:true})).toBeEnabled();
  await expect(dialog(page).getByRole('button',{name:'分享图片',exact:true})).toHaveCount(0);
});

test('cancelling aborts in-flight poster requests instead of accumulating old generations', async ({page}) => {
  const state = await installPoster(page,20); await open(page);
  await expect.poll(()=>state.active).toBe(0);
  let finish!:()=>void; state.hold = new Promise(resolve=>{finish=resolve;});
  const requested = page.waitForRequest(request=>request.url().endsWith('/route'));
  await generate(page); await requested;
  const aborted = page.waitForEvent('requestfailed',{predicate:request=>request.url().endsWith('/route'), timeout:3000});
  try {
    await dialog(page).getByRole('button',{name:'取消生成',exact:true}).click();
    expect((await aborted).failure()?.errorText).toContain('ERR_ABORTED');
  } finally { state.hold = null; finish(); }
  await expect(preview(page)).toHaveCount(0);
});

test('poster colors follow the actual UI theme without refetching or resampling routes', async ({page}, info) => {
  const state = await installPoster(page,121);
  await page.emulateMedia({colorScheme:'light'}); await open(page); await generate(page); await expect(preview(page)).toBeVisible();
  const pixel = () => preview(page).evaluate((img: HTMLImageElement) => {
    if(!img.complete || !img.naturalWidth) return null;
    const canvas=document.createElement('canvas'); canvas.width=1;canvas.height=1;
    const context=canvas.getContext('2d')!; context.drawImage(img,0,0);
    const value=context.getImageData(0,0,1,1).data;
    return `rgb(${value[0]}, ${value[1]}, ${value[2]})`;
  });
  await expect.poll(pixel).toBe(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor));
  const prior = state.urls.length;
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect.poll(pixel).toBe(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor));
  expect(state.urls.length).toBe(prior);
  await dialog(page).getByRole('button',{name:'保存 PNG',exact:true}).scrollIntoViewIfNeeded();
  const download=page.waitForEvent('download'); await dialog(page).getByRole('button',{name:'保存 PNG',exact:true}).click();
  await (await download).saveAs(info.outputPath('route-poster-dark.png'));
});
