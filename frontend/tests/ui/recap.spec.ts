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
      // Verify chart X-axis labels never overlap and stay >=12px across desktop/tablet/mobile too.
      for (const testId of ['recap-terrain-chart', 'recap-pace-chart']) {
        const check = await page.getByTestId(testId).evaluate((root) => {
          const labels = [...root.querySelectorAll<HTMLElement>('.slot-label')]
            .map((el) => ({
              fontSize: parseFloat(getComputedStyle(el).fontSize),
              rect: el.getBoundingClientRect(),
            }))
            .sort((a, b) => a.rect.left - b.rect.left);
          const overlaps = labels.slice(1).filter((curr, idx) => curr.rect.left < labels[idx].rect.right - 0.5);
          return {
            minFont: Math.min(...labels.map((l) => l.fontSize)),
            overlapCount: overlaps.length,
          };
        });
        expect(check.minFont).toBeGreaterThanOrEqual(12);
        expect(check.overlapCount).toBe(0);
      }
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

      const originPrefix = `${new URL(page.url()).origin}/`;
      expect(
        requests.filter((url) => !url.startsWith('blob:') && (!url.startsWith(originPrefix) || url.includes('/api/'))),
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

for (const narrow of [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'narrow-320', width: 320, height: 568 },
]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${narrow.name} ${scheme} keeps dual-axis chart labels and badges readable (>=12px) without overlap`, async ({
      page,
    }, info) => {
      await loginRunner(page);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width: narrow.width, height: narrow.height });
      await page.addInitScript((theme) => localStorage.setItem('runnote-theme', theme), scheme);
      await page.goto(recap + '?period=year&year=2025');
      await expect(page.getByTestId('recap-overview')).toContainText('186.00');
      await expect(page.getByTestId('recap-poster-dock').getByRole('img')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(narrow.width);

      for (const testId of ['recap-terrain-chart', 'recap-pace-chart']) {
        const stats = await page.getByTestId(testId).evaluate((root) => {
          const rootRect = root.getBoundingClientRect();
          const svg = root.querySelector('svg');
          const svgRect = svg?.getBoundingClientRect();
          const leftAxis = root.querySelector<HTMLElement>('[data-testid="recap-terrain-axis-left"], .pace-y-axis');
          const rightAxis = root.querySelector<HTMLElement>('[data-testid="recap-terrain-axis-right"]');
          const measure = (selector: string) =>
            [...root.querySelectorAll<HTMLElement>(selector)].map((el) => {
              const rect = el.getBoundingClientRect();
              const fontSize = parseFloat(getComputedStyle(el).fontSize);
              return {
                text: el.textContent?.trim() ?? '',
                fontSize,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
              };
            });
          const leftYLabels = measure('.axis-label-left, .pace-y-axis .axis-label');
          const rightYLabels = measure('.axis-label-right');
          const xLabels = measure('.slot-label');
          const badges = measure('.point-badge, .pace-fast-badge');
          const sortedX = [...xLabels].sort((a, b) => a.left - b.left);
          const xOverlaps = sortedX.slice(1).filter((curr, idx) => curr.left < sortedX[idx].right - 0.5);
          const verticalOverlaps = (items: typeof leftYLabels) => {
            const sorted = [...items].sort((a, b) => a.top - b.top);
            return sorted.slice(1).filter((curr, idx) => curr.top < sorted[idx].bottom - 0.5);
          };
          return {
            rootLeft: rootRect.left,
            rootRight: rootRect.right,
            svgLeft: svgRect?.left ?? 0,
            svgRight: svgRect?.right ?? 0,
            svgWidth: svgRect?.width ?? 0,
            svgHeight: svgRect?.height ?? 0,
            leftAxisRight: leftAxis?.getBoundingClientRect().right ?? 0,
            rightAxisLeft: rightAxis?.getBoundingClientRect().left ?? null,
            leftYLabels,
            rightYLabels,
            leftYOverlaps: verticalOverlaps(leftYLabels),
            rightYOverlaps: verticalOverlaps(rightYLabels),
            xLabels,
            badges,
            xOverlaps,
          };
        });

        expect(stats.svgHeight).toBeGreaterThanOrEqual(160);
        expect(stats.leftYLabels.length).toBeGreaterThanOrEqual(2);
        expect(stats.leftYOverlaps).toEqual([]);
        expect(stats.leftAxisRight).toBeLessThanOrEqual(stats.svgLeft + 1);
        if (testId === 'recap-terrain-chart') {
          expect(stats.rightYLabels).toHaveLength(3);
          expect(stats.rightYOverlaps).toEqual([]);
          expect(stats.rightAxisLeft).not.toBeNull();
          expect(stats.rightAxisLeft!).toBeGreaterThanOrEqual(stats.svgRight - 1);
        }
        expect(stats.xLabels.length).toBeGreaterThanOrEqual(4);
        expect(stats.xOverlaps).toEqual([]);
        expect(stats.badges.length).toBeGreaterThanOrEqual(1);
        for (const label of [...stats.leftYLabels, ...stats.rightYLabels, ...stats.xLabels, ...stats.badges]) {
          expect(label.fontSize).toBeGreaterThanOrEqual(12);
          expect(label.height).toBeGreaterThanOrEqual(12);
          expect(label.left).toBeGreaterThanOrEqual(stats.rootLeft - 2);
          expect(label.right).toBeLessThanOrEqual(stats.rootRight + 2);
        }
      }

      await page.screenshot({
        path: info.outputPath(`${narrow.name}-${scheme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(errors).toEqual([]);
    });
  }
}

test('dual-axis terrain aligns periodic left axis and cumulative right axis for 12x10km and equal-value cases, and HTML X-axis labels select buckets', async ({
  page,
}) => {
  await loginRunner(page);

  // Case 1: 12 months × 10 km = 120 km total (periodic max 10 km on left axis, cumulative 0..120 km on right axis).
  const months = Array.from({ length: 12 }, (_, idx) => {
    const start = `2025-${String(idx + 1).padStart(2, '0')}-01`;
    const end = idx === 11 ? '2026-01-01' : `2025-${String(idx + 2).padStart(2, '0')}-01`;
    return {
      bucket_start: start,
      bucket_end: end,
      is_partial: false,
      activity_count: 2,
      activity_days: 2,
      distance_m: '10000.000',
      duration_sum_seconds: '3600.000',
      known_duration_count: 2,
      missing_duration_count: 0,
      pace_eligible_count: 2,
      pace_eligible_distance_m: '10000.000',
      avg_pace_seconds_per_km: '360.000',
      quality_warning_count: 0,
      date_assignment: 'activity_local_date',
    };
  });
  await page.route(report, (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          period: 'year',
          year: 2025,
          month: null,
          date_from: '2025-01-01',
          date_to: '2026-01-01',
          is_partial: false,
          cutoff_date: null,
          today: '2026-11-21',
          activity_count: 24,
          activity_days: 24,
          distance_m: '120000.000',
          duration_sum_seconds: '43200.000',
          known_duration_count: 24,
          missing_duration_count: 0,
          pace_eligible_count: 24,
          pace_eligible_distance_m: '120000.000',
          avg_pace_seconds_per_km: '360.000',
          quality_warning_count: 0,
          date_assignment: 'activity_local_date',
        },
        error: null,
      },
    }),
  );
  await page.route(trends, (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          period: 'month',
          date_from: '2025-01-01',
          date_to: '2026-01-01',
          week_start: 'monday',
          date_assignment: 'activity_local_date',
          buckets: months,
        },
        error: null,
      },
    }),
  );

  await page.goto(recap + '?period=year&year=2025');
  const terrain = page.getByTestId('recap-terrain-chart');
  await expect(terrain.getByTestId('recap-terrain-axis-left')).toContainText('10');
  await expect(terrain.getByTestId('recap-terrain-axis-right')).toContainText('120');

  const dualCheck = await terrain.evaluate((root) => {
    const leftTexts = [...root.querySelectorAll('[data-testid="recap-terrain-axis-left"] .axis-label')].map((el) =>
      el.textContent?.trim(),
    );
    const rightTexts = [...root.querySelectorAll('[data-testid="recap-terrain-axis-right"] .axis-label')].map((el) =>
      el.textContent?.trim(),
    );
    const guideYs = [...root.querySelectorAll('line.guide-line')].map((el) => Number(el.getAttribute('y1')));
    const topY = Math.min(...guideYs);
    const bottomY = Math.max(...guideYs);
    const midY = (topY + bottomY) / 2;
    const cumD = root.querySelector('[data-testid="recap-terrain-cum-path"]')?.getAttribute('d') ?? '';
    const cumYs = [...cumD.matchAll(/[ML]\s+([\d.]+)\s+([\d.]+)/g)].map((m) => Number(m[2]));
    const pointYs = [...root.querySelectorAll('circle.point')].map((el) => Number(el.getAttribute('cy')));
    return { leftTexts, rightTexts, topY, midY, bottomY, cumYs, pointYs };
  });

  expect(dualCheck.leftTexts).toEqual(['10', '5', '0']);
  expect(dualCheck.rightTexts).toEqual(['120', '60', '0']);
  expect(dualCheck.pointYs).toHaveLength(12);
  // Every monthly 10 km point sits on the left-axis 10 km line (topY).
  for (const py of dualCheck.pointYs) {
    expect(py).toBeCloseTo(dualCheck.topY, 1);
  }
  // Cumulative line scales strictly against right axis (0..120 km): Jan=10/120, Jun=60/120 (midY), Dec=120/120 (topY).
  const span = dualCheck.bottomY - dualCheck.topY;
  expect(dualCheck.cumYs).toHaveLength(12);
  expect(dualCheck.cumYs[0]).toBeCloseTo(dualCheck.bottomY - (10 / 120) * span, 1);
  expect(dualCheck.cumYs[5]).toBeCloseTo(dualCheck.midY, 1);
  expect(dualCheck.cumYs[11]).toBeCloseTo(dualCheck.topY, 1);

  // Clicking an HTML X-axis slot label selects that month and updates the inspector with cumulative mileage.
  await terrain.locator('[data-slot-index="5"]').click();
  await expect(page.getByTestId('recap-terrain-inspector')).toContainText('6月');
  await expect(page.getByTestId('recap-terrain-inspector')).toContainText('累计 60.00 km');

  // Case 2: Cumulative equals bucket distance (month 1 = 10 km, month 2 = 0 km, total = 10 km) -> identical Y height at top.
  await page.unroute(report);
  await page.unroute(trends);
  await page.route(report, (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          period: 'year',
          year: 2026,
          month: null,
          date_from: '2026-01-01',
          date_to: '2026-03-01',
          is_partial: true,
          cutoff_date: '2026-02-28',
          today: '2026-02-28',
          activity_count: 1,
          activity_days: 1,
          distance_m: '10000.000',
          duration_sum_seconds: '3600.000',
          known_duration_count: 1,
          missing_duration_count: 0,
          pace_eligible_count: 1,
          pace_eligible_distance_m: '10000.000',
          avg_pace_seconds_per_km: '360.000',
          quality_warning_count: 0,
          date_assignment: 'activity_local_date',
        },
        error: null,
      },
    }),
  );
  await page.route(trends, (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          period: 'month',
          date_from: '2026-01-01',
          date_to: '2026-03-01',
          week_start: 'monday',
          date_assignment: 'activity_local_date',
          buckets: [
            { ...months[0], bucket_start: '2026-01-01', bucket_end: '2026-02-01', distance_m: '10000.000' },
            {
              ...months[1],
              bucket_start: '2026-02-01',
              bucket_end: '2026-03-01',
              activity_count: 0,
              activity_days: 0,
              distance_m: '0.000',
              duration_sum_seconds: null,
              known_duration_count: 0,
              pace_eligible_count: 0,
              pace_eligible_distance_m: '0.000',
              avg_pace_seconds_per_km: null,
            },
          ],
        },
        error: null,
      },
    }),
  );

  await page.goto(recap + '?period=year&year=2026');
  const equalCheck = await terrain.evaluate((root) => {
    const leftTexts = [...root.querySelectorAll('[data-testid="recap-terrain-axis-left"] .axis-label')].map((el) =>
      el.textContent?.trim(),
    );
    const rightTexts = [...root.querySelectorAll('[data-testid="recap-terrain-axis-right"] .axis-label')].map((el) =>
      el.textContent?.trim(),
    );
    const cumD = root.querySelector('[data-testid="recap-terrain-cum-path"]')?.getAttribute('d') ?? '';
    const cumYs = [...cumD.matchAll(/[ML]\s+([\d.]+)\s+([\d.]+)/g)].map((m) => Number(m[2]));
    const firstPointY = Number(root.querySelector('circle.point')?.getAttribute('cy'));
    return { leftTexts, rightTexts, cumYs, firstPointY };
  });
  expect(equalCheck.leftTexts).toEqual(['10', '5', '0']);
  expect(equalCheck.rightTexts).toEqual(['10', '5', '0']);
  expect(equalCheck.cumYs[0]).toBeCloseTo(equalCheck.firstPointY, 1);
  expect(equalCheck.cumYs[1]).toBeCloseTo(equalCheck.firstPointY, 1);
});

test('editorial receipt structure, punch-card sync, flat content buttons, and modal glass boundary', async ({
  page,
}) => {
  await loginRunner(page);
  await page.goto(recap + '?period=year&year=2025');

  const root = page.getByTestId('recap-page');
  await expect(root).toHaveClass(/editorial-page/);
  await expect(page.getByTestId('recap-overview')).toHaveClass(/receipt-sheet/);
  await expect(page.getByTestId('recap-overview').locator('.receipt-header')).toBeVisible();

  // Content buttons print flat (no Liquid Glass inside .editorial-page content area).
  const shareBtn = page.getByRole('button', { name: '生成分享图' });
  await expect(shareBtn).toBeEnabled();
  await expect(shareBtn).not.toHaveClass(/rn-glass-control/);

  // Punch-card rhythm columns sync with the terrain inspector and attendance ledger.
  const punch = page.getByTestId('recap-punch-rhythm');
  await expect(punch).toBeVisible();
  const mayPunch = punch.getByRole('button', { name: /^5月/ });
  await mayPunch.click();
  await expect(mayPunch).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('recap-terrain-inspector')).toContainText('5月');
  await expect(page.getByTestId('recap-attendance-grid').getByRole('button', { name: /^5月/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Share desk appearance switcher and style tabs work cleanly, and share dialog preserves data-glass-overlay.
  const dock = page.getByTestId('recap-poster-dock');
  const darkAppearance = dock.getByRole('button', { name: '深色暖炭' });
  await darkAppearance.click();
  await expect(darkAppearance).toHaveAttribute('aria-pressed', 'true');

  await shareBtn.click();
  const dialog = page.getByRole('dialog', { name: '分享图预览' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-glass-overlay', '');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(shareBtn).toBeFocused();
});

for (const vp of [
  { name: '1440x768', width: 1440, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
]) {
  test(`sticky share desk controls remain visible and clickable while mid-scrolled at ${vp.name}`, async ({ page }) => {
    await loginRunner(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(recap + '?period=year&year=2025');

    const dock = page.getByTestId('recap-poster-dock');
    await expect(dock.getByRole('img')).toBeVisible();
    const styleC = dock.getByRole('button', { name: 'C 存根' });
    const launchBtn = dock.getByRole('button', { name: '打开高清预览与保存' });

    for (const scrollY of [400, 800]) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      const boxes = await Promise.all([styleC.boundingBox(), launchBtn.boundingBox()]);
      for (const box of boxes) {
        expect(box, `control visible at scrollY=${scrollY}`).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
      }
    }

    await styleC.click();
    await expect(styleC).toHaveAttribute('aria-pressed', 'true');
    await launchBtn.click();
    const dialog = page.getByRole('dialog', { name: '分享图预览' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('in-progress partial month in punch-card rhythm uses hatched mark and accessible in-progress name', async ({
  page,
}) => {
  await loginRunner(page);
  await page.goto(recap);
  await expect(page.getByTestId('recap-partial-pill')).toContainText('进行中');

  const punch = page.getByTestId('recap-punch-rhythm');
  await expect(punch).toBeVisible();
  await expect(punch).toContainText('斜线为进行中');

  const partialCols = punch.locator('[data-partial="true"]');
  await expect(partialCols).toHaveCount(1);
  const partialBtn = partialCols.first();
  await expect(partialBtn).toHaveAccessibleName(/进行中（未结束）/);

  const bgImage = await partialBtn
    .locator('.punch-blk')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bgImage).toContain('repeating-linear-gradient');

  // Completed earlier month must not carry partial state or in-progress accessible name.
  const janBtn = punch.getByRole('button', { name: /^1月/ });
  await expect(janBtn).not.toHaveAttribute('data-partial', 'true');
  await expect(janBtn).not.toHaveAccessibleName(/进行中/);
});
