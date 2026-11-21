import { expect, login, test } from './support/fixtures';
import { importTrack } from './support/tracks';

function datedTcx(startIso: string, seconds: number, metres: number, name: string) {
  const startMs = Date.parse(startIso);
  const endIso = new Date(startMs + seconds * 1000).toISOString().replace('.000', '');
  const point = (time: string, lon: number) =>
    `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position></Trackpoint>`;
  const xml =
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities>' +
    `<Activity Sport="Running"><Lap><TotalTimeSeconds>${seconds}</TotalTimeSeconds><DistanceMeters>${metres}</DistanceMeters>` +
    `<Track>${point(startIso, 0)}${point(endIso, 0.001)}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  return { name, mimeType: 'application/xml', buffer: Buffer.from(xml) };
}

function gate() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}

test('signed-in member period reports keep period consistency during delays, isolate accounts, and stay off anonymous showcase', async ({
  page,
  member,
  ownerApi,
}) => {
  // Anonymous visitor sees existing public /records without period report UI or anonymous report APIs.
  const anonymousReportRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/statistics/report')) anonymousReportRequests.push(req.url());
  });
  await page.goto('/records');
  await expect(page.locator('[data-testid="records-ready"], [data-testid="records-empty"]').first()).toBeVisible();
  await expect(page.getByTestId('period-report')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '查看跑步回顾' })).toHaveCount(0);
  expect(anonymousReportRequests).toEqual([]);
  expect((await page.request.get('/api/v1/statistics/report?period=year&year=2024')).status()).toBe(401);
  expect((await page.request.get('/api/v1/showcase/statistics/report?period=year&year=2024')).status()).toBe(404);
  expect(
    (await page.request.get(`/api/v1/showcase/users/${member.username}/statistics/report?period=year&year=2024`)).status(),
  ).toBe(404);

  const ownerJanBefore = (await (await ownerApi.get('/api/v1/statistics/report?period=month&year=2024&month=1')).json()).data;
  const ownerFebBefore = (await (await ownerApi.get('/api/v1/statistics/report?period=month&year=2024&month=2')).json()).data;

  await login(page, member, '/workspace/activities');
  await importTrack(page, datedTcx('2024-01-15T00:00:00Z', 1500, 5000, 'jan-2024.tcx'));
  await importTrack(page, datedTcx('2024-02-29T00:00:00Z', 600, 2000, 'leap-2024.tcx'));

  // Signed-in non-owner visiting site owner's /records does not see own period report mixed in.
  await page.goto('/records');
  await expect(page.locator('[data-testid="records-ready"], [data-testid="records-empty"]').first()).toBeVisible();
  await expect(page.getByTestId('period-report')).toHaveCount(0);

  await page.goto('/workspace/records');
  const card = page.getByTestId('period-report');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-testid="period-report-ready"], [data-testid="period-report-empty"]').first()).toBeVisible();

  // Check January 2024 monthly report.
  await card.getByLabel('选择月份', { exact: true }).fill('2024-01');
  await expect(card.getByTestId('period-report-count')).toHaveText('1 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('5 km');
  await expect(card.getByTestId('period-report-duration')).toHaveText('25:00');
  await expect(card.getByTestId('period-report-pace')).toContainText('5:00 /km');
  await expect(card.getByTestId('period-report-range')).toContainText('2024-01-01 至 2024-01-31');

  // Delayed non-empty -> non-empty switch (2024-01 -> 2024 year): title, aria-label, dates and metrics stay locked to Jan until resolved.
  const annualGate = gate();
  let holdAnnual = true;
  await page.route(/\/api\/v1\/statistics\/report\?/, async (route) => {
    const url = new URL(route.request().url());
    if (holdAnnual && url.searchParams.get('period') === 'year' && url.searchParams.get('year') === '2024') {
      holdAnnual = false;
      await annualGate.pending;
    }
    return route.continue();
  });
  await card.getByTestId('period-report-mode').getByRole('button', { name: '年度' }).click();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  const range = card.getByTestId('period-report-range');
  await expect(range.locator('.period-name')).toHaveText('2024 年 1 月');
  await expect(range).toContainText('2024-01-01 至 2024-01-31');
  await expect(card.getByTestId('period-report-refreshing')).toHaveText('正在读取 2024 年…');
  await expect(card.getByTestId('period-report-metrics')).toHaveAttribute('aria-label', '2024 年 1 月跑步报告核心指标');
  await expect(card.getByTestId('period-report-distance')).toHaveText('5 km');
  annualGate.release();
  await expect(card).toHaveAttribute('aria-busy', 'false');
  await expect(range.locator('.period-name')).toHaveText('2024 年');
  await expect(range).toContainText('2024-01-01 至 2024-12-31');
  await expect(card.getByTestId('period-report-metrics')).toHaveAttribute('aria-label', '2024 年跑步报告核心指标');
  await expect(card.getByTestId('period-report-count')).toHaveText('2 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('7 km');
  await expect(card.getByTestId('period-report-duration')).toHaveText('35:00');
  await page.unroute(/\/api\/v1\/statistics\/report\?/);

  // Step to empty 2023, then verify delayed empty -> non-empty switch back to 2024.
  await card.getByRole('button', { name: '上一年' }).click();
  await expect(card.getByTestId('period-report-empty')).toContainText('2023 年没有跑步记录');
  const emptyToFilledGate = gate();
  let holdFilled = true;
  await page.route(/\/api\/v1\/statistics\/report\?/, async (route) => {
    const url = new URL(route.request().url());
    if (holdFilled && url.searchParams.get('period') === 'year' && url.searchParams.get('year') === '2024') {
      holdFilled = false;
      await emptyToFilledGate.pending;
    }
    return route.continue();
  });
  await card.getByRole('button', { name: '下一年' }).click();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  await expect(range.locator('.period-name')).toHaveText('2023 年');
  await expect(card.getByTestId('period-report-empty')).toContainText('2023 年没有跑步记录');
  await expect(card.getByTestId('period-report-refreshing')).toHaveText('正在读取 2024 年…');
  emptyToFilledGate.release();
  await expect(card.getByTestId('period-report-ready')).toBeVisible();
  await expect(range.locator('.period-name')).toHaveText('2024 年');
  await expect(card.getByTestId('period-report-count')).toHaveText('2 次');
  await page.unroute(/\/api\/v1\/statistics\/report\?/);

  // Cross-account isolation: site owner's reports for 2024-01 and 2024-02 are completely unchanged by member's imports.
  const ownerJanAfter = await ownerApi.get('/api/v1/statistics/report?period=month&year=2024&month=1');
  const ownerFebAfter = await ownerApi.get('/api/v1/statistics/report?period=month&year=2024&month=2');
  expect(ownerJanAfter.status()).toBe(200);
  expect(ownerFebAfter.status()).toBe(200);
  expect((await ownerJanAfter.json()).data).toEqual(ownerJanBefore);
  expect((await ownerFebAfter.json()).data).toEqual(ownerFebBefore);

  await card.getByRole('link', { name: '查看跑步回顾' }).click();
  await expect(page).toHaveURL(/\/workspace\/records\/recap\?period=year&year=2024$/);
  await expect(page.getByTestId('recap-overview')).toContainText('7.00 km');
  await page.getByText('查看完整数据表').click();
  const yearly = page.getByRole('table', { name: '2024 年跑步回顾里程分布' });
  await expect(yearly.getByRole('row').nth(1)).toContainText('5.00');
  await expect(yearly.getByRole('row').nth(2)).toContainText('2.00');

  await page.goto('/workspace/records/recap?period=month&year=2024&month=2');
  await page.getByText('查看完整数据表').click();
  const february = page.getByRole('table', { name: '2024 年 2 月跑步回顾里程分布' });
  const leapWeek = february.getByRole('row').last();
  await expect(leapWeek).toContainText('2024-02-26 至 2024-02-29');
  await expect(leapWeek).toContainText('2.00');
});
