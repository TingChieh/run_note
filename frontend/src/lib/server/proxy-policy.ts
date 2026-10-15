const MAX_UPLOAD_BODY = 11 * 1024 * 1024;
export const isGpxUpload = (path: string, method: string) => method === 'POST' && ['/api/v1/gpx-imports', '/api/v1/tcx-imports', '/api/v1/mifitness-imports'].includes(path.split('?')[0]);
export const upstreamTimeout = (path: string, method: string) => isGpxUpload(path, method) ? 45000 : method === 'POST' && path.split('?')[0] === '/api/v1/ai-reports' ? 40000 : 8000;
export class ProxyBodyError extends Error { status = 413; }
export async function readProxyBody(request: Request, upload: boolean): Promise<ArrayBuffer | undefined> {
  if (['GET', 'HEAD'].includes(request.method)) return undefined;
  if (!upload) return request.arrayBuffer();
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_UPLOAD_BODY) throw new ProxyBodyError('轨迹上传请求不能超过 11 MiB');
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD_BODY) { await reader.cancel(); throw new ProxyBodyError('轨迹上传请求不能超过 11 MiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body.buffer;
}
