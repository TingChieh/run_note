import { expect, test, type Page } from '@playwright/test';

const id = '34567890-1234-4567-8899-012345678901';
const pagePath = `/activities/${id}`;
const apiPath = `/api/v1/me/activities/${id}/diary`;
const photo = { id: '10000000-0000-4000-8000-000000000002', width: 80, height: 48 };
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAwCAIAAAAJh2qgAAAAVElEQVRo3u3PAQ3AIADAMEDYxaEBwch4MjoF6/z2GS+1/h4ABgYGBgYGfifgesD1gOsB1wOuB1wPuB5wPeB6wPWA6wHXA64HXA+4HnA94HrA9YDrXaruAbQrE8xKAAAAAElFTkSuQmCC',
  'base64',
);

async function signIn(page: Page) {
  await page.goto('/admin?next=' + encodeURIComponent(pagePath));
  await page.getByLabel('邮箱', { exact: true }).fill('runner@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === pagePath);
}

test('edits and deletes a private diary with a photo', async ({ page }) => {
  type Fields = { mood: string; rpe: number; weather: string; notes: string };
  let entry: (Fields & { photos: (typeof photo)[] }) | null = null;
  await page.route('**' + apiPath, async (route) => {
    switch (route.request().method()) {
      case 'PUT':
        expect(route.request().headers()['x-csrf-token']).toBeTruthy();
        entry = { ...(route.request().postDataJSON() as Fields), photos: entry?.photos ?? [] };
        break;
      case 'DELETE':
        entry = null;
        await route.fulfill({ json: { data: { deleted: true }, error: null } });
        return;
    }
    await route.fulfill({ json: { data: { diary: entry }, error: null } });
  });
  await page.route('**' + apiPath + '/photos', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    entry?.photos.push(photo);
    await route.fulfill({ status: 201, json: { data: photo, error: null } });
  });
  await page.route('**' + apiPath + '/photos/' + photo.id, (route) =>
    route.fulfill({ body: png, contentType: 'image/png' }),
  );
  await signIn(page);
  const diary = page.getByRole('region', { name: '跑步日记' });
  await expect(diary.getByText('还没有日记')).toBeVisible();
  await diary.getByRole('button', { name: '记录日记' }).click();
  await expect(diary.getByLabel('心情')).toBeFocused();
  await diary.getByLabel('心情').selectOption('good');
  await diary.getByLabel('疲劳（RPE 1–10）').fill('7');
  await diary.getByLabel('天气').selectOption('rain');
  await diary.getByLabel('备注').fill('合成测试备注');
  await diary.getByRole('button', { name: '保存日记' }).click();
  await expect(diary.getByText('合成测试备注')).toBeVisible();
  await diary.getByLabel('添加照片').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  const picture = diary.getByRole('img', { name: '跑步照片 1' });
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(photo.width);
  await diary.getByRole('button', { name: '删除日记', exact: true }).click();
  await diary.getByRole('button', { name: '确认删除日记', exact: true }).click();
  await expect(diary.getByText('还没有日记')).toBeVisible();
  await expect(picture).toHaveCount(0);
});

test('public detail does not request the diary and private detail handles read failures', async ({ page }) => {
  let requests = 0;
  await page.route('**' + apiPath, async (route) => {
    requests++;
    const status = requests === 1 ? 403 : 401;
    await route.fulfill({ status, json: { data: null, error: { message: '无法读取日记' } } });
  });
  await page.goto(pagePath);
  await expect(page.getByRole('heading', { name: '合成活动', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: '跑步日记' })).toHaveCount(0);
  expect(requests).toBe(0);
  await signIn(page);
  const diary = page.getByRole('region', { name: '跑步日记' });
  await expect(diary.getByRole('alert')).toContainText('无法读取日记');
  await diary.getByRole('button', { name: '重新读取日记' }).click();
  await expect(page).toHaveURL(/\/admin\?reason=expired/);
});

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`renders the diary at ${width}×${height} in ${colorScheme} mode`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.route('**/api/v1/activities/' + id + '/shares', (route) =>
        route.fulfill({ json: { data: { items: [] }, error: null } }),
      );
      await page.route('**' + apiPath, (route) =>
        route.fulfill({
          json: {
            data: {
              diary: {
                mood: 'good',
                rpe: 7,
                weather: 'rain',
                notes: '合成验收备注\n' + '长文本'.repeat(75),
                photos: [photo],
              },
            },
            error: null,
          },
        }),
      );
      await page.route('**' + apiPath + '/photos/' + photo.id, (route) =>
        route.fulfill({ body: png, contentType: 'image/png' }),
      );
      await signIn(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      const diary = page.getByRole('region', { name: '跑步日记' });
      const edit = diary.getByRole('button', { name: '编辑日记' });
      const picture = diary.getByRole('img', { name: '跑步照片 1' });
      await expect(picture).toBeVisible();
      await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(photo.width);
      await diary.screenshot({ path: info.outputPath('display.png'), animations: 'disabled' });
      await edit.focus();
      await page.keyboard.press('Enter');
      const mood = diary.getByLabel('心情');
      await expect(mood).toBeFocused();
      if (width < 800) {
        const title = diary.getByRole('heading', { name: '跑步日记' });
        await expect
          .poll(() =>
            title.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return element.contains(document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2));
            }),
          )
          .toBe(true);
      }
      await expect(mood).toHaveValue('good');
      await expect(diary.getByLabel('疲劳（RPE 1–10）')).toHaveValue('7');
      await expect(diary.getByLabel('天气')).toHaveValue('rain');
      await expect(diary.getByLabel('备注')).toHaveValue(/^合成验收备注/);
      expect(await diary.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
        await diary.evaluate((element) => element.clientWidth),
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await diary.screenshot({ path: info.outputPath('editor.png'), animations: 'disabled' });
      await diary.getByRole('button', { name: '取消' }).click();
      await expect(edit).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}
