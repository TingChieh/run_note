import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { installActivities, loginRunner, sampleActivity, syntheticReplay } from '../fixtures/activities';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/summary?**', (route) =>
    route.fulfill({ json: { data: { distance_m: 12500 }, error: null } }),
  );
});

/** `override` runs after the shared fixture: Playwright tries the most recently added route first. */
async function openReplay(page: Page, override?: () => Promise<unknown>) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installActivities(page);
  await override?.();
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '动态回放' }).click();
  const dialog = page.getByRole('dialog', { name: '动态回放' });
  await expect(dialog.getByTestId('replay-map-ready')).toBeVisible({ timeout: 20000 });
  return { dialog, errors };
}

test('replay plays, pauses, seeks, changes speed and camera, and restarts after the end', async ({ page }) => {
  const { dialog, errors } = await openReplay(page);
  await expect(dialog.getByText('经过时间', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('replay-distance')).toHaveText('0 km');
  await expect(dialog.getByTestId('replay-time')).toHaveText('0:00 / 13:35');
  const toggle = dialog.getByTestId('replay-toggle');

  await toggle.click();
  await expect(toggle).toHaveText('暂停');
  // About 46 track seconds pass per screen second at 1x: within a second the clock is well past the start.
  await expect
    .poll(async () => (await dialog.getByTestId('replay-elapsed').textContent())?.trim(), { timeout: 3000 })
    .not.toMatch(/^0:0\d$/);
  await toggle.click();
  await expect(toggle).toHaveText('播放');
  const paused = await dialog.getByTestId('replay-elapsed').textContent();
  await page.waitForTimeout(300);
  await expect(dialog.getByTestId('replay-elapsed')).toHaveText(paused!);

  await dialog.getByRole('button', { name: '10x' }).click();
  await expect(dialog.getByRole('button', { name: '10x' })).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  // 11.6 minutes inside segments plays in about 16 s at 1x, so 10x finishes in under 2 s.
  await expect(toggle).toHaveText('重新开始', { timeout: 5000 });
  await expect(dialog.getByTestId('replay-distance')).toHaveText('2.1 km');

  // Seek into the first segment: 300 s at 3 m/s is 900 m, with pace from the server.
  const slider = dialog.getByRole('slider', { name: '回放进度' });
  await slider.fill('300');
  await expect(dialog.getByTestId('replay-elapsed')).toHaveText('5:00');
  await expect(dialog.getByTestId('replay-distance')).toHaveText('0.9 km');
  await expect(dialog.getByTestId('replay-pace')).toHaveText('5:33 /km');
  await page.screenshot({ path: 'test-results/activity-replay-desktop.png' });
  // Inside the 2-minute signal gap the runner holds still: distance and moving time stop, elapsed time runs.
  await slider.fill('601');
  await expect(dialog.getByTestId('replay-distance')).toHaveText('1.8 km');
  await expect(dialog.getByTestId('replay-moving')).toHaveText('10:00');
  await expect(dialog.getByTestId('replay-pace')).toContainText('—');

  await dialog.getByRole('button', { name: '镜头跟随' }).click();
  await expect(dialog.getByRole('button', { name: '镜头跟随' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '全局视角' }).click();
  await expect(dialog.getByRole('button', { name: '全局视角' })).toHaveAttribute('aria-pressed', 'true');

  const max = await slider.getAttribute('max');
  await slider.fill(max!);
  await expect(toggle).toHaveText('重新开始');
  await expect(dialog.getByTestId('replay-distance')).toHaveText('2.1 km');
  await toggle.click();
  await expect(toggle).toHaveText('暂停');
  await dialog.getByRole('button', { name: '重新播放' }).click();
  await expect(toggle).toHaveText('暂停');

  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '动态回放' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('a track without reliable time is labelled simulated and shows no pace', async ({ page }) => {
  const { dialog, errors } = await openReplay(page, () =>
    page.route(/\/activities\/[^/]+\/replay$/, (route) =>
      route.fulfill({ json: { data: syntheticReplay('simulated'), error: null } }),
    ),
  );
  await expect(dialog.getByText('模拟用时')).toBeVisible();
  await expect(dialog.getByTestId('replay-moving')).toHaveCount(0);
  await dialog.getByRole('slider', { name: '回放进度' }).fill('300');
  await expect(dialog.getByTestId('replay-pace')).toContainText('—');
  expect(errors).toEqual([]);
});

test('replay dialog fits phones and keeps keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const { dialog } = await openReplay(page);
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const map = await dialog.locator('.replay-map').boundingBox();
  expect(map!.height).toBeGreaterThanOrEqual(190);
  await dialog.getByRole('slider', { name: '回放进度' }).fill('300');
  await page.screenshot({ path: 'test-results/activity-replay-mobile-dark.png' });
  // Every control fits on a phone screen without scrolling the dialog.
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  await dialog.getByTestId('replay-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByTestId('replay-toggle')).toHaveText('暂停');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('replay load failure offers a retry', async ({ page }) => {
  let failures = 1;
  await installActivities(page);
  await page.route(/\/activities\/[^/]+\/replay$/, (route) =>
    failures-- > 0
      ? route.fulfill({ status: 503, json: { data: null, error: { message: '暂时无法读取，请重试' } } })
      : route.fulfill({ json: { data: syntheticReplay(), error: null } }),
  );
  await page.goto(`/activities/${sampleActivity.id}`);
  await page.getByRole('button', { name: '动态回放' }).click();
  const dialog = page.getByRole('dialog', { name: '动态回放' });
  await expect(dialog.getByText('暂时无法读取，请重试')).toBeVisible();
  await dialog.getByRole('button', { name: '重新读取' }).click();
  await expect(dialog.getByTestId('replay-map-ready')).toBeVisible({ timeout: 20000 });
});

test('camera: follow, leave it by panning, back to the overview, and zooming keeps following', async ({ page }) => {
  const { dialog, errors } = await openReplay(page);
  const overview = dialog.getByRole('button', { name: '全局视角' }),
    follow = dialog.getByRole('button', { name: '镜头跟随' });
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  // A hand pan means "let me look": neither mode stays pressed.
  const map = await dialog.locator('.replay-map').boundingBox();
  await page.mouse.move(map!.x + map!.width / 2, map!.y + map!.height / 2);
  await page.mouse.down();
  await page.mouse.move(map!.x + map!.width / 2 + 120, map!.y + map!.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await expect(overview).toHaveAttribute('aria-pressed', 'false');
  await overview.click();
  await expect(overview).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  await dialog.getByTestId('replay-toggle').click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await overview.click();
  await expect(overview).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('visitors cannot export video', async ({ page }) => {
  const { dialog } = await openReplay(page);
  await expect(dialog.getByRole('button', { name: '导出视频' })).toHaveCount(0);
});

test('the owner exports a decodable H.264 MP4 at the chosen size and length', async ({ page }, info) => {
  test.setTimeout(240_000);
  await installActivities(page);
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await page.getByRole('button', { name: '动态回放' }).click();
  const dialog = page.getByRole('dialog', { name: '动态回放' });
  await expect(dialog.getByTestId('replay-map-ready')).toBeVisible({ timeout: 20000 });
  await dialog.getByRole('button', { name: '导出视频' }).click();
  const panel = dialog.getByRole('region', { name: '导出视频' });
  await panel.getByRole('button', { name: '1:1 方形' }).click();
  await panel.getByRole('button', { name: '720p' }).click();
  await panel.getByRole('button', { name: '15 秒' }).click();
  await panel.getByRole('button', { name: '深色地图' }).click();
  const started = Date.now();
  await panel.getByRole('button', { name: '开始导出' }).click();
  const progress = panel.getByTestId('video-progress');
  await expect(progress).toBeVisible();
  await expect(progress).toBeInViewport();
  await expect(progress.getByRole('button', { name: '取消导出' })).toBeVisible();
  // Drawing frames: a determinate bar with a frame count and a live preview of the frame being drawn.
  const bar = progress.getByRole('progressbar', { name: '视频导出进度' });
  await expect(progress.getByRole('status')).toHaveText('正在逐帧绘制视频…', { timeout: 60_000 });
  await expect
    .poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 60_000 })
    .toBeGreaterThan(10);
  await expect(progress).toContainText(/\d+% · \d+ \/ 450 帧/);
  await page.screenshot({ path: 'test-results/activity-replay-export-progress.png' });
  await expect(panel.getByTestId('video-result')).toBeVisible({ timeout: 200_000 });
  const result = panel.getByTestId('video-result');
  await expect(result.getByRole('status')).toContainText('视频已生成');
  await expect(result.getByRole('status')).toContainText(/720×720 · 15 秒 · [\d.]+ MB · 导出用时/);
  // The result card holds every follow-up action; the start button is gone until options change.
  await expect(result.getByRole('button', { name: '重新导出' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '开始导出' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/activity-replay-export-result.png' });
  await expect(panel.getByRole('button', { name: '保存 MP4' })).toBeFocused();
  info.annotations.push({ type: 'export-seconds', description: String((Date.now() - started) / 1000) });
  // Tiles are blocked in the synthetic suite, so the video falls back to the plain local background.
  await expect(panel).toContainText('底图暂不可用');
  await page.screenshot({ path: 'test-results/activity-replay-export.png' });
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: '保存 MP4' }).click();
  const file = info.outputPath('replay.mp4');
  await (await download).saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
  expect(bytes.subarray(bytes.readUInt32BE(0) + 4, bytes.readUInt32BE(0) + 8).toString('latin1')).toBe('moov');
  let probe: string | null = null;
  try {
    probe = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,nb_read_frames',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    info.annotations.push({ type: 'skipped', description: 'ffprobe not installed: decoding not checked' });
  }
  if (probe) {
    const [stream] = JSON.parse(probe).streams;
    expect(stream).toMatchObject({ codec_name: 'h264', width: 720, height: 720, nb_read_frames: '450' });
  }
});

test('the record header share menu opens the share image and the video export', async ({ page }) => {
  await installActivities(page);
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  const share = page.getByTestId('sport-hero').getByRole('button', { name: '分享', exact: true });
  await share.click();
  const menu = page.getByRole('group', { name: '分享这次跑步' });
  await expect(menu.getByRole('button')).toHaveText(['生成分享图', '导出视频']);
  await expect(menu).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/activity-share-menu.png' });

  await menu.getByRole('button', { name: '导出视频' }).click();
  const dialog = page.getByRole('dialog', { name: '动态回放' });
  await expect(dialog.getByRole('region', { name: '导出视频' })).toBeVisible({ timeout: 20000 });
  await expect(dialog.getByRole('button', { name: '导出视频' })).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: 'test-results/activity-share-video.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(share).toBeFocused();

  await share.click();
  await menu.getByRole('button', { name: '生成分享图' }).click();
  await expect(page.getByRole('dialog', { name: '生成分享图' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(share).toBeFocused();
});

test('visitors get no share menu', async ({ page }) => {
  await installActivities(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('heading', { name: sampleActivity.title, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '分享', exact: true })).toHaveCount(0);
});
