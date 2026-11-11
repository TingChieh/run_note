import { expect, test } from '@playwright/test';

// Build-only: the dev server has no built root error node, so this runs from playwright.showcase-build.config.ts.
test('every page preloads the root error node the client start waits for', async ({ request }) => {
  for (const path of ['/dashboard', '/together', '/activities/missing-activity']) {
    const html = await (await request.get(path)).text();
    const preloads = [...html.matchAll(/<link href="([^"]+)" rel="modulepreload">/g)].map((match) => match[1]);
    const errorNode = preloads.filter((href) => /\/_app\/immutable\/nodes\/1\.[\w-]+\.js$/.test(href));
    expect(errorNode, path).toHaveLength(1);
    expect((await request.get(errorNode[0].replace(/^\.\//, '/'))).status()).toBe(200);
  }
});
