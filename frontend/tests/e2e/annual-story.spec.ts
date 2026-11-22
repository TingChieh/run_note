import { expect, login, test } from './support/fixtures';
import { importTrack } from './support/tracks';

function datedTcx(startIso: string, seconds: number, metres: number, name: string) {
  const startMs = Date.parse(startIso);
  const endIso = new Date(startMs + seconds * 1000).toISOString().replace('.000', '');
  const point = (time: string, lon: number, lat: number) =>
    `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position></Trackpoint>`;
  const xml =
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities>' +
    `<Activity Sport="Running"><Lap><TotalTimeSeconds>${seconds}</TotalTimeSeconds><DistanceMeters>${metres}</DistanceMeters>` +
    `<Track>${point(startIso, 120.1, 30.2)}${point(endIso, 120.12, 30.22)}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  return { name, mimeType: 'application/xml', buffer: Buffer.from(xml) };
}

test('private annual story isolates accounts, blocks anonymous access, and renders all beats from real backend', async ({
  page,
  member,
  ownerApi,
}) => {
  // Anonymous visitor cannot access story page or endpoint, and showcase route does not exist.
  await page.goto('/workspace/records/story?year=2025');
  await expect(page).toHaveURL(/\/admin\?next=/);
  expect((await page.request.get('/api/v1/statistics/annual-story?year=2025')).status()).toBe(401);
  expect((await page.request.get('/api/v1/showcase/statistics/annual-story?year=2025')).status()).toBe(404);
  expect(
    (await page.request.get(`/api/v1/showcase/users/${member.username}/statistics/annual-story?year=2025`)).status(),
  ).toBe(404);

  const ownerBefore = (await (await ownerApi.get('/api/v1/statistics/annual-story?year=2025')).json()).data;

  await login(page, member, '/workspace/activities');
  await importTrack(page, datedTcx('2025-01-05T00:00:00Z', 1650, 5000, 'first-2025.tcx'));
  await importTrack(page, datedTcx('2025-08-12T00:00:00Z', 3000, 10000, 'longest-2025.tcx'));

  await page.goto('/workspace/records');
  const card = page.getByTestId('period-report');
  await card.getByTestId('period-report-mode').getByRole('button', { name: '年度' }).click();
  await card.getByLabel('选择年份').selectOption('2025');
  await expect(card.getByTestId('period-report-ready')).toBeVisible();
  await card.getByRole('link', { name: '查看年度故事' }).click();

  await expect(page).toHaveURL(/\/workspace\/records\/story\?year=2025$/);
  await expect(page.getByTestId('story-prologue')).toContainText('15.00');
  await expect(page.getByTestId('story-chapter-first')).toContainText('5.00');
  await expect(page.getByTestId('story-chapter-longest')).toContainText('10.00');
  await expect(page.getByTestId('story-chapter-best')).toContainText('10km');

  await page.getByRole('button', { name: '生成海报' }).click();
  await expect(page.getByTestId('story-poster-image')).toBeVisible();
  await page.getByTestId('story-poster-dialog').getByRole('button', { name: '关闭' }).click();

  // Cross-account isolation: owner's 2025 story is untouched by member's runs.
  const ownerAfter = await ownerApi.get('/api/v1/statistics/annual-story?year=2025');
  expect(ownerAfter.status()).toBe(200);
  expect((await ownerAfter.json()).data).toEqual(ownerBefore);
});
