import { apiSession, expect, login, owner, test } from './support/fixtures';
import { equatorGpx, importTrack } from './support/tracks';

test('a member manages diary and photo via the proxy, and the site owner gets 404', async ({
  page,
  member,
  context,
  baseURL,
}) => {
  await login(page, member, '/workspace/activities');
  const activityPath = await importTrack(page, equatorGpx());
  await page.goto(activityPath);
  const id = activityPath.split('/').at(-1)!;
  const path = `/api/v1/me/activities/${id}/diary`;
  const diary = page.getByRole('region', { name: '跑步日记' });
  await diary.getByRole('button', { name: '记录日记' }).click();
  await diary.getByLabel('心情').selectOption('very_good');
  await diary.getByLabel('疲劳（RPE 1–10）').fill('7');
  await diary.getByLabel('备注').fill('隔离测试跑步日记');
  await diary.getByRole('button', { name: '保存日记' }).click();
  await expect(diary.getByText('隔离测试跑步日记')).toBeVisible();

  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 48;
    const painter = canvas.getContext('2d')!;
    painter.fillStyle = 'steelblue';
    painter.fillRect(0, 0, 80, 48);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await diary.getByLabel('添加照片').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes, 'base64'),
  });
  await expect(diary.getByRole('img', { name: '跑步照片 1' })).toBeVisible();
  await page.reload();
  await expect(diary.getByText('隔离测试跑步日记')).toBeVisible();
  await expect(diary.getByRole('img', { name: '跑步照片 1' })).toBeVisible();
  const response = await context.request.get(path);
  const [photo] = (await response.json()).data.diary.photos;
  const photoPath = path + '/photos/' + photo.id;
  expect((await context.request.get(photoPath)).headers()['cache-control']).toBe('private, no-store');

  const other = await apiSession(baseURL!, owner);
  try {
    expect((await other.get(path)).status()).toBe(404);
    expect((await other.get(photoPath)).status()).toBe(404);
  } finally {
    await other.dispose();
  }
  await diary.getByRole('button', { name: '删除日记', exact: true }).click();
  await diary.getByRole('button', { name: '确认删除日记' }).click();
  await expect(diary.getByText('还没有日记')).toBeVisible();
  expect((await context.request.get(photoPath)).status()).toBe(404);
});
