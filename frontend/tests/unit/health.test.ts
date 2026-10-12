import { describe, expect, it } from 'vitest';
import { getHealth } from '../../src/lib/api/health';

describe('health API client', () => {
  it('requests the same-origin health API and returns readiness', async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(input).toBe('/api/health');
      return Response.json({
        data: { status: 'ok', database: 'connected', postgis: 'enabled', schema: 'current' },
        error: null,
        meta: { request_id: 'test-request' }
      });
    };
    await expect(getHealth(fetcher)).resolves.toEqual({
      status: 'ok', database: 'connected', postgis: 'enabled', schema: 'current'
    });
  });

  it('surfaces database-unavailable errors instead of claiming success', async () => {
    const fetcher: typeof fetch = async () => Response.json({
      data: null,
      error: { code: 'DEPENDENCY_UNAVAILABLE', message: '数据库尚未就绪', details: [] },
      meta: { request_id: 'test-request' }
    }, { status: 503 });
    await expect(getHealth(fetcher)).rejects.toThrow('数据库尚未就绪');
  });

  it('reports invalid proxy responses clearly', async () => {
    const fetcher: typeof fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
    await expect(getHealth(fetcher)).rejects.toThrow('后端返回了无效响应');
  });

  it('rejects null JSON instead of exposing a property-access error', async () => {
    const fetcher: typeof fetch = async () => Response.json(null);
    await expect(getHealth(fetcher)).rejects.toThrow('后端返回了无效响应');
  });

  it('does not accept incomplete data as database readiness', async () => {
    const fetcher: typeof fetch = async () => Response.json({ data: { status: 'ok' }, error: null });
    await expect(getHealth(fetcher)).rejects.toThrow('后端返回了无效响应');
  });
});
