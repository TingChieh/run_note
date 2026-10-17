import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
// Share images are owner-only; the synthetic runner is the site owner.
async function visit(page: Page, path = '/activities/wall') {
  await loginRunner(page);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: '足迹墙', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
}
async function reopen(page: Page) {
  await page.getByRole('button', { name: '生成分享图', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function open(page: Page, path = '/activities/wall') { await visit(page, path); await reopen(page); }
// Opening the dialog reads the viewer's own data automatically; this waits for the real preview.
const generate = (page: Page) => expect(preview(page)).toBeVisible();
const preview = (page: Page) => dialog(page).getByRole('img', { name: '跑步足迹分享图预览' });
const sample = (page: Page) => dialog(page).getByRole('img', { name: '分享图示例（非你的数据）' });
const loadOwn = (page: Page) => dialog(page).getByRole('button', { name: '读取我的数据', exact: true });

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
  // The previous image stays visible while the new sample loads.
  await expect.poll(()=>state.urls.slice(prior).filter(url=>url.endsWith('/route')).length).toBe(120);
  await expect(dialog(page).locator('.poster-preview')).toHaveAttribute('aria-busy','false');
  await expect(preview(page)).toBeVisible();
  const refreshed = state.urls.slice(prior);
  expect(refreshed.some(url=>url.includes('offset=200'))).toBe(true);
  expect(refreshed.filter(url=>url.endsWith('/route')).some(url=>!first.has(url))).toBe(true);
});

test('month changes reload automatically, keyboard dismissal restores focus and reopening reuses data', async ({page}, info) => {
  const state = await installPoster(page,12); await page.setViewportSize({width:390,height:844}); await open(page);
  for(const scheme of ['light','dark'] as const) {
    await page.emulateMedia({colorScheme:scheme}); await generate(page); await expect(preview(page)).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await dialog(page).screenshot({path:info.outputPath(`dialog-mobile-${scheme}.png`)});
  }
  await dialog(page).getByLabel('统计范围',{exact:true}).selectOption('month');
  await expect(dialog(page)).toContainText('2026 年 10 月');
  await dialog(page).getByLabel('统计月份',{exact:true}).fill('2024-02'); await generate(page);
  await expect(preview(page)).toBeVisible(); await expect(dialog(page)).toContainText('2024 年 2 月');
  await page.keyboard.press('Escape'); await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole('button',{name:'生成分享图',exact:true})).toBeFocused();
  // Reopening the same range reuses the cached sample instead of querying again.
  const requests = [...state.urls];
  await page.keyboard.press('Enter'); await expect(preview(page)).toBeVisible();
  await expect(dialog(page)).toContainText('2024 年 2 月');
  expect(state.urls).toEqual(requests);
});

test('route failures block export, retry succeeds, and empty months remain honest', async ({page}) => {
  const state = await installPoster(page,5); await visit(page); state.routeFailures = 1; await reopen(page);
  await expect(dialog(page).getByRole('alert')).toContainText('路线读取失败');
  await expect(sample(page)).toBeVisible(); await expect(preview(page)).toHaveCount(0);
  await expect(dialog(page).getByRole('button',{name:'保存 PNG',exact:true})).toBeDisabled();
  await loadOwn(page).click(); await expect(preview(page)).toBeVisible();
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  state.emptyMonth = true; await dialog(page).getByLabel('统计范围',{exact:true}).selectOption('month');
  await expect(dialog(page).getByRole('alert')).toContainText('没有跑步记录'); await expect(preview(page)).toHaveCount(0);
  await expect(sample(page)).toBeVisible();
  await expect(dialog(page).getByRole('button',{name:'保存 PNG',exact:true})).toBeDisabled();
});

test('cancel discards pending responses and a new generation remains independent', async ({page}) => {
  const state = await installPoster(page,20); await visit(page);
  let finish!:()=>void; state.hold = new Promise(resolve=>{finish=resolve;});
  await reopen(page); await expect(dialog(page).getByRole('button',{name:'取消读取',exact:true})).toBeVisible();
  await dialog(page).getByRole('button',{name:'取消读取',exact:true}).click();
  await expect(sample(page)).toBeVisible();
  state.hold = null;
  try { await loadOwn(page).click(); await expect(preview(page)).toBeVisible(); } finally { finish(); }
  await expect(preview(page)).toBeVisible();
  expect(state.peak).toBeLessThanOrEqual(8); // Old cancelled requests may still be in flight.
});

for(const path of ['/activities/wall','/p/runner/activities/wall','/workspace/activities/wall']) {
  test(`reads only the authenticated own-data API from ${path}`, async ({page}) => {
    const state = await installPoster(page,3);
    await visit(page,path); const prior = state.urls.length; await reopen(page); await generate(page);
    const poster = state.urls.slice(prior);
    expect(poster.length).toBeGreaterThan(0);
    for(const url of poster) { expect(url.startsWith('/api/v1/')).toBe(true); expect(url).not.toContain('/showcase/'); }
  });
}

test('expired sessions clear the preview and return to the login entry', async ({page}) => {
  const state = await installPoster(page,3); await open(page); await generate(page); await expect(preview(page)).toBeVisible();
  state.summary401 = true; await dialog(page).getByLabel('统计范围',{exact:true}).selectOption('month');
  await expect(page).toHaveURL(/\/admin\?reason=expired/);
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
  const state = await installPoster(page,20); await visit(page);
  await expect.poll(()=>state.active).toBe(0);
  let finish!:()=>void; state.hold = new Promise(resolve=>{finish=resolve;});
  const requested = page.waitForRequest(request=>request.url().endsWith('/route'));
  await reopen(page); await requested;
  const aborted = page.waitForEvent('requestfailed',{predicate:request=>request.url().endsWith('/route'), timeout:3000});
  try {
    await dialog(page).getByRole('button',{name:'取消读取',exact:true}).click();
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

const layouts = ['经典足迹', '极简画廊', '运动海报', '足迹手账'];
for (const theme of ['light', 'dark'] as const) {
  test(`four poster layouts export distinct PNGs from the same sample in ${theme}`, async ({page}, info) => {
    await page.emulateMedia({colorScheme:theme});
    const state = await installPoster(page,121); await open(page);
    await expect(dialog(page).getByRole('radio',{name:'经典足迹',exact:true})).toBeChecked();
    await generate(page); await expect(preview(page)).toBeVisible();
    const requests = [...state.urls], hashes = new Set<string>();
    for (const [index,name] of layouts.entries()) {
      if (index) {
        const previous = await preview(page).getAttribute('src');
        await dialog(page).getByRole('radio',{name,exact:true}).check();
        await expect(preview(page)).not.toHaveAttribute('src',previous!);
      }
      await expect(dialog(page).getByRole('button',{name:'保存 PNG',exact:true})).toBeEnabled();
      await expect(preview(page)).toBeVisible();
      const download = page.waitForEvent('download');
      await dialog(page).getByRole('button',{name:'保存 PNG',exact:true}).click();
      const path = info.outputPath(`poster-${index}-${theme}.png`);
      await (await download).saveAs(path);
      const bytes = await readFile(path);
      expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
      expect(bytes.readUInt32BE(16)).toBe(1080); expect(bytes.readUInt32BE(20)).toBe(1920);
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
      const pixels = await preview(page).evaluate((img:HTMLImageElement) => {
        const canvas = document.createElement('canvas');canvas.width=1080;canvas.height=1920;
        const ctx = canvas.getContext('2d')!;ctx.drawImage(img,0,0);
        const background = ctx.getImageData(0,0,1,1).data;
        const footer = ctx.getImageData(0,1888,1080,32).data;
        let footerMarks=0, routePixels=0;
        for(let i=0;i<footer.length;i+=4) if(footer[i]!==background[0] || footer[i+1]!==background[1] || footer[i+2]!==background[2]) footerMarks++;
        const routes = ctx.getImageData(80,560,920,940).data;
        for(let i=0;i<routes.length;i+=4) if(routes[i+1]>100 && routes[i+1]>routes[i]*1.5 && routes[i+1]>routes[i+2]*1.1) routePixels++;
        return {footerMarks,routePixels};
      });
      expect(pixels.footerMarks).toBe(0);
      expect(pixels.routePixels).toBeGreaterThan(2000);
      expect(state.urls).toEqual(requests);
    }
    expect(hashes.size).toBe(4);
    await dialog(page).screenshot({path:info.outputPath(`styles-desktop-${theme}.png`)});
  });
}

test('styles preview instantly while loading, and route-free styles only read totals',async ({page},info) => {
  const state=await installPoster(page,12);await visit(page);
  let finish!:()=>void;state.hold=new Promise(resolve=>{finish=resolve;});
  try {
    await reopen(page);
    await expect(sample(page)).toBeVisible();
    await expect(dialog(page)).toContainText('示例效果，非你的数据');
    await expect(dialog(page).getByRole('button',{name:'保存 PNG',exact:true})).toBeDisabled();
    await expect(dialog(page).getByRole('button',{name:'取消读取',exact:true})).toBeVisible();
    await expect.poll(()=>state.urls.filter(url=>url.endsWith('/route')).length).toBeGreaterThan(0);
    await dialog(page).screenshot({path:info.outputPath('sample-while-loading.png')});
    const during=[...state.urls];
    // Controls stay usable during loading; each click redraws the sample locally without new requests.
    for(const name of ['极简画廊','大字里程','动感斜纹']) {
      const option=dialog(page).getByRole('radio',{name,exact:true});
      await expect(option).toBeEnabled();
      const previous=await sample(page).getAttribute('src');
      await option.check();
      await expect(sample(page)).not.toHaveAttribute('src',previous!);
    }
    expect(state.urls.filter(url=>!during.includes(url))).toEqual([]);
    await dialog(page).getByRole('button',{name:'取消读取',exact:true}).click();
    await expect(loadOwn(page)).toBeVisible();
  } finally {state.hold=null;finish();}
  await expect.poll(()=>state.active).toBe(0);
  // A route-free style only needs the totals: exactly one summary request.
  const prior=state.urls.length;
  await loadOwn(page).click(); await generate(page);
  expect(state.urls.slice(prior)).toEqual(['/api/v1/statistics/summary']);
  await dialog(page).getByRole('radio',{name:'极简画廊',exact:true}).check();
  // Switching to a route style fetches the route sample once, then shows it.
  await expect.poll(()=>state.urls.slice(prior).filter(url=>url.endsWith('/route')).length).toBe(11);
  await expect(dialog(page)).toContainText('随机展示 11 / 11 条轨迹');
  await dialog(page).getByLabel('统计范围',{exact:true}).selectOption('month');
  await expect(dialog(page)).toContainText('2026 年 10 月');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'生成分享图',exact:true}).click();
  await expect(dialog(page).getByRole('radio',{name:'极简画廊',exact:true})).toBeChecked();
});

test('sparse poster layouts remain usable with keyboard selection on narrow screens',async ({page},info) => {
  await installPoster(page,1);await page.setViewportSize({width:320,height:780});await open(page);
  await generate(page);await expect(preview(page)).toBeVisible();
  await dialog(page).getByRole('radio',{name:'经典足迹',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog(page).getByRole('radio',{name:'极简画廊',exact:true})).toBeChecked();
  for(const width of [320,390]) {
    await page.setViewportSize({width,height:844});
    for(const [index,name] of layouts.entries()) {
      const option=dialog(page).getByRole('radio',{name,exact:true});
      await expect(option).toBeEnabled();
      const previous=await preview(page).getAttribute('src');
      await option.check();
      await expect(preview(page)).not.toHaveAttribute('src',previous!);
      await expect(dialog(page)).toContainText('随机展示 1 / 1 条轨迹');
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect.poll(()=>preview(page).evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth===1080)).toBe(true);
      if(width===390) {
        const download=page.waitForEvent('download');
        await dialog(page).getByRole('button',{name:'保存 PNG',exact:true}).click();
        await (await download).saveAs(info.outputPath(`sparse-${index}.png`));
      }
    }
    await dialog(page).screenshot({path:info.outputPath(`styles-mobile-${width}.png`)});
  }
});

const plainLayouts = ['大字里程', '跑步票根', '半马勋章', '动感斜纹'];
for (const theme of ['light', 'dark'] as const) {
  test(`route-free poster layouts export distinct PNGs without refetching in ${theme}`, async ({page}, info) => {
    await page.emulateMedia({colorScheme:theme});
    const state = await installPoster(page,121); await open(page);
    await generate(page); await expect(preview(page)).toBeVisible();
    const requests = [...state.urls], hashes = new Set<string>();
    for (const [index,name] of plainLayouts.entries()) {
      const previous = await preview(page).getAttribute('src');
      await dialog(page).getByRole('radio',{name,exact:true}).check();
      await expect(preview(page)).not.toHaveAttribute('src',previous!);
      await expect(dialog(page)).not.toContainText('随机展示');
      await expect(dialog(page).getByRole('button',{name:'换一组轨迹',exact:true})).toHaveCount(0);
      await expect(dialog(page)).toContainText('图片只包含统计数字，不含路线形状。');
      const download = page.waitForEvent('download');
      await dialog(page).getByRole('button',{name:'保存 PNG',exact:true}).click();
      const path = info.outputPath(`plain-${index}-${theme}.png`);
      await (await download).saveAs(path);
      const bytes = await readFile(path);
      expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
      expect(bytes.readUInt32BE(16)).toBe(1080); expect(bytes.readUInt32BE(20)).toBe(1920);
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
      const footerMarks = await preview(page).evaluate((img:HTMLImageElement) => {
        const canvas = document.createElement('canvas');canvas.width=1080;canvas.height=1920;
        const ctx = canvas.getContext('2d')!;ctx.drawImage(img,0,0);
        const background = ctx.getImageData(0,0,1,1).data, footer = ctx.getImageData(0,1888,1080,32).data;
        let marks=0;
        for(let i=0;i<footer.length;i+=4) if(footer[i]!==background[0] || footer[i+1]!==background[1] || footer[i+2]!==background[2]) marks++;
        return marks;
      });
      expect(footerMarks).toBe(0);
      expect(state.urls).toEqual(requests);
    }
    expect(hashes.size).toBe(4);
    await dialog(page).getByRole('radio',{name:'经典足迹',exact:true}).check();
    await expect(dialog(page)).toContainText('随机展示 120 / 120 条轨迹');
    await expect(dialog(page).getByRole('button',{name:'换一组轨迹',exact:true})).toBeVisible();
    expect(state.urls).toEqual(requests);
    await dialog(page).screenshot({path:info.outputPath(`plain-dialog-${theme}.png`)});
  });
}

test('poster appearance can be fixed to day or night independently of the site theme', async ({page}, info) => {
  const state = await installPoster(page,121);
  await page.emulateMedia({colorScheme:'light'}); await open(page);
  await expect(dialog(page).getByRole('radio',{name:'跟随网站',exact:true})).toBeChecked();
  await generate(page); await expect(preview(page)).toBeVisible();
  const colors = () => preview(page).evaluate((img: HTMLImageElement) => {
    if(!img.complete || !img.naturalWidth) return null;
    const canvas=document.createElement('canvas'); canvas.width=1080;canvas.height=1920;
    const context=canvas.getContext('2d')!; context.drawImage(img,0,0);
    const at=(x:number,y:number)=>{const v=context.getImageData(x,y,1,1).data;return `${v[0]},${v[1]},${v[2]}`;};
    return {background:at(0,0), surface:at(60,700), heading:at(1000,140)};
  });
  const day = {background:'246,247,244', surface:'255,255,255', heading:'245,197,25'};
  const night = {background:'16,26,22', surface:'27,41,34', heading:'88,71,30'};
  await expect.poll(colors).toEqual(day);
  const requests = [...state.urls];
  const choose = async (name: string) => {
    const previous = await preview(page).getAttribute('src');
    await dialog(page).getByRole('radio',{name,exact:true}).check();
    await expect(preview(page)).not.toHaveAttribute('src',previous!);
  };
  await choose('夜间');
  await expect.poll(colors).toEqual(night);
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const download=page.waitForEvent('download'); await dialog(page).getByRole('button',{name:'保存 PNG',exact:true}).click();
  await (await download).saveAs(info.outputPath('night-on-light-site.png'));
  // A fixed choice ignores later site theme changes.
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect.poll(colors).toEqual(night);
  await choose('日间');
  await expect.poll(colors).toEqual(day);
  await choose('跟随网站');
  await expect.poll(colors).toEqual(night);
  // Route-free styles use the same appearance choice.
  await dialog(page).getByRole('radio',{name:'日间',exact:true}).check();
  await choose('跑步票根');
  await expect.poll(async()=>(await colors())?.background).toBe(day.background);
  expect(state.urls).toEqual(requests);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'生成分享图',exact:true}).click();
  await expect(dialog(page).getByRole('radio',{name:'日间',exact:true})).toBeChecked();
  await dialog(page).screenshot({path:info.outputPath('appearance-dialog.png')});
});

test('month scope uses the shared calendar picker with keyboard selection inside the dialog', async ({page}, info) => {
  await installPoster(page,12); await open(page);
  await dialog(page).getByLabel('统计范围',{exact:true}).selectOption('month');
  const field = dialog(page).getByLabel('统计月份',{exact:true});
  await expect(field).toHaveAttribute('type','month');
  await expect(field).toHaveValue('2026-10');
  await generate(page); await expect(preview(page)).toBeVisible();
  const trigger = dialog(page).getByRole('button',{name:'选择统计月份',exact:true});
  await trigger.click();
  const calendar = page.getByRole('dialog',{name:'选择统计月份',exact:true});
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole('button',{name:'2026年10月',exact:true})).toBeFocused();
  await expect(calendar.getByRole('button',{name:'2026年10月',exact:true})).toHaveAttribute('aria-pressed','true');
  await calendar.screenshot({path:info.outputPath('month-calendar.png')});
  await calendar.getByRole('button',{name:'2026年3月',exact:true}).click();
  await expect(calendar).not.toBeVisible();
  await expect(field).toHaveValue('2026-03');
  await expect(trigger).toBeFocused();
  await expect(dialog(page)).toContainText('2026 年 3 月');
  // Keyboard: ArrowUp moves one row (3 months), PageUp one year; Escape closes only the calendar.
  await page.keyboard.press('Enter');
  await expect(calendar.getByRole('button',{name:'2026年3月',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('PageUp');
  await expect(calendar.getByRole('button',{name:'2025年2月',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(calendar).not.toBeVisible(); await expect(dialog(page)).toBeVisible(); await expect(trigger).toBeFocused();
  await expect(field).toHaveValue('2026-03');
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('PageUp'); await page.keyboard.press('Enter');
  await expect(field).toHaveValue('2025-02');
  await generate(page); await expect(dialog(page)).toContainText('2025 年 2 月');
  await page.setViewportSize({width:320,height:700});
  await trigger.click(); await expect(calendar).toHaveCSS('opacity','1');
  const box = await calendar.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(320);
  await page.screenshot({path:info.outputPath('month-calendar-320.png')});
});

const wallReady = (page: Page) => expect(page.getByRole('heading',{name:'足迹墙',exact:true})).toBeVisible();
const posterButton = (page: Page) => page.getByRole('button',{name:'生成分享图',exact:true});

test('anonymous visitors cannot create share images on any showcase wall', async ({page}) => {
  const state = await installPoster(page,3);
  for(const path of ['/activities/wall','/p/runner/activities/wall']) {
    await page.goto(path); await wallReady(page);
    await expect(posterButton(page)).toHaveCount(0);
    await expect(page.getByRole('dialog',{name:'生成分享图'})).toHaveCount(0);
  }
  expect(state.urls.some(url=>url.includes('/route'))).toBe(false);
  const anonymous = await page.request.get('/api/v1/statistics/summary');
  expect(anonymous.status()).toBe(401);
});

test('signed-in accounts can only share their own records', async ({page, browser}) => {
  await installPoster(page,3); await loginRunner(page);
  const username = `ui_poster_${Date.now().toString(36)}`;
  const created = await page.request.post('/api/v1/admin/users', {
    headers: { Origin: 'http://127.0.0.1:5191', 'X-CSRF-Token': 'ui-csrf' },
    data: { email: `${username}@example.com`, username, display_name: '合成跑者', timezone: 'Asia/Shanghai', password: 'Synthetic-only-password', is_active: true, showcase_enabled: true },
  });
  expect(created.status()).toBe(201);
  // The site owner cannot share another account's named showcase.
  await page.goto(`/p/${username}/activities/wall`); await wallReady(page);
  await expect(posterButton(page)).toHaveCount(0);
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    const state = await installPoster(other,3);
    await other.goto('/admin');
    await other.getByLabel('邮箱',{exact:true}).fill(`${username}@example.com`);
    await other.getByLabel('密码',{exact:true}).fill('Synthetic-only-password');
    await other.getByRole('button',{name:'登录',exact:true}).click();
    await expect.poll(()=>new URL(other.url()).pathname).toBe('/workspace/dashboard');
    for(const path of ['/activities/wall','/p/runner/activities/wall']) {
      await other.goto(path); await wallReady(other);
      await expect(posterButton(other)).toHaveCount(0);
    }
    for(const path of [`/p/${username}/activities/wall`,'/workspace/activities/wall']) {
      await other.goto(path); await wallReady(other);
      await other.waitForLoadState('networkidle');
      const prior = state.urls.length;
      await posterButton(other).click();
      await expect(other.getByRole('img',{name:'跑步足迹分享图预览'})).toBeVisible();
      for(const url of state.urls.slice(prior)) expect(url).not.toContain('/showcase/');
      await other.keyboard.press('Escape');
    }
  } finally { await context.close(); }
});
