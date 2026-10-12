export interface HealthStatus {
  status: 'ok';
  database: 'connected';
  postgis: 'enabled';
  schema: 'current';
}

export async function getHealth(fetcher: typeof fetch = fetch): Promise<HealthStatus> {
  const response = await fetcher('/api/health', {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json' },
    credentials: 'same-origin'
  });
  let body: { data: HealthStatus | null; error: { message: string } | null };
  try {
    body = await response.json();
  } catch {
    throw new Error('后端返回了无效响应');
  }
  if (!body || typeof body !== 'object') {
    throw new Error('后端返回了无效响应');
  }
  if (!response.ok || body.error || !body.data) {
    throw new Error(body.error?.message ?? `健康检查失败（HTTP ${response.status}）`);
  }
  if (body.data.status !== 'ok' || body.data.database !== 'connected'
    || body.data.postgis !== 'enabled' || body.data.schema !== 'current') {
    throw new Error('后端返回了无效响应');
  }
  return body.data;
}
