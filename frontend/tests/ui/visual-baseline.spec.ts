import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

// The synthetic API has a few clock-dependent responses; pin those as well as the browser clock.
const today = '2026-10-15';
test.use({ browserName: 'chromium', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' });

for (const theme of ['light', 'dark'] as const) {
  for (const device of ['desktop', 'mobile'] as const) {
    for (const view of ['dashboard', 'wellbeing'] as const) {
      test(`${view} ${theme} ${device}`, async ({ page }) => {
        await page.setViewportSize(device === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
        await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'));
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript(value => localStorage.setItem('runnote-theme', value), theme);
        await page.route('**/api/v1/**/statistics/streaks', route => route.fulfill({ json: {
          data: { today, current_days: 0, longest_days: 0, current_weeks: 0, longest_weeks: 0,
            week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${12 + i}`, active: false })) }, error: null
        } }));
        await page.route('**/api/v1/me/wellbeing/days/*', route => route.fulfill({ json: {
          data: { date: today, today, timezone: 'Asia/Shanghai', entry: null, doses: [], symptoms: [] }, error: null
        } }));
        await loginRunner(page);
        await page.goto(view === 'dashboard' ? '/?year=2026' : '/wellbeing');
        if (view === 'dashboard') {
          await expect(page.getByTestId('annual-distance')).toBeVisible();
          await expect(page.getByTestId('records-banner')).toBeVisible();
        } else {
          await expect(page.getByTestId('wellbeing-status')).toHaveText('今天还没有记录');
        }
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${view}-${theme}-${device}.png`, {
          fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002,
          mask: [page.locator('canvas'), page.locator('.maplibregl-map')]
        });
      });
    }
  }
}
