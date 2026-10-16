import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

// Run from frontend after pnpm build. Only in-memory fixture API and loopback ports.
/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

const output = await files('build');
for (const path of output) {
  assert(!/ui-showcase|Showcase/.test(path), `Unexpected showcase asset: ${path}`);
  if (!/\.(js|css|json|html|map)$/.test(path)) continue;
  const content = await readFile(path, 'utf8');
  for (const marker of ['RunNote 组件展示', 'ui-showcase', 'visual-reference']) {
    assert(!content.includes(marker), `Showcase marker ${marker} in ${path}`);
  }
}

// Refuse occupied ports rather than using or stopping a developer's service.
for (const port of [8191, 5194]) {
  const probe = createServer();
  probe.listen(port, '127.0.0.1');
  await once(probe, 'listening');
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve(undefined)));
}

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
/** @param {string[]} args @param {Record<string, string>} [env] */
function start(args, env = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit']
  });
  children.push(child);
  return child;
}
/** @param {string} url @param {import('node:child_process').ChildProcess} child */
async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(child.exitCode === null, `Fixture exited before readiness: ${url}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; }
    catch { /* Wait only for the owned process to start. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Readiness timeout: ${url}`);
}

try {
  const api = start(['tests/fixtures/ui-api.mjs']);
  await ready('http://127.0.0.1:8191/api/health', api);
  const app = start(['build/index.js'], {
    HOST: '127.0.0.1', PORT: '5194', ORIGIN: 'http://127.0.0.1:5194',
    INTERNAL_API_BASE_URL: 'http://127.0.0.1:8191'
  });
  await ready('http://127.0.0.1:5194/login', app);
  for (const path of ['/showcase', '/ui-showcase', '/tests/fixtures/ui-showcase/', '/main.ts']) {
    const response = await fetch(`http://127.0.0.1:5194${path}`, { redirect: 'manual' });
    assert.equal(response.status, 404, `Unexpected production route: ${path}`);
    console.log(`PASS production ${path}: 404`);
  }
  console.log(`PASS production output: ${output.length} files, no showcase markers/assets`);
} finally {
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  }));
}
