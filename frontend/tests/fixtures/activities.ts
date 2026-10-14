import { expect, type Page } from '@playwright/test';
import type { Activity } from '../../src/lib/api/activities';
import type { Share } from '../../src/lib/api/sharing';
export const sampleActivity: Activity = {
  id: '11111111-1111-4111-8111-111111111111', title: '河畔晨跑', activity_date: '2026-10-13', timezone: 'Asia/Shanghai',
  started_at: '2026-10-13T00:00:00Z', ended_at: '2026-10-13T00:30:00Z', distance_m: '5123.456', elapsed_seconds: '1800', avg_pace_seconds_per_km: '351.3',
  temporal_quality: 'complete', visibility: 'private', allow_shared_route: false, quality_summary: { valid_point_count: 3, input_segment_count: 1, warnings: [] },
  metrics_version: 'gpx-v1', has_route: true, created_at: '2026-10-13T01:00:00Z'
};
export const incompleteActivity: Activity = { ...sampleActivity, id: '22222222-2222-4222-8222-222222222222', title: '缺少时间的长标题记录，用于检查手机布局和质量提示', activity_date: '2026-10-12', elapsed_seconds: null, avg_pace_seconds_per_km: null, temporal_quality: 'incomplete', visibility: 'unlisted', has_route: false, quality_summary: { missing_time_count: 2, warnings: ['TIME_INCOMPLETE'] } };
export async function loginRunner(page: Page) {
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill('runner@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
}
export async function installActivities(page: Page) {
  const state = {
    records: [{ ...sampleActivity }, { ...incompleteActivity }], links: [] as Share[],
    listFailures: 0, detailFailures: 0, uploadMode: 'success' as 'success' | 'error' | 'duplicate', uploadCount: 0,
    uploadBody: '', holdUpload: null as Promise<void> | null, writes: [] as { method: string; path: string; data: unknown }[]
  };
  await page.route(/\/api\/v1\/activities(?:\?|\/|$)/, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: { data, error: status >= 400 ? { message: '暂时无法读取，请重试' } : null } });
    if (path === '/api/v1/activities') {
      if (state.listFailures-- > 0) return send(null, 503);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return send({ items: state.records.slice(offset, offset + 20), total: state.records.length, limit: 20, offset });
    }
    if (req.method() !== 'GET') state.writes.push({ method: req.method(), path, data: req.postData() ? req.postDataJSON() : null });
    if (path.endsWith('/route')) return send({ type: 'FeatureCollection', start: [121.48,31.23], end: [121.49,31.237], features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[121.48,31.23],[121.485,31.235],[121.49,31.237]] }, properties: { segment_index: 0, point_count: 3 } }] });
    if (path.endsWith('/shares') && req.method() === 'GET') return send({ items: state.links });
    if (path.endsWith('/shares') && req.method() === 'POST') {
      const link: Share = { link_id: '33333333-3333-4333-8333-333333333333', created_at: '2026-10-13T02:00:00Z', expires_at: null, revoked_at: null, status: 'active' };
      state.links = [link]; return send({ link_id: link.link_id, share_url: 'http://127.0.0.1:5191/shared/synthetic-token', expires_at: null });
    }
    if (req.method() === 'DELETE') { state.links = state.links.map(link => ({ ...link, status: 'revoked', revoked_at: '2026-10-13T02:01:00Z' })); return send({}); }
    const item = state.records.find(record => path.endsWith(record.id));
    if (!item) return send(null, 404);
    if (req.method() === 'PATCH') {
      Object.assign(item, req.postDataJSON());
      if (item.visibility === 'private') state.links = state.links.map(link => ({ ...link, status: 'revoked' }));
      return send(item);
    }
    if (state.detailFailures-- > 0) return send(null, 503);
    return send(item);
  });
  await page.route('**/api/v1/gpx-imports', async route => {
    state.uploadCount++; state.uploadBody = route.request().postData() ?? '';
    if (state.holdUpload) await state.holdUpload;
    if (state.uploadMode === 'error') return route.fulfill({ status: 503, json: { error: { message: '上传暂时失败，请重试' } } });
    if (state.uploadMode === 'duplicate') return route.fulfill({ status: 409, json: { error: { code: 'DUPLICATE_GPX', message: '这条记录已经导入', details: [{ existing_activity_id: sampleActivity.id, duplicate_kind: 'raw' }] } } });
    const imported = { ...incompleteActivity, id: '44444444-4444-4444-8444-444444444444', title: '新导入的跑步', visibility: 'private' as const };
    state.records = [imported, ...state.records];
    return route.fulfill({ json: { data: { activity: imported, warnings: ['TIME_INCOMPLETE'] }, error: null } });
  });
  // Deterministic basemap outage: local GeoJSON should still render, with no external data calls.
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort());
  return state;
}
