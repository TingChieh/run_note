import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { openImport } from '../../fixtures/activities';

// Synthetic tracks only (AGENTS.md section 11): the six-point equator GPX fixture and generated TCX.

export const equatorGpx = () => ({
  name: 'equator-six.gpx',
  mimeType: 'application/gpx+xml',
  buffer: readFileSync(new URL('../../../../backend/tests/fixtures/gpx/equator-six.gpx', import.meta.url)),
});

/** A two-point TCX lap with the given summary, starting at 2026-10-04T00:00Z on the equator. */
export function syntheticTcx(seconds: number, metres: number, name = 'synthetic.tcx') {
  const end = new Date(Date.UTC(2026, 9, 4) + seconds * 1000).toISOString().replace('.000', '');
  const point = (time: string, lon: number) =>
    `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position></Trackpoint>`;
  const xml =
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities>' +
    `<Activity Sport="Running"><Lap><TotalTimeSeconds>${seconds}</TotalTimeSeconds><DistanceMeters>${metres}</DistanceMeters>` +
    `<Track>${point('2026-10-04T00:00:00Z', 0)}${point(end, 0.001)}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  return { name, mimeType: 'application/xml', buffer: Buffer.from(xml) };
}

export type TrackFile = { name: string; mimeType: string; buffer: Buffer };

/** Import through the real form on the current activities page; returns the activity's page path. */
export async function importTrack(
  page: Page,
  file: TrackFile,
  before?: (page: Page) => Promise<void>,
): Promise<string> {
  await openImport(page);
  await page.locator('input[type=file][name=file]').setInputFiles(file);
  await before?.(page);
  const format = file.name.split('.').pop()!.toUpperCase();
  await page.getByRole('button', { name: `导入 ${format}`, exact: true }).click();
  const status = page.getByRole('status').filter({ hasText: '导入成功' });
  await expect(status).toBeVisible({ timeout: 30_000 });
  const href = await status.getByRole('link', { name: '查看活动与路线' }).getAttribute('href');
  expect(href).toMatch(/\/activities\/[0-9a-f-]{36}$/);
  return href!;
}

/** `/workspace/activities/<id>` and `/activities/<id>` both map to `/api/v1/activities/<id>`. */
export const apiPath = (pagePath: string) => `/api/v1/activities/${pagePath.split('/').pop()}`;
