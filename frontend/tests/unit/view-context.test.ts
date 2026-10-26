import { describe, expect, it } from 'vitest';
import { viewContext, contextPath, contextAPI } from '../../src/lib/api/view-context.ts';
describe('view context isolation', () => {
 it('keeps named links and reads under encoded subject', () => { const c = viewContext('/p/alice/activities', false); expect(contextPath(c, '/activities/a?offset=2')).toBe('/p/alice/activities/a?offset=2'); expect(contextAPI(c, '/api/v1/showcase/activities')).toBe('/api/v1/showcase/users/alice/activities'); expect(c.manage).toBe(false); });
 it('workspace uses own API even without public profile', () => { const c = viewContext('/workspace/dashboard', false); expect(c.manage).toBe(true); expect(contextAPI(c, '/api/v1/showcase/running-goals')).toBe('/api/v1/me/running-goals'); });
 it('root stays fixed read-only for ordinary identity', () => { const c=viewContext('/dashboard', false); expect(c.manage).toBe(false); expect(contextAPI(c,'/api/v1/showcase/activities')).toBe('/api/v1/showcase/activities'); expect(viewContext('/dashboard',true).manage).toBe(true); expect(viewContext('/p/alice/dashboard',true).manage).toBe(false); });
});
describe('context resource mapping', () => {
 it('never rewrites auth or mutations and encodes named subjects once', () => {
  const c=viewContext('/p/a%20b/ai', true);
  expect(contextAPI(c,'/api/v1/auth/session')).toBe('/api/v1/auth/session');
  expect(contextAPI(c,'/api/v1/showcase/ai-reports?limit=10')).toBe('/api/v1/showcase/users/a%20b/ai-reports?limit=10');
  expect(contextPath(c,'/activities/wall')).toBe('/p/a%20b/activities/wall');
  expect(contextPath(c,'/workspace/dashboard')).toBe('/workspace/dashboard');
  expect(contextPath(viewContext('/activities'), '/dashboard')).toBe('/');
  expect(contextPath(viewContext('/activities'), '/dashboard?year=2026')).toBe('/?year=2026');
  expect(contextPath(viewContext('/p/alice/dashboard'), '/dashboard')).toBe('/p/alice/dashboard');
  expect(contextPath(viewContext('/workspace/dashboard', true), '/dashboard')).toBe('/workspace/dashboard');
 });
});
describe('routes prefix', () => {
 it('prefixes the frequent routes pages by context', () => {
  expect(contextPath(viewContext('/p/runner/routes'), '/routes')).toBe('/p/runner/routes');
  expect(contextPath(viewContext('/workspace/routes'), '/routes/abc')).toBe('/workspace/routes/abc');
 });
});
describe('records path', () => {
 it('keeps the records page under named and workspace contexts', () => {
  expect(contextPath(viewContext('/p/alice/records'), '/records')).toBe('/p/alice/records');
  expect(contextPath(viewContext('/workspace/records'), '/records?year=2024')).toBe('/workspace/records?year=2024');
  expect(contextPath(viewContext('/records'), '/records')).toBe('/records');
 });
});
