import { expect, login, test } from './support/fixtures';
import { apiPath, importTrack } from './support/tracks';

const points = Array.from({ length: 21 }, (_, i) => {
  const time = new Date(Date.UTC(2026, 9, 4, 16, 15, 20) + Math.round((i * 1322) / 20) * 1000).toISOString();
  return `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>${i * 0.001}</LongitudeDegrees></Position></Trackpoint>`;
}).join('');
const raw = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" creator="Mi Fitness"><Activities><Activity Sport=""><Lap><TotalTimeSeconds>1166</TotalTimeSeconds><DistanceMeters>2999</DistanceMeters><Calories>144</Calories><HeartRateBpm>156</HeartRateBpm><Steps>3262</Steps><Track>${points}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
const file = { name: 'synthetic.tcx', mimeType: 'application/xml', buffer: Buffer.from(raw) };

test('a Mi Fitness TCX read as local time keeps its device metrics, and the server owns the totals', async ({
  page,
  context,
  member,
}) => {
  await login(page, member, '/workspace/activities');
  const path = await importTrack(page, file, async (form) => {
    await form.getByLabel('时间解释', { exact: true }).selectOption('local');
    await form.getByText('补充导入信息', { exact: true }).click();
    await form.getByLabel('时区（可选）', { exact: true }).fill('Asia/Shanghai');
  });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: '跑步 · 2026-10-04', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('156 bpm', { exact: true })).toBeVisible();
  await expect(page.getByText('16:15:20 · Asia/Shanghai', { exact: true })).toBeVisible();
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  await page.reload();
  await expect(page.getByText('156 bpm', { exact: true })).toBeVisible();

  const stored = (await (await context.request.get(apiPath(path))).json()).data;
  expect(stored).toMatchObject({
    activity_date: '2026-10-04',
    timezone: 'Asia/Shanghai',
    avg_heart_rate_bpm: 156,
    steps: 3262,
    calories_kcal: 144,
  });
  // Distance and pace come from the server's aggregation, not the browser (AGENTS.md section 3).
  const summary = (await (await context.request.get('/api/v1/statistics/summary')).json()).data;
  expect(Number(summary.distance_m)).toBe(2999);
  expect(Number(summary.duration_sum_seconds)).toBe(1166);
  expect(Number(summary.avg_pace_seconds_per_km)).toBe(388.796);

  const forged = await context.request.post('/api/v1/tcx-imports', {
    headers: { Origin: 'https://evil.example' },
    multipart: { file },
  });
  expect(forged.status()).toBe(403);
});
