import { apiSession, expect, login, owner, test, write } from './support/fixtures';
import { equatorGpx, importTrack } from './support/tracks';

test('a member binds their own activity and the site owner cannot read or change that binding', async ({
  page,
  context,
  baseURL,
  member,
}) => {
  await login(page, member, '/workspace/activities');
  await expect(page.getByRole('link', { name: '跑鞋', exact: true })).toBeVisible();
  const path = await importTrack(page, equatorGpx());
  const identifier = path.split('/').at(-1)!;
  await page.getByRole('link', { name: '跑鞋', exact: true }).click();
  await page.getByRole('button', { name: '添加跑鞋' }).click();
  const editor = page.getByRole('dialog', { name: '添加跑鞋' });
  await editor.getByLabel('鞋名').fill('浏览器验收跑鞋');
  await editor.getByLabel('初始里程（km）').fill('1');
  await editor.getByRole('button', { name: '保存跑鞋', exact: true }).click();
  await expect(page.getByRole('heading', { name: '浏览器验收跑鞋' })).toBeVisible();
  const shoes = await context.request.get('/api/v1/me/shoes');
  expect(shoes.status()).toBe(200);
  const [shoe] = (await shoes.json()).data.items;

  await page.goto(path);
  const binding = page.getByRole('region', { name: '活动的跑鞋' });
  await expect(binding).toContainText('未绑定');
  await binding.getByRole('combobox').selectOption(shoe.id);
  await binding.getByRole('button', { name: '保存跑鞋' }).click();
  await expect(binding.getByRole('status')).toHaveText('已保存跑鞋');
  await page.reload();
  await expect(binding.getByRole('combobox')).toHaveValue(shoe.id);

  await page.goto('/activities/shoes');
  await expect(page).toHaveURL(/\/workspace\/activities\/shoes$/);
  await expect(page.getByRole('region', { name: '跑鞋详情' }).getByRole('heading', { name: shoe.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: '关联活动' })).toBeVisible();

  const api = await apiSession(baseURL!, owner);
  try {
    const shoeUrl = '/api/v1/me/shoes/' + shoe.id;
    const bindingUrl = '/api/v1/me/activities/' + identifier + '/shoe';
    expect((await api.get(shoeUrl)).status()).toBe(404);
    expect((await api.get(bindingUrl)).status()).toBe(404);
    expect((await write(api, 'PATCH', bindingUrl, { shoe_id: null })).status()).toBe(404);
    expect((await (await context.request.get(bindingUrl)).json()).data.shoe.id).toBe(shoe.id);
  } finally {
    await api.dispose();
  }
});
