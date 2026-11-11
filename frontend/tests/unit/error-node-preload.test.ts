import { expect, it } from 'vitest';
import { addModulePreloads, nodeImports, rootErrorImports } from '../../src/lib/server/error-node-preload.ts';

const head = '<head><link href="./_app/immutable/entry/start.A1.js" rel="modulepreload"></head><body></body>';

it('adds only the imports the page does not preload yet', () => {
  const html = addModulePreloads(head, ['_app/immutable/entry/start.A1.js', '_app/immutable/nodes/1.B2.js']);
  expect(html).toBe(
    '<head><link href="./_app/immutable/entry/start.A1.js" rel="modulepreload">' +
      '<link href="/_app/immutable/nodes/1.B2.js" rel="modulepreload"></head><body></body>',
  );
});

it('leaves chunks without a head and fully preloaded pages untouched', () => {
  expect(addModulePreloads('<main></main>', ['_app/immutable/nodes/1.B2.js'])).toBe('<main></main>');
  expect(addModulePreloads(head, ['_app/immutable/entry/start.A1.js'])).toBe(head);
  expect(addModulePreloads(head, [])).toBe(head);
});

it('accepts only immutable client scripts from the built node', () => {
  expect(
    nodeImports({
      imports: ['_app/immutable/nodes/1.B2.js', '_app/immutable/chunks/C3.js', 'https://x.test/a.js', '"><script>', 7],
    }),
  ).toEqual(['_app/immutable/nodes/1.B2.js', '_app/immutable/chunks/C3.js']);
  expect(nodeImports(null)).toEqual([]);
  expect(nodeImports({ imports: 'x' })).toEqual([]);
});

it('finds nothing outside a build', async () => {
  expect(await rootErrorImports()).toEqual([]);
});
