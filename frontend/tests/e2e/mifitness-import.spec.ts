import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const start = Date.parse('2026-10-12T00:00:00Z') / 1000;
const record = (time: number, hasTrack: boolean) => ({
  source_time: time, has_downloaded_track: hasTrack,
  source_metrics: {
    start_time: time, end_time: time + 1200, distance: 3000, duration: 1100,
    avg_hrm: 156, max_hrm: 180, min_hrm: null as number | null, avg_cadence: 170, max_cadence: 5730,
    vo2_max: 45, train_load: 80, train_effect: 0, anaerobic_train_effect: 1,
    account_id: 'must-stay-local', download_url: 'https://private.invalid/never-upload'
  }
});
const summaries = (records: ReturnType<typeof record>[]) => ({ name: 'running_summaries.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ records })) });
const track = {
  name: `running_${start}.gpx`, mimeType: 'application/gpx+xml',
  buffer: Buffer.from(`<gpx version="1.1" creator="synthetic"><trk><trkseg>${[0,1,2].map(i => `<trkpt lat="0" lon="${i * .001}"><time>${new Date((start + 1 + i * 599) * 1000).toISOString()}</time></trkpt>`).join('')}</trkseg></trk></gpx>`)
};

test('real Mi Fitness preview, track and summary save, record duplicates and explicit enrichment persist privately', async ({ page, context }) => {
  test.setTimeout(90000);
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort());
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const unique = randomUUID().replaceAll('-', '').slice(0,18);
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(`${unique}@example.com`);
  await page.getByLabel('用户名', { exact: true }).fill(`u_${unique}`);
  await page.getByLabel('密码', { exact: true }).fill(`${randomUUID()}aA9!`);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/activities');
  const box = page.getByRole('region', { name: 'Mi Fitness 跑步导入', exact: true });
  const original = [record(start,true),record(start + 86400,false)];
  await box.getByLabel('跑步汇总 JSON').setInputFiles(summaries(original));
  await box.getByLabel('匹配的 GPX 文件').setInputFiles(track);
  await box.getByLabel('Mi Fitness 时区（可选）').fill('Asia/Shanghai');
  await box.getByRole('button', { name: '预览所选记录' }).click();
  await expect(box.getByText('预览成功', { exact: true })).toHaveCount(2, { timeout: 30000 });
  await expect(box.getByText('最大步频异常，已留空')).toHaveCount(2);
  await expect(box.getByText('仅汇总（无轨迹）', { exact: true })).toHaveCount(1);
  expect((await (await context.request.get('/api/v1/activities')).json()).data.total).toBe(0);
  await box.getByRole('button', { name: '导入预览成功的记录' }).click();
  await expect(box.getByText('成功 · 仅汇总', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(box.getByText('成功', { exact: true })).toBeVisible();
  const rows = box.locator('ol > li');
  const routeHref = await rows.filter({ hasText: '2026-10-12' }).getByRole('link', { name: '查看已导入活动' }).getAttribute('href');
  const summaryHref = await rows.filter({ hasText: '2026-10-13' }).getByRole('link', { name: '查看已导入活动' }).getAttribute('href');
  expect(routeHref).toMatch(/^\/activities\/[0-9a-f-]{36}$/); expect(summaryHref).toMatch(/^\/activities\/[0-9a-f-]{36}$/);
  const list = (await (await context.request.get('/api/v1/activities')).json()).data;
  expect(list.total).toBe(2);
  for (const item of list.items) { expect(item.visibility).toBe('private'); expect(item.max_cadence_spm).toBeNull(); expect(Number(item.aerobic_training_effect)).toBe(0); }

  // The same source identity must be surfaced as a duplicate; enrichment is an explicit action.
  const corrected = original.map(item => ({ ...item, source_metrics: { ...item.source_metrics, max_cadence: 190, min_hrm: 110, vo2_max: 99, distance: 8000, duration: 1000 } }));
  await box.getByLabel('跑步汇总 JSON').setInputFiles(summaries(corrected));
  await box.getByRole('button', { name: '预览所选记录' }).click();
  await expect(box.getByText('重复', { exact: true })).toHaveCount(2, { timeout: 30000 });
  await expect(box.getByRole('link', { name: '查看已有活动' })).toHaveCount(2);
  for (const date of ['2026-10-12','2026-10-13']) {
    const row = rows.filter({ hasText: date === '2026-10-12' ? String(start) : String(start+86400) });
    await row.getByRole('button', { name: '仅补充已有记录缺失指标' }).click();
    await expect(row.getByRole('link', { name: '查看已导入活动' })).toBeVisible({ timeout: 30000 });
  }
  expect((await (await context.request.get('/api/v1/activities')).json()).data.total).toBe(2);
  for (const href of [routeHref!,summaryHref!]) {
    const item = (await (await context.request.get('/api/v1' + href)).json()).data;
    expect(Number(item.max_cadence_spm)).toBe(190); expect(item.min_heart_rate_bpm).toBe(110);
    expect(Number(item.vo2_max_ml_kg_min)).toBe(45); expect(Number(item.distance_m)).toBe(3000); expect(Number(item.timer_seconds)).toBe(1100);
    await page.goto(href); await page.reload();
    const metrics = page.getByRole('region', { name: '设备指标', exact: true });
    await expect(metrics).toContainText('190'); await expect(metrics).toContainText('110'); await expect(metrics).toContainText('设备估计');
    if (href === routeHref) await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
    else { await expect(page.getByText('此活动没有路线。', { exact: true })).toBeVisible(); await expect(page.getByTestId('route-map-ready')).toHaveCount(0); }
  }
  expect(errors).toEqual([]);
});
