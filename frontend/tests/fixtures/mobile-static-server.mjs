import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '../android/public');
const port = Number(process.argv[3] ?? 4195);

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  const candidate = resolve(root, `.${urlPath}`);
  let target = join(root, 'index.html');
  if (candidate.startsWith(root)) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) target = candidate;
    } catch {
      // SPA fallback to index.html, matching Capacitor WebViewLocalServer.
    }
  }
  try {
    const content = await readFile(target);
    const type = MIME[extname(target)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mobile static server listening on http://127.0.0.1:${port}\n`);
});
