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

test('a signed-in member switches monthly and yearly reports in /workspace/records with strict account isolation', async ({
  page,
  member,
  ownerApi,
}) => {
  await login(page, member, '/workspace/activities');
  await importTrack(page, datedTcx('2026-10-04T00:00:00Z', 1500, 5000, 'oct-2026.tcx'));
  await importTrack(page, datedTcx('2024-02-29T00:00:00Z', 600, 2000, 'leap-2024.tcx'));

  await page.goto('/workspace/records');
  const card = page.getByTestId('period-report');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-testid="period-report-ready"], [data-testid="period-report-empty"]').first()).toBeVisible();

  // Check October 2026 monthly report.
  await card.getByLabel('选择月份', { exact: true }).fill('2026-10');
  await expect(card.getByTestId('period-report-count')).toHaveText('1 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('5 km');
  await expect(card.getByTestId('period-report-duration')).toHaveText('25:00');
  await expect(card.getByTestId('period-report-pace')).toContainText('5:00 /km');
  await expect(card.getByTestId('period-report-range')).toContainText('2026-10-01 至 2026-10-31');

  // Check leap-day February 2024 monthly report.
  await card.getByLabel('选择月份', { exact: true }).fill('2024-02');
  await expect(card.getByTestId('period-report-count')).toHaveText('1 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('2 km');
  await expect(card.getByTestId('period-report-duration')).toHaveText('10:00');
  await expect(card.getByTestId('period-report-pace')).toContainText('5:00 /km');
  await expect(card.getByTestId('period-report-range')).toContainText('2024-02-01 至 2024-02-29');

  // Switch to yearly mode for 2024, then step to empty 2023.
  await card.getByTestId('period-report-mode').getByRole('button', { name: '年度' }).click();
  await expect(card.getByTestId('period-report-count')).toHaveText('1 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('2 km');
  await expect(card.getByTestId('period-report-range')).toContainText('2024-01-01 至 2024-12-31');

  await card.getByRole('button', { name: '上一年' }).click();
  await expect(card.getByTestId('period-report-empty')).toContainText('2023 年没有跑步记录');

  // Cross-account isolation: another account (site owner) sees 0 runs for 2026-10.
  const other = await ownerApi.get('/api/v1/statistics/report?period=month&year=2026&month=10');
  expect(other.status()).toBe(200);
  expect((await other.json()).data.activity_count).toBe(0);
});
