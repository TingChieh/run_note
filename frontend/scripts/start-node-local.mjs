import { createServer } from 'node:http';
import { resolve } from 'node:path';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '5184');
const localHosts = new Set(['127.0.0.1', 'localhost']);

if (!localHosts.has(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Local adapter-node must bind to a loopback host and valid port');
}

const configuredOrigin = process.env.RUNNOTE_LOCAL_ORIGIN ?? `http://${host}:${port}`;
const origin = new URL(configuredOrigin);
if (origin.protocol !== 'http:' || !localHosts.has(origin.hostname) || origin.hostname !== host || origin.port !== String(port) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('RUNNOTE_LOCAL_ORIGIN must exactly match the local HTTP host and port');
}

const protocolHeader = 'x-runnote-local-protocol';
process.env.HOST = host;
process.env.PORT = String(port);
process.env.PROTOCOL_HEADER = protocolHeader;
process.env.BODY_SIZE_LIMIT ??= '11M';

const { handler } = await import(resolve('build/handler.js'));
const server = createServer((request, response) => {
  // This value is derived from this loopback-only HTTP listener, never from client headers.
  request.headers[protocolHeader] = 'http';
  handler(request, response, () => {
    response.statusCode = 404;
    response.end();
  });
});

server.listen(port, host, () => console.log(`Listening on ${origin.origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
