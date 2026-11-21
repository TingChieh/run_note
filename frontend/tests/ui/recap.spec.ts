import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities';

const recap = '/workspace/records/recap';
const report = /\/api\/v1\/statistics\/report\?/;
const trends = /\/api\/v1\/statistics\/trends\?/;

test('the recap requires a session and links from the loaded personal period', async ({ page }) => {
  await page.goto(recap + '?period=year&year=2025');
  await expect(page).toHaveURL(/\/admin\?next=/);
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看跑步回顾' })).toHaveCount(0);
  await loginRunner(page);
  await page.goto('/records');
  await page.getByRole('button', { name: '年度', exact: true }).click();
  const entry = page.getByRole('link', { name: '查看跑步回顾' });
  await expect(entry).toHaveAttribute('href', /period=year&year=\d{4}/);
  await entry.click();
  await expect(page.getByRole('heading', { name: /年跑步回顾/, level: 1 })).toBeVisible();
});

test('switching period keeps the loaded heading until both reads finish and preserves browser history', async ({
  page,
}) => {
  await loginRunner(page);
  await page.goto(recap + '?period=month&year=2024&month=2');
  await expect(page.getByRole('button', { name: '生成分享图' })).toBeEnabled();
  await page.getByText('查看完整数据表').click();
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(6);
  await expect(table.getByRole('row').last()).toContainText('2024-02-26 至 2024-02-29');
  await expect(page.getByTestId('recap-overview')).toContainText(/平均配速\s*—\s*（数据缺失）/);
  await expect(page.getByText(/峰值/)).toHaveCount(0);

  let release!: () => void;
  const requested = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(trends, async (route) => {
    await requested;
    await route.continue();
  });
  const previous = page.getByRole('button', { name: '上一个月' });
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('正在读取 2024 年 1 月');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2024 年 2 月跑步回顾');
  await expect(previous).toBeFocused();
  await expect(page.getByRole('button', { name: '生成分享图' })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2024 年 1 月跑步回顾');
  await expect(page.getByRole('button', { name: '生成分享图' })).toBeEnabled();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2024 年 2 月跑步回顾');
});

test('load, empty, trend error recovery, and expired session', async ({ page }) => {
  await loginRunner(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(report, async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto(recap + '?period=year&year=2023');
  await expect(page.getByTestId('page-skeleton')).toBeVisible();
  release();
  await expect(page.getByText('这个周期还没有跑步记录')).toBeVisible();
  const unavailable = { data: null, error: { code: 'UNAVAILABLE', message: '统计服务暂不可用' } };
  await page.route(report, (route) => route.fulfill({ status: 503, json: unavailable }), { times: 1 });
  await page.getByRole('button', { name: '下一年' }).click();
  await expect(page.getByText('统计服务暂不可用')).toBeVisible();
  await page.route(trends, (route) => route.fulfill({ status: 503, json: unavailable }), { times: 1 });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByTestId('recap-overview')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成分享图' })).toHaveCount(0);
  await expect(page.getByTestId('recap-rhythm-spread')).toHaveCount(0);
  await page.getByRole('button', { name: '重试读取分布' }).click();
  await expect(page.getByRole('button', { name: '生成分享图' })).toBeEnabled();
  await expect(page.getByTestId('recap-rhythm-spread')).toBeVisible();
  await page.route(trends, async (route) => {
    await page.context().clearCookies();
    await route.fulfill({ status: 401, json: { data: null } });
  });
  await page.getByRole('button', { name: '下一年' }).click();
  await expect(page).toHaveURL(/\/admin\?reason=expired&next=.*year%3D2025/);
  await expect(page.getByTestId('recap-overview')).toHaveCount(0);
});

test('interactive terrain keyboard navigation syncs with attendance matrix and respects reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginRunner(page);
  await page.goto(recap + '?period=year&year=2025');

  await expect(page.getByTestId('recap-overview')).toContainText('186.00');
  const inspector = page.getByTestId('recap-terrain-inspector');
  await expect(inspector).toContainText('10月 · 峰值');

  const terrain = page.getByTestId('recap-terrain-chart');
  const octNode = terrain.locator('[data-bucket-index="9"]');
  await octNode.focus();
  await expect(octNode).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('ArrowRight');
  const novNode = terrain.locator('[data-bucket-index="10"]');
  await expect(novNode).toBeFocused();
  await expect(novNode).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toContainText('11月');

  // Synced with 03A Attendance Matrix.
  const attendance = page.getByTestId('recap-attendance-grid');
  await expect(attendance.getByRole('button', { name: /^11月/ })).toHaveAttribute('aria-pressed', 'true');

  // Clicking a ring in 03A updates the terrain inspector.
  const janRing = attendance.getByRole('button', { name: /^1月/ });
  await janRing.click();
  await expect(janRing).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toContainText('1月');

  // 03B Pace profile renders SVG curve.
  await expect(page.getByTestId('recap-pace-chart').locator('svg')).toBeVisible();

  // Chapter 04 dock opens dialog and restores focus to dock button on Escape.
  const dockLaunch = page.getByRole('button', { name: '打开高清预览与保存' });
  await dockLaunch.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '分享图预览' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(dockLaunch).toBeFocused();
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${viewport.name} ${scheme} recap fits and produces local PNGs`, async ({ page }, info) => {
      await loginRunner(page);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize(viewport);
      await page.addInitScript((theme) => localStorage.setItem('runnote-theme', theme), scheme);
      await page.goto(recap + '?period=year&year=2025');
      const launch = page.getByRole('button', { name: '生成分享图' });
      await expect(launch).toBeEnabled();
      await expect(page.getByTestId('recap-overview')).toContainText('186.00');
      // Wait for Chapter 04 mini poster preview image to render before capturing full-page screenshot.
      const dockImg = page.getByTestId('recap-poster-dock').getByRole('img');
      await expect(dockImg).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await page.screenshot({
        path: info.outputPath(`${viewport.name}-${scheme}.png`),
        fullPage: true,
        animations: 'disabled',
      });

      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await launch.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '分享图预览' });
      await expect(dialog).toContainText('包含私人跑步记录的汇总');
      await expect(dialog.getByRole('button', { name: '关闭' })).toBeFocused();
      const image = dialog.getByRole('img');
      await expect(image).toHaveAccessibleName(/2025 年跑步回顾.*版式 A 特刊.*总里程 186.00 km.*平均配速 6:00 \/km/);
      expect(
        await image.evaluate(async (img: HTMLImageElement) => {
          await img.decode();
          return [img.naturalWidth, img.naturalHeight];
        }),
      ).toEqual([1080, 1920]);
      await expect(dialog.getByRole('button', { name: '系统分享' })).toHaveCount(0);

      // Download A/B/C styles on desktop so every variant is captured and verified.
      const styles =
        viewport.name === 'desktop'
          ? [
              { btn: 'A 特刊', slug: 'a-editorial' },
              { btn: 'B 环道', slug: 'b-telemetry' },
              { btn: 'C 存根', slug: 'c-receipt' },
            ]
          : [{ btn: 'A 特刊', slug: 'a-editorial' }];

      let previousHref = '';
      for (const style of styles) {
        const styleButton = dialog.getByTestId('recap-poster-styles').getByRole('button', { name: style.btn });
        if ((await styleButton.getAttribute('aria-pressed')) !== 'true') {
          await styleButton.click();
          await expect(styleButton).toHaveAttribute('aria-pressed', 'true');
          await expect(dialog.getByRole('link', { name: '保存 PNG' })).not.toHaveAttribute('href', previousHref);
        }
        const downloadLink = dialog.getByRole('link', { name: '保存 PNG' });
        previousHref = (await downloadLink.getAttribute('href')) ?? '';
        const download = page.waitForEvent('download');
        await downloadLink.click();
        const png = await download;
        expect(png.suggestedFilename()).toBe('runnote-recap-2025.png');
        await png.saveAs(info.outputPath(`poster-${style.slug}-${viewport.name}-${scheme}.png`));
      }

      expect(
        requests.filter(
          (url) => !url.startsWith('blob:') && (!url.startsWith('http://127.0.0.1:5191/') || url.includes('/api/')),
        ),
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(launch).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}

test('current cutoff reaches Canvas across A/B/C styles, themes change exported PNG, and 320px does not overflow', async ({
  page,
}, info) => {
  await loginRunner(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('runnote-theme', 'light');
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    const texts: string[] = [];
    const files: File[] = [];
    Object.assign(window, { collectedRecapText: texts, sharedRecapFiles: files });
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas.width === 1080 && this.canvas.height === 1920) texts.push(text);
      return fillText.call(this, text, ...args);
    };
    Object.defineProperty(navigator, 'canShare', { value: (data: ShareData) => data.files?.[0]?.type === 'image/png' });
    Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => files.push(...(data.files ?? [])) });
  });
  await page.goto(recap);
  const launch = page.getByRole('button', { name: '生成分享图' });
  await expect(launch).toBeEnabled();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/年跑步回顾/);
  await page.getByRole('button', { name: '月度', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/月跑步回顾/);
  await expect(launch).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await launch.click();
  const dialog = page.getByRole('dialog', { name: '分享图预览' });
  const button = dialog.getByRole('button', { name: '系统分享' });
  const downloadLink = dialog.getByRole('link', { name: '保存 PNG' });
  await expect(button).toBeEnabled();
  const firstUrl = (await downloadLink.getAttribute('href'))!;

  // Measure average luminance of the lower paper area (y=1200) so light vs dark is unambiguous for all styles.
  const inspectLuminance = () =>
    dialog.getByRole('img').evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const [r, g, b] = ctx.getImageData(20, 1200, 1, 1).data;
      return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    });

  const lightLum = await inspectLuminance();
  await dialog.getByLabel('图片外观').selectOption('dark');
  await expect(downloadLink).not.toHaveAttribute('href', firstUrl);
  expect(await inspectLuminance()).toBeLessThan(lightLum);

  // Switch to Style C (存根) and export monthly dark + light receipt posters too.
  const styleC = dialog.getByTestId('recap-poster-styles').getByRole('button', { name: 'C 存根' });
  const darkAUrl = (await downloadLink.getAttribute('href'))!;
  await styleC.click();
  await expect(styleC).toHaveAttribute('aria-pressed', 'true');
  await expect(downloadLink).not.toHaveAttribute('href', darkAUrl);
  const darkDownload = page.waitForEvent('download');
  await downloadLink.click();
  await (await darkDownload).saveAs(info.outputPath('poster-month-c-dark.png'));

  const darkCUrl = (await downloadLink.getAttribute('href'))!;
  await dialog.getByLabel('图片外观').selectOption('light');
  await expect(downloadLink).not.toHaveAttribute('href', darkCUrl);
  const lightDownload = page.waitForEvent('download');
  await downloadLink.click();
  await (await lightDownload).saveAs(info.outputPath('poster-month-c-light.png'));

  await button.click();
  const captured = await page.evaluate(() => {
    const { collectedRecapText, sharedRecapFiles } = window as unknown as {
      collectedRecapText: string[];
      sharedRecapFiles: File[];
    };
    return { texts: collectedRecapText, names: sharedRecapFiles.map((file) => file.name) };
  });
  expect(captured.texts).toContain('RunNote');
  expect(captured.texts.some((text) => /^进行中 · 截至 \d\d\.\d\d$/.test(text))).toBe(true);
  expect(captured.texts).toContain('02 · PUNCH-CARD RHYTHM');
  expect(captured.names).toEqual([expect.stringMatching(/^runnote-recap-\d{4}-\d{2}\.png$/)]);

  // Earlier Object URL must already be revoked.
  expect(
    await page.evaluate(
      async (url) =>
        fetch(url).then(
          () => true,
          () => false,
        ),
      firstUrl,
    ),
  ).toBe(false);

  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
