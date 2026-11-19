import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiSession, expect, login, owner, test } from './support/fixtures';

// backend/pyproject.toml is the single source of the version; the real backend reports it.
const version = /^version = "(\d+\.\d+\.\d+)"$/m.exec(readFileSync(resolve('../backend/pyproject.toml'), 'utf8'))![1];

test('only the site owner sees the running version', async ({ page, request, baseURL, member }) => {
  expect((await request.get('/api/v1/admin/version')).status()).toBe(401);

  const memberApi = await apiSession(baseURL!, member);
  const refused = await memberApi.get('/api/v1/admin/version');
  expect(refused.status()).toBe(403);
  expect(await refused.text()).not.toContain(version);
  await memberApi.dispose();

  await login(page, owner, '/settings/site');
  const card = page.getByTestId('version-info');
  await expect(card.getByTestId('app-version')).toHaveText(`v${version}`);
  // The e2e backend runs from the source tree, which has no RELEASE file.
  await expect(card).toContainText('本地源码运行（非发布包）');
});
